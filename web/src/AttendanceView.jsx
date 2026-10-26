import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api } from './api.js';
import { addDays, dow, dayShort, fmtDay, studentName } from './meals.js';

const SLOT_NAME = { guard: 'Nočni varnostnik', teacher: 'Dežurni vzgojitelj', night: 'Prisoten' };
const sundayOf = day => addDays(day, -dow(day));
const fmtTime = t => new Date(t).toLocaleString('sl-SI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const key = (sid, night, slot) => `${sid}|${night}|${slot}`;

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
  const away = useMemo(() => new Set((data?.away || []).map(a => `${a.student_id}|${a.night}`)), [data]);

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
                    <th className="sticky">{studentName(s)}{s.room && <small>soba {s.room}</small>}</th>
                    {cols.map(c => {
                      if (!c.slot) return <td key={c.night.day} className="off" />;
                      if (!livesThere(s, c.night.day)) return <td key={c.night.day + c.slot} className="off" title="Izseljen" />;
                      const m = marks.get(key(s.id, c.night.day, c.slot));
                      const isAway = away.has(`${s.id}|${c.night.day}`);
                      const editable = canTick(s, c);
                      const title = m ? `${SLOT_NAME[c.slot]}: označil ${m.by_name || '—'}, ${fmtTime(m.checked_at)}`
                        : !editable && c.night.day > data.today ? 'Prisotnost se označi na ta večer'
                          : !data.slots.includes(c.slot) ? `Ta stolpec odkljuka ${c.slot === 'guard' ? 'nočni varnostnik' : 'dežurni vzgojitelj'}` : '';
                      return (
                        <td key={c.night.day + c.slot} className={`${c.night.day === today ? 'today' : ''}${m ? ' on' : ''}`} title={title}>
                          <label className="tick">
                            <input type="checkbox" checked={!!m} disabled={!editable} onChange={() => toggle(s, c)} aria-label={`${studentName(s)} ${dayShort(c.night.day)} ${SLOT_NAME[c.slot]}`} />
                          </label>
                          {isAway && !m && <span className="away" title="Ni prijavljen na zajtrk naslednji dan">odjavljen</span>}
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
      <p className="hint att-hint">Kljukico postavite, ko se dijak zvečer javi v domu. Ob nedeljah oziroma ob prihodu po prazniku dijaka odkljukata nočni varnostnik in dežurni vzgojitelj, vsak v svojem stolpcu.
        »Odjavljen« pomeni, da dijak naslednje jutro nima prijavljenega zajtrka. Podatki se osvežijo vsako minuto.</p>
    </div>
  );
}
