# Master Prompt: Izgradnja aplikacije Dom Obroki

Ta dokument predstavlja celovit "master" prompt in natančno tehnično-funkcionalno specifikacijo za izgradnjo spletne aplikacije **Dom Obroki** (celovit sistem za naročanje prehrane, organizacijo kuhinje, vodenje večerne prisotnosti in evidenco dijakov v dijaškem domu).

---

```markdown
Ti si vrhunski full-stack programer in programski arhitekt. Tvoja naloga je od začetka zgraditi celovito spletno aplikacijo za upravljanje prehrane, kuhinje, večerne prisotnosti in evidence dijakov v dijaškem domu z imenom **"Dom Obroki"**.

Aplikacija mora biti pripravljena za produkcijsko uporabo tako v lokalnem omrežju dijaškega doma (Node.js HTTP strežnik na operacijskih sistemih Linux/Windows ali storitev systemd) kot tudi v oblaku (serverless funkcije / Node.js API) z relacijsko podatkovno bazo PostgreSQL.

Spodaj so podrobne zahteve glede arhitekture, podatkovnega modela, poslovnih pravil, API-ja, uporabniškega vmesnika (UI) in izvoza dokumentov.

---

### 1. TEHNOLOŠKI SKLAD (TECH STACK) IN ARHITEKTURA

1. **Backend / API:**
   - **Node.js (ES module - ESM)** z minimalnimi zunanjimi odvisnostmi (`pg` za PostgreSQL povezavo, vgrajeni moduli `node:crypto`, `node:http`, `node:fs/promises`, `node:path`).
   - Enoten RPC-style API handler (JSON endpoint `POST /api`), ki sprejema telo `{ action: string, ...params }` z avtentikacijskim zaglavjem `Authorization: Bearer <token>`.
   - Vgrajena varna avtentikacija brez zunanjih težkih knjižnic:
     - Gesla zgoščena s `crypto.scryptSync` z naključnim soljenjem (salt 16 bajtov, dolžina ključa 64 bajtov, zapis `salt:hash`).
     - Lastni varni podpisani žetoni (HMAC-SHA256 z zgoščeno vsebino in tajnim ključem `secret` v bazi).
     - Obvezna sprememba začasnega gesla (`must_change: true`) ob prvi prijavi; žeton vsebuje oznako gesla (`pwTag`), ki ob spremembi gesla takoj razveljavi vse ostale odprte seje uporabnika.
   - Podpora za lokalni strežnik (`local/server.mjs`), ki streže zgrajeno statično spletno mesto (Single Page Application fallback na `index.html`) in posreduje klice `/api` neposredno v funkcijski handler.

2. **Frontend:**
   - **React** (sodoben funkcijski React s hooks: `useState`, `useEffect`, `useMemo`, `useRef`).
   - **Vite** kot orodje za grajenje (build tool) in razvojni strežnik.
   - Ikone: `lucide-react`.
   - Generiranje in branje dokumentov na odjemalcu:
     - Excel preglednice: uvoz in izvoz (.xlsx) brez težkih odvisnosti ali z lahkotno implementacijo ZIP/XML parserja.
     - Word dokumenti: polnjenje predlog (.docx) z zamenjavo oznak (XML DOM parsing znotraj ZIP arhiva).
     - Tiskanje: optimizirani CSS slogi za tiskanje (`@media print`) s skrivanjem navigacije in orodnih vrstic (`.no-print`).
   - Čist, odziven lasten CSS (modern UI s paleto čistih barv, karticami, prilagojenimi modalnimi okni, preglednicami z lepljivimi glavami `sticky header` in ločenim mobilnim pogledom za dijake).

3. **Baza podatkov:**
   - **PostgreSQL** z avtomatsko inicializacijo sheme (`CREATE TABLE IF NOT EXISTS`, migracije z `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
   - Tip podatkov `DATE` se vedno parsira in obravnava kot niz formata `YYYY-MM-DD` brez premikov časovnih pasov.

---

### 2. VLOGE (ROLES) IN PRAVICE (RIGHTS)

Sistem pozna **8 uporabniških vlog**:
1. `admin` (Skrbnik): Popoln dostop do vseh nastavitev, uporabnikov, revizijske sledi, brisanja neprimernih ocen, konfiguracije sistema.
2. `principal` (Ravnatelj): Pregled naročil, urejanje dijakov, prisotnost, kuhinja, mesečni pregled, uporabniki, ocene obrokov.
3. `teacher` (Vzgojitelj): Upravljanje naročil za dijake (posamično in masovno), urejanje podatkov dijakov, vpisovanje odsotnosti, vodenje večerne prisotnosti, opombe za varnostnika. Lahko ima dodeljene svoje vzgojne skupine (`groups`), ki se privzeto prikažejo prve.
4. `dietitian` (Organizator prehrane): Urejanje tedenskega jedilnika, spremljanje diet in posebnih zdravstvenih razlogov dijakov, pregled kuhinje, nastavitev prehrane (šolsko leto, zaprti dnevi kuhinje, časovni termini obrokov).
5. `kitchen` (Kuhinja): Dnevni in tedenski normativi obrokov, seznami suhih paketov, poznih obrokov in posebnih diet (brez vpogleda v osebne zdravstvene diagnoze dijakov).
6. `office` (Tajništvo): Vpogled v jedilnik ter mesečni zbirni obračun obrokov z izvozom v Excel za fakturiranje.
7. `guard` (Nočni varnostnik): Vpisovanje večerne prisotnosti ob prihodih v dom (stolpec varnostnika ob nedeljah/praznikih ali redni večeri), beleženje dejanskega časa poznih prihodov in varnostnih opomb.
8. `student` (Dijak): Samopostrežni portal: "Moji obroki" (izbira različic v okviru dovoljenega, pregled jedilnika, odsotnosti) ter ocenjevanje zaužitih obrokov (1–5 z utemeljitvijo in neobvezno fotografijo).

**Sistem pravic (Rights):**
- `users`: upravljanje računov zaposlenih in zaklepanje (`admin`, `principal`).
- `audit`: vpogled v revizijski dnevnik sprememb (`admin`, `principal`).
- `students`: polna kartoteka dijaka, stiki staršev, uvoz/izvoz, Word obrazci, kreiranje prijav (`admin`, `principal`, `teacher`).
- `diets`: vpogled in urejanje diet ter privzetih menijev (`admin`, `principal`, `teacher`, `dietitian`).
- `orders`: pregledna tabela naročil, vpisovanje posamičnih in masovnih sprememb, odsotnosti (`admin`, `principal`, `teacher`, `dietitian`).
- `menu`: urejanje jedilnika in kopiranje med tedni (`admin`, `dietitian`).
- `viewMenu`: vpogled v tedenski jedilnik (`admin`, `principal`, `teacher`, `dietitian`, `kitchen`, `office`).
- `kitchen`: pregled normativov za kuhinjo (`admin`, `principal`, `teacher`, `dietitian`, `kitchen`).
- `report`: mesečni pregled in Excel izvoz (`admin`, `principal`, `dietitian`, `office`).
- `attendance`: vodenje večerne prisotnosti (`admin`, `principal`, `teacher`, `guard`).
- `mealSettings`: nastavitve šolskega leta, zaprtih dni, dovoljenih izbir dijakov, urnika (`admin`, `dietitian`).
- `system`: rok naročil (ura), časovni pas, globalna anonimnost ocen (`admin`).
- `ratings`: pregled ocen obrokov (`admin`, `principal` + možnost dodatne pravice).
- **Dodatne pravice (Extra rights):** Skrbnik lahko posameznemu zaposlenemu dodeli dodatne pravice prek polja `perms` (npr. `orders`, `menu`, `mealSettings`, `report`, `ratings`).

---

### 3. POSLOVNA PRAVILA PREHRANE IN NAROČIL

1. **Obroki in dnevi:**
   - Obroki so: **Zajtrk (`B` - Breakfast)**, **Kosilo (`L` - Lunch)**, **Večerja (`D` - Dinner)**.
   - Strežba: Ponedeljek–petek zajtrk in kosilo; ponedeljek–četrtek večerja. V petek zvečer in čez vikend obrokov ni (`mealServed(day, meal)`).

2. **Različice obrokov (Variants):**
   - `none`: Odjavljen / ni prijavljen (prikazano kot `–`).
   - `normal`: Navadni meni (`N`).
   - `veg`: Vegetarijanski meni (`V`).
   - `dry_normal`: Suhi navadni paket za s seboj (`SN`) – na voljo pri kosilu in večerji.
   - `dry_veg`: Suhi vegetarijanski paket (`SV`) – na voljo pri kosilu in večerji.
   - `late_normal`: Pozni navadni shranjen obrok (`PN`) – na voljo pri kosilu in večerji.
   - `late_veg`: Pozni vegetarijanski shranjen obrok (`PV`) – na voljo pri kosilu in večerji.
   - `light`: Lahka večerja (`La`) – na voljo samo pri večerji.

3. **Samodejna prijava in materializacija naročil:**
   - Vsak aktiven dijak ima nastavljen **privzeti meni** (`def_b`, `def_l`, `def_d`) ter poljubne **stalne tedenske izjeme** po dnevih v tednu (`weekly` JSON, npr. ob sredah kosilo `dry_normal`).
   - Prednost pri določanju obroka:
     1. Ročna sprememba posameznika / vzgojitelja (`source = 'manual'`).
     2. Odsotnost (`source = 'absence'` -> `none`).
     3. Tedenska izjema za določen dan v tednu (`weekly[dow][meal]`).
     4. Privzeti meni dijaka (`def_b`, `def_l`, `def_d`).
   - Aplikacija samodejno materializira zapise v tabelo `orders` za tekoče šolsko leto (ali privzeto za 28 dni vnaprej), pri čemer obstoječih ročnih sprememb in odjav nikoli ne prepiše (`ON CONFLICT DO NOTHING`).

4. **Rok za naročanje in spremembe (Cutoff Deadline):**
   - Naročila za dan `X` se zaprejo **dan prej ob nastavljeni uri** (privzeto ob **18:00**; konfiguralno v nastavitvah pod `cutoff_hour` in `timezone`).
   - Formula za prvi spremenljiv dan (`firstEditableDay`):
     - Če je trenutni lokalni čas pred uro roka: prvi spremenljiv dan je jutri (`today + 1`).
     - Če je trenutni lokalni čas enak ali po uri roka: jutrišnji dan je zaklenjen, prvi spremenljiv dan je pojutrišnjem (`today + 2`).
   - Zaklenjeni dnevi imajo v UI ikono ključavnice in jih ni več mogoče urejati.

5. **Kuhinja zaprta (Closed Days):**
   - Organizator prehrane lahko posamezne dneve ali časovna obdobja (počitnice, prazniki) označi kot zaprte z vpisom razloga (npr. "Jesenske počitnice").
   - Na zaprte dni se obroki ne naročajo in se v kuhinji ne štejejo.

6. **Odsotnosti dijakov:**
   - Vzgojitelj ali administrator lahko dijaku (ali več dijakom hkrati) zabeleži odsotnost od datuma `from` do `to` z razlogom.
   - Odsotnost nastavi vse obroke v obdobju na `none` (`source = 'absence'`).
   - Če je dovoljeno v nastavitvah (`student_can_cancel = 1`), lahko odsotnost prijavi tudi dijak sam.
   - Ob preklicu odsotnosti se za odprte prihodnje dni samodejno povrne dijakov privzeti meni.

7. **Izselitev dijaka (Move out / Izstop):**
   - Ko se dijak izseli, se zabeleži datum zadnjega dne v domu (`left_on`) in razlog izstopa.
   - Vsi obroki po tem datumu se avtomatsko odjavijo (`none`), uporabniški račun dijaka se deaktivira.
   - Dnevna avtomatska rutina (`retireLeavers`) arhivira pretekle izselitve.
   - Možnost preklica izselitve (`moveBack`), ki povrne status dijaka in ponovno materializira naročila.

---

### 4. OCENJEVANJE OBROKOV (MEAL RATINGS)

Dijaki lahko ocenijo obroke, ki so jih zaužili, z namenom povratne informacije kuhinji:
- **Pogoji za oddajo ocene:**
  - Oceniti je mogoče le obrok, ki je že minil (največ 7 dni nazaj) in na katerega je bil dijak dejansko prijavljen (`variant <> 'none'`).
  - Kuhinja ta dan ni smela biti zaprta.
- **Ocena:** številska vrednost od 1 do 5 (1 - zelo slab, 2 - slab, 3 - povprečen, 4 - dober, 5 - odličen).
- **Zahtevana utemeljitev:** Utemeljitev mora vsebovati vsaj **5 različnih besed**, dolgih vsaj 3 črke (`REASON_MIN_WORDS = 5`), kar preprečuje nepremišljene enobesedne žaljivke.
- **Fotografija obroka (neobvezno):**
  - Možnost naložitve fotografije (JPG, PNG, WebP do 2 MB), shranjene v bazi (`bytea`).
- **Anonimnost:**
  - Administrator lahko vklopi ali izklopi anonimnost ocen.
  - Vrednost `anonymous` se fiksira ob oddaji ocene, tako da kasnejša sprememba nastavitve nikoli retroaktivno ne razkrije identitete avtorja preteklih anonimnih ocen.

---

### 5. VEČERNA PRISOTNOST (EVENING ATTENDANCE)

Modul za spremljanje dijakov v domu ob večerih (od nedelje do četrtka):
1. **Dnevi bivanja:**
   - Dijak biva v domu tiste večere, ko je naslednji dan šolski dan (nedelja–četrtek, razen pred prazniki/počitnicami).
2. **Režim označevanja prisotnosti:**
   - **Običajni večeri (ponedeljek–četrtek):** En stolpec prisotnosti (`slot = 'night'`), ki ga lahko označi dežurni vzgojitelj ali nočni varnostnik.
   - **Večeri prihodov (nedelja ali večer po prazniku):** Dva ločena stolpca:
     - `guard` (Nočni varnostnik)
     - `teacher` (Dežurni vzgojitelj)
     Vsak ločeno odkljuka prisotnost ob prihodu dijaka.
3. **Povezava s prehrano:**
   - Sistem preveri, ali ima dijak naslednji dan naročene obroke. Če dijak zvečer ni prisoten, ima pa zjutraj naročen zajtrk/kosilo, sistem vzgojitelja vizualno opozori (oranžna celica) z možnostjo hitre odjave obrokov.
4. **Opombe vzgojitelja za varnostnika (`attendance_notes`):**
   - Vzgojitelj vpiše napovedan pozni prihod dijaka (ura npr. `22:30`) in opombo (npr. "trening košarke").
5. **Dnevnik nočnega varnostnika (`guard_reports`):**
   - Varnostnik vpiše dejanski čas prihoda dijaka in opombo. Vpis dejanskega časa prihoda lahko avtomatsko označi dijakovo prisotnost. Varnostnik lahko popravlja zapise do 3 dni nazaj.
6. **Večerne odsotnosti (`attendance_absences`):**
   - Vzgojitelji lahko vpišejo večerne odsotnosti (npr. bivanje doma, tekmovanja, zdravstveni razlogi) z obdobjem in razlogom.

---

### 6. PODATKOVNI MODEL (POSTGRESQL SHEMA)

Shema baze podatkov mora vsebovati naslednje tabele z ustreznimi indeksi in relacijami:

```sql
-- 1. Nastavitve sistema in parametrov prehrane
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2. Uporabniški računi
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'principal', 'teacher', 'dietitian', 'kitchen', 'office', 'guard', 'student')),
  pw_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  student_id INT UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  must_change BOOLEAN NOT NULL DEFAULT false,
  perms TEXT[] NOT NULL DEFAULT '{}',
  groups TEXT[] NOT NULL DEFAULT '{}',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Evidenca dijakov
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  ext_id TEXT NOT NULL DEFAULT '',           -- Enolična šifra/zap. št. iz šolskega registra
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',       -- Vzgojna skupina
  room TEXT NOT NULL DEFAULT '',             -- Številka sobe
  diet TEXT NOT NULL DEFAULT '',             -- Naziv posebne diete (vidi tudi kuhinja)
  diet_reason TEXT NOT NULL DEFAULT '',      -- Zdravstveni razlog diete (zaupno, le vzgojitelji)
  notes TEXT NOT NULL DEFAULT '',
  def_b TEXT NOT NULL DEFAULT 'normal',      -- Privzeti zajtrk
  def_l TEXT NOT NULL DEFAULT 'normal',      -- Privzeto kosilo
  def_d TEXT NOT NULL DEFAULT 'normal',      -- Privzeta večerja
  weekly JSONB NOT NULL DEFAULT '{}',        -- Tedenske stalne izjeme po dnevih {"3": {"L": "dry_normal"}}
  details JSONB NOT NULL DEFAULT '{}',       -- Poljubna razširjena polja (stiki, starši, EMŠO, šola...)
  active BOOLEAN NOT NULL DEFAULT true,
  left_on DATE,                              -- Zadnji dan bivanja v domu ob izselitvi
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Naročila obrokov (en zapis na dijaka, dan in obrok)
CREATE TABLE IF NOT EXISTS orders (
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  meal CHAR(1) NOT NULL CHECK (meal IN ('B', 'L', 'D')),
  variant TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'default',    -- 'default', 'manual', 'absence'
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, day, meal)
);
CREATE INDEX IF NOT EXISTS orders_day_idx ON orders(day);

-- 5. Revizijski dnevnik sprememb naročil
CREATE TABLE IF NOT EXISTS order_log (
  id BIGSERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  meal CHAR(1) NOT NULL,
  old_variant TEXT,
  new_variant TEXT NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_log_student_idx ON order_log(student_id, at DESC);

-- 6. Zaprti dnevi kuhinje (počitnice, prazniki)
CREATE TABLE IF NOT EXISTS closed_days (
  day DATE PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT ''
);

-- 7. Tedenski jedilnik
CREATE TABLE IF NOT EXISTS menus (
  day DATE NOT NULL,
  meal CHAR(1) NOT NULL CHECK (meal IN ('B', 'L', 'D')),
  variant TEXT NOT NULL,
  dish TEXT NOT NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, meal, variant)
);

-- 8. Odsotnosti od prehrane
CREATE TABLE IF NOT EXISTS absences (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_from DATE NOT NULL,
  day_to DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS absences_student_idx ON absences(student_id, day_to);

-- 9. Večerna prisotnost
CREATE TABLE IF NOT EXISTS attendance (
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  night DATE NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('night', 'guard', 'teacher')),
  checked_by INT REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, night, slot)
);
CREATE INDEX IF NOT EXISTS attendance_night_idx ON attendance(night);

-- 10. Večerne odsotnosti
CREATE TABLE IF NOT EXISTS attendance_absences (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_from DATE NOT NULL,
  day_to DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_absences_idx ON attendance_absences(day_to, day_from);

-- 11. Opombe vzgojitelja za nočnega varnostnika
CREATE TABLE IF NOT EXISTS attendance_notes (
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  night DATE NOT NULL,
  late_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, night)
);

-- 12. Poročilo nočnega varnostnika (dejanski prihod in opombe)
CREATE TABLE IF NOT EXISTS guard_reports (
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  night DATE NOT NULL,
  arrived_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, night)
);

-- 13. Ocene obrokov dijakov
CREATE TABLE IF NOT EXISTS meal_ratings (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  meal CHAR(1) NOT NULL CHECK (meal IN ('B', 'L', 'D')),
  variant TEXT NOT NULL,
  dish TEXT NOT NULL DEFAULT '',
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  reason TEXT NOT NULL,
  photo BYTEA,
  photo_type TEXT NOT NULL DEFAULT '',
  anonymous BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, day, meal)
);
CREATE INDEX IF NOT EXISTS meal_ratings_day_idx ON meal_ratings(day);

-- 14. Sistemski revizijski dnevnik (Audit Log)
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);
```

---

### 7. SPECIFIKACIJA API AKCIJ (`POST /api`)

Vsi klici (razen `setup` in `login`) zahtevajo HTTP glavo `Authorization: Bearer <token>`. Telo zahteve je JSON z `action: "<ime_akcije>"` in parametri:

1. **Avtentikacija in profil:**
   - `setup`: Prva namestitev skrbniškega računa (če v bazi še ni nobenega uporabnika).
   - `login`: Prijava z uporabniškim imenom in geslom -> vrne JWT žeton.
   - `me`: Podatki o prijavljenem uporabniku, pravice, sistemska ura, dovoljene izbire obrokov.
   - `changePassword`: Sprememba lastnega gesla (obvezno ob prvi prijavi z začasnim geslom).

2. **Naročila (osebje):**
   - `grid`: Vrne matriko dijakov, naročil, odsotnosti, jedilnika in zaprtih dni za izbrano obdobje (`from` do `to`) in filter skupine (`group`).
   - `setOrders`: Posodobitev posameznih celic `{ changes: [{ student_id, day, meal, variant }] }`.
   - `bulkOrders`: Masovna sprememba obrokov za več dijakov, dni in obrokov naenkrat.

3. **Odsotnosti:**
   - `absences`: Seznam odsotnosti določenega dijaka.
   - `addAbsence`: Vpis odsotnosti za enega ali več dijakov (avtomatska odjava vseh obrokov).
   - `cancelAbsence`: Preklic odsotnosti in povrnitev privzetih menijev na odprte dni.

4. **Dijaki (kartoteka in administracija):**
   - `students`: Seznam dijakov s filtriranjem in iskanjem.
   - `studentDetails`: Naloži razširjene osebne podatke, stike in podatke o vpisu dijaka.
   - `saveStudent`: Shranjevanje osnovnih podatkov, diete ali celotne kartoteke.
   - `moveOut`: Nastavitev datuma izstopa dijaka iz doma in odjava vseh prihodnjih obrokov.
   - `moveBack`: Preklic izstopa in ponovna aktivacija dijaka.
   - `importStudents`: Uvoz dijakov iz seznama (Excel) z načinom predogleda (`dryRun`) in zaznavo novih, spremenjenih ali izseljenih dijakov.
   - `setWeekly`: Nastavitev masovne stalne tedenske izjeme (npr. suho kosilo ob sredah za celo skupino).
   - `studentLog`: Zgodovina vseh sprememb obrokov za izbranega dijaka.
   - `studentLogins`: Generiranje dostopnih podatkov z začasnimi gesli (prijazna gesla oblike `beseda-beseda-številka`, npr. `kruh-jabolko-482`) in priprava za tisk listkov.

5. **Portal za dijake:**
   - `myWeek`: Pregled obrokov tekočega tedna za dijaka, jedilnik, odsotnosti in lastne oddane ocene.
   - `mySetOrder`: Sprememba lastnega obroka (le dovoljene različice in le pred iztekom roka).
   - `myAbsence` / `myCancelAbsence`: Samostojna prijava/preklic odsotnosti (če je v nastavitvah dovoljeno).
   - `myRate`: Oddaja ali posodobitev ocene zaužitega obroka (1–5, min. 5 besed utemeljitve, neobvezna slika).
   - `myDeleteRating`: Brisanje lastne ocene do 7 dni nazaj.

6. **Kuhinja in jedilnik:**
   - `kitchenDay`: Podrobni normativi za določen dan: skupno število po različicah, seznami suhih paketov poimensko, seznam poznih obrokov poimensko, seznam posebnih diet poimensko z opisi.
   - `kitchenWeek`: Tedenski zbirni normativi po dnevih in različicah.
   - `menuWeek`: Tedenski jedilnik (vidi celotno osebje in dijaki).
   - `saveMenu`: Shranjevanje jedi po dnevih, obrokih in različicah.
   - `copyMenu`: Hitro kopiranje celotnega tedenskega jedilnika v enega ali več prihodnjih tednov.

7. **Mesečni pregled (obračun):**
   - `monthReport`: Zbirni mesečni podatki o naročenih obrokih po dijakih in skupinah za izbrani mesec (`YYYY-MM`) za potrebe fakturiranja.

8. **Večerna prisotnost:**
   - `attendanceWeek`: Podatki za teden (nedelja–četrtek): seznam bivanja, označene kljukice vzgojitelja/varnostnika, naročeni obroki za naslednji dan, opombe in varnostna poročila.
   - `setAttendance`: Označitev prisotnosti dijaka v ustreznem stolpcu (`night`, `guard`, `teacher`).
   - `addAttendanceAbsence` / `cancelAttendanceAbsence`: Vpis in preklic večerne odsotnosti.
   - `setAttendanceNote`: Vpis predvidenega poznega prihoda s strani vzgojitelja.
   - `setGuardReport`: Vpis dejanskega prihoda in opomb nočnega varnostnika.

9. **Ocene obrokov (nadzor):**
   - `ratings`: Pregled vseh ocen obrokov s filtriranjem po datumu in obroku.
   - `ratingPhoto`: Prenos naložene fotografije k oceni.
   - `deleteRating`: Brisanje neprimerne ali žaljive ocene (pravica administratorja/ravnatelja).
   - `saveRatingSettings`: Vklop/izklop anonimnosti ocen obrokov.

10. **Uporabniki in nastavitve:**
    - `users`: Seznam računov zaposlenih in dostopov dijakov.
    - `saveUser`: Ustvarjanje ali urejanje računa zaposlenega (vloga, dodatne pravice, skupine, geslo, zaklep).
    - `auditLog`: Pregled zadnjih 300 varnostnih in revizijskih dogodkov v sistemu.
    - `settings`: Naloži sistemske in prehranske nastavitve.
    - `saveMealSettings`: Shranjevanje šolskega leta, časovnih terminov obrokov, dovoljenih izbir za dijake.
    - `saveSystemSettings`: Shranjevanje ure roka naročil (`cutoff_hour`) in časovnega pasu (`timezone`).
    - `setClosedDay`: Dodajanje ali brisanje zaprtega dneva kuhinje.

---

### 8. STRUKTURA IN ZNAČILNOSTI UPORABNIŠKEGA VMESNIKA (FRONTEND UI)

Uporabniški vmesnik mora biti intuitiven, hiter in prilagojen vlogi uporabnika:

1. **Glavna navigacija:**
   - Zgornja vrstica (`topbar`) z logotipom "Dom Obroki", dinamičnimi zavihki glede na pravice uporabnika, imenom prijavljenega z vlogo, gumbom za menjavo gesla in gumbom za odjavo.
   - Zavihki:
     - `Moji obroki` (dijaki)
     - `Naročila` (osebje s pravico `orders`)
     - `Jedilnik` / `Prehrana` (jedilnik + podzavihek za ocene obrokov)
     - `Kuhinja` (normativi, paketi, pozni obroki)
     - `Mesečni pregled` (obračun in izvoz)
     - `Prisotnost` (večerna prisotnost)
     - `Dijaki` (kartoteka, uvoz, obrazci)
     - `Uporabniki` (upravljanje računov)
     - `Nastavitve` (sistemske in prehranske nastavitve)

2. **Glavni pogledi (Views):**
   - **Naročila (`OrdersView`):**
     - Tedenska matrika z navigacijo med tedni (gumb "Prvi odprti teden").
     - Hitro iskanje po imenu, priimku ali sobi, filter po skupinah ("Moje skupine", posamezna skupina, cel dom).
     - Barvno kodirane značke različic obrokov (N, V, SN, SV, PN, PV, La, –). Pika na znački ponazarja ročno spremembo, oznaka O ponazarja odsotnost.
     - Hitro urejanje s klikom na posamezno celico (popover meni z izbirami).
     - Večkratni izbor dijakov s potrditvenimi polji (checkbox) in spodnja orodna vrstica za masovne spremembe obdobja (npr. nastavi cel teden na odsotnost ali suhi obrok).
   - **Kuhinja (`KitchenView`):**
     - Prikaz za izbrani dan z indikatorjem, ali so številke že dokončne (rok potekel) ali se še lahko spremenijo.
     - Kartice s seštevki po obrokih in različicah.
     - Seznama suhih paketov in poznih obrokov poimensko z vzgojno skupino.
     - Seznam posebnih diet z dijakom in vrsto diete (klik za podrobnosti).
     - Optimiziran gumb za neposredno tiskanje delovnih nalogov za kuhinjo.
   - **Prisotnost (`AttendanceView`):**
     - Pregled tedna od nedelje do četrtka.
     - Stolpci z ustreznimi kljukicami glede na večer (ločeno varnostnik in vzgojitelj ob prihodu).
     - Opozorilne barve celic, če dijak zvečer manjka, naslednji dan pa ima naročeno prehrano.
     - Možnost desnega klika ali hitrega menija za vpis opombe o poznem prihodu.
     - Zgornji razdelek z zbranimi zapisi varnostnika in možnostjo takojšnjega filtriranja.
   - **Dijaki (`StudentsView`):**
     - Tabela dijakov z iskanjem (tudi brez šumnikov), filtrom skupin in prikazom izseljenih.
     - Kartoteka dijaka v modalnem oknu z zavihki:
       - *Osnovno in prehrana:* skupina, soba, posebna dieta, zdravstveni razlog, privzeti obroki, izjeme po dnevih.
       - *Kontakti:* stalni naslov, začasni naslov, e-pošta, telefon dijaka ter stiki matere in očeta.
       - *Ostalo:* EMŠO, davčna št., šola, program, razred, datum vpisa, št. pogodbe itd.
       - *Odsotnosti:* pregled in vpis odsotnosti.
       - *Dostop:* generiranje uporabniškega računa in začasnega gesla.
       - *Zgodovina:* revizijska sled sprememb obrokov dijaka.
     - Modalno okno za uvoz iz Excela s predogledom razlik pred potrditvijo.
     - Priprava in prenos vzorčne Excel datoteke za uvoz.
   - **Izvoz dokumentov (Word .docx):**
     - Generiranje predizpolnjene **Izpisnice** (ob izstopu dijaka iz doma).
     - Generiranje **Osebnega lista dijaka** na podlagi predloge z vsemi shranjenimi podatki.
   - **Mesečni pregled (`ReportView`):**
     - Prikaz mesečnega povzetka po skupinah in dijakih (število zajtrkov, kosil, suhih obrokov, večerij in skupaj).
     - Izvoz v Excel s tremi ločenimi listi: *Povzetek*, *Po dnevih* in *Dnevni seštevki*.

---

### 9. NAVODILA ZA IZVEDBO IN ZAGON

1. Koda mora biti razdeljena na čiste module (npr. `functions/api/rules.mjs`, `auth.mjs`, `db.mjs`, `index.mjs` ter React komponente v `web/src/`).
2. Zagotovi celovito obravnavo napak (HTTP statusi 400, 401, 403, 500) z jasnimi sporočili v slovenskem jeziku.
3. Poskrbi, da je namestitev baze avtomatska ob zagonu strežnika (`init()`), inicialne nastavitve pa se samodejno vnesejo s privzetimi vrednostmi.
4. Omogoči enostaven lokalni zagon z ukazom `npm start` in skriptami v mapi `local/`.
```
