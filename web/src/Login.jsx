import { useState } from 'react';
import { api, session } from './api.js';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api('login', { username, password });
      session.token = token;
      await onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <p className="eyebrow">Dijaški dom</p>
        <h1>Vsak krožnik,<br />preštet do šestih.</h1>
        <p className="lede">Zajtrk, kosilo in večerja za ves dom. Naročila za jutri se zaprejo ob 18.00 — potem so številke za kuhinjo dokončne.</p>
        <ul className="legend-strip">
          <li className="v-normal">Navadni</li>
          <li className="v-veg">Vegetarijanski</li>
          <li className="v-dry_normal">Suhi</li>
          <li className="v-late_normal">Pozni</li>
          <li className="v-light">Lahki</li>
        </ul>
      </section>
      <form className="login-card" onSubmit={submit}>
        <h2>Prijava</h2>
        <label>Uporabniško ime<input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>Geslo<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !username || !password}>{busy ? 'Prijavljanje …' : 'Prijava'}</button>
      </form>
    </div>
  );
}
