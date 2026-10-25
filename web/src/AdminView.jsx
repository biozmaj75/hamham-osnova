import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { fmtLong, capitalize } from './meals.js';

const ROLES = { admin: 'Skrbnik', teacher: 'Vzgojitelj', kitchen: 'Kuhinja' };

export default function AdminView({ me }) {
  return (
    <div className="admin">
      <Users me={me} />
      <SettingsCard />
    </div>
  );
}

function Users({ me }) {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api('users').then(r => setUsers(r.users));
  useEffect(() => { load(); }, []);

  return (
    <section className="table-card">
      <header className="card-head">
        <div><h2>Uporabniški računi</h2><p className="muted">Vzgojitelji urejajo naročila, kuhinja vidi število obrokov in sezname, skrbniki upravljajo vse.</p></div>
        <button className="btn primary" onClick={() => setEditing({ username: '', name: '', role: 'teacher', password: '', active: true })}><Plus size={16} /> Dodaj račun</button>
      </header>
      <table className="list">
        <thead><tr><th>Ime</th><th>Uporabniško ime</th><th>Vloga</th><th>Stanje</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className={u.active ? '' : 'inactive'} onClick={() => setEditing({ ...u, password: '' })}>
              <td><strong>{u.name}</strong>{u.id === me.id && <em className="tag">vi</em>}</td>
              <td>{u.username}</td>
              <td>{ROLES[u.role]}</td>
              <td>{u.active ? 'Aktiven' : 'Onemogočen'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </section>
  );
}

function UserForm({ user, onClose, onSaved }) {
  const [u, setU] = useState(user);
  const [error, setError] = useState('');
  const set = (k, v) => setU(p => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();
    try {
      await api('saveUser', { user: u });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={user.id ? `Uredi: ${user.name}` : 'Nov račun'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Ime in priimek<input value={u.name} onChange={e => set('name', e.target.value)} autoFocus /></label>
        <label>Uporabniško ime<input value={u.username} onChange={e => set('username', e.target.value)} /></label>
        <label>Vloga
          <select value={u.role} onChange={e => set('role', e.target.value)}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{user.id ? 'Novo geslo (pustite prazno, da ostane)' : 'Geslo (vsaj 8 znakov)'}
          <input type="text" value={u.password} onChange={e => set('password', e.target.value)} autoComplete="off" />
        </label>
        {user.id && <label className="inline-check"><input type="checkbox" checked={u.active} onChange={e => set('active', e.target.checked)} /> Račun je aktiven</label>}
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Prekliči</button><button className="btn primary">Shrani</button></div>
      </form>
    </Modal>
  );
}

function SettingsCard() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const load = () => api('settings').then(setS);
  useEffect(() => { load(); }, []);

  if (!s) return null;

  async function save(e) {
    e.preventDefault();
    try {
      await api('saveSettings', { timezone: s.timezone, cutoff_hour: Number(s.cutoff_hour) });
      setMsg({ ok: true, text: 'Shranjeno. Osvežite stran, da bo novi rok veljal povsod.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  async function closeDay(e) {
    e.preventDefault();
    await api('setClosedDay', { day, reason });
    setDay(''); setReason('');
    load();
  }

  return (
    <div className="admin-side">
      <section className="table-card pad-card">
        <h2>Rok za naročila</h2>
        <form className="form" onSubmit={save}>
          <label>Naročila za posamezen dan se zaprejo dan prej ob
            <select value={s.cutoff_hour} onChange={e => setS({ ...s, cutoff_hour: e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}.00</option>)}
            </select>
          </label>
          <label>Časovni pas<input value={s.timezone} onChange={e => setS({ ...s, timezone: e.target.value })} /></label>
          {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
          <div className="form-actions"><button className="btn primary">Shrani</button></div>
        </form>
      </section>
      <section className="table-card pad-card">
        <h2>Kuhinja zaprta</h2>
        <p className="muted">Počitnice in dnevi brez obrokov. Naročil za te dni ni mogoče spreminjati, na seznamu za kuhinjo je dan označen kot zaprt.</p>
        <form className="form row" onSubmit={closeDay}>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
          <input placeholder="Razlog, npr. jesenske počitnice" value={reason} onChange={e => setReason(e.target.value)} />
          <button className="btn" disabled={!day}><Plus size={16} /> Dodaj</button>
        </form>
        <ul className="closed-list">
          {s.closed.map(c => (
            <li key={c.day}>
              <span><b>{capitalize(fmtLong(c.day))}</b> {c.reason && <span className="muted">— {c.reason}</span>}</span>
              <button className="icon-btn" title="Odstrani" onClick={async () => { await api('setClosedDay', { day: c.day, remove: true }); load(); }}><Trash2 size={15} /></button>
            </li>
          ))}
          {s.closed.length === 0 && <li className="muted">Ni zaprtih dni.</li>}
        </ul>
      </section>
    </div>
  );
}
