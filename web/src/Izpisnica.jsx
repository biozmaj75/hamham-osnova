import { useState } from 'react';
import { Download } from 'lucide-react';
import { izpisnicaDocx, CHECKS } from './izpisnicaDocx.js';
import { downloadBlob } from './pdf.js';

const fmtDate = d => (d ? d.split('-').reverse().map(Number).join('. ') : '');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const guessSex = v => (/^(m|moški)/i.test(v || '') ? 'M' : /^(ž|z|f|ženski)/i.test(v || '') ? 'Z' : '');
const slug = v => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The home's move-out form, filled in from the student record; everything can still be changed before download
export default function IzpisnicaForm({ student, details = {}, leftOn, reason, onClose }) {
  const [v, setV] = useState(() => ({
    sex: guessSex(details.sex),
    name: `${student.first_name} ${student.last_name}`,
    birth_date: details.birth_date || '',
    birth_place: details.birth_place || '',
    request_date: today(),
    move_date: leftOn || '',
    reason: reason || details.left_reason || '',
    reg_no: student.ext_id || '',
    received: today(),
    notice: '',
    left_on: leftOn || '',
    keys: '', linen: '', damage: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => setV(prev => ({ ...prev, [k]: x }));
  const text = (k, label, extra = {}) => <label>{label}<input value={v[k]} onChange={e => set(k, e.target.value)} {...extra} /></label>;
  const date = (k, label) => <label>{label}<input type="date" value={v[k]} onChange={e => set(k, e.target.value)} /></label>;
  const word = (m, f, both) => (v.sex === 'M' ? m : v.sex === 'Z' ? f : both);

  async function download() {
    setBusy(true);
    setError('');
    try {
      const blob = await izpisnicaDocx({
        ...v,
        request_date: fmtDate(v.request_date), move_date: fmtDate(v.move_date),
        received: fmtDate(v.received), left_on: fmtDate(v.left_on),
      });
      downloadBlob(blob, `izpisnica-${slug(`${student.last_name} ${student.first_name}`)}.docx`);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  // The box sits inside the student form: Enter must not save the student
  const noSubmit = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); };

  return (
    <div className="confirm-box izpisnica" onKeyDown={noSubmit}>
      <p><b>Izpisnica</b> <span className="muted">– podatki so vpisani iz kartoteke dijaka; dopolnite ali popravite, kar je treba, in prenesite dokument.</span></p>
      <div className="move-out-fields">
        <label>Spol (za obliko besed v dokumentu)
          <select value={v.sex} onChange={e => set('sex', e.target.value)}>
            <option value="">dijak_inja (obe obliki)</option>
            <option value="M">dijak</option>
            <option value="Z">dijakinja</option>
          </select>
        </label>
        {text('name', `Ime in priimek ${word('dijaka', 'dijakinje', 'dijaka_inje')}`)}
        {text('birth_date', `${word('Rojen', 'Rojena', 'Rojen_a')} (datum)`, { placeholder: 'npr. 3. 5. 2009' })}
        {text('birth_place', 'Kraj rojstva')}
      </div>
      <h5>Izjava</h5>
      <div className="move-out-fields">
        {date('request_date', 'Datum vloge za izpis')}
        {date('move_date', 'Dne … se izselim iz dijaškega doma')}
        <label className="span2">Razlog izpisa<input value={v.reason} onChange={e => set('reason', e.target.value)} /></label>
      </div>
      <h5>Potrdilo o izpisu <small className="muted">izpolni dom</small></h5>
      <div className="move-out-fields">
        {text('reg_no', 'Številka vpisa v evidenco')}
        {date('received', 'Datum prejema izpisnice')}
        {text('notice', 'Odpovedni rok (dni)', { inputMode: 'numeric' })}
        {date('left_on', 'Datum izpisa iz dijaškega doma')}
      </div>
      <div className="izpis-checks">
        {CHECKS.map(([k, label]) => (
          <div key={k} className="izpis-check">
            <span>{label.replace(/(\w+)_a\b/, (_, stem) => word(stem, `${stem}a`, `${stem}_a`))}</span>
            {['da', 'ne', ''].map(a => (
              <label key={a} className="inline-check">
                <input type="radio" name={`izpis-${k}`} checked={v[k] === a} onChange={() => set(k, a)} /> {a || 'prazno'}
              </label>
            ))}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="box-actions">
        <button type="button" className="btn small primary" onClick={download} disabled={busy}><Download size={14} /> {busy ? 'Pripravljam …' : 'Prenesi izpisnico (docx)'}</button>
        <button type="button" className="btn small ghost" onClick={onClose}>Zapri</button>
      </div>
    </div>
  );
}
