import { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, Search, Leaf, History } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { MEALS, MEAL_NAMES, VARIANTS, VARIANT_LABEL, VARIANT_SHORT, fmtDay, studentName } from './meals.js';

const DEF_COL = { B: 'def_b', L: 'def_l', D: 'def_d' };
const EMPTY = { first_name: '', last_name: '', group_name: '', room: '', diet: '', notes: '', def_b: 'normal', def_l: 'normal', def_d: 'normal', active: true };

export default function StudentsView() {
  const [students, setStudents] = useState(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('students').then(r => setStudents(r.students)).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => [...new Set((students || []).map(s => s.group_name).filter(Boolean))].sort(), [students]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (students || []).filter(s => (showInactive || s.active)
      && (!q || `${s.first_name} ${s.last_name} ${s.group_name} ${s.room} ${s.diet}`.toLowerCase().includes(q)));
  }, [students, query, showInactive]);

  const activeCount = (students || []).filter(s => s.active).length;

  return (
    <div className="students">
      <div className="toolbar">
        <div className="title-block"><h1>Students</h1><span className="muted">{activeCount} living in the dormitory</span></div>
        <label className="search"><Search size={15} /><input placeholder="Search name, group, room, diet" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="inline-check"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show moved-out</label>
        <button className="btn" onClick={() => setImporting(true)}><Upload size={16} /> Import list</button>
        <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}><Plus size={16} /> Add student</button>
      </div>
      {error && <p className="error banner">{error}</p>}
      {!students ? <p className="muted pad">Loading…</p> : (
        <div className="table-card">
          <table className="list">
            <thead><tr><th>Name</th><th>Group</th><th>Room</th><th>Default menu</th><th>Special diet</th><th /></tr></thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.id} className={s.active ? '' : 'inactive'} onClick={() => setEditing({ ...s })}>
                  <td><strong>{studentName(s)}</strong>{!s.active && <em className="tag">moved out</em>}</td>
                  <td>{s.group_name}</td>
                  <td>{s.room}</td>
                  <td className="defaults">
                    {MEALS.map(m => <span key={m} title={`${MEAL_NAMES[m]}: ${VARIANT_LABEL[s[DEF_COL[m]]]}`} className={`chip v-${s[DEF_COL[m]]}`}>{VARIANT_SHORT[s[DEF_COL[m]]]}</span>)}
                  </td>
                  <td>{s.diet && <span className="diet"><Leaf size={11} />{s.diet}</span>}</td>
                  <td className="muted right">Edit</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="muted">No students found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editing && <StudentForm student={editing} groups={groups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function StudentForm({ student, groups, onClose, onSaved }) {
  const [s, setS] = useState(student);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (student.id && student.active && !s.active
      && !confirm('Mark as moved out? All orders that can still be changed will be cancelled.')) return;
    setBusy(true);
    try {
      await api('saveStudent', { student: s });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={student.id ? studentName(student) : 'New student'} onClose={onClose} wide>
      <form className="form two-col" onSubmit={save}>
        <label>First name<input value={s.first_name} onChange={e => set('first_name', e.target.value)} autoFocus /></label>
        <label>Last name<input value={s.last_name} onChange={e => set('last_name', e.target.value)} /></label>
        <label>Group
          <input list="groups" value={s.group_name} onChange={e => set('group_name', e.target.value)} placeholder="e.g. Group 3" />
          <datalist id="groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
        </label>
        <label>Room<input value={s.room} onChange={e => set('room', e.target.value)} /></label>
        <label className="span2"><span>Special diet <small>shown to the kitchen on every meal list</small></span>
          <input value={s.diet} onChange={e => set('diet', e.target.value)} placeholder="e.g. gluten-free, lactose-free, no nuts" />
        </label>
        <fieldset className="span2 defaults-field">
          <legend>Default menu <small>used automatically for every school day unless changed</small></legend>
          {MEALS.map(m => (
            <label key={m}>{MEAL_NAMES[m]}
              <select value={s[DEF_COL[m]]} onChange={e => set(DEF_COL[m], e.target.value)}>
                {VARIANTS[m].map(v => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
                <option value="none">Not registered</option>
              </select>
            </label>
          ))}
        </fieldset>
        <label className="span2">Notes<textarea rows={2} value={s.notes} onChange={e => set('notes', e.target.value)} /></label>
        {student.id && (
          <label className="inline-check span2"><input type="checkbox" checked={s.active} onChange={e => set('active', e.target.checked)} /> Lives in the dormitory (untick when the student moves out)</label>
        )}
        {student.id && <p className="hint span2">Changing the default menu updates all open days that were not changed by hand.</p>}
        {error && <p className="error span2">{error}</p>}
        <div className="form-actions span2">
          {student.id && (
            <button type="button" className="btn ghost" onClick={() => api('studentLog', { student_id: student.id }).then(r => setLog(r.log))}>
              <History size={16} /> Change history
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      {log && (
        <div className="log">
          <h4>Last changes</h4>
          {log.length === 0 && <p className="muted">No changes yet.</p>}
          <ul>
            {log.map((l, i) => (
              <li key={i}>
                <span className="muted">{new Date(l.at).toLocaleString()}</span>
                <span>{MEAL_NAMES[l.meal]} {fmtDay(l.day)}: {VARIANT_LABEL[l.old_variant] || '—'} → <b>{VARIANT_LABEL[l.new_variant]}</b></span>
                <span className="muted">{l.user_name || 'system'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

// Accepts lines pasted from a spreadsheet: last name, first name, group, room, special diet
function parseImport(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const p = line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',').map(x => x.trim());
    return { last_name: p[0] || '', first_name: p[1] || '', group_name: p[2] || '', room: p[3] || '', diet: p[4] || '' };
  });
}

function ImportDialog({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = parseImport(text);
  const bad = rows.filter(r => !r.first_name || !r.last_name).length;

  async function run() {
    setBusy(true);
    try {
      await api('importStudents', { rows });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Import students" onClose={onClose} wide>
      <div className="form">
        <p className="hint">Paste rows from Excel or a text file, one student per line, columns in this order:<br />
          <b>Last name · First name · Group · Room · Special diet</b> (group, room and diet may be empty). Everyone gets the normal menu by default.</p>
        <textarea rows={10} value={text} onChange={e => setText(e.target.value)} placeholder={'Novak\tAna\tGroup 1\t104\tgluten-free\nKos\tBor\tGroup 2\t210'} />
        {rows.length > 0 && <p className="muted">{rows.length} students recognised{bad ? ` — ${bad} without a full name` : ''}.</p>}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !rows.length || bad > 0} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length}`}</button>
        </div>
      </div>
    </Modal>
  );
}
