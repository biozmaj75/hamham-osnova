import { useEffect, useState } from 'react';
import { Camera, Trash2, EyeOff, Eye } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { MEAL_NAMES, SCORE_LABEL, reasonWords, fmtLong } from './meals.js';

// Photos are shrunk in the browser before upload: a phone picture is several MB, this keeps it ~200 KB
function shrinkPhoto(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Slike ni mogoče prebrati. Izberi fotografijo JPG ali PNG.')); };
    img.src = url;
  });
}

// A student's rating of one meal: score 1–5, a reason of at least minWords words, an optional photo
export default function RateMeal({ day, meal, dish, existing, rules, onClose, onSaved }) {
  const [score, setScore] = useState(existing?.score || 0);
  const [reason, setReason] = useState(existing?.reason || '');
  const [photo, setPhoto] = useState(null);           // new photo (data URL)
  const [oldPhoto, setOldPhoto] = useState(null);     // the one already saved
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const words = reasonWords(reason);
  const enough = words >= rules.minWords;

  useEffect(() => {
    if (existing?.has_photo) api('ratingPhoto', { day, meal }).then(r => setOldPhoto(r.photo)).catch(() => {});
  }, []);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      setPhoto(await shrinkPhoto(file));
      setRemovePhoto(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('myRate', { day, meal, score, reason, photo: photo || undefined, removePhoto: removePhoto && !photo });
      onSaved('Hvala za oceno!');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Umaknem to oceno?')) return;
    try {
      await api('myDeleteRating', { day, meal });
      onSaved('Ocena je umaknjena.');
    } catch (err) {
      setError(err.message);
    }
  }

  const shown = photo || (!removePhoto && oldPhoto);

  return (
    <Modal title={`Oceni: ${MEAL_NAMES[meal].toLowerCase()}`} onClose={onClose}>
      <form className="form rate-form" onSubmit={save}>
        <p className="muted rate-what">{fmtLong(day)}{dish && <><br /><b>{dish}</b></>}</p>

        <fieldset className="rate-scores">
          <legend>Ocena <small>1 = zelo slab, 5 = odličen</small></legend>
          {[1, 2, 3, 4, 5].map(n => (
            <label key={n} className={`rate-score s${n} ${score === n ? 'on' : ''}`}>
              <input type="radio" name="score" value={n} checked={score === n} onChange={() => setScore(n)} />
              <b>{n}</b><small>{SCORE_LABEL[n]}</small>
            </label>
          ))}
        </fieldset>

        <label>Utemeljitev ocene
          <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000}
            placeholder="Kaj ti je bilo všeč ali ne? Okus, temperatura, količina, postrežba …" />
        </label>
        <p className={`hint word-count ${enough ? 'ok' : ''}`}>
          {enough ? '✓ ' : ''}{Math.min(words, rules.minWords)} / {rules.minWords} besed (vsaj {rules.minWords} različnih besed z vsaj 3 črkami)
        </p>

        <div className="rate-photo">
          {shown && <img src={shown} alt="Fotografija obroka" />}
          <div className="rate-photo-actions">
            <label className="btn small file-btn">
              <Camera size={14} /> {shown ? 'Zamenjaj fotografijo' : 'Priloži fotografijo'}
              <input type="file" accept="image/*" onChange={pick} hidden />
            </label>
            {shown && <button type="button" className="btn ghost small" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Odstrani</button>}
            {!shown && <span className="muted small-note">neobvezno</span>}
          </div>
        </div>

        <p className="hint rate-anon">
          {rules.anonymous
            ? <><EyeOff size={13} /> Ocena je anonimna – kdo jo je oddal, ne vidi nihče.</>
            : <><Eye size={13} /> Ocena ni anonimna – pri oceni bo zapisano tvoje ime.</>}
        </p>

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          {existing && <button type="button" className="btn ghost danger-text" onClick={remove}><Trash2 size={14} /> Umakni</button>}
          <div className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Prekliči</button>
          <button className="btn primary" disabled={busy || !score || !enough}>{busy ? 'Pošiljanje …' : existing ? 'Shrani oceno' : 'Oddaj oceno'}</button>
        </div>
      </form>
    </Modal>
  );
}
