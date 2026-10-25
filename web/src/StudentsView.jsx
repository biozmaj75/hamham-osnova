import { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, Search, Leaf, History, KeyRound, Lock, Unlock, CalendarOff, CalendarClock, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { readXlsx, excelDate } from './xlsx.js';
import Modal from './Modal.jsx';
import { loginSlipsPdf, downloadBlob } from './pdf.js';
import { MEALS, MEAL_NAMES, VARIANTS, VARIANT_LABEL, VARIANT_SHORT, WEEKDAYS, DEF_COL, ROLE_NAME, fmtDay, studentName, plural } from './meals.js';

const EMPTY = { first_name: '', last_name: '', group_name: '', room: '', diet: '', diet_reason: '', notes: '', def_b: 'normal', def_l: 'normal', def_d: 'normal', weekly: {}, active: true };

const fmtDate = d => d.split('-').reverse().map(Number).join('. ');
const fmtTime = t => (t ? new Date(t).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Issues logins (new ones, or new temporary passwords) and downloads the slips to print
async function printLogins(studentIds, me) {
  const { sheets } = await api('studentLogins', { student_ids: studentIds });
  if (!sheets.length) return sheets;
  const today = new Date().toISOString().slice(0, 10);
  downloadBlob(loginSlipsPdf(sheets, {
    home: 'Dijaški dom', url: window.location.origin, date: fmtDate(today), issuer: `${me.user.name}, ${ROLE_NAME[me.user.role].toLowerCase()}`,
  }), `dostopi-${sheets.length === 1 ? sheets[0].username : today}.pdf`);
  return sheets;
}

function LoginState({ s }) {
  if (!s.username) return <span className="muted">brez dostopa</span>;
  if (!s.login_active) return <span className="locked-tag"><Lock size={12} /> zaklenjen</span>;
  if (s.must_change) return <span className="muted">začasno geslo</span>;
  return <span>{s.username}</span>;
}

// [[weekday name, meal, variant]] for a student's weekday exceptions
function exceptions(s) {
  return WEEKDAYS.flatMap(([n, name]) => MEALS.filter(m => s.weekly?.[n]?.[m]).map(m => [name, m, s.weekly[n][m]]));
}

export default function StudentsView({ me }) {
  const [students, setStudents] = useState(null);
  const [full, setFull] = useState(false);
  const [logins, setLogins] = useState(false);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const myGroups = me.user.groups || [];
  const [group, setGroup] = useState(myGroups.length ? '@mine' : '');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [weeklyBulk, setWeeklyBulk] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('students').then(r => { setStudents(r.students); setFull(r.full); }).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => [...new Set((students || []).map(s => s.group_name).filter(Boolean))].sort(), [students]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inGroup = s => !group || (group === '@mine' ? myGroups.includes(s.group_name) : s.group_name === group);
    return (students || []).filter(s => (showInactive || s.active) && inGroup(s)
      && (!q || `${s.first_name} ${s.last_name} ${s.group_name} ${s.room || ''} ${s.diet}`.toLowerCase().includes(q)));
  }, [students, query, showInactive, group]);

  const activeCount = (students || []).filter(s => s.active).length;

  return (
    <div className="students">
      <div className="toolbar">
        <div className="title-block"><h1>Dijaki</h1><span className="muted">{activeCount} {plural(activeCount, 'dijak', 'dijaka', 'dijaki', 'dijakov')} v domu</span></div>
        <select value={group} onChange={e => setGroup(e.target.value)}>
          {myGroups.length > 0 && <option value="@mine">Moji dijaki ({myGroups.join(', ')})</option>}
          <option value="">Cel dom – vse skupine</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className="search"><Search size={15} /><input placeholder={full ? 'Išči ime, skupino, sobo, dieto' : 'Išči ime, skupino, dieto'} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="inline-check"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Prikaži izseljene</label>
        {full && <button className="btn" onClick={() => setLogins(true)}><KeyRound size={16} /> Dostopi za dijake</button>}
        {full && <button className="btn" onClick={() => setWeeklyBulk(true)}><CalendarClock size={16} /> Stalne izjeme</button>}
        {full && <button className="btn" onClick={() => setImporting(true)}><Upload size={16} /> Uvozi seznam</button>}
        {full && <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={16} /> Dodaj dijaka</button>}
      </div>
      {students && !full && <p className="hint pad-x">Vidite samo podatke, potrebne za prehrano. Osebne podatke dijakov urejajo vzgojitelji.</p>}
      {error && <p className="error banner">{error}</p>}
      {!students ? <p className="muted pad">Nalaganje …</p> : (
        <div className="table-card">
          <table className="list">
            <thead><tr><th>Ime</th><th>Skupina</th>{full && <th>Soba</th>}<th>Privzeti meni</th><th>Posebna dieta</th>{full && <th>Dostop</th>}<th /></tr></thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.id} className={s.active ? '' : 'inactive'} onClick={() => setEditing({ ...s })}>
                  <td><strong>{studentName(s)}</strong>{!s.active && <em className="tag">izseljen</em>}</td>
                  <td>{s.group_name}</td>
                  {full && <td>{s.room}</td>}
                  <td className="defaults">
                    {MEALS.map(m => <span key={m} title={`${MEAL_NAMES[m]}: ${VARIANT_LABEL[s[DEF_COL[m]]]}`} className={`chip v-${s[DEF_COL[m]]}`}>{VARIANT_SHORT[s[DEF_COL[m]]]}</span>)}
                    <ExceptionTag student={s} />
                  </td>
                  <td>{s.diet && <span className="diet" title={s.diet_reason ? `Razlog: ${s.diet_reason}` : ''}><Leaf size={11} />{s.diet}</span>}</td>
                  {full && <td className="login-cell"><LoginState s={s} /></td>}
                  <td className="muted right">Uredi</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="muted">Ni najdenih dijakov.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <StudentForm student={editing} groups={groups} full={full} me={me}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onChanged={load} />
      )}
      {logins && <LoginsDialog students={students.filter(s => s.active)} groups={groups} initialGroup={group === '@mine' ? myGroups[0] || '' : group} me={me} onClose={() => { setLogins(false); load(); }} />}
      {weeklyBulk && <WeeklyDialog students={students.filter(s => s.active)} groups={groups} initialGroup={group === '@mine' ? myGroups[0] || '' : group}
        onClose={() => setWeeklyBulk(false)} onDone={() => { setWeeklyBulk(false); load(); }} />}
      {importing && <ImportDialog me={me} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function ExceptionTag({ student }) {
  const list = exceptions(student);
  if (!list.length) return null;
  const title = list.map(([day, m, v]) => `${day}: ${MEAL_NAMES[m].toLowerCase()} ${VARIANT_LABEL[v].toLowerCase()}`).join('\n');
  return <em className="tag" title={title}>+{list.length} {plural(list.length, 'izjema', 'izjemi', 'izjeme', 'izjem')}</em>;
}

function StudentForm({ student, groups, full, me, onClose, onSaved, onChanged }) {
  const [s, setS] = useState(student);
  const ro = !full; // the meal planner edits only the diet and menu fields
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));
  const setWeekly = (n, meal, v) => setS(prev => {
    const day = { ...(prev.weekly?.[n] || {}) };
    if (v) day[meal] = v; else delete day[meal];
    const weekly = { ...(prev.weekly || {}), [n]: day };
    if (!Object.keys(day).length) delete weekly[n];
    return { ...prev, weekly };
  });

  async function save(e) {
    e.preventDefault();
    if (student.id && student.active && !s.active
      && !confirm('Označim dijaka kot izseljenega? Vsa naročila, ki jih je še mogoče spremeniti, bodo preklicana.')) return;
    setBusy(true);
    try {
      await api('saveStudent', { student: s });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={student.id ? studentName(student) : 'Nov dijak'} onClose={onClose} wide>
      <form className="form two-col" onSubmit={save}>
        <label>Ime<input value={s.first_name} onChange={e => set('first_name', e.target.value)} readOnly={ro} autoFocus={!ro} /></label>
        <label>Priimek<input value={s.last_name} onChange={e => set('last_name', e.target.value)} readOnly={ro} /></label>
        <label className={full ? '' : 'span2'}>Skupina
          <input list="groups" value={s.group_name} onChange={e => set('group_name', e.target.value)} placeholder="npr. 3. skupina" readOnly={ro} />
          <datalist id="groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
        </label>
        {full && <label>Soba<input value={s.room} onChange={e => set('room', e.target.value)} /></label>}
        <label><span>Posebna dieta <small>kuhinja jo vidi</small></span>
          <input value={s.diet} onChange={e => set('diet', e.target.value)} placeholder="npr. brez glutena, brez laktoze" autoFocus={ro} />
        </label>
        <label><span>Zdravstveni razlog <small>kuhinja ga ne vidi</small></span>
          <input value={s.diet_reason || ''} onChange={e => set('diet_reason', e.target.value)} placeholder="npr. celiakija (neobvezno)" />
        </label>
        <fieldset className="span2 defaults-field">
          <legend>Privzeti meni <small>samodejno velja za vsak šolski dan, če ga ne spremenite</small></legend>
          {MEALS.map(m => (
            <label key={m}>{MEAL_NAMES[m]}
              <select value={s[DEF_COL[m]]} onChange={e => set(DEF_COL[m], e.target.value)}>
                {VARIANTS[m].map(v => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
                <option value="none">Ni prijavljen</option>
              </select>
            </label>
          ))}
        </fieldset>
        <fieldset className="span2 weekly-field">
          <legend>Izjeme po dnevih <small>ponavljajo se vsak teden, npr. suho kosilo vsako sredo</small></legend>
          <table className="weekly">
            <thead><tr><th />{MEALS.map(m => <th key={m}>{MEAL_NAMES[m]}</th>)}</tr></thead>
            <tbody>
              {WEEKDAYS.map(([n, name]) => (
                <tr key={n}>
                  <th>{name}</th>
                  {MEALS.map(m => (n === 5 && m === 'D' ? <td key={m} className="muted no-meal">ni večerje</td> : (
                    <td key={m}>
                      <select className={s.weekly?.[n]?.[m] ? 'set' : ''} value={s.weekly?.[n]?.[m] || ''} onChange={e => setWeekly(n, m, e.target.value)}>
                        <option value="">Kot privzeto ({VARIANT_LABEL[s[DEF_COL[m]]].toLowerCase()})</option>
                        {VARIANTS[m].map(v => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
                        <option value="none">Ni prijavljen</option>
                      </select>
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        {full && <label className="span2">Opombe<textarea rows={2} value={s.notes || ''} onChange={e => set('notes', e.target.value)} /></label>}
        {full && student.id && (
          <label className="inline-check span2"><input type="checkbox" checked={s.active} onChange={e => set('active', e.target.checked)} /> Živi v domu (odkljukajte, ko se dijak izseli)</label>
        )}
        {student.id && <p className="hint span2">Sprememba privzetega menija ali izjem posodobi vse odprte dni do konca šolskega leta, ki niso bili ročno spremenjeni.</p>}
        {error && <p className="error span2">{error}</p>}
        <div className="form-actions span2">
          {student.id && (
            <button type="button" className="btn ghost" onClick={() => api('studentLog', { student_id: student.id }).then(r => setLog(r.log))}>
              <History size={16} /> Zgodovina sprememb
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Prekliči</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Shranjevanje …' : 'Shrani'}</button>
        </div>
      </form>
      {student.id && student.active && full && <LoginBox student={student} me={me} onChanged={onChanged} />}
      {student.id && student.active && me.rights.includes('orders') && <AbsenceBox student={student} />}
      {log && (
        <div className="log">
          <h4>Zadnje spremembe</h4>
          {log.length === 0 && <p className="muted">Še ni sprememb.</p>}
          <ul>
            {log.map((l, i) => (
              <li key={i}>
                <span className="muted">{new Date(l.at).toLocaleString('sl-SI')}</span>
                <span>{MEAL_NAMES[l.meal]} {fmtDay(l.day)}: {VARIANT_LABEL[l.old_variant] || '—'} → <b>{VARIANT_LABEL[l.new_variant]}</b></span>
                <span className="muted">{l.user_name ? `${l.user_name}${l.user_role === 'student' ? ' (dijak)' : ''}` : 'sistem'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

// Accepts lines pasted from a spreadsheet: last name, first name, group, room, special diet
function parsePaste(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const p = line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map(x => x.trim());
    return { last_name: p[0] || '', first_name: p[1] || '', group_name: p[2] || '', room: p[3] || '', diet: p[4] || '' };
  });
}

// Only these columns are read from the home's spreadsheet; everything else (EMŠO, addresses, parents …) stays out
const IMPORT_FIELDS = [
  ['last_name', 'Priimek', h => h === 'priimek'],
  ['first_name', 'Ime', h => h === 'ime' || h === 'in ime'],
  ['group_name', 'Vzgojna skupina', h => h === 'vzgojna skupina' || h === 'skupina'],
  ['diet', 'Dieta', h => h === 'dieta' || h === 'posebna dieta'],
  ['room', 'Soba', h => h === 'soba'],
  ['left', 'Izstop (datum)', h => h === 'izstop'],
  ['ext_id', 'Zap. št. dijaka', h => h.startsWith('zap')],
];
const normHead = v => String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// The header row is the first one (of the top 20) that has a "priimek" column
function guessColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const heads = (rows[i] || []).map(normHead);
    if (!heads.includes('priimek')) continue;
    const cols = {};
    for (const [k, , match] of IMPORT_FIELDS) {
      const idx = heads.findIndex(match);
      cols[k] = idx >= 0 ? idx : '';
    }
    return { headerRow: i, cols };
  }
  return { headerRow: 0, cols: Object.fromEntries(IMPORT_FIELDS.map(([k]) => [k, ''])) };
}

function ImportDialog({ me, onClose, onDone }) {
  const [mode, setMode] = useState('file');
  const [sheet, setSheet] = useState(null); // { name, rows, headerRow, cols }
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = me.clock.today;

  async function pick(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(''); setPreview(null);
    try {
      const rows = await readXlsx(file);
      setSheet({ name: file.name, rows, ...guessColumns(rows) });
    } catch (err) {
      setSheet(null);
      setError(err.message);
    }
  }

  const rows = useMemo(() => {
    if (mode === 'paste') return parsePaste(text);
    if (!sheet) return [];
    const cell = (r, k) => (sheet.cols[k] === '' ? '' : r[sheet.cols[k]] ?? '');
    return sheet.rows.slice(sheet.headerRow + 1)
      .filter(r => r && r.some(v => String(v).trim()))
      .map(r => {
        const out = {};
        for (const [k] of IMPORT_FIELDS) if (k !== 'left') out[k] = String(cell(r, k)).trim();
        const left = excelDate(cell(r, 'left'));
        if (left && left <= today) out.left = true;
        return out;
      });
  }, [mode, text, sheet, today]);

  const named = rows.filter(r => r.first_name && r.last_name);
  const ready = mode === 'paste' || (sheet && sheet.cols.first_name !== '' && sheet.cols.last_name !== '');

  // Preview what the import would do, every time the rows change
  useEffect(() => {
    setPreview(null);
    if (!ready || !named.length) return undefined;
    const t = setTimeout(() => {
      api('importStudents', { rows: named, dryRun: true }).then(setPreview).catch(err => setError(err.message));
    }, 300);
    return () => clearTimeout(t);
  }, [rows, ready]);

  async function run() {
    setBusy(true);
    try {
      await api('importStudents', { rows: named });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const setCol = (k, v) => setSheet({ ...sheet, cols: { ...sheet.cols, [k]: v === '' ? '' : Number(v) } });
  const headers = sheet ? (sheet.rows[sheet.headerRow] || []) : [];
  const sm = preview?.summary;

  return (
    <Modal title="Uvoz dijakov" onClose={onClose} wide>
      <div className="form">
        <div className="seg">
          <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>Excelova datoteka</button>
          <button className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>Prilepi vrstice</button>
        </div>

        {mode === 'file' ? (
          <>
            <p className="hint">Izberite preglednico dijakov (.xlsx). Prebere se samo prvi list in samo stolpci za prehrano:
              priimek, ime, vzgojna skupina, dieta, izstop in zap. št. dijaka. <b>Ostali podatki (EMŠO, naslovi, starši, šola …) se ne prenesejo</b> –
              datoteka se obdela kar v vašem brskalniku.</p>
            <label className="file-pick">
              <Upload size={16} /> {sheet ? sheet.name : 'Izberi datoteko .xlsx'}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} />
            </label>
            {sheet && (
              <fieldset className="perm-field import-cols">
                <legend>Stolpci <small>prepoznani samodejno, po potrebi popravite</small></legend>
                {IMPORT_FIELDS.map(([k, label]) => (
                  <label key={k}>{label}
                    <select value={sheet.cols[k]} onChange={e => setCol(k, e.target.value)}>
                      <option value="">— ni v datoteki —</option>
                      {headers.map((h, i) => String(h).trim() && <option key={i} value={i}>{String(h).replace(/\s+/g, ' ').trim()}</option>)}
                    </select>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        ) : (
          <>
            <p className="hint">Prilepite vrstice iz Excela, en dijak v vrstici, stolpci v tem vrstnem redu:<br />
              <b>Priimek · Ime · Skupina · Soba · Posebna dieta</b> (skupina, soba in dieta so lahko prazne).</p>
            <textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'Novak\tAna\t1. skupina\t104\tbrez glutena\nKos\tBor\t2. skupina\t210'} />
          </>
        )}

        {named.length > 0 && (
          <div className="import-preview">
            <table className="list compact">
              <thead><tr><th>Priimek</th><th>Ime</th><th>Skupina</th><th>Dieta</th>{mode === 'file' && <th>Zap. št.</th>}</tr></thead>
              <tbody>
                {named.slice(0, 6).map((r, i) => (
                  <tr key={i} className={r.left ? 'inactive' : ''}>
                    <td>{r.last_name}</td><td>{r.first_name}</td><td>{r.group_name}</td><td>{r.diet}</td>{mode === 'file' && <td>{r.ext_id}{r.left && <em className="tag">izstop</em>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {named.length > 6 && <p className="muted">… in še {named.length - 6}</p>}
          </div>
        )}
        {sm && (
          <ul className="import-summary">
            <li><b>{sm.create}</b> novih dijakov</li>
            <li><b>{sm.update}</b> posodobljenih (skupina, dieta, ime)</li>
            {sm.moveOut > 0 && <li><b>{sm.moveOut}</b> izseljenih po datumu izstopa: {preview.moveOutNames.slice(0, 8).join(', ')}{sm.moveOut > 8 ? ' …' : ''}</li>}
            <li><b>{sm.same}</b> brez sprememb{sm.skipped > 0 && <>, <b>{sm.skipped}</b> preskočenih (izstopili ali podvojeni)</>}</li>
          </ul>
        )}
        <p className="hint">Dijake prepoznamo po zap. št. ali po imenu in priimku, zato lahko isto preglednico uvozite znova – obstoječi se posodobijo, ne podvojijo.
          Prazna polja v datoteki ne izbrišejo podatkov v aplikaciji. Novi dijaki dobijo navadni meni kot privzeti.</p>
        {rows.length > named.length && <p className="muted">Vrstic brez imena ali priimka: {rows.length - named.length} (ne uvozijo se).</p>}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>Prekliči</button>
          <button className="btn primary" disabled={busy || !sm || !(sm.create + sm.update + sm.moveOut)} onClick={run}>{busy ? 'Uvažanje …' : 'Uvozi'}</button>
        </div>
      </div>
    </Modal>
  );
}

function LoginBox({ student, me, onChanged }) {
  const [s, setS] = useState(student);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const canLock = me.rights.includes('users') && s.user_id;

  async function issue() {
    if (s.username && !confirm(`${studentName(s)} dobi novo začasno geslo, staro preneha veljati. Nadaljujem?`)) return;
    setBusy(true);
    try {
      const [sheet] = await printLogins([s.id], me);
      setS({ ...s, username: sheet.username, must_change: true, login_active: s.login_active ?? true });
      setMsg({ ok: true, text: `PDF z dostopom je prenesen. Natisnite ga in ga izročite dijaku. Geslo: ${sheet.password}` });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  async function toggleLock() {
    setBusy(true);
    try {
      await api('saveUser', { user: { id: s.user_id, active: !s.login_active } });
      setS({ ...s, login_active: !s.login_active });
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  return (
    <section className="side-box">
      <h4><KeyRound size={15} /> Dostop do aplikacije</h4>
      {s.username ? (
        <p>Uporabniško ime <b className="mono">{s.username}</b> · <LoginState s={s} />
          {s.last_login ? <span className="muted"> · zadnja prijava {fmtTime(s.last_login)}</span> : <span className="muted"> · še ni bil prijavljen</span>}</p>
      ) : <p className="muted">Dijak še nima dostopa. Ustvarite ga, natisnite listek in mu ga izročite.</p>}
      <div className="box-actions">
        <button type="button" className="btn small" onClick={issue} disabled={busy}>
          <KeyRound size={14} /> {s.username ? 'Novo začasno geslo (PDF)' : 'Ustvari dostop (PDF)'}
        </button>
        {canLock && (
          <button type="button" className="btn small ghost" onClick={toggleLock} disabled={busy}>
            {s.login_active ? <><Lock size={14} /> Zakleni dostop</> : <><Unlock size={14} /> Odkleni dostop</>}
          </button>
        )}
      </div>
      {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
    </section>
  );
}

function AbsenceBox({ student }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('absences', { student_id: student.id }).then(r => setList(r.absences)).catch(err => setError(err.message));
  useEffect(() => { load(); }, [student.id]);

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('addAbsence', { student_id: student.id, from: form.from, to: form.to || form.from, reason: form.reason });
      setForm(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancel(a) {
    if (!confirm('Prekličem odsotnost? Dijak bo za te dni spet prijavljen po privzetem meniju.')) return;
    setError('');
    try {
      await api('cancelAbsence', { id: a.id });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="side-box">
      <h4><CalendarOff size={15} /> Odsotnosti
        {!form && <button type="button" className="btn small ghost" onClick={() => setForm({ from: '', to: '', reason: '' })}><Plus size={14} /> Dodaj</button>}
      </h4>
      {form && (
        <form className="absence-form" onSubmit={add}>
          <label>Od<input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} required /></label>
          <label>Do<input type="date" value={form.to} min={form.from} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
          <label className="grow">Razlog<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="npr. bolezen, ekskurzija" /></label>
          <button className="btn small primary" disabled={!form.from}>Shrani</button>
          <button type="button" className="btn small ghost" onClick={() => setForm(null)}>Prekliči</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {list && (
        <ul className="absence-list">
          {list.map(a => (
            <li key={a.id}>
              <span><b>{fmtDay(a.day_from)}{a.day_to !== a.day_from ? ` – ${fmtDay(a.day_to)}` : ''}</b> {a.reason && <span className="muted">— {a.reason}</span>}</span>
              <span className="muted">{a.created_by_name}{a.created_by_role === 'student' ? ' (dijak)' : ''}</span>
              <button type="button" className="icon-btn" title="Prekliči odsotnost" onClick={() => cancel(a)}><Trash2 size={14} /></button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">Ni prijavljenih odsotnosti.</li>}
        </ul>
      )}
      <p className="hint">V času odsotnosti dijak ni prijavljen na noben obrok. Ob preklicu se za odprte dni vrne privzeti meni.</p>
    </section>
  );
}

// Logins for a whole group at once: new accounts, or new passwords for everyone in the group
// Standing weekday exception for many students at once, set once for the whole school year
const WEEKLY_CHOICES = [
  ['none', 'Odjava (ni prijavljen)'],
  ['dry', 'Suh obrok (vegetarijanci dobijo vegetarijanskega)'],
  ['', 'Brez izjeme – kot privzeti meni'],
];

function WeeklyDialog({ students, groups, initialGroup, onClose, onDone }) {
  const [day, setDay] = useState(5);
  const [meals, setMeals] = useState(['B', 'L']);
  const [variant, setVariant] = useState('none');
  const [group, setGroup] = useState(initialGroup || '');
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const dayMeals = meals.filter(m => !(day === 5 && m === 'D') && !(variant === 'dry' && m === 'B'));
  const inGroup = students.filter(s => !group || s.group_name === group);
  const target = students.filter(s => picked.has(s.id));
  const toggle = id => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = inGroup.length > 0 && inGroup.every(s => picked.has(s.id));
  const pickAll = on => setPicked(prev => { const n = new Set(prev); inGroup.forEach(s => (on ? n.add(s.id) : n.delete(s.id))); return n; });
  const current = s => dayMeals.map(m => s.weekly?.[day]?.[m]).filter(Boolean).map(v => VARIANT_LABEL[v].toLowerCase());

  async function run() {
    setBusy(true);
    setError('');
    try {
      setDone(await api('setWeekly', { student_ids: target.map(s => s.id), day, meals: dayMeals, variant }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const dayName = WEEKDAYS.find(([n]) => n === day)[1];
  return (
    <Modal title="Stalne tedenske izjeme" onClose={done ? onDone : onClose} wide>
      {done ? (
        <div className="form">
          <p className="success">Izjema je nastavljena pri {done.changed} {plural(done.changed, 'dijaku', 'dijakih', 'dijakih', 'dijakih')}{done.changed < done.total ? ` (pri ${done.total - done.changed} je bila že enaka)` : ''}. Velja vsak {dayName} do konca šolskega leta.</p>
          <p className="hint">Dnevi, ki ste jih pri dijaku ročno spremenili, ostanejo, kot so.</p>
          <div className="form-actions"><button className="btn primary" onClick={onDone}>Zapri</button></div>
        </div>
      ) : (
        <div className="form weekly-bulk">
          <p className="hint">Nastavite enkrat za celo šolsko leto – na primer odjava vsak petek ali suho kosilo vsako sredo. Posamezne dni lahko kasneje še vedno spremenite v prijavah.</p>
          <div className="weekly-bulk-row">
            <label>Dan
              <select value={day} onChange={e => setDay(Number(e.target.value))}>
                {WEEKDAYS.map(([n, name]) => <option key={n} value={n}>vsak {name}</option>)}
              </select>
            </label>
            <fieldset>
              <legend>Obroki</legend>
              {MEALS.map(m => {
                const off = (day === 5 && m === 'D') || (variant === 'dry' && m === 'B');
                return (
                  <label key={m} className={`inline-check${off ? ' muted' : ''}`}>
                    <input type="checkbox" disabled={off} checked={!off && meals.includes(m)}
                      onChange={e => setMeals(prev => (e.target.checked ? [...prev, m] : prev.filter(x => x !== m)))} /> {MEAL_NAMES[m]}
                  </label>
                );
              })}
            </fieldset>
            <fieldset>
              <legend>Kaj</legend>
              {WEEKLY_CHOICES.map(([v, label]) => (
                <label key={v} className="inline-check"><input type="radio" name="wv" checked={variant === v} onChange={() => setVariant(v)} /> {label}</label>
              ))}
            </fieldset>
          </div>
          <div className="weekly-bulk-pick">
            <div className="weekly-bulk-head">
              <select value={group} onChange={e => setGroup(e.target.value)}>
                <option value="">Vse skupine</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <label className="inline-check"><input type="checkbox" checked={allPicked} onChange={e => pickAll(e.target.checked)} /> Izberi vse ({inGroup.length})</label>
              <span className="muted">Izbranih: {target.length}</span>
            </div>
            <ul className="pick-list">
              {inGroup.map(s => {
                const cur = current(s);
                return (
                  <li key={s.id}>
                    <label className="inline-check">
                      <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                      <span>{studentName(s)} <span className="muted">{s.group_name}</span></span>
                      {cur.length > 0 && <em className="tag">zdaj: {cur.join(', ')}</em>}
                    </label>
                  </li>
                );
              })}
              {inGroup.length === 0 && <li className="muted">V tej skupini ni dijakov.</li>}
            </ul>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button className="btn ghost" onClick={onClose}>Prekliči</button>
            <button className="btn primary" disabled={busy || !target.length || !dayMeals.length} onClick={run}>
              {busy ? 'Shranjevanje …' : `Nastavi za ${target.length} ${plural(target.length, 'dijaka', 'dijaka', 'dijake', 'dijakov')}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LoginsDialog({ students, groups, initialGroup, me, onClose }) {
  const [group, setGroup] = useState(initialGroup || '');
  const [mode, setMode] = useState('missing');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const inGroup = students.filter(s => !group || s.group_name === group);
  const target = mode === 'missing' ? inGroup.filter(s => !s.username) : inGroup;

  async function run() {
    if (mode === 'all' && !confirm(`${target.length} dijakov dobi novo začasno geslo; stara gesla prenehajo veljati. Nadaljujem?`)) return;
    setBusy(true);
    setError('');
    try {
      setDone(await printLogins(target.map(s => s.id), me));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="Dostopi za dijake" onClose={onClose}>
      {done ? (
        <div className="form">
          <p className="success">PDF z {done.length} {plural(done.length, 'listkom', 'listkoma', 'listki', 'listki')} je prenesen. Natisnite ga, razrežite in listke izročite dijakom.</p>
          <p className="hint">Gesla se ne shranijo v berljivi obliki. Če PDF izgubite, izdajte nova gesla.</p>
          <div className="form-actions"><button className="btn primary" onClick={onClose}>Zapri</button></div>
        </div>
      ) : (
        <div className="form">
          <label>Skupina
            <select value={group} onChange={e => setGroup(e.target.value)}>
              <option value="">Vse skupine</option>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="inline-check"><input type="radio" name="mode" checked={mode === 'missing'} onChange={() => setMode('missing')} /> Samo dijaki brez dostopa ({inGroup.filter(s => !s.username).length})</label>
          <label className="inline-check"><input type="radio" name="mode" checked={mode === 'all'} onChange={() => setMode('all')} /> Vsi dijaki v skupini, z novimi gesli ({inGroup.length})</label>
          <p className="hint">Prenese se PDF s tremi listki na stran: uporabniško ime, začasno geslo in naslov aplikacije. Ob prvi prijavi si dijak izbere svoje geslo.</p>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button className="btn ghost" onClick={onClose}>Prekliči</button>
            <button className="btn primary" disabled={busy || !target.length} onClick={run}>{busy ? 'Pripravljam …' : `Natisni dostope (${target.length})`}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
