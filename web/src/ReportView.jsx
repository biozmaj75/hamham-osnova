import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { api } from './api.js';
import { writeXlsx } from './xlsx.js';
import { downloadBlob } from './pdf.js';
import { MEALS, MEAL_NAMES, VARIANT_LABEL, VARIANT_SHORT, addDays, dow, dayShort, fmtDay, studentName } from './meals.js';

const MONTHS = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'];
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const fmtDate = d => d.split('-').reverse().map(Number).join('. ');
const isDry = v => v.startsWith('dry_');

// Office: every student's ordered meals for one month, totals and an Excel export
export default function ReportView({ me }) {
  const [month, setMonth] = useState(me.clock.today.slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('sum');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api('monthReport', { month }).then(setData).catch(err => setError(err.message));
  }, [month]);

  const report = useMemo(() => {
    if (!data) return null;
    const days = [];
    for (let d = data.from; d <= data.to; d = addDays(d, 1)) if (dow(d) >= 1 && dow(d) <= 5) days.push(d);
    const closed = new Map(data.closed.map(c => [c.day, c.reason]));
    const cell = new Map(); // `${student}|${day}` -> { B, L, D }
    const sums = new Map(); // student -> { B, L, D, dry }
    const perDay = new Map(days.map(d => [d, { B: 0, L: 0, D: 0, dry: 0 }]));
    for (const o of data.orders) {
      const key = `${o.student_id}|${o.day}`;
      cell.set(key, { ...cell.get(key), [o.meal]: o.variant });
      const s = sums.get(o.student_id) || { B: 0, L: 0, D: 0, dry: 0 };
      s[o.meal]++;
      if (o.meal === 'L' && isDry(o.variant)) s.dry++;
      sums.set(o.student_id, s);
      const pd = perDay.get(o.day);
      if (pd) { pd[o.meal]++; if (o.meal === 'L' && isDry(o.variant)) pd.dry++; }
    }
    return { days, closed, cell, sums, perDay };
  }, [data]);

  const groups = useMemo(() => [...new Set((data?.students || []).map(s => s.group_name).filter(Boolean))].sort(), [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.students || []).filter(s => (!group || s.group_name === group)
      && (!q || `${s.first_name} ${s.last_name} ${s.group_name}`.toLowerCase().includes(q)));
  }, [data, group, query]);

  const sumOf = id => report?.sums.get(id) || { B: 0, L: 0, D: 0, dry: 0 };
  const total = shown.reduce((t, s) => {
    const x = sumOf(s.id);
    return { B: t.B + x.B, L: t.L + x.L, D: t.D + x.D, dry: t.dry + x.dry };
  }, { B: 0, L: 0, D: 0, dry: 0 });
  const note = s => (s.left_on ? `izseljen, zadnji dan ${fmtDate(s.left_on)}` : !s.active ? 'izseljen' : '');

  function exportXlsx() {
    const { days, closed, cell } = report;
    const ids = new Set(shown.map(s => s.id));
    const title = `Obroki – ${monthLabel(month)}${group ? ` – ${group}` : ''}`;
    const stamp = `Izvoženo ${new Date().toLocaleString('sl-SI')}. Upoštevana so naročila (odjavljeni obroki niso šteti).`;
    const head = cols => cols.map(v => ({ v, bold: true }));

    const summary = [
      [{ v: title, bold: true }], [stamp], [],
      head(['Priimek', 'Ime', 'Skupina', 'Zajtrki', 'Kosila', 'od tega suha kosila', 'Večerje', 'Skupaj obrokov', 'Opomba']),
      ...shown.map(s => {
        const x = sumOf(s.id);
        return [s.last_name, s.first_name, s.group_name, x.B, x.L, x.dry, x.D, x.B + x.L + x.D, note(s)];
      }),
      head(['Skupaj', '', `${shown.length} dijakov`]).concat([total.B, total.L, total.dry, total.D, total.B + total.L + total.D].map(v => ({ v, bold: true }))),
    ];

    const list = [head(['Datum', 'Dan', 'Priimek', 'Ime', 'Skupina', 'Zajtrk', 'Kosilo', 'Večerja'])];
    for (const d of days) {
      for (const s of shown) {
        const c = cell.get(`${s.id}|${d}`);
        if (!c) continue;
        list.push([{ date: d }, dayShort(d), s.last_name, s.first_name, s.group_name,
          ...MEALS.map(m => (c[m] ? VARIANT_LABEL[c[m]] : ''))]);
      }
    }

    const daily = [head(['Datum', 'Dan', 'Zajtrki', 'Kosila', 'od tega suha kosila', 'Večerje', 'Skupaj', 'Opomba'])];
    const dt = { B: 0, L: 0, D: 0, dry: 0 };
    for (const d of days) {
      const x = { B: 0, L: 0, D: 0, dry: 0 };
      for (const o of data.orders) {
        if (o.day !== d || !ids.has(o.student_id)) continue;
        x[o.meal]++;
        if (o.meal === 'L' && isDry(o.variant)) x.dry++;
      }
      for (const k of Object.keys(dt)) dt[k] += x[k];
      daily.push([{ date: d }, dayShort(d), x.B, x.L, x.dry, x.D, x.B + x.L + x.D, closed.has(d) ? `zaprto${closed.get(d) ? ': ' + closed.get(d) : ''}` : '']);
    }
    daily.push(head(['Skupaj', '']).concat([dt.B, dt.L, dt.dry, dt.D, dt.B + dt.L + dt.D].map(v => ({ v, bold: true }))));

    const blob = writeXlsx([
      { name: 'Povzetek', rows: summary, widths: [18, 14, 14, 10, 10, 18, 10, 15, 30], freeze: 4 },
      { name: 'Po dnevih', rows: list, widths: [12, 6, 18, 14, 14, 20, 20, 20], freeze: 1 },
      { name: 'Dnevni seštevki', rows: daily, widths: [12, 6, 10, 10, 18, 10, 10, 30], freeze: 1 },
    ]);
    downloadBlob(blob, `obroki-${month}${group ? '-' + group.replace(/[^\p{L}\d]+/gu, '-') : ''}.xlsx`);
  }

  return (
    <div className="report">
      <div className="toolbar">
        <div className="title-block"><h1>Mesečni pregled</h1><span className="muted">naročeni obroki vseh dijakov</span></div>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} title="Prejšnji mesec"><ChevronLeft size={16} /></button>
          <strong>{monthLabel(month)}</strong>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} title="Naslednji mesec"><ChevronRight size={16} /></button>
        </div>
        <select value={group} onChange={e => setGroup(e.target.value)}>
          <option value="">Cel dom – vse skupine</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className="search"><Search size={15} /><input placeholder="Išči dijaka" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="seg">
          <button className={view === 'sum' ? 'on' : ''} onClick={() => setView('sum')}>Povzetek</button>
          <button className={view === 'days' ? 'on' : ''} onClick={() => setView('days')}>Po dnevih</button>
        </div>
        <button className="btn primary" onClick={exportXlsx} disabled={!report}><Download size={16} /> Izvozi v Excel</button>
      </div>
      {error && <p className="error banner">{error}</p>}
      {month >= me.clock.today.slice(0, 7) && <p className="hint pad-x">Za dneve, ki še niso minili, so prikazana trenutna naročila – do roka za spremembe se lahko še spremenijo.</p>}
      {!report ? <p className="muted pad">Nalaganje …</p> : view === 'sum' ? (
        <div className="table-card">
          <table className="list report-sum">
            <thead><tr><th>Dijak</th><th>Skupina</th><th className="num">Zajtrki</th><th className="num">Kosila</th><th className="num">od tega suha</th><th className="num">Večerje</th><th className="num">Skupaj</th><th /></tr></thead>
            <tbody>
              {shown.map(s => {
                const x = sumOf(s.id);
                return (
                  <tr key={s.id}>
                    <td><strong>{studentName(s)}</strong></td>
                    <td>{s.group_name}</td>
                    <td className="num">{x.B}</td><td className="num">{x.L}</td><td className="num muted">{x.dry}</td><td className="num">{x.D}</td>
                    <td className="num"><strong>{x.B + x.L + x.D}</strong></td>
                    <td className="muted">{note(s)}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} className="muted">Ni dijakov.</td></tr>}
            </tbody>
            <tfoot><tr><th>Skupaj ({shown.length})</th><th /><th className="num">{total.B}</th><th className="num">{total.L}</th><th className="num">{total.dry}</th><th className="num">{total.D}</th><th className="num">{total.B + total.L + total.D}</th><th /></tr></tfoot>
          </table>
        </div>
      ) : (
        <div className="table-card report-days-wrap">
          <table className="report-days">
            <thead>
              <tr>
                <th className="sticky">Dijak</th>
                {report.days.map(d => <th key={d} className={report.closed.has(d) ? 'closed' : ''} title={report.closed.get(d) || ''}>{dayShort(d)}<br />{fmtDay(d)}</th>)}
                {MEALS.map(m => <th key={m} className="num">{MEAL_NAMES[m].slice(0, 3)}.</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(s => {
                const x = sumOf(s.id);
                return (
                  <tr key={s.id}>
                    <th className="sticky">{studentName(s)}<small>{s.group_name}</small></th>
                    {report.days.map(d => {
                      const c = report.cell.get(`${s.id}|${d}`) || {};
                      return (
                        <td key={d} className={report.closed.has(d) ? 'closed' : ''}
                          title={MEALS.map(m => `${MEAL_NAMES[m]}: ${c[m] ? VARIANT_LABEL[c[m]] : '—'}`).join('\n')}>
                          {MEALS.map(m => <span key={m} className={c[m] ? `mini v-${c[m]}` : 'mini off'}>{c[m] ? VARIANT_SHORT[c[m]] : '·'}</span>)}
                        </td>
                      );
                    })}
                    {MEALS.map(m => <td key={m} className="num">{x[m]}</td>)}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th className="sticky">Skupaj</th>
                {report.days.map(d => {
                  const x = { B: 0, L: 0, D: 0 };
                  for (const s of shown) { const c = report.cell.get(`${s.id}|${d}`); if (c) for (const m of MEALS) if (c[m]) x[m]++; }
                  return <td key={d} className="day-total" title={MEALS.map(m => `${MEAL_NAMES[m]}: ${x[m]}`).join('\n')}>{x.B}/{x.L}/{x.D}</td>;
                })}
                {MEALS.map(m => <th key={m} className="num">{total[m]}</th>)}
              </tr>
            </tfoot>
          </table>
          <p className="hint pad-x">V vsaki celici so zajtrk, kosilo in večerja: N navadni, V vegetarijanski, S… suhi, P… pozni, La lahki, · ni naročeno. Spodaj je število zajtrkov/kosil/večerij za dan.</p>
        </div>
      )}
    </div>
  );
}
