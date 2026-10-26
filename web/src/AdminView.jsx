import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Lock, Unlock, Search } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { MEALS, MEAL_NAMES, VARIANTS, VARIANT_LABEL, ROLE_NAME, fmtLong, capitalize } from './meals.js';

const STAFF_ROLES = ['admin', 'principal', 'teacher', 'dietitian', 'kitchen'];

// Mirror of the server's rights, for showing what each role can do
const ROLE_RIGHTS = {
  users: ['admin', 'principal'],
  students: ['admin', 'principal', 'teacher'],
  diets: ['admin', 'principal', 'teacher', 'dietitian'],
  orders: ['admin', 'principal', 'teacher', 'dietitian'],
  menu: ['admin', 'dietitian'],
  mealSettings: ['admin', 'dietitian'],
  system: ['admin'],
  kitchen: ['admin', 'principal', 'teacher', 'dietitian', 'kitchen'],
};

const RIGHT_LABEL = {
  users: 'Računi, vloge, zaklepanje in dnevnik',
  students: 'Osebni podatki dijakov in njihovi dostopi',
  diets: 'Prehranski podatki dijakov (privzeti meni, dieta)',
  orders: 'Naročila in odsotnosti',
  menu: 'Urejanje jedilnika',
  mealSettings: 'Šolsko leto, zaprti dnevi, izbire dijakov, ure obrokov',
  system: 'Rok za naročila, časovni pas',
  kitchen: 'Kuhinjski seznami in števila',
};

const ACTION_LABEL = {
  'user.create': 'Nov račun',
  'user.update': 'Sprememba računa',
  'user.lock': 'Zaklepanje računa',
  'user.unlock': 'Odklepanje računa',
  'student.create': 'Nov dijak',
  'student.update': 'Sprememba dijaka',
  'student.import': 'Uvoz dijakov',
  'student.weekly': 'Stalna izjema',
  'student.password': 'Dostop za dijaka',
  'absence.add': 'Odsotnost',
  'absence.cancel': 'Preklic odsotnosti',
  'menu.copy': 'Kopiranje jedilnika',
  'settings.meals': 'Nastavitve prehrane',
  'settings.system': 'Sistemske nastavitve',
  'closed.add': 'Zaprt dan',
  'closed.remove': 'Odprt dan',
};

const fmtTime = t => (t ? new Date(t).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// ------------------------------------------------------------ users

export function UsersView({ me }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [show, setShow] = useState('staff');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const load = () => api('users').then(setData).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);

  const isAdmin = me.user.role === 'admin';
  const users = data?.users || [];
  const staff = users.filter(u => u.role !== 'student');
  const students = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(u => u.role === 'student' && (!q || `${u.name} ${u.username} ${u.group_name}`.toLowerCase().includes(q)));
  }, [users, query]);

  async function toggleLock(u) {
    if (u.active && !confirm(`Zaklenem dostop za ${u.name}? Prijava ne bo več mogoča, dokler ga ne odklenete.`)) return;
    try {
      await api('saveUser', { user: { id: u.id, active: !u.active } });
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="admin">
      <section className="table-card">
        <header className="card-head">
          <div>
            <h2>Uporabniški računi</h2>
            <p className="muted">Vloge določajo, kaj kdo vidi. Zaklenjen račun se ne more prijaviti, podatki pa ostanejo.</p>
          </div>
          {show === 'staff' && (
            <button className="btn primary" onClick={() => setEditing({ username: '', name: '', role: 'teacher', password: '', active: true, perms: [], groups: [] })}>
              <Plus size={16} /> Dodaj račun
            </button>
          )}
        </header>
        <div className="seg-bar">
          <div className="seg">
            <button className={show === 'staff' ? 'on' : ''} onClick={() => setShow('staff')}>Zaposleni ({staff.length})</button>
            <button className={show === 'students' ? 'on' : ''} onClick={() => setShow('students')}>Dijaki ({users.length - staff.length})</button>
          </div>
          {show === 'students' && <label className="search"><Search size={15} /><input placeholder="Išči" value={query} onChange={e => setQuery(e.target.value)} /></label>}
        </div>
        {error && <p className="error banner">{error}</p>}
        {show === 'staff' ? (
          <table className="list">
            <thead><tr><th>Ime</th><th>Vloga</th><th>Zadnja prijava</th><th>Stanje</th></tr></thead>
            <tbody>
              {staff.map(u => {
                const locked = u.role === 'admin' && !isAdmin;
                return (
                  <tr key={u.id} className={`${u.active ? '' : 'inactive'} ${locked ? 'readonly' : ''}`}
                    onClick={() => !locked && setEditing({ ...u, password: '', perms: u.perms || [], groups: u.groups || [] })}
                    title={locked ? 'Skrbniške račune ureja samo skrbnik' : ''}>
                    <td><strong>{u.name}</strong>{u.id === me.user.id && <em className="tag">vi</em>}<div className="sub">{u.username}</div></td>
                    <td>{ROLE_NAME[u.role]}{(u.perms || []).length > 0 && <em className="tag" title={(u.perms || []).map(p => RIGHT_LABEL[p]).join('\n')}>+{u.perms.length} {u.perms.length === 1 ? 'pravica' : 'pravice'}</em>}
                      {u.role === 'teacher' && <div className="sub">{(u.groups || []).length ? `skupine: ${u.groups.join(', ')}` : 'brez skupine'}</div>}</td>
                    <td className="muted">{fmtTime(u.last_login)}{u.must_change && <em className="tag">začasno geslo</em>}</td>
                    <td>{u.active ? 'Aktiven' : <span className="locked-tag"><Lock size={12} /> Zaklenjen</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="list">
            <thead><tr><th>Dijak</th><th>Skupina</th><th>Zadnja prijava</th><th /></tr></thead>
            <tbody>
              {students.map(u => (
                <tr key={u.id} className={u.active ? 'static' : 'static inactive'}>
                  <td><strong>{u.name}</strong><div className="sub">{u.username}</div></td>
                  <td>{u.group_name}</td>
                  <td className="muted">{u.last_login ? fmtTime(u.last_login) : 'še ni bil prijavljen'}{u.must_change && <em className="tag">začasno geslo</em>}</td>
                  <td className="right">
                    <button className="btn small ghost" onClick={() => toggleLock(u)}>
                      {u.active ? <><Lock size={14} /> Zakleni</> : <><Unlock size={14} /> Odkleni</>}
                    </button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && <tr className="static"><td colSpan={4} className="muted">Ni dostopov za dijake. Ustvarijo jih vzgojitelji v zavihku Dijaki.</td></tr>}
            </tbody>
          </table>
        )}
        {editing && (
          <UserForm user={editing} me={me} extraRights={data?.extraRights || []} groups={data?.groups || []}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
        )}
      </section>
      <div className="admin-side">
        <RolesCard />
        {me.rights.includes('audit') && <AuditCard />}
      </div>
    </div>
  );
}

function UserForm({ user, me, extraRights, groups, onClose, onSaved }) {
  const [u, setU] = useState(user);
  const [error, setError] = useState('');
  const set = (k, v) => setU(p => ({ ...p, [k]: v }));
  const self = user.id === me.user.id;
  const roles = STAFF_ROLES.filter(r => r !== 'admin' || me.user.role === 'admin');
  const extras = extraRights.filter(p => !ROLE_RIGHTS[p].includes(u.role));
  const [newGroup, setNewGroup] = useState('');
  const allGroups = [...new Set([...groups, ...u.groups])].sort((a, b) => a.localeCompare(b, 'sl', { numeric: true }));
  const toggleGroup = (g, on) => set('groups', on ? [...u.groups, g] : u.groups.filter(x => x !== g));
  function addGroup() {
    const g = newGroup.trim();
    if (g && !u.groups.includes(g)) set('groups', [...u.groups, g]);
    setNewGroup('');
  }

  async function save(e) {
    e.preventDefault();
    try {
      await api('saveUser', { user: { ...u, perms: u.perms.filter(p => extras.includes(p)) } });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={user.id ? `Uredi: ${user.name}` : 'Nov račun'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Ime in priimek<input value={u.name} onChange={e => set('name', e.target.value)} autoFocus /></label>
        <label>Uporabniško ime<input value={u.username} onChange={e => set('username', e.target.value)} autoComplete="off" /></label>
        <label>Vloga
          <select value={u.role} onChange={e => set('role', e.target.value)} disabled={self}>
            {roles.map(r => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
          </select>
        </label>
        {u.role === 'teacher' && (
          <fieldset className="perm-field">
            <legend>Vzgojne skupine <small>ob prijavi vidi najprej svoje dijake, ostale pa na zahtevo</small></legend>
            {allGroups.map(g => (
              <label key={g} className="inline-check">
                <input type="checkbox" checked={u.groups.includes(g)} onChange={e => toggleGroup(g, e.target.checked)} /> {g}
              </label>
            ))}
            <div className="add-group">
              <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="Druga skupina, npr. 3. skupina"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } }} />
              <button type="button" className="btn small" onClick={addGroup} disabled={!newGroup.trim()}>Dodaj</button>
            </div>
          </fieldset>
        )}
        {extras.length > 0 && (
          <fieldset className="perm-field">
            <legend>Dodatne pravice <small>samo za ta račun, poleg pravic vloge</small></legend>
            {extras.map(p => (
              <label key={p} className="inline-check">
                <input type="checkbox" checked={u.perms.includes(p)}
                  onChange={e => set('perms', e.target.checked ? [...u.perms, p] : u.perms.filter(x => x !== p))} />
                {RIGHT_LABEL[p]}
              </label>
            ))}
          </fieldset>
        )}
        <label>{user.id ? 'Novo začasno geslo (pustite prazno, da ostane)' : 'Začasno geslo (vsaj 8 znakov)'}
          <input type="text" value={u.password} onChange={e => set('password', e.target.value)} autoComplete="off" />
        </label>
        <p className="hint">Ob prvi prijavi z začasnim geslom si mora uporabnik nastaviti svoje.</p>
        {user.id && !self && (
          <label className="inline-check"><input type="checkbox" checked={!u.active} onChange={e => set('active', !e.target.checked)} /> Račun je zaklenjen</label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Prekliči</button><button className="btn primary">Shrani</button></div>
      </form>
    </Modal>
  );
}

function RolesCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="table-card pad-card">
      <header className="row-head">
        <h2>Pravice vlog</h2>
        <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Skrij' : 'Prikaži'}</button>
      </header>
      {open && (
        <table className="rights">
          <thead><tr><th />{STAFF_ROLES.map(r => <th key={r} title={ROLE_NAME[r]}>{ROLE_NAME[r].split(' ')[0]}</th>)}</tr></thead>
          <tbody>
            {Object.keys(ROLE_RIGHTS).map(p => (
              <tr key={p}>
                <th>{RIGHT_LABEL[p]}</th>
                {STAFF_ROLES.map(r => <td key={r}>{ROLE_RIGHTS[p].includes(r) ? '●' : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">Dijak vidi samo jedilnik ter svoje obroke, odsotnosti in podatke. Kuhinja ne vidi zdravstvenih razlogov za diete.</p>
    </section>
  );
}

function AuditCard() {
  const [log, setLog] = useState(null);
  useEffect(() => { api('auditLog').then(r => setLog(r.log)).catch(() => setLog([])); }, []);
  return (
    <section className="table-card pad-card">
      <h2>Dnevnik sprememb</h2>
      <p className="muted">Kdo je spreminjal račune, dijake, odsotnosti in nastavitve.</p>
      {!log ? <p className="muted">Nalaganje …</p> : (
        <ul className="audit">
          {log.map((l, i) => (
            <li key={i}>
              <span className="muted">{fmtTime(l.at)}</span>
              <span><b>{ACTION_LABEL[l.action] || l.action}</b> {l.details}</span>
              <span className="muted">{l.user_name ? `${l.user_name}, ${ROLE_NAME[l.user_role] || ''}` : 'sistem'}</span>
            </li>
          ))}
          {log.length === 0 && <li className="muted">Še ni zapisov.</li>}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------ settings

export function SettingsView({ me }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('settings').then(setS).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);
  const has = r => me.rights.includes(r);

  if (error) return <p className="error banner">{error}</p>;
  if (!s) return <p className="muted pad">Nalaganje …</p>;

  return (
    <div className="admin">
      <div className="admin-side">
        {has('mealSettings') && <MealSettings s={s} setS={setS} />}
      </div>
      <div className="admin-side">
        {has('system') && <SystemSettings s={s} setS={setS} />}
        {has('mealSettings') && <ClosedDays closed={s.closed} reload={load} />}
      </div>
    </div>
  );
}

function SaveState({ msg }) {
  return msg ? <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p> : null;
}

function MealSettings({ s, setS }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (m, v) => setS(p => {
    const cur = p.student_choices[m] || [];
    return { ...p, student_choices: { ...p.student_choices, [m]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] } };
  });
  const setTime = (k, v) => setS(p => ({ ...p, meal_times: { ...p.meal_times, [k]: v } }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('saveMealSettings', {
        school_year_start: s.school_year_start, school_year_end: s.school_year_end,
        student_choices: s.student_choices, meal_times: s.meal_times, student_can_cancel: !!s.student_can_cancel,
      });
      setMsg({ ok: true, text: 'Shranjeno. Osvežite stran, da bodo nove nastavitve veljale povsod.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  return (
    <section className="table-card pad-card">
      <h2>Organizacija prehrane</h2>
      <form className="form" onSubmit={save}>
        <div className="form-pair">
          <label>Prvi dan šolskega leta<input type="date" value={s.school_year_start} onChange={e => setS({ ...s, school_year_start: e.target.value })} /></label>
          <label>Zadnji dan šolskega leta<input type="date" value={s.school_year_end} min={s.school_year_start} onChange={e => setS({ ...s, school_year_end: e.target.value })} /></label>
        </div>
        <p className="hint">Vsi dijaki so samodejno prijavljeni po svojem privzetem meniju in izjemah za ves čas šolskega leta. Brez šolskega leta se naročila pripravijo štiri tedne vnaprej.</p>

        <fieldset className="weekly-field">
          <legend>Kaj lahko dijaki izberejo sami <small>do roka za naročila</small></legend>
          <table className="weekly choices">
            <tbody>
              {MEALS.map(m => (
                <tr key={m}>
                  <th>{MEAL_NAMES[m]}</th>
                  <td>
                    {VARIANTS[m].map(v => (
                      <label key={v} className="inline-check choice">
                        <input type="checkbox" checked={(s.student_choices[m] || []).includes(v)} onChange={() => toggle(m, v)} /> {VARIANT_LABEL[v]}
                      </label>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="inline-check student-cancel">
            <input type="checkbox" checked={!!s.student_can_cancel} onChange={e => setS({ ...s, student_can_cancel: e.target.checked })} />
            Dijaki se lahko sami odjavijo od obroka in prijavijo odsotnost
          </label>
          {!s.student_can_cancel && <p className="hint">Dijak si lahko spreminja le vrsto obroka. Odjavo in odsotnost zanj vpiše vzgojitelj.</p>}
        </fieldset>

        <fieldset className="weekly-field times-field">
          <legend>Čas obrokov <small>dijaki in kuhinja ga vidijo ob obroku</small></legend>
          {MEALS.map(m => (
            <label key={m}>{MEAL_NAMES[m]}<input value={s.meal_times[m]} onChange={e => setTime(m, e.target.value)} placeholder="npr. 6.30–7.30" /></label>
          ))}
          <label>Pozni obrok<input value={s.meal_times.late} onChange={e => setTime('late', e.target.value)} placeholder="npr. do 16.00" /></label>
          <label>Prevzem suhega obroka<input value={s.meal_times.dry} onChange={e => setTime('dry', e.target.value)} placeholder="npr. 7.00–7.45" /></label>
        </fieldset>
        <SaveState msg={msg} />
        <div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? 'Shranjevanje …' : 'Shrani'}</button></div>
      </form>
    </section>
  );
}

function SystemSettings({ s, setS }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('saveSystemSettings', { timezone: s.timezone, cutoff_hour: Number(s.cutoff_hour) });
      setMsg({ ok: true, text: 'Shranjeno. Osvežite stran, da bodo nove nastavitve veljale povsod.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  return (
    <section className="table-card pad-card">
      <h2>Sistem</h2>
      <form className="form" onSubmit={save}>
        <label>Naročila za posamezen dan se zaprejo dan prej ob
          <select value={s.cutoff_hour} onChange={e => setS({ ...s, cutoff_hour: e.target.value })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}.00</option>)}
          </select>
        </label>
        <label>Časovni pas<input value={s.timezone} onChange={e => setS({ ...s, timezone: e.target.value })} /></label>
        <SaveState msg={msg} />
        <div className="form-actions"><button className="btn primary" disabled={busy}>{busy ? 'Shranjevanje …' : 'Shrani'}</button></div>
      </form>
    </section>
  );
}

function ClosedDays({ closed, reload }) {
  const [day, setDay] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');

  async function closeDay(e) {
    e.preventDefault();
    try {
      await api('setClosedDay', { day, to: to || day, reason });
      setDay(''); setTo(''); setReason('');
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <section className="table-card pad-card">
      <h2>Kuhinja zaprta</h2>
      <p className="muted">Počitnice, prazniki in dnevi brez obrokov. Za počitnice vpišite prvi in zadnji dan. Naročil za te dni ni mogoče spreminjati, na seznamu za kuhinjo je dan označen kot zaprt.</p>
      <form className="form closed-form" onSubmit={closeDay}>
        <label>Od<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        <label>Do (neobvezno)<input type="date" value={to} min={day} onChange={e => setTo(e.target.value)} /></label>
        <input className="span2" placeholder="Razlog, npr. jesenske počitnice" value={reason} onChange={e => setReason(e.target.value)} />
        <button className="btn" disabled={!day}><Plus size={16} /> Dodaj</button>
      </form>
      <ul className="closed-list">
        {closed.map(c => (
          <li key={c.day}>
            <span><b>{capitalize(fmtLong(c.day))}</b> {c.reason && <span className="muted">— {c.reason}</span>}</span>
            <button className="icon-btn" title="Odstrani" onClick={async () => { await api('setClosedDay', { day: c.day, remove: true }); reload(); }}><Trash2 size={15} /></button>
          </li>
        ))}
        {closed.length === 0 && <li className="muted">Ni zaprtih dni.</li>}
      </ul>
    </section>
  );
}
