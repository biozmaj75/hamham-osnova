// Student record fields beyond the meal data, as in the home's register (Excel).
// [key, label, tab, section, header match (see headKey), type]
import { excelDate } from './xlsx.js';

export const DETAIL_FIELDS = [
  // Kontakti
  ['address', 'Stalni naslov', 'contact', 'Dijak', h => h.startsWith('stalni naslov')],
  ['post_code', 'Poštna številka', 'contact', 'Dijak', h => h === 'postna stevilka'],
  ['post', 'Pošta', 'contact', 'Dijak', h => h === 'posta'],
  ['municipality', 'Občina', 'contact', 'Dijak', h => h === 'obcina'],
  ['temp_address', 'Začasni naslov', 'contact', 'Dijak', h => h.startsWith('zacasni naslov')],
  ['email', 'E-naslov', 'contact', 'Dijak', h => h === 'e naslov' || h === 'email', 'email'],
  ['phone', 'Mobitel', 'contact', 'Dijak', h => h === 'mobitel' || h === 'telefon', 'phone'],
  ['mother_last', 'Priimek', 'contact', 'Mati', h => h === 'mati priimek' || h === 'priimek mati'],
  ['mother_first', 'Ime', 'contact', 'Mati', h => h === 'mati ime' || h === 'ime mati'],
  ['mother_address', 'Naslov', 'contact', 'Mati', h => h === 'naslov mati'],
  ['mother_email', 'E-naslov', 'contact', 'Mati', h => h === 'e naslov mati', 'email'],
  ['mother_phone', 'Mobitel', 'contact', 'Mati', h => h === 'mobitel mati', 'phone'],
  ['father_last', 'Priimek', 'contact', 'Oče', h => h === 'priimek oce' || h === 'oce priimek'],
  ['father_first', 'Ime', 'contact', 'Oče', h => h === 'ime oce' || h === 'oce ime'],
  ['father_address', 'Naslov', 'contact', 'Oče', h => h === 'naslov oce'],
  ['father_email', 'E-naslov', 'contact', 'Oče', h => h === 'e naslov oce', 'email'],
  ['father_phone', 'Mobitel', 'contact', 'Oče', h => h === 'mobitel oce', 'phone'],
  // Ostalo
  ['contract_no', 'Št. pogodbe', 'other', 'Bivanje v domu', h => h === 'st pogodbe'],
  ['contract_date', 'Datum sklenitve pogodbe', 'other', 'Bivanje v domu', h => h === 'datum sklenitve pogodbe', 'date'],
  ['enrol_cert', 'Potrdilo o vpisu', 'other', 'Bivanje v domu', h => h.startsWith('potrdilo')],
  ['vs_new', 'VS novo', 'other', 'Bivanje v domu', h => h === 'vs novo'],
  ['admitted', 'Sprejem', 'other', 'Bivanje v domu', h => h === 'sprejem', 'date'],
  ['left_on', 'Izstop', 'other', 'Bivanje v domu', h => h === 'izstop', 'date'],
  ['left_reason', 'Razlog izstopa', 'other', 'Bivanje v domu', h => h === 'razlog izstopa'],
  ['subsidy', 'Subvencija', 'other', 'Bivanje v domu', h => h === 'subvencija'],
  ['birth_date', 'Rojstni datum', 'other', 'Osebni podatki', h => h === 'rojstni datum', 'date'],
  ['birth_place', 'Rojstni kraj', 'other', 'Osebni podatki', h => h === 'rojstni kraj'],
  ['birth_country', 'Rojstna država', 'other', 'Osebni podatki', h => h === 'rojstna drzava'],
  ['sex', 'Spol', 'other', 'Osebni podatki', h => h === 'spol'],
  ['citizenship', 'Državljanstvo', 'other', 'Osebni podatki', h => h === 'drzavljanstvo'],
  ['emso', 'EMŠO', 'other', 'Osebni podatki', h => h === 'emso', 'emso'],
  ['tax_no', 'Davčna številka', 'other', 'Osebni podatki', h => h === 'ds' || h === 'davcna stevilka', 'tax'],
  ['parish', 'Matična župnija', 'other', 'Osebni podatki', h => h === 'maticna zupnija'],
  ['prior_edu', 'Predhodno pridobljena izobrazba', 'other', 'Šolanje', h => h.startsWith('predhodno')],
  ['school', 'Šola', 'other', 'Šolanje', h => h === 'sola'],
  ['program', 'Program', 'other', 'Šolanje', h => h === 'program'],
  ['class', 'Razred', 'other', 'Šolanje', h => h.startsWith('razred')],
  ['mother_emso', 'EMŠO – mati', 'other', 'Starši', h => h === 'emso mati', 'emso'],
  ['mother_tax_no', 'Davčna št. – mati', 'other', 'Starši', h => h === 'ds mati', 'tax'],
  ['father_emso', 'EMŠO – oče', 'other', 'Starši', h => h === 'emso oce', 'emso'],
  ['father_tax_no', 'Davčna št. – oče', 'other', 'Starši', h => h === 'ds oce', 'tax'],
];

// Column headers of the sample import sheet (each one is recognised by the matcher above) and an example value
export const SAMPLE_COLUMNS = [
  ['address', 'Stalni naslov', 'Glavna ulica 12'], ['post_code', 'Poštna številka', '2000'], ['post', 'Pošta', 'Maribor'],
  ['municipality', 'Občina', 'Maribor'], ['temp_address', 'Začasni naslov', 'Vrbanska cesta 30, 2000 Maribor'],
  ['email', 'E-naslov', 'ana.novak@primer.si'], ['phone', 'Mobitel', '041 123 456'],
  ['mother_first', 'Ime mati', 'Marija'], ['mother_last', 'Priimek mati', 'Novak'], ['mother_address', 'Naslov mati', 'Glavna ulica 12, 2000 Maribor'],
  ['mother_email', 'E-naslov mati', 'marija.novak@primer.si'], ['mother_phone', 'Mobitel mati', '031 234 567'],
  ['father_first', 'Ime oče', 'Janez'], ['father_last', 'Priimek oče', 'Novak'], ['father_address', 'Naslov oče', 'Glavna ulica 12, 2000 Maribor'],
  ['father_email', 'E-naslov oče', 'janez.novak@primer.si'], ['father_phone', 'Mobitel oče', '040 345 678'],
  ['contract_no', 'Št. pogodbe', '123/2026'], ['contract_date', 'Datum sklenitve pogodbe', { date: '2026-08-25' }],
  ['enrol_cert', 'Potrdilo o vpisu', 'da'], ['vs_new', 'VS novo', ''], ['admitted', 'Sprejem', { date: '2026-09-01' }],
  ['left_reason', 'Razlog izstopa', ''], ['subsidy', 'Subvencija', 'ne'],
  ['birth_date', 'Rojstni datum', { date: '2010-05-14' }], ['birth_place', 'Rojstni kraj', 'Maribor'], ['birth_country', 'Rojstna država', 'Slovenija'],
  ['sex', 'Spol', 'Ž'], ['citizenship', 'Državljanstvo', 'slovensko'], ['emso', 'EMŠO', '1405010505123'], ['tax_no', 'Davčna številka', '12345678'],
  ['parish', 'Matična župnija', 'Maribor – sv. Janez Krstnik'], ['prior_edu', 'Predhodno pridobljena izobrazba', 'osnovna šola'],
  ['school', 'Šola', 'II. gimnazija Maribor'], ['program', 'Program', 'gimnazija'], ['class', 'Razred', '1. a'],
  ['mother_emso', 'EMŠO mati', ''], ['mother_tax_no', 'DŠ mati', ''], ['father_emso', 'EMŠO oče', ''], ['father_tax_no', 'DŠ oče', ''],
];

// A register column with a parent's full name ("Mati", "Oče") is split into the first/last name fields
const FULL_NAME_HEADS = { mati: 'mother', oce: 'father' };
export const LEGACY_DETAILS = Object.values(FULL_NAME_HEADS);

// Columns that are part of the basic record (name, group, diet …), not details
const CORE_HEADS = ['priimek', 'ime', 'in ime', 'vzgojna skupina', 'skupina', 'dieta', 'posebna dieta', 'soba'];

// "EMŠO - mati" -> "emso mati"
export const headKey = v => String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Excel keeps numbers without their leading zeros
function cellText(v, type) {
  if (type === 'date') {
    const iso = excelDate(v);
    return iso ? iso.split('-').reverse().map(Number).join('. ') : String(v).trim();
  }
  if (typeof v === 'number') {
    const s = String(v);
    if (type === 'phone' && /^\d{8}$/.test(s)) return `0${s}`;
    if (type === 'emso') return s.padStart(13, '0');
    if (type === 'tax') return s.padStart(8, '0');
    return s;
  }
  return String(v ?? '').trim();
}

// For each sheet column: [index, detail key, type]. Unknown columns keep their own header as the key.
export function detailColumns(headerRow, usedCols) {
  const out = [];
  const taken = new Set();
  (headerRow || []).forEach((raw, i) => {
    const h = headKey(raw);
    if (!h || usedCols.includes(i) || CORE_HEADS.includes(h) || h.startsWith('zap')) return;
    if (FULL_NAME_HEADS[h]) { out.push([i, FULL_NAME_HEADS[h], null]); return; }
    const f = DETAIL_FIELDS.find(([key, , , , match]) => !taken.has(key) && match(h));
    if (f) { taken.add(f[0]); out.push([i, f[0], f[5]]); } else out.push([i, String(raw).trim().slice(0, 80), null]);
  });
  return out;
}

export function rowDetails(row, columns) {
  const d = {};
  for (const [i, key, type] of columns) {
    const v = cellText(row[i] ?? '', type);
    if (v) d[key] = v;
  }
  for (const who of LEGACY_DETAILS) {
    const full = d[who];
    delete d[who];
    if (!full || d[`${who}_first`] || d[`${who}_last`]) continue;
    const parts = full.split(/\s+/);
    if (parts.length > 1) d[`${who}_last`] = parts.pop();
    d[`${who}_first`] = parts.join(' ');
  }
  return d;
}
