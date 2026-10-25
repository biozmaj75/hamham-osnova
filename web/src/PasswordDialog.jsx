import { useState } from 'react';
import { api } from './api.js';
import Modal from './Modal.jsx';

export default function PasswordDialog({ onClose }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    try {
      await api('changePassword', { current, password });
      setMsg({ ok: true, text: 'Geslo je spremenjeno.' });
      setCurrent(''); setPassword('');
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <Modal title="Sprememba gesla" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Trenutno geslo<input type="password" value={current} onChange={e => setCurrent(e.target.value)} /></label>
        <label>Novo geslo (vsaj 8 znakov)<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
        <div className="form-actions"><button className="btn primary" disabled={!current || password.length < 8}>Shrani</button></div>
      </form>
    </Modal>
  );
}
