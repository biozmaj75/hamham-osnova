import { useState } from 'react';
import { Download } from 'lucide-react';
import { osebniListDocx } from './osebniListDocx.js';
import { downloadBlob } from './pdf.js';

const fmtDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.split('-').reverse().map(Number).join('. ') : d || '');
const slug = v => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// School year that a date falls in (from September on it is the next one): 2026-10-29 -> 2026
const yearOf = d => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1);
// "3. 9. 2024" or "2024-09-03" -> Date
function parseDay(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
const SEX = v => (/^(m|moški)/i.test(v || '') ? 'moški' : /^(ž|z|f|ženski)/i.test(v || '') ? 'ženski' : v || '');

// A parent from the register: separate first/last name columns, or one "Mati"/"Oče" column with the full name
function parent(d, who) {
  let first = d[`${who}_first`] || '';
  let last = d[`${who}_last`] || '';
  if (!first && !last && d[who]) {
    const parts = d[who].trim().split(/\s+/);
    last = parts.length > 1 ? parts.pop() : '';
    first = parts.join(' ');
  }
  return { first, last, address: d[`${who}_address`] || '', post: '' };
}

// The home's personal record sheet, filled in from the student record; everything can be changed before download
export default function OsebniListForm({ student, details: d = {}, onClose }) {
  const current = yearOf(new Date());
  const admitted = parseDay(d.admitted);
  const first = Math.max(Math.min(admitted ? yearOf(admitted) : current, current), current - 5);
  const [v, setV] = useState(() => ({
    list_no: student.ext_id || '',
    contract: [d.contract_no && `št. ${d.contract_no}`, d.contract_date].filter(Boolean).join(', '),
    admitted: d.admitted || '',
    left_on: fmtDate(student.left_on || d.left_on),
    left_reason: d.left_reason || '',
    first_name: student.first_name, last_name: student.last_name,
    sex: SEX(d.sex), emso: d.emso || '',
    birth_date: d.birth_date || '', birth_place: d.birth_place || '', birth_municipality: '',
    birth_country: d.birth_country || '', citizenship: d.citizenship || '',
    address: d.address || '', post: [d.post_code, d.post].filter(Boolean).join(' '),
    municipality: d.municipality || '', country: d.post_code ? 'Slovenija' : '',
    mother: parent(d, 'mother'), father: parent(d, 'father'), guardian: { first: '', last: '', address: '', post: '' },
    years: Array.from({ length: 6 }, (_, i) => {
      const y = first + i;
      const now = y === current;
      return {
        year: `${y}/${y + 1}`, past: y <= current,
        school: now ? d.school || '' : '', program: now ? d.program || '' : '', grade: now ? d.class || '' : '',
        group: now ? student.group_name || '' : '', activities: '', awards: '', signed: '',
      };
    }),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => setV(prev => ({ ...prev, [k]: x }));
  const text = (k, label) => <label>{label}<input value={v[k]} onChange={e => set(k, e.target.value)} /></label>;
  const setPerson = (who, k, x) => setV(prev => ({ ...prev, [who]: { ...prev[who], [k]: x } }));
  const setYear = (i, k, x) => setV(prev => ({ ...prev, years: prev.years.map((y, j) => (j === i ? { ...y, [k]: x } : y)) }));

  async function download() {
    setBusy(true);
    setError('');
    try {
      downloadBlob(await osebniListDocx(v), `osebni-list-${slug(`${student.last_name} ${student.first_name}`)}.docx`);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  // The box sits inside the student form: Enter must not save the student
  const noSubmit = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); };
  const shown = v.years.map((y, i) => [y, i]).filter(([y]) => y.past);

  return (
    <div className="confirm-box izpisnica osebni-list" onKeyDown={noSubmit}>
      <p><b>Osebni list</b> <span className="muted">– podatki so vpisani iz kartoteke dijaka; dopolnite ali popravite, kar je treba, in prenesite dokument (en list, ležeče A4).</span></p>
      <h5>Nastanitev</h5>
      <div className="move-out-fields">
        {text('list_no', 'Št. osebnega lista')}
        {text('contract', 'Sklenitev pogodbe')}
        {text('admitted', 'Datum sprejema')}
        {text('left_on', 'Datum izstopa')}
        <label className="span2">Razlog izstopa<input value={v.left_reason} onChange={e => set('left_reason', e.target.value)} /></label>
      </div>
      <h5>Dijak</h5>
      <div className="move-out-fields">
        {text('first_name', 'Ime')}
        {text('last_name', 'Priimek')}
        {text('sex', 'Spol')}
        {text('emso', 'EMŠO')}
        {text('birth_date', 'Datum rojstva')}
        {text('birth_place', 'Kraj rojstva')}
        {text('birth_municipality', 'Občina rojstva')}
        {text('birth_country', 'Država rojstva')}
        {text('citizenship', 'Državljanstvo')}
        {text('address', 'Naslov')}
        {text('post', 'Pošta')}
        {text('municipality', 'Občina')}
        {text('country', 'Država')}
      </div>
      {[['mother', 'Mati'], ['father', 'Oče'], ['guardian', 'Skrbnik']].map(([who, title]) => (
        <div key={who}>
          <h5>{title}</h5>
          <div className="move-out-fields four">
            {[['first', 'Ime'], ['last', 'Priimek'], ['address', 'Naslov'], ['post', 'Pošta']].map(([k, label]) => (
              <label key={k}>{label}<input value={v[who][k]} onChange={e => setPerson(who, k, e.target.value)} /></label>
            ))}
          </div>
        </div>
      ))}
      <h5>Bivanje in izobraževanje <small className="muted">prihodnja šolska leta ostanejo prazna za ročni vpis</small></h5>
      <div className="ol-years">
        <table>
          <thead><tr><th />{shown.map(([y]) => <th key={y.year}>{y.year}</th>)}</tr></thead>
          <tbody>
            {[['school', 'Šola'], ['program', 'Program'], ['grade', 'Letnik'], ['group', 'Vzgojna skupina'],
              ['activities', 'Interesne dejavnosti'], ['awards', 'Pohvale, nagrade, priznanja'], ['signed', 'Datum (podpis vzgojitelja)']].map(([k, label]) => (
              <tr key={k}>
                <th>{label}</th>
                {shown.map(([y, i]) => <td key={y.year}><input value={y[k]} onChange={e => setYear(i, k, e.target.value)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="box-actions">
        <button type="button" className="btn small primary" onClick={download} disabled={busy}><Download size={14} /> {busy ? 'Pripravljam …' : 'Prenesi osebni list (docx)'}</button>
        <button type="button" className="btn small ghost" onClick={onClose}>Zapri</button>
      </div>
    </div>
  );
}
