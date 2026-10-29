import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, Lock, Clock } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import {
  MEALS, MEAL_NAMES, VARIANTS, VARIANT_LABEL, VARIANT_SHORT,
  addDays, dow, mondayOf, mealServed, nextSchoolDay, dayShort, fmtDay, fmtLong, studentName, capitalize, dishFor, plural,
} from './meals.js';

// Special-diet meals are counted on their own line and left out of the variant counts, so the total stays the same.
// A diet meal that is not a plain regular one (packed, kept for later, vegetarian …) colours the line; the tooltip says why.
function dietSummary(rows) {
  const odd = {};
  rows.filter(r => r.variant !== 'normal').forEach(r => { odd[r.variant] = (odd[r.variant] || 0) + 1; });
  const why = Object.entries(odd).map(([v, n]) => `${n} ${VARIANT_LABEL[v].toLowerCase()}`);
  return {
    n: rows.length,
    flag: why.length > 0,
    title: `${rows.length} ${plural(rows.length, 'dietni obrok', 'dietna obroka', 'dietni obroki', 'dietnih obrokov')}${why.length ? ` – od tega ${why.join(', ')}` : ''} · klik za seznam`,
  };
}

function DietCount({ rows, onOpen }) {
  const d = dietSummary(rows);
  if (!d.n) return <>0</>;
  return <button className={`diet-count${d.flag ? ' flag' : ''}`} title={d.title} onClick={onOpen}>{d.n}</button>;
}

// Which diets are ordered for one meal
function DietDialog({ day, meal, rows, onClose }) {
  return (
    <Modal title={`Posebne diete – ${MEAL_NAMES[meal].toLowerCase()}, ${dayShort(day)} ${fmtDay(day)}`} onClose={onClose}>
      <ol className="diet-dialog">
        {rows.map(r => (
          <li key={r.id}>
            <span className={`chip v-${r.variant}`}>{VARIANT_SHORT[r.variant]}</span>
            <span><span className="nm">{studentName(r)}</span> <span className="meta">{r.group_name}</span></span>
            <span className="diet-text">{r.diet}</span>
            {r.variant !== 'normal' && <small className="muted">{VARIANT_LABEL[r.variant]}</small>}
          </li>
        ))}
      </ol>
      <div className="box-actions"><button className="btn primary" onClick={onClose}>Zapri</button></div>
    </Modal>
  );
}

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
  const [dietFor, setDietFor] = useState(null);

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
    for (const r of data?.diets || []) c[`${r.meal}|${r.variant}`] -= 1;
    return c;
  }, [data]);

  return (
    <div className="kitchen">
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setDay(prevSchoolDay(day))} title="Prejšnji dan"><ChevronLeft size={18} /></button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} />
          <button className="icon-btn" onClick={() => setDay(nextSchoolDay(addDays(day, 1)))} title="Naslednji dan"><ChevronRight size={18} /></button>
          <button className="btn ghost small" onClick={() => setDay(nextSchoolDay(addDays(clock.today, 1)))}>Jutri</button>
        </div>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Natisni</button>
      </div>

      {error && <p className="error banner">{error}</p>}

      {data && (
        <>
          <div className="kitchen-head">
            <div>
              <p className="eyebrow">Seznam za kuhinjo</p>
              <h1>{capitalize(fmtLong(day))}</h1>
            </div>
            {data.closed ? <span className="status closed">Kuhinja zaprta{data.closed.reason ? ` — ${data.closed.reason}` : ''}</span>
              : data.locked ? <span className="status final"><Lock size={14} /> Dokončno — naročila so zaprta</span>
                : <span className="status open"><Clock size={14} /> Odprto do {fmtDay(addDays(day, -1))} ob {clock.cutoffHour}.00 — številke se še lahko spremenijo</span>}
          </div>

          {dow(day) === 0 || dow(day) === 6 ? <p className="muted pad">Ob vikendih ni obrokov.</p> : (
            <>
              <section className="meal-cards">
                {MEALS.filter(m => mealServed(day, m)).map(m => {
                  const diets = data.diets.filter(r => r.meal === m);
                  const total = VARIANTS[m].reduce((a, v) => a + (count[`${m}|${v}`] || 0), 0) + diets.length;
                  return (
                    <article key={m} className="meal-card">
                      <header><h2>{MEAL_NAMES[m]}{data.times?.[m] && <small className="meal-time">{data.times[m]}</small>}</h2><span className="big">{total}</span></header>
                      <table className="counts">
                        <tbody>
                          {VARIANTS[m].map(v => (
                            <tr key={v} className={count[`${m}|${v}`] ? '' : 'zero'}>
                              <td><span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span></td>
                              <td>{VARIANT_LABEL[v]}{dishFor(data.menu, day, m, v) && <small className="dish">{dishFor(data.menu, day, m, v)}</small>}</td>
                              <td className="num">{count[`${m}|${v}`] || 0}</td>
                            </tr>
                          ))}
                          <tr className={`diet-row${diets.length ? '' : ' zero'}`}>
                            <td><span className="chip diet">D</span></td>
                            <td>Posebne diete</td>
                            <td className="num"><DietCount rows={diets} onOpen={() => setDietFor({ day, meal: m, rows: diets })} /></td>
                          </tr>
                        </tbody>
                      </table>
                    </article>
                  );
                })}
              </section>

              <section className="lists">
                <PeopleList title="Suhi obroki (paketi)" time={data.times?.dry} rows={data.dry} />
                <PeopleList title="Pozni obroki (shranjeni)" time={data.times?.late} rows={data.late} />
                <DietList rows={data.diets} />
              </section>
            </>
          )}
        </>
      )}

      {week && <WeekTable week={week} activeDay={day} onPick={setDay} onDiets={setDietFor} />}
      {dietFor && <DietDialog {...dietFor} onClose={() => setDietFor(null)} />}
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
      <header><h3>Posebne diete</h3><span className="count">{people.length}</span></header>
      {people.length === 0 && <p className="muted">Ni.</p>}
      <ol>
        {people.map(p => (
          <li key={p.id}>
            <span><span className="nm">{studentName(p)}</span> <span className="diet-text">{p.diet}</span></span>
            <span className="meta">{p.group_name}</span>
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

function PeopleList({ title, time, rows, showDiet }) {
  const byMeal = MEALS.map(m => [m, rows.filter(r => r.meal === m)]).filter(([, r]) => r.length);
  return (
    <article className="people">
      <header><h3>{title}{time && <small className="meal-time">{time}</small>}</h3><span className="count">{rows.length}</span></header>
      {byMeal.length === 0 && <p className="muted">Ni.</p>}
      {byMeal.map(([m, list]) => (
        <div key={m} className="people-meal">
          <h4>{MEAL_NAMES[m]} · {list.length}</h4>
          <ol>
            {list.map(r => (
              <li key={r.id + r.meal}>
                <span className={`chip v-${r.variant}`}>{VARIANT_SHORT[r.variant]}</span>
                <span className="nm">{studentName(r)}</span>
                <span className="meta">{r.group_name}</span>
                {showDiet && <span className="diet-text">{r.diet}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </article>
  );
}

function WeekTable({ week, activeDay, onPick, onDiets }) {
  const c = {};
  for (const r of week.counts) c[`${r.day}|${r.meal}|${r.variant}`] = r.n;
  for (const r of week.diets) c[`${r.day}|${r.meal}|${r.variant}`] -= 1;
  const dietsOf = (d, m) => week.diets.filter(r => r.day === d && r.meal === m);
  const closed = new Set(week.closed.map(x => x.day));
  return (
    <section className="week-table">
      <h3>Pregled tedna</h3>
      <div className="grid-wrap">
        <table className="grid compact">
          <thead>
            <tr>
              <th className="sticky-col">Obrok</th>
              {week.days.map(d => (
                <th key={d} className={`clickable ${d === activeDay ? 'active' : ''}`} onClick={() => onPick(d)}>
                  {dayShort(d)} <b>{fmtDay(d)}</b>{closed.has(d) && <em className="tag">zaprto</em>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MEALS.map(m => [
              <tr key={m} className="group-row"><td className="sticky-col">{MEAL_NAMES[m]}</td>{week.days.map(d => {
                const total = VARIANTS[m].reduce((a, v) => a + (c[`${d}|${m}|${v}`] || 0), 0) + dietsOf(d, m).length;
                return <td key={d} className="num"><b>{mealServed(d, m) ? total : '—'}</b></td>;
              })}</tr>,
              ...VARIANTS[m].map(v => (
                <tr key={m + v}>
                  <td className="sticky-col"><span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span> {VARIANT_LABEL[v]}</td>
                  {week.days.map(d => <td key={d} className="num">{mealServed(d, m) ? (c[`${d}|${m}|${v}`] || 0) : ''}</td>)}
                </tr>
              )),
              <tr key={m + 'diet'} className="diet-row">
                <td className="sticky-col"><span className="chip diet">D</span> Posebne diete</td>
                {week.days.map(d => <td key={d} className="num">{mealServed(d, m) ? <DietCount rows={dietsOf(d, m)} onOpen={() => onDiets({ day: d, meal: m, rows: dietsOf(d, m) })} /> : ''}</td>)}
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
