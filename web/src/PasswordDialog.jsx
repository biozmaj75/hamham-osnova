import { useState } from 'react';
import { api, session } from './api.js';
import Modal from './Modal.jsx';

// forced: first sign-in with a temporary password; the dialog stays until the password is changed
export default function PasswordDialog({ onClose, forced, onChanged, onSignOut }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (password !== repeat) { setMsg({ ok: false, text: 'Gesli se ne ujemata' }); return; }
    setBusy(true);
    try {
      const r = await api('changePassword', { current, password });
      session.token = r.token;
      setMsg({ ok: true, text: 'Geslo je spremenjeno. Na drugih napravah se boste morali prijaviti znova.' });
      setCurrent(''); setPassword(''); setRepeat('');
      onChanged?.();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  return (
    <Modal title={forced ? 'Nastavite svoje geslo' : 'Sprememba gesla'} onClose={forced ? null : onClose}>
      <form className="form" onSubmit={save}>
        {forced && <p className="hint">Prijavili ste se z začasnim geslom. Pred nadaljevanjem si izberite svoje geslo, ki ga poznate samo vi.</p>}
        <label>{forced ? 'Začasno geslo' : 'Trenutno geslo'}<input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" autoFocus /></label>
        <label>Novo geslo (vsaj 8 znakov)<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label>
        <label>Ponovite novo geslo<input type="password" value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" /></label>
        {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
        <div className="form-actions">
          {forced && <button type="button" className="btn ghost" onClick={onSignOut}>Odjava</button>}
          <button className="btn primary" disabled={busy || !current || password.length < 8 || !repeat}>Shrani</button>
        </div>
      </form>
    </Modal>
  );
}
