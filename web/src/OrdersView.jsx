import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Search, X, CalendarRange, Leaf } from 'lucide-react';
import { api } from './api.js';
import {
  MEALS, MEAL_NAMES, MEAL_SHORT, VARIANTS, ALL_VARIANTS, VARIANT_LABEL, VARIANT_SHORT,
  addDays, startWeek, mealServed, dayShort, fmtDay, fmtLong, studentName, capitalize, plural,
  defaultVariant, weeklyVariant, dishFor,
} from './meals.js';

const key = (sid, day, meal) => `${sid}|${day}|${meal}`;

function describeResult(r) {
  const parts = [`${r.saved} ${plural(r.saved, 'obrok shranjen', 'obroka shranjena', 'obroki shranjeni', 'obrokov shranjenih')}`];
  const s = r.skipped || {};
  if (s.locked) parts.push(`preskočeno ${s.locked} — rok za spremembe je že potekel`);
  if (s.closed) parts.push(`preskočeno ${s.closed} — kuhinja je zaprta`);
  if (s.invalid) parts.push(`preskočeno ${s.invalid} — ta izbira pri tem obroku ni mogoča`);
  return parts.join(' · ');
}

export default function OrdersView({ clock: initialClock }) {
  const [week, setWeek] = useState(() => startWeek(initialClock.firstEditable));
  const [group, setGroup] = useState(() => localStorage.getItem('orders-group') || '');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState(new Map());
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [pop, setPop] = useState(null);
  const [toast, setToast] = useState(null);

  const days = useMemo(() => [0, 1, 2, 3, 4].map(i => addDays(week, i)), [week]);
  const clock = data?.clock || initialClock;
  const closed = useMemo(() => new Map((data?.closed || []).map(c => [c.day, c.reason])), [data]);
  const editable = day => day >= clock.firstEditable && !closed.has(day);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await api('grid', { from: week, to: addDays(week, 4), group });
      setData(d);
      setOrders(new Map(d.orders.map(o => [key(o.student_id, o.day, o.meal), o])));
    } catch (err) {
      setError(err.message);
    }
  }, [week, group]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { localStorage.setItem('orders-group', group); }, [group]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const students = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.students || [];
    return q ? list.filter(s => `${s.first_name} ${s.last_name} ${s.room}`.toLowerCase().includes(q)) : list;
  }, [data, query]);

  const totals = useMemo(() => {
    const t = {};
    for (const o of orders.values()) {
      if (o.variant === 'none') continue;
      const k = `${o.day}|${o.meal}`;
      t[k] = (t[k] || 0) + 1;
    }
    return t;
  }, [orders]);

  async function send(changes) {
    // Optimistic update so the grid reacts immediately
    setOrders(prev => {
      const next = new Map(prev);
      for (const c of changes) {
        const s = data.students.find(x => x.id === c.student_id);
        const variant = c.variant === 'default' ? defaultVariant(s, c.day, c.meal) : c.variant;
        if (VARIANTS[c.meal].includes(variant) || variant === 'none') {
          next.set(key(c.student_id, c.day, c.meal), { ...c, variant, source: c.variant === 'default' ? 'default' : 'manual' });
        }
      }
      return next;
    });
    try {
      const r = await api('setOrders', { changes });
      if (changes.length > 1 || r.saved !== changes.length) setToast({ text: describeResult(r) });
      if (r.saved !== changes.length) load();
    } catch (err) {
      setToast({ error: true, text: err.message });
      load();
    }
  }

  function openCell(e, student, day, meal) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPop({ student, day, meal, x: rect.left, y: rect.bottom });
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const allShownSelected = students.length > 0 && students.every(s => selected.has(s.id));
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      students.forEach(s => (allShownSelected ? next.delete(s.id) : next.add(s.id)));
      return next;
    });
  }

  let lastGroup = null;
  const columns = days.flatMap(d => MEALS.filter(m => mealServed(d, m)).map(m => ({ day: d, meal: m })));

  return (
    <div className="orders">
      <div className="toolbar">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setWeek(addDays(week, -7))} title="Prejšnji teden"><ChevronLeft size={18} /></button>
          <div className="week-label">
            <span className="eyebrow">Teden</span>
            <strong>{fmtDay(days[0])} – {fmtDay(days[4])} {days[4].slice(0, 4)}</strong>
          </div>
          <button className="icon-btn" onClick={() => setWeek(addDays(week, 7))} title="Naslednji teden"><ChevronRight size={18} /></button>
          <button className="btn ghost small" onClick={() => setWeek(startWeek(clock.firstEditable))}>Prvi odprti teden</button>
        </div>
        <select value={group} onChange={e => { setGroup(e.target.value); setSelected(new Set()); }}>
          <option value="">Vse skupine</option>
          {(data?.groups || []).map(g => <option key={g.group_name} value={g.group_name}>{g.group_name || '(brez skupine)'} · {g.n}</option>)}
        </select>
        <label className="search">
          <Search size={15} />
          <input placeholder="Išči dijaka ali sobo" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="deadline">
          <Lock size={14} />
          <span>Spremembe so možne od <strong>{fmtLong(clock.firstEditable)}</strong> dalje · rok je dan prej ob {clock.cutoffHour}.00</span>
        </div>
      </div>

      {error && <p className="error banner">{error}</p>}
      {!data && !error && <p className="muted pad">Nalaganje naročil …</p>}

      {data && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col corner" rowSpan={2}>
                  <label className="check"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /> <span>Dijak</span></label>
                </th>
                {days.map(d => {
                  const span = MEALS.filter(m => mealServed(d, m)).length;
                  const locked = !editable(d);
                  return (
                    <th key={d} colSpan={span} className={`day-head ${locked ? 'locked' : ''}`}>
                      <span>{dayShort(d)} <b>{fmtDay(d)}</b></span>
                      {closed.has(d) ? <em className="tag">zaprto{closed.get(d) ? ` · ${closed.get(d)}` : ''}</em>
                        : locked ? <Lock size={12} /> : null}
                    </th>
                  );
                })}
              </tr>
              <tr>
                {columns.map(c => (
                  <th key={c.day + c.meal} className={`meal-head ${c.meal === 'B' ? 'day-start' : ''} ${!editable(c.day) ? 'locked' : ''}`} title={MEAL_NAMES[c.meal]}>
                    {MEAL_SHORT[c.meal]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map(s => {
                const header = !group && s.group_name !== lastGroup;
                lastGroup = s.group_name;
                return [
                  header && (
                    <tr key={'g' + s.group_name} className="group-row">
                      <td className="sticky-col" colSpan={1}>{s.group_name || 'Brez skupine'}</td>
                      <td colSpan={columns.length} />
                    </tr>
                  ),
                  <tr key={s.id} className={selected.has(s.id) ? 'sel' : ''}>
                    <td className="sticky-col name-cell">
                      <label className="check">
                        <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                        <span className="nm">{studentName(s)}</span>
                        {s.room && <span className="room">{s.room}</span>}
                        {s.diet && <span className="diet" title={`Posebna dieta: ${s.diet}`}><Leaf size={11} />{s.diet}</span>}
                      </label>
                    </td>
                    {columns.map(c => {
                      const o = orders.get(key(s.id, c.day, c.meal));
                      const v = o?.variant || 'none';
                      const locked = !editable(c.day);
                      return (
                        <td key={c.day + c.meal} className={`cell ${c.meal === 'B' ? 'day-start' : ''} ${locked ? 'locked' : ''}`}>
                          <button
                            className={`chip v-${v} ${o?.source === 'manual' ? 'manual' : ''}`}
                            disabled={locked}
                            title={cellTitle(s, c, v, o, data.menu)}
                            onClick={e => openCell(e, s, c.day, c.meal)}
                          >{VARIANT_SHORT[v]}</button>
                        </td>
                      );
                    })}
                  </tr>,
                ];
              })}
              {students.length === 0 && (
                <tr><td className="sticky-col muted" colSpan={columns.length + 1}>Tu še ni dijakov. Dodajte jih v zavihku <b>Dijaki</b>.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Prijavljenih{group ? ' v skupini' : ''}</td>
                {columns.map(c => <td key={c.day + c.meal} className={c.meal === 'B' ? 'day-start' : ''}>{totals[`${c.day}|${c.meal}`] || 0}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Legend />

      {pop && (
        <CellPopover
          pop={pop}
          orders={orders}
          menu={data?.menu}
          selectedCount={selected.has(pop.student.id) ? selected.size : 0}
          onClose={() => setPop(null)}
          onPick={(variant, scope, everyone) => {
            const ids = everyone ? [...selected] : [pop.student.id];
            const meals = scope === 'day' ? MEALS.filter(m => mealServed(pop.day, m)) : [pop.meal];
            send(ids.flatMap(student_id => meals.map(meal => ({ student_id, day: pop.day, meal, variant }))));
            setPop(null);
          }}
        />
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          defaultFrom={days[0] < clock.firstEditable ? clock.firstEditable : days[0]}
          defaultTo={days[4]}
          minDay={clock.firstEditable}
          onClear={() => setSelected(new Set())}
          onApply={async params => {
            try {
              const r = await api('bulkOrders', { ...params, student_ids: [...selected] });
              setToast({ text: describeResult(r) });
              load();
            } catch (err) {
              setToast({ error: true, text: err.message });
            }
          }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.error ? 'bad' : ''}`} onClick={() => setToast(null)}>{toast.text}</div>
      )}
    </div>
  );
}

function CellPopover({ pop, orders, menu, selectedCount, onClose, onPick }) {
  const ref = useRef(null);
  const [everyone, setEveryone] = useState(false);
  const { student, day, meal } = pop;
  const current = orders.get(key(student.id, day, meal))?.variant || 'none';
  const def = defaultVariant(student, day, meal);

  useEffect(() => {
    const onDown = e => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const hasMenu = VARIANTS[meal].some(v => dishFor(menu, day, meal, v));
  const height = hasMenu ? 520 : 360;
  const left = Math.min(pop.x, window.innerWidth - (hasMenu ? 340 : 300));
  const top = pop.y + height > window.innerHeight ? Math.max(8, pop.y - height) : pop.y + 6;

  return (
    <div className={`popover ${hasMenu ? 'with-menu' : ''}`} ref={ref} style={{ left, top }}>
      <header>
        <strong>{everyone ? `Izbrani dijaki: ${selectedCount}` : studentName(student)}</strong>
        <span>{MEAL_NAMES[meal]} · {capitalize(fmtLong(day))}</span>
      </header>
      <div className="pop-options">
        {VARIANTS[meal].map(v => (
          <button key={v} className={`opt ${current === v && !everyone ? 'cur' : ''}`} onClick={() => onPick(v, 'meal', everyone)}>
            <span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span>
            <span className="opt-text">{VARIANT_LABEL[v]}{dishFor(menu, day, meal, v) && <small>{dishFor(menu, day, meal, v)}</small>}</span>
          </button>
        ))}
        <button className={`opt ${current === 'none' && !everyone ? 'cur' : ''}`} onClick={() => onPick('none', 'meal', everyone)}>
          <span className="chip v-none">–</span>Ni prijavljen
        </button>
        <button className="opt" onClick={() => onPick('default', 'meal', everyone)}>
          <span className="chip v-default">↺</span>Nazaj na privzeto{!everyone && ` (${VARIANT_LABEL[def]}${weeklyVariant(student, day, meal) ? ', izjema' : ''})`}
        </button>
      </div>
      <div className="pop-day">
        <span>Cel dan</span>
        <button className="btn small ghost" onClick={() => onPick('none', 'day', everyone)}>Odjavi dan</button>
        <button className="btn small ghost" onClick={() => onPick('default', 'day', everyone)}>Privzeti meni</button>
      </div>
      {selectedCount > 1 && (
        <label className="pop-all"><input type="checkbox" checked={everyone} onChange={e => setEveryone(e.target.checked)} /> Uporabi za vse izbrane dijake ({selectedCount})</label>
      )}
    </div>
  );
}

function cellTitle(s, c, v, o, menu) {
  const notes = [];
  if (o?.source === 'manual') notes.push('ročno spremenjeno');
  else if (weeklyVariant(s, c.day, c.meal)) notes.push('tedenska izjema');
  const dish = v !== 'none' && dishFor(menu, c.day, c.meal, v);
  return `${MEAL_NAMES[c.meal]} ${fmtDay(c.day)}: ${VARIANT_LABEL[v]}${notes.length ? ` (${notes.join(', ')})` : ''}${dish ? `\n${dish}` : ''}`;
}

function BulkBar({ count, defaultFrom, defaultTo, minDay, onApply, onClear }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [meals, setMeals] = useState(['B', 'L', 'D']);
  const [variant, setVariant] = useState('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFrom(defaultFrom); setTo(defaultTo); }, [defaultFrom, defaultTo]);

  const toggleMeal = m => setMeals(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]));

  return (
    <div className="bulkbar">
      <div className="bulk-count"><CalendarRange size={16} />izbranih: <strong>{count}</strong></div>
      <label>Od<input type="date" value={from} min={minDay} onChange={e => setFrom(e.target.value)} /></label>
      <label>Do<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
      <div className="meal-toggles">
        {MEALS.map(m => (
          <button key={m} className={meals.includes(m) ? 'mt on' : 'mt'} onClick={() => toggleMeal(m)}>{MEAL_NAMES[m]}</button>
        ))}
      </div>
      <label>Nastavi na
        <select value={variant} onChange={e => setVariant(e.target.value)}>
          <option value="none">Ni prijavljen (odjava)</option>
          <option value="default">Privzeti meni vsakega dijaka</option>
          {ALL_VARIANTS.map(v => <option key={v} value={v}>{VARIANT_LABEL[v]}{v === 'light' ? ' (samo večerja)' : v.includes('_') ? ' (kosilo in večerja)' : ''}</option>)}
        </select>
      </label>
      <button
        className="btn primary"
        disabled={busy || !meals.length || !from || !to || to < from}
        onClick={async () => { setBusy(true); await onApply({ from, to, meals, variant }); setBusy(false); }}
      >{busy ? 'Shranjevanje …' : 'Uporabi'}</button>
      <button className="icon-btn" title="Počisti izbiro" onClick={onClear}><X size={18} /></button>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg', 'light', 'none'].map(v => (
        <span key={v}><span className={`chip v-${v}`}>{VARIANT_SHORT[v]}</span>{VARIANT_LABEL[v]}</span>
      ))}
      <span><span className="chip v-normal manual">N</span>Ročno spremenjeno</span>
      <span><span className="chip v-normal" style={{ opacity: 0.45 }}>N</span>Zaklenjeno</span>
    </div>
  );
}
