import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Plus, Clock, UtensilsCrossed, CalendarOff, MessageSquare } from 'lucide-react';
import { api } from './api.js';
import { addDays, dow, dayShort, fmtDay, fmtLong, capitalize, studentName, plural, MEALS, MEAL_NAMES, VARIANT_LABEL } from './meals.js';
import Modal from './Modal.jsx';

const SLOT_NAME = { guard: 'Nočni varnostnik', teacher: 'Dežurni vzgojitelj', night: 'Prisoten' };
const sundayOf = day => addDays(day, -dow(day));
const fmtTime = t => new Date(t).toLocaleString('sl-SI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const key = (sid, night, slot) => `${sid}|${night}|${slot}`;
const REASONS = ['bolezen', 'praksa', 'izmenjava', 'večdnevni izlet', 'ekskurzija', 'tekmovanje', 'osebni razlogi'];
const span = a => (a.day_from === a.day_to ? fmtDay(a.day_from) : `${fmtDay(a.day_from)} – ${fmtDay(a.day_to)}`);

// Evening attendance Sunday–Thursday. On an arrival evening (Sunday or the evening of a holiday) students
// report to the night guard and to the teacher on duty, so that evening has a column for each of them.
export default function AttendanceView({ me }) {
  const myGroups = me.user.groups || [];
  const [sunday, setSunday] = useState(() => sundayOf(me.clock.today));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [group, setGroup] = useState(() => (myGroups.length ? '@mine' : ''));
  const [query, setQuery] = useState('');
  const [marks, setMarks] = useState(new Map());
  const [awayFor, setAwayFor] = useState(null);
  const [mealsFor, setMealsFor] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [menu, setMenu] = useState(null);

  const load = useCallback(async (week, quiet) => {
    if (!quiet) setData(null);
    try {
      const r = await api('attendanceWeek', { sunday: week });
      setData(r);
      setMarks(new Map(r.marks.map(m => [key(m.student_id, m.night, m.slot), m])));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(sunday); }, [sunday, load]);
  // Guard and teacher tick at the same time: pick up the other's ticks every minute and on return to the tab
  useEffect(() => {
    const refresh = () => document.visibilityState === 'visible' && load(sunday, true);
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [sunday, load]);

  // Columns: one per evening, two on an arrival evening
  const cols = useMemo(() => (data?.nights || []).flatMap(n => (!n.inHome ? [{ night: n, slot: null }]
    : n.arrival ? [{ night: n, slot: 'guard' }, { night: n, slot: 'teacher' }] : [{ night: n, slot: 'night' }])), [data]);

  const groups = useMemo(() => [...new Set((data?.students || []).map(s => s.group_name))].sort((a, b) => a.localeCompare(b, 'sl', { numeric: true })), [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const only = group === '@mine' ? myGroups : group ? [group] : null;
    return (data?.students || []).filter(s => (!only || only.includes(s.group_name))
      && (!q || `${s.first_name} ${s.last_name} ${s.room || ''}`.toLowerCase().includes(q)));
  }, [data, group, query, myGroups]);
  // Meals ordered the day after each evening, by student and evening
  const fed = useMemo(() => {
    const m = new Map();
    (data?.meals || []).forEach(o => {
      const k = `${o.student_id}|${addDays(o.day, -1)}`;
      m.set(k, [...(m.get(k) || []), o]);
    });
    return m;
  }, [data]);
  const notes = useMemo(() => new Map((data?.notes || []).map(n => [`${n.student_id}|${n.night}`, n])), [data]);
  const absenceOn = (sid, night) => (data?.away || []).find(a => a.student_id === sid && night >= a.day_from && night <= a.day_to);
  const present = (sid, night) => ['night', 'guard', 'teacher'].some(slot => marks.has(key(sid, night, slot)));
  // The roll call of an evening has started once anybody is ticked; earlier evenings count as finished
  const started = useMemo(() => new Set([...marks.keys()].map(k => k.split('|')[1])), [marks]);
  // Not in the home that evening but meals are ordered for the next day: the teacher should check the meals
  // (tonight a planned late arrival is not a warning yet)
  const warn = (s, night) => fed.has(`${s.id}|${night}`) && !present(s.id, night)
    && (absenceOn(s.id, night) || night < data.today
      || (night === data.today && started.has(night) && !notes.get(`${s.id}|${night}`)?.late_at));

  // Meals to offer for deregistration: the day after the clicked evening, or after every evening of the absence
  function openMeals(s, night) {
    const a = absenceOn(s.id, night);
    const nights = a ? data.nights.map(n => n.day).filter(d => d >= a.day_from && d <= a.day_to && fed.has(`${s.id}|${d}`)) : [night];
    setMealsFor({ student: s, rows: nights.flatMap(n => fed.get(`${s.id}|${n}`) || []) });
  }

  // Right click on a cell: notes for the guard, absence and meals, for whoever may change them
  function openMenu(e, s, night) {
    const items = [];
    if (data.canAway && night >= data.today) {
      items.push({ icon: Clock, label: notes.has(`${s.id}|${night}`) ? 'Uredi pozen prihod / opombo' : 'Pozen prihod / opomba za varnostnika', run: () => setNoteFor({ student: s, night }) });
      items.push({ icon: CalendarOff, label: 'Odsotnost …', run: () => setAwayFor({ ...s, from: night }) });
    }
    if (data.canOrders && fed.has(`${s.id}|${night}`)) items.push({ icon: UtensilsCrossed, label: 'Odjava prehrane naslednji dan …', run: () => openMeals(s, night) });
    if (!items.length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, title: `${studentName(s)} · ${dayShort(night)} ${fmtDay(night)}`, items });
  }

  const livesThere = (s, night) => !s.left_on || s.left_on > night;
  const canTick = (s, c) => c.slot && data.slots.includes(c.slot) && c.night.day <= data.today && livesThere(s, c.night.day);

  async function toggle(s, c) {
    const k = key(s.id, c.night.day, c.slot);
    const present = !marks.has(k);
    const before = marks;
    const next = new Map(marks);
    if (present) next.set(k, { by_name: me.user.name, checked_at: new Date().toISOString() });
    else next.delete(k);
    setMarks(next);
    try {
      await api('setAttendance', { student_id: s.id, night: c.night.day, slot: c.slot, present });
      setError('');
    } catch (err) {
      setMarks(before);
      setError(err.message);
    }
  }

  const today = me.clock.today;
  const weekLabel = `${fmtDay(sunday)} – ${fmtDay(addDays(sunday, 4))} ${addDays(sunday, 4).slice(0, 4)}`;
  let lastGroup = null;

  return (
    <div className="attendance">
      <div className="toolbar">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => setSunday(addDays(sunday, -7))} title="Prejšnji teden"><ChevronLeft size={18} /></button>
          <div className="week-label">
            <span className="eyebrow">Prisotnost zvečer</span>
            <strong>{weekLabel}</strong>
          </div>
          <button className="icon-btn" onClick={() => setSunday(addDays(sunday, 7))} title="Naslednji teden"><ChevronRight size={18} /></button>
          {sunday !== sundayOf(today) && <button className="btn ghost small" onClick={() => setSunday(sundayOf(today))}>Ta teden</button>}
        </div>
        <select value={group} onChange={e => setGroup(e.target.value)}>
          {myGroups.length > 0 && <option value="@mine">Moje skupine ({myGroups.join(', ')})</option>}
          <option value="">Cel dom – vse skupine</option>
          {groups.map(g => <option key={g} value={g}>{g || '(brez skupine)'}</option>)}
        </select>
        <label className="search"><Search size={15} /><input placeholder="Išči dijaka ali sobo" value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
      {error && <p className="error banner">{error}</p>}
      {!data ? <p className="muted pad">Nalaganje …</p> : (
        <div className="att-wrap">
          <table className="att">
            <thead>
              <tr>
                <th className="sticky" rowSpan={2}>Dijak</th>
                {data.nights.map(n => (
                  <th key={n.day} colSpan={n.arrival ? 2 : 1} rowSpan={n.arrival ? 1 : 2}
                    className={`${n.inHome ? '' : 'off'}${n.day === today ? ' today' : ''}${n.arrival ? ' arrival' : ''}`}>
                    {dayShort(n.day)} {fmtDay(n.day)}
                    <small>{!n.inHome ? `doma${n.reason ? ' · ' + n.reason : ''}` : n.arrival ? 'prihod v dom' : ''}</small>
                  </th>
                ))}
              </tr>
              <tr>
                {cols.filter(c => c.night.arrival).map(c => (
                  <th key={c.night.day + c.slot} className={`sub${c.night.day === today ? ' today' : ''}`}>{c.slot === 'guard' ? 'varnostnik' : 'vzgojitelj'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(s => {
                const head = s.group_name !== lastGroup;
                lastGroup = s.group_name;
                return [
                  head && <tr key={`g-${s.group_name}`} className="group-row"><th className="sticky" colSpan={1}>{s.group_name || '(brez skupine)'}</th><td colSpan={cols.length} /></tr>,
                  <tr key={s.id}>
                    <th className="sticky">
                      {data.canAway
                        ? <button className="att-name" onClick={() => setAwayFor(s)} title="Vpiši ali preglej odsotnost">{studentName(s)}</button>
                        : studentName(s)}
                      {s.room && <small>soba {s.room}</small>}
                    </th>
                    {cols.map(c => {
                      if (!c.slot) return <td key={c.night.day} className="off" />;
                      if (!livesThere(s, c.night.day)) return <td key={c.night.day + c.slot} className="off" title="Izseljen" />;
                      const m = marks.get(key(s.id, c.night.day, c.slot));
                      const absent = absenceOn(s.id, c.night.day);
                      const alarm = warn(s, c.night.day);
                      const future = c.night.day > data.today;
                      const editable = canTick(s, c);
                      const note = notes.get(`${s.id}|${c.night.day}`);
                      // On an arrival evening the note sits in the guard's column
                      const showNote = note && c.slot !== 'teacher';
                      const fixMeals = alarm && data.canOrders;
                      const title = [
                        m ? `${SLOT_NAME[c.slot]}: označil ${m.by_name || '—'}, ${fmtTime(m.checked_at)}` : '',
                        absent ? `Odsoten ${span(absent)}: ${absent.reason}` : '',
                        note ? `Opomba za varnostnika${note.late_at ? ` – pozen prihod ob ${note.late_at}` : ''}${note.note ? `: ${note.note}` : ''} (${note.by_name || '—'})` : '',
                        alarm ? `Dijaka ni v domu, naslednji dan pa ima naročene obroke – preverite prehrano${fixMeals ? ' (klik za odjavo)' : ''}` : '',
                        !m && !future && !data.slots.includes(c.slot) ? `Ta stolpec odkljuka ${c.slot === 'guard' ? 'nočni varnostnik' : 'dežurni vzgojitelj'}` : '',
                      ].filter(Boolean).join('\n');
                      return (
                        <td key={c.night.day + c.slot} title={title}
                          className={`${c.night.day === today ? 'today' : ''}${m ? ' on' : ''}${absent ? ' absent' : ''}${alarm ? ' warn' : ''}${note ? ' noted' : ''}${fixMeals ? ' clickable' : ''}`}
                          onClick={fixMeals ? e => { if (!e.target.closest('label, button')) openMeals(s, c.night.day); } : undefined}
                          onContextMenu={e => openMenu(e, s, c.night.day)}>
                          {!future && (
                            <label className="tick">
                              <input type="checkbox" checked={!!m} disabled={!editable} onChange={() => toggle(s, c)} aria-label={`${studentName(s)} ${dayShort(c.night.day)} ${SLOT_NAME[c.slot]}`} />
                            </label>
                          )}
                          {absent && <span className="away">{absent.reason}</span>}
                          {showNote && (
                            <span className="late-tag">
                              {note.late_at ? <><Clock size={11} /> {note.late_at}</> : <MessageSquare size={11} />}
                              {note.note && <em>{note.note}</em>}
                            </span>
                          )}
                          {fixMeals && <button className="att-meals" onClick={() => openMeals(s, c.night.day)} title="Odjavi prehrano naslednji dan"><UtensilsCrossed size={12} /> odjavi</button>}
                          {future && !absent && data.canAway && (
                            <button className="att-plan" onClick={() => setAwayFor({ ...s, from: c.night.day })} title="Vpiši odsotnost" aria-label={`Odsotnost ${studentName(s)} ${dayShort(c.night.day)}`}><Plus size={13} /></button>
                          )}
                        </td>
                      );
                    })}
                  </tr>,
                ];
              })}
              {shown.length === 0 && <tr><td colSpan={cols.length + 1} className="muted">Ni dijakov.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <th className="sticky">Prisotnih</th>
                {cols.map(c => {
                  if (!c.slot) return <td key={c.night.day} className="off" />;
                  const here = shown.filter(s => livesThere(s, c.night.day));
                  const n = here.filter(s => marks.has(key(s.id, c.night.day, c.slot))).length;
                  return <td key={c.night.day + c.slot} className={c.night.day === today ? 'today' : ''}>{n} / {here.length}</td>;
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="att-legend">
        <span><i className="sw on" />prisoten</span>
        <span><i className="sw absent" />napovedana odsotnost</span>
        <span><i className="sw warn" />ni v domu, naslednji dan pa ima naročene obroke – preverite prehrano{data?.canOrders ? ' (klik odpre odjavo)' : ''}</span>
        <span><Clock size={12} className="lg-icon" />načrtovan pozen prihod / opomba za varnostnika</span>
      </div>
      <p className="hint att-hint">Kljukico postavite, ko se dijak zvečer javi v domu. Ob nedeljah oziroma ob prihodu po prazniku dijaka odkljukata nočni varnostnik in dežurni vzgojitelj, vsak v svojem stolpcu.
        {data?.canAway && ' Odsotnost za naprej (bolezen, praksa, izmenjava, izlet …) vpišete s klikom na ime dijaka ali na + pri prihodnjem večeru. Vpis odsotnosti ne spreminja prehrane.'}
        {data?.canAway && ' Z desnim klikom na polje vpišete pozen prihod ali opombo za nočnega varnostnika (npr. trening, pride ob 23.00).'} Podatki se osvežijo vsako minuto.</p>
      {awayFor && (
        <AwayDialog student={awayFor} from={awayFor.from} today={data.today} absences={data.away.filter(a => a.student_id === awayFor.id)}
          onClose={() => setAwayFor(null)} onSaved={() => load(sunday, true)} />
      )}
      {mealsFor && <MealsDialog {...mealsFor} firstEditable={data.firstEditable} onClose={() => setMealsFor(null)} onSaved={() => load(sunday, true)} />}
      {noteFor && <NoteDialog {...noteFor} note={notes.get(`${noteFor.student.id}|${noteFor.night}`)} onClose={() => setNoteFor(null)} onSaved={() => load(sunday, true)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function AwayDialog({ student, from: start, today, absences, onClose, onSaved }) {
  const [from, setFrom] = useState(start || today);
  const [to, setTo] = useState(start || today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  const save = () => run(() => api('addAttendanceAbsence', { student_ids: [student.id], from, to, reason }));

  return (
    <Modal title={`Odsotnost – ${studentName(student)}`} onClose={onClose}>
      {absences.length > 0 && (
        <ul className="att-absences">
          {absences.map(a => (
            <li key={a.id}>
              <span><b>{span(a)}</b> · {a.reason}<small className="muted"> vpisal {a.by_name || '—'}</small></span>
              {a.day_to >= today && <button className="btn small ghost" disabled={busy} onClick={() => run(() => api('cancelAttendanceAbsence', { id: a.id }))}>{a.day_from < today ? 'Končaj' : 'Prekliči'}</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="att-away-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <label>Prvi večer odsotnosti<input type="date" value={from} min={today} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
        <label>Zadnji večer odsotnosti<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <label className="span2">Razlog
          <input list="att-reasons" value={reason} onChange={e => setReason(e.target.value)} placeholder="npr. bolezen, praksa, izmenjava" autoFocus />
          <datalist id="att-reasons">{REASONS.map(r => <option key={r} value={r} />)}</datalist>
        </label>
        <p className="hint span2">Vpis velja samo za večerno prisotnost. Če dijak v tem času ne bo jedel v domu, ga odjavite še v Naročilih.</p>
        {error && <p className="error span2">{error}</p>}
        <div className="box-actions span2">
          <button className="btn primary" disabled={busy || !from || !to || to < from || !reason.trim()}>{busy ? 'Shranjevanje …' : 'Vpiši odsotnost'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Zapri</button>
        </div>
      </form>
    </Modal>
  );
}

function ContextMenu({ x, y, title, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = e => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 300);
  const top = Math.min(y, window.innerHeight - 60 - items.length * 40);
  return (
    <div className="popover att-menu" ref={ref} style={{ left, top }} role="menu">
      <header><strong>{title}</strong></header>
      <div className="pop-options">
        {items.map(it => (
          <button key={it.label} role="menuitem" onClick={() => { onClose(); it.run(); }}><it.icon size={15} /> {it.label}</button>
        ))}
      </div>
    </div>
  );
}

function NoteDialog({ student, night, note, onClose, onSaved }) {
  const [late, setLate] = useState(note?.late_at || '');
  const [text, setText] = useState(note?.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(lateAt, noteText) {
    setBusy(true);
    setError('');
    try {
      await api('setAttendanceNote', { student_id: student.id, night, late_at: lateAt, note: noteText });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Opomba za varnostnika – ${studentName(student)}`} onClose={onClose}>
      <form className="att-away-form" onSubmit={e => { e.preventDefault(); save(late, text); }}>
        <p className="span2 muted">{capitalize(fmtLong(night))} zvečer</p>
        <label>Načrtovan prihod ob<input type="time" value={late} onChange={e => setLate(e.target.value)} /></label>
        <label className="span2">Opomba za nočnega varnostnika
          <input value={text} onChange={e => setText(e.target.value)} placeholder="npr. je na treningu, pride ob 23.00" maxLength={300} autoFocus />
        </label>
        {error && <p className="error span2">{error}</p>}
        <div className="box-actions span2">
          <button className="btn primary" disabled={busy || (!late && !text.trim())}>{busy ? 'Shranjevanje …' : 'Shrani'}</button>
          {note && <button type="button" className="btn ghost" disabled={busy} onClick={() => save('', '')}>Odstrani opombo</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Zapri</button>
        </div>
      </form>
    </Modal>
  );
}

// Sets the chosen meals to 'none'; days past the deadline cannot be changed any more
function MealsDialog({ student, rows, firstEditable, onClose, onSaved }) {
  const k = o => `${o.day}|${o.meal}`;
  const open = o => o.day >= firstEditable;
  const [picked, setPicked] = useState(() => new Set(rows.filter(open).map(k)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const days = [...new Set(rows.map(o => o.day))].sort();
  const flip = o => setPicked(p => { const n = new Set(p); n.has(k(o)) ? n.delete(k(o)) : n.add(k(o)); return n; });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const changes = rows.filter(o => picked.has(k(o))).map(o => ({ student_id: student.id, day: o.day, meal: o.meal, variant: 'none' }));
      const r = await api('setOrders', { changes });
      const locked = r.skipped?.locked || 0;
      setResult(`Odjavljeno: ${r.saved} ${plural(r.saved, 'obrok', 'obroka', 'obroki', 'obrokov')}${locked ? ` · ${locked} ni bilo mogoče odjaviti, ker je rok že potekel` : ''}.`);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <Modal title={`Odjava prehrane – ${studentName(student)}`} onClose={onClose}>
      {result ? (
        <>
          <p>{result}</p>
          <div className="box-actions"><button className="btn primary" onClick={onClose}>Zapri</button></div>
        </>
      ) : (
        <>
          <p className="muted">Dijak zvečer ni v domu, naslednji dan pa ima naročene obroke. Izberite obroke, ki jih želite odjaviti.</p>
          <div className="att-meals-days">
            {days.map(d => (
              <div key={d} className="att-meals-day">
                <strong>{capitalize(fmtLong(d))}</strong>
                {!open({ day: d }) && <small className="muted">rok za spremembe je potekel</small>}
                <div>
                  {MEALS.map(meal => rows.find(o => o.day === d && o.meal === meal)).filter(Boolean).map(o => (
                    <label key={k(o)} className="inline-check">
                      <input type="checkbox" checked={picked.has(k(o))} disabled={!open(o)} onChange={() => flip(o)} />
                      {MEAL_NAMES[o.meal]} <small className="muted">({VARIANT_LABEL[o.variant] || o.variant})</small>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="box-actions">
            <button className="btn primary" disabled={busy || !picked.size} onClick={save}>{busy ? 'Shranjevanje …' : `Odjavi izbrane (${picked.size})`}</button>
            <button className="btn ghost" onClick={onClose}>Prekliči</button>
          </div>
        </>
      )}
    </Modal>
  );
}
