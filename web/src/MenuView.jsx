import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, Copy } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import {
  MEALS, MEAL_NAMES, MENU_VARIANTS, VARIANT_LABEL, addDays, mondayOf, startWeek, mealServed, dayShort, fmtDay, dishFor,
} from './meals.js';

export default function MenuView({ clock, canEdit }) {
  const [from, setFrom] = useState(() => startWeek(clock.firstEditable || addDays(clock.today, 1)));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(0);
  const [copying, setCopying] = useState(false);

  const load = () => {
    setError('');
    return api('menuWeek', { from }).then(setData).catch(err => setError(err.message));
  };
  useEffect(() => { setData(null); load(); }, [from]);

  async function save(day, meal, variant, dish) {
    if (dish.trim() === dishFor(data.items, day, meal, variant)) return;
    setSaving(n => n + 1);
    try {
      await api('saveMenu', { items: [{ day, meal, variant, dish }] });
      setData(d => ({
        ...d,
        items: [
          ...d.items.filter(i => !(i.day === day && i.meal === meal && i.variant === variant)),
          ...(dish.trim() ? [{ day, meal, variant, dish: dish.trim() }] : []),
        ],
      }));
    } catch (err) {
      setError(err.message);
    }
    setSaving(n => n - 1);
  }

  const closed = day => data?.closed.find(c => c.day === day);
  const last = addDays(from, 4);

  return (
    <div className="menu-view">
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setFrom(addDays(from, -7))} title="Prejšnji teden"><ChevronLeft size={18} /></button>
          <div className="week-label">
            <span className="eyebrow">Teden</span>
            <strong>{fmtDay(from)} – {fmtDay(last)} {last.slice(0, 4)}</strong>
          </div>
          <button className="icon-btn" onClick={() => setFrom(addDays(from, 7))} title="Naslednji teden"><ChevronRight size={18} /></button>
          <input type="date" value={from} onChange={e => e.target.value && setFrom(mondayOf(e.target.value))} title="Skok na teden" />
          <button className="btn ghost small" onClick={() => setFrom(mondayOf(clock.today))}>Ta teden</button>
        </div>
        <div className="grow" />
        {canEdit && <span className="muted save-state">{saving ? 'Shranjevanje …' : 'Spremembe se shranijo samodejno'}</span>}
        {canEdit && <button className="btn" onClick={() => setCopying(true)} disabled={!data?.items.length}><Copy size={16} /> Kopiraj teden</button>}
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Natisni</button>
      </div>

      {error && <p className="error banner">{error}</p>}

      <div className="print-only menu-print-head">
        <h1>Jedilnik {fmtDay(from)} – {fmtDay(last)} {last.slice(0, 4)}</h1>
      </div>

      {data && (
        <div className="grid-wrap menu-wrap">
          <table className="grid menu-grid">
            <thead>
              <tr>
                <th className="sticky-col corner" />
                {data.days.map(d => (
                  <th key={d} className={closed(d) ? 'closed' : ''}>
                    <span className="day-name">{dayShort(d)}</span> {fmtDay(d)}
                    {closed(d) && <small className="closed-note">zaprto{closed(d).reason ? ` — ${closed(d).reason}` : ''}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            {MEALS.map(m => (
              <tbody key={m}>
                <tr className="meal-head"><th className="sticky-col" colSpan={6}>{MEAL_NAMES[m]}</th></tr>
                {MENU_VARIANTS[m].map(v => (
                  <tr key={v}>
                    <th className="sticky-col variant">{VARIANT_LABEL[v]}</th>
                    {data.days.map(d => {
                      if (!mealServed(d, m)) return <td key={d} className="no-meal">ni obroka</td>;
                      const dish = dishFor(data.items, d, m, v);
                      if (closed(d)) return <td key={d} className="no-meal">{dish || '—'}</td>;
                      return (
                        <td key={`${d}|${from}`} className="dish-cell">
                          {canEdit
                            ? <DishInput value={dish} onSave={t => save(d, m, v, t)} />
                            : <span className={dish ? '' : 'muted'}>{dish || '—'}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <p className="hint menu-note no-print">Pozni obroki dobijo isto jed kot navadni oziroma vegetarijanski obrok.{canEdit ? ' Pustite polje prazno, če jedi še ni.' : ''}</p>

      {copying && <CopyWeek from={from} onClose={() => setCopying(false)} onDone={msg => { setCopying(false); alert(msg); }} />}
    </div>
  );
}

function DishInput({ value, onSave }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <textarea
      rows={2}
      value={text}
      maxLength={300}
      placeholder="—"
      onChange={e => setText(e.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}

function CopyWeek({ from, onClose, onDone }) {
  const [to, setTo] = useState(addDays(from, 7));
  const [weeks, setWeeks] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const start = mondayOf(to);
    const targets = Array.from({ length: Number(weeks) }, (_, i) => addDays(start, 7 * i));
    setBusy(true);
    try {
      await api('copyMenu', { from, to: targets });
      onDone(`Jedilnik je kopiran v ${targets.length === 1 ? 'teden' : `${targets.length} tednov, prvi`} od ${fmtDay(start)} dalje.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Kopiraj jedilnik tedna ${fmtDay(from)} – ${fmtDay(addDays(from, 4))}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>V teden, ki vsebuje dan<input type="date" value={to} onChange={e => setTo(e.target.value)} required /></label>
        <label>Število zaporednih tednov
          <input type="number" min={1} max={52} value={weeks} onChange={e => setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))} />
        </label>
        <p className="hint">Obstoječi jedilnik v ciljnih tednih bo zamenjan. Primerno za ponavljajoče se tedenske jedilnike, npr. kopija vsak teden do konca meseca.</p>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Prekliči</button>
          <button className="btn primary" disabled={busy || !to}>{busy ? 'Kopiranje …' : 'Kopiraj'}</button>
        </div>
      </form>
    </Modal>
  );
}
