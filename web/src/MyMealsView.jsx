import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, CalendarOff, Trash2, Plus, Leaf, Clock, Star } from 'lucide-react';
import { api } from './api.js';
import RateMeal from './RateMeal.jsx';
import {
  MEALS, MEAL_NAMES, VARIANT_LABEL, VARIANT_SHORT, addDays, startWeek, mondayOf, mealServed, fmtDay, fmtLong, capitalize, dishFor,
} from './meals.js';

const TIME_NOTE = v => (v.startsWith('dry_') ? 'dry' : v.startsWith('late_') ? 'late' : null);

// The student's own week: menu, choices before the deadline, absences
export default function MyMealsView({ me }) {
  const clock = me.clock;
  const [from, setFrom] = useState(() => startWeek(clock.firstEditable));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [rating, setRating] = useState(null);

  const load = () => api('myWeek', { from }).then(setData).catch(err => setError(err.message));
  useEffect(() => { setData(null); setError(''); load(); }, [from]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function choose(day, meal, variant) {
    setBusy(`${day}|${meal}`);
    try {
      await api('mySetOrder', { day, meal, variant });
      await load();
      setToast({ text: 'Shranjeno.' });
    } catch (err) {
      setToast({ error: true, text: err.message });
    }
    setBusy('');
  }

  const order = (day, meal) => data?.orders.find(o => o.day === day && o.meal === meal);
  const closed = day => data?.closed.find(c => c.day === day);
  const away = day => data?.absences.find(a => a.day_from <= day && day <= a.day_to);
  const ratingOf = (day, meal) => data?.ratings.find(r => r.day === day && r.meal === meal);
  const st = me.student || {};

  return (
    <div className="my">
      <section className="my-head">
        <div>
          <p className="eyebrow">{st.group_name || 'Dijaški dom'}</p>
          <h1>Živjo, {st.first_name}</h1>
          <p className="hint"><Clock size={13} /> Obroke za posamezen dan lahko spremeniš do {clock.cutoffHour}.00 dan prej. Zdaj je odprto od <b>{fmtLong(clock.firstEditable)}</b> dalje.</p>
        </div>
      </section>

      <div className="toolbar my-nav">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setFrom(addDays(from, -7))} title="Prejšnji teden"><ChevronLeft size={18} /></button>
          <div className="week-label">
            <span className="eyebrow">Teden</span>
            <strong>{fmtDay(from)} – {fmtDay(addDays(from, 4))}</strong>
          </div>
          <button className="icon-btn" onClick={() => setFrom(addDays(from, 7))} title="Naslednji teden"><ChevronRight size={18} /></button>
        </div>
        {from !== mondayOf(clock.today) && <button className="btn ghost small" onClick={() => setFrom(mondayOf(clock.today))}>Ta teden</button>}
      </div>

      {error && <p className="error banner">{error}</p>}
      {!data && !error && <p className="muted pad">Nalaganje …</p>}

      {data && (
        <div className="my-days">
          {data.days.map(day => {
            const c = closed(day);
            const a = away(day);
            const locked = day < clock.firstEditable;
            return (
              <article key={day} className={`my-day ${locked ? 'locked' : ''} ${c ? 'closed' : ''} ${day === clock.today ? 'today' : ''}`}>
                <header>
                  <h2>{capitalize(fmtLong(day).split(',')[0])} <span>{fmtDay(day)}</span></h2>
                  {c ? <em className="tag">zaprto{c.reason ? ` · ${c.reason}` : ''}</em>
                    : a ? <em className="tag away"><CalendarOff size={11} /> odsoten</em>
                      : locked ? <em className="tag"><Lock size={11} /> zaključeno</em> : null}
                </header>
                {MEALS.filter(m => mealServed(day, m)).map(m => {
                  const o = order(day, m);
                  const v = o?.variant || 'none';
                  const dish = v !== 'none' ? dishFor(data.menu, day, m, v) : '';
                  const note = TIME_NOTE(v);
                  const options = [...new Set([...(me.choices[m] || []), ...(v !== 'none' ? [v] : [])])];
                  return (
                    <div key={m} className="my-meal">
                      <div className="my-meal-top">
                        <span className="my-meal-name">{MEAL_NAMES[m]}{me.times[m] && <small>{me.times[m]}</small>}</span>
                        {locked || c || a || (!me.canCancel && v === 'none') ? (
                          <span className={`chip v-${v}`} title={VARIANT_LABEL[v]}>{VARIANT_SHORT[v]}</span>
                        ) : (
                          <select className={`my-select v-${v}`} value={v} disabled={busy === `${day}|${m}`} onChange={e => choose(day, m, e.target.value)}>
                            {options.map(x => <option key={x} value={x} disabled={!(me.choices[m] || []).includes(x)}>{VARIANT_LABEL[x]}</option>)}
                            {me.canCancel && <option value="none">Ne bom jedel (odjava)</option>}
                            {o?.source === 'manual' && <option value="default">↺ Nazaj na privzeto</option>}
                          </select>
                        )}
                      </div>
                      {(locked || c || a || (!me.canCancel && v === 'none')) && <span className="my-choice">{a && v === 'none' ? 'Odsoten' : VARIANT_LABEL[v]}</span>}
                      {dish && <p className="my-dish">{dish}</p>}
                      {note && me.times[note] && <p className="my-note">{note === 'dry' ? 'Prevzem paketa' : 'Pozni obrok'}: {me.times[note]}</p>}
                      {!c && v !== 'none' && day <= clock.today && day >= data.rating.from && (() => {
                        const r = ratingOf(day, m);
                        return (
                          <button className={`rate-btn ${r ? `rated s${r.score}` : ''}`} onClick={() => setRating({ day, meal: m, dish, existing: r })}>
                            <Star size={13} /> {r ? <span>Tvoja ocena <b>{r.score}</b>/5 · uredi</span> : 'Oceni obrok'}
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}

      <div className="my-bottom">
        {data && <MyAbsences absences={data.absences} clock={clock} canCancel={me.canCancel} reload={load} setToast={setToast} />}
        <section className="my-card">
          <h3>Moji podatki</h3>
          <dl>
            <dt>Ime</dt><dd>{st.first_name} {st.last_name}</dd>
            <dt>Skupina</dt><dd>{st.group_name || '—'}</dd>
            <dt>Soba</dt><dd>{st.room || '—'}</dd>
            <dt>Posebna dieta</dt><dd>{st.diet ? <span className="diet"><Leaf size={11} />{st.diet}</span> : '—'}</dd>
          </dl>
          <p className="hint">Napaka v podatkih ali sprememba diete? Povej vzgojitelju.</p>
        </section>
      </div>

      {rating && (
        <RateMeal {...rating} rules={data.rating} onClose={() => setRating(null)}
          onSaved={text => { setRating(null); setToast({ text }); load(); }} />
      )}
      {toast && <div className={`toast ${toast.error ? 'bad' : ''}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}

function MyAbsences({ absences, clock, canCancel, reload, setToast }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('myAbsence', { from: form.from, to: form.to || form.from, reason: form.reason });
      setForm(null);
      setToast({ text: 'Odsotnost je prijavljena, za te dni si odjavljen od vseh obrokov.' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancel(a) {
    if (!confirm('Prekličem odsotnost? Za odprte dni boš spet prijavljen na svoje običajne obroke.')) return;
    try {
      await api('myCancelAbsence', { id: a.id });
      setToast({ text: 'Odsotnost je preklicana.' });
      reload();
    } catch (err) {
      setToast({ error: true, text: err.message });
    }
  }

  const upcoming = absences.filter(a => a.day_to >= clock.today);

  return (
    <section className="my-card">
      <h3><CalendarOff size={16} /> Odsotnost</h3>
      {canCancel
        ? <p className="hint">Če te ne bo v domu (bolezen, ekskurzija, odhod domov), prijavi odsotnost. Za te dni boš odjavljen od vseh obrokov.</p>
        : <p className="hint">Če te ne bo v domu ali ne boš jedel, to sporoči vzgojitelju – on te odjavi od obrokov.</p>}
      {!canCancel ? null : form ? (
        <form className="form" onSubmit={add}>
          <div className="form-pair">
            <label>Od<input type="date" value={form.from} min={clock.firstEditable} onChange={e => setForm({ ...form, from: e.target.value })} required /></label>
            <label>Do<input type="date" value={form.to} min={form.from || clock.firstEditable} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
          </div>
          <label>Razlog<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="npr. odhod domov" /></label>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Prekliči</button>
            <button className="btn primary" disabled={!form.from}>Prijavi odsotnost</button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setForm({ from: clock.firstEditable, to: '', reason: '' })}><Plus size={16} /> Prijavi odsotnost</button>
      )}
      <ul className="absence-list">
        {upcoming.map(a => (
          <li key={a.id}>
            <span><b>{fmtDay(a.day_from)}{a.day_to !== a.day_from ? ` – ${fmtDay(a.day_to)}` : ''}</b> {a.reason && <span className="muted">— {a.reason}</span>}
              {a.created_by_role && a.created_by_role !== 'student' && <small className="muted"> (vpisal {a.created_by_name})</small>}</span>
            {canCancel && a.day_to >= clock.firstEditable && a.created_by_role === 'student' && <button className="icon-btn" title="Prekliči" onClick={() => cancel(a)}><Trash2 size={14} /></button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
