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
        <p className="eyebrow">Student dormitory</p>
        <h1>Every plate,<br />counted by six.</h1>
        <p className="lede">Breakfast, lunch and dinner for the whole house. Orders for tomorrow close at 18:00 — after that the kitchen's numbers are final.</p>
        <ul className="legend-strip">
          <li className="v-normal">Normal</li>
          <li className="v-veg">Vegetarian</li>
          <li className="v-dry_normal">Dry</li>
          <li className="v-late_normal">Late</li>
          <li className="v-light">Light</li>
        </ul>
      </section>
      <form className="login-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <label>Username<input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
