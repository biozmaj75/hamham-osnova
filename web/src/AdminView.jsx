import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { fmtLong } from './meals.js';

const ROLES = { admin: 'Administrator', teacher: 'Teacher', kitchen: 'Kitchen' };

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
        <div><h2>Staff accounts</h2><p className="muted">Teachers edit orders, the kitchen sees counts and lists, administrators manage everything.</p></div>
        <button className="btn primary" onClick={() => setEditing({ username: '', name: '', role: 'teacher', password: '', active: true })}><Plus size={16} /> Add account</button>
      </header>
      <table className="list">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} className={u.active ? '' : 'inactive'} onClick={() => setEditing({ ...u, password: '' })}>
              <td><strong>{u.name}</strong>{u.id === me.id && <em className="tag">you</em>}</td>
              <td>{u.username}</td>
              <td>{ROLES[u.role]}</td>
              <td>{u.active ? 'Active' : 'Disabled'}</td>
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
    <Modal title={user.id ? `Edit ${user.name}` : 'New account'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Full name<input value={u.name} onChange={e => set('name', e.target.value)} autoFocus /></label>
        <label>Username<input value={u.username} onChange={e => set('username', e.target.value)} /></label>
        <label>Role
          <select value={u.role} onChange={e => set('role', e.target.value)}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>{user.id ? 'New password (leave empty to keep)' : 'Password (min. 8 characters)'}
          <input type="text" value={u.password} onChange={e => set('password', e.target.value)} autoComplete="off" />
        </label>
        {user.id && <label className="inline-check"><input type="checkbox" checked={u.active} onChange={e => set('active', e.target.checked)} /> Account active</label>}
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
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
      setMsg({ ok: true, text: 'Saved. Reload the page to see the new deadline everywhere.' });
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
        <h2>Ordering deadline</h2>
        <form className="form" onSubmit={save}>
          <label>Orders for a day close the day before at
            <select value={s.cutoff_hour} onChange={e => setS({ ...s, cutoff_hour: e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </label>
          <label>Time zone<input value={s.timezone} onChange={e => setS({ ...s, timezone: e.target.value })} /></label>
          {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
          <div className="form-actions"><button className="btn primary">Save</button></div>
        </form>
      </section>
      <section className="table-card pad-card">
        <h2>Kitchen closed</h2>
        <p className="muted">Holidays and days without meals. Orders for these days cannot be changed and the kitchen sheet shows the day as closed.</p>
        <form className="form row" onSubmit={closeDay}>
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
          <input placeholder="Reason, e.g. autumn holidays" value={reason} onChange={e => setReason(e.target.value)} />
          <button className="btn" disabled={!day}><Plus size={16} /> Add</button>
        </form>
        <ul className="closed-list">
          {s.closed.map(c => (
            <li key={c.day}>
              <span><b>{fmtLong(c.day)}</b> {c.reason && <span className="muted">— {c.reason}</span>}</span>
              <button className="icon-btn" title="Remove" onClick={async () => { await api('setClosedDay', { day: c.day, remove: true }); load(); }}><Trash2 size={15} /></button>
            </li>
          ))}
          {s.closed.length === 0 && <li className="muted">No closed days.</li>}
        </ul>
      </section>
    </div>
  );
}
