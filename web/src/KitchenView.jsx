import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, Lock, Clock } from 'lucide-react';
import { api } from './api.js';
import {
  MEALS, MEAL_NAMES, VARIANTS, VARIANT_LABEL, VARIANT_SHORT,
  addDays, dow, mondayOf, mealServed, nextSchoolDay, dayShort, fmtDay, fmtLong, studentName,
} from './meals.js';

function prevSchoolDay(day) {
  let d = addDays(day, -1);
  while (dow(d) === 0 || dow(d) === 6) d = addDays(d, -1);
  return d;
}

export default function KitchenView({ clock }) {
  // Default: the next day whose orders are final (tomorrow before 18:00, the day after once it's locked)
  const [day, setDay] = useState(() => nextSchoolDay(addDays(clock.today, 1)));
  const [data, setData] = useState(null);
  const [week, setWeek] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setData(null);
    Promise.all([api('kitchenDay', { day }), api('kitchenWeek', { from: mondayOf(day) })])
      .then(([d, w]) => { setData(d); setWeek(w); })
      .catch(err => setError(err.message));
  }, [day]);

  const count = useMemo(() => {
    const c = {};
    for (const r of data?.counts || []) c[`${r.meal}|${r.variant}`] = r.n;
    return c;
  }, [data]);

  return (
    <div className="kitchen">
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setDay(prevSchoolDay(day))} title="Previous day"><ChevronLeft size={18} /></button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} />
          <button className="icon-btn" onClick={() => setDay(nextSchoolDay(addDays(day, 1)))} title="Next day"><ChevronRight size={18} /></button>
          <button className="btn ghost small" onClick={() => setDay(nextSchoolDay(addDays(clock.today, 1)))}>Tomorrow</button>
        </div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print</button>
      </div>

      {error && <p className="error banner">{error}</p>}

      {data && (
        <>
          <div className="kitchen-head">
            <div>
              <p className="eyebrow">Kitchen sheet</p>
              <h1>{fmtLong(day)}</h1>
            </div>
            {data.closed ? <span className="status closed">Kitchen closed{data.closed.reason ? ` — ${data.closed.reason}` : ''}</span>
              : data.locked ? <span className="status final"><Lock size={14} /> Final — orders closed</span>
                : <span className="status open"><Clock size={14} /> Still open until {fmtDay(addDays(day, -1))} {clock.cutoffHour}:00 — numbers may change</span>}
          </div>

          {dow(day) === 0 || dow(day) === 6 ? <p className="muted pad">No meals are served on weekends.</p> : (
            <>
              <section className="meal-cards">
                {MEALS.filter(m => mealServed(day, m)).map(m => {
                  const total = VARIANTS[m].reduce((a, v) => a + (count[`${m}|${v}`] || 0), 0);
                  return (
                    <article key={m} className="meal-card">
                      <header><h2>{MEAL_NAMES[m]}</h2><span className="big">{total}</span></header>
                      <table className="counts">
                        <tbody>
                          {VARIANTS[m].map(v => (
                            <tr key={v} className={count[`${m}|${v}`] ? '' : 'zero'}>
                              <td><span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span></td>
                              <td>{VARIANT_LABEL[v]}</td>
                              <td className="num">{count[`${m}|${v}`] || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </article>
                  );
                })}
              </section>

              <section className="lists">
                <PeopleList title="Dry meals (packed)" rows={data.dry} />
                <PeopleList title="Late meals (kept aside)" rows={data.late} />
                <DietList rows={data.diets} />
              </section>
            </>
          )}
        </>
      )}

      {week && <WeekTable week={week} activeDay={day} onPick={setDay} />}
    </div>
  );
}

// One line per student with special diet, listing what they eat that day
function DietList({ rows }) {
  const people = [];
  for (const r of rows) {
    let p = people.find(x => x.id === r.id);
    if (!p) people.push(p = { ...r, meals: {} });
    p.meals[r.meal] = r.variant;
  }
  return (
    <article className="people diet-people">
      <header><h3>Special diets</h3><span className="count">{people.length}</span></header>
      {people.length === 0 && <p className="muted">None.</p>}
      <ol>
        {people.map(p => (
          <li key={p.id}>
            <span><span className="nm">{studentName(p)}</span> <span className="diet-text">{p.diet}</span></span>
            <span className="meta">{[p.group_name, p.room].filter(Boolean).join(' · ')}</span>
            <span className="diet-meals">
              {MEALS.filter(m => p.meals[m]).map(m => (
                <span key={m}>{MEAL_NAMES[m]} <span className={`chip v-${p.meals[m]}`}>{VARIANT_SHORT[p.meals[m]]}</span></span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function PeopleList({ title, rows, showDiet }) {
  const byMeal = MEALS.map(m => [m, rows.filter(r => r.meal === m)]).filter(([, r]) => r.length);
  return (
    <article className="people">
      <header><h3>{title}</h3><span className="count">{rows.length}</span></header>
      {byMeal.length === 0 && <p className="muted">None.</p>}
      {byMeal.map(([m, list]) => (
        <div key={m} className="people-meal">
          <h4>{MEAL_NAMES[m]} · {list.length}</h4>
          <ol>
            {list.map(r => (
              <li key={r.id + r.meal}>
                <span className={`chip v-${r.variant}`}>{VARIANT_SHORT[r.variant]}</span>
                <span className="nm">{studentName(r)}</span>
                <span className="meta">{[r.group_name, r.room].filter(Boolean).join(' · ')}</span>
                {showDiet && <span className="diet-text">{r.diet}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </article>
  );
}

function WeekTable({ week, activeDay, onPick }) {
  const c = {};
  for (const r of week.counts) c[`${r.day}|${r.meal}|${r.variant}`] = r.n;
  const closed = new Set(week.closed.map(x => x.day));
  return (
    <section className="week-table">
      <h3>Week overview</h3>
      <div className="grid-wrap">
        <table className="grid compact">
          <thead>
            <tr>
              <th className="sticky-col">Meal</th>
              {week.days.map(d => (
                <th key={d} className={`clickable ${d === activeDay ? 'active' : ''}`} onClick={() => onPick(d)}>
                  {dayShort(d)} <b>{fmtDay(d)}</b>{closed.has(d) && <em className="tag">closed</em>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEALS.map(m => [
              <tr key={m} className="group-row"><td className="sticky-col">{MEAL_NAMES[m]}</td>{week.days.map(d => {
                const total = VARIANTS[m].reduce((a, v) => a + (c[`${d}|${m}|${v}`] || 0), 0);
                return <td key={d} className="num"><b>{mealServed(d, m) ? total : '—'}</b></td>;
              })}</tr>,
              ...VARIANTS[m].map(v => (
                <tr key={m + v}>
                  <td className="sticky-col"><span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span> {VARIANT_LABEL[v]}</td>
                  {week.days.map(d => <td key={d} className="num">{mealServed(d, m) ? (c[`${d}|${m}|${v}`] || 0) : ''}</td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
