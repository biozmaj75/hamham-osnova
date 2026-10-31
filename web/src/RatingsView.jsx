import { useEffect, useMemo, useState } from 'react';
import { Image, Trash2, EyeOff } from 'lucide-react';
import { api } from './api.js';
import Modal from './Modal.jsx';
import { MEALS, MEAL_NAMES, VARIANT_LABEL, SCORE_LABEL, addDays, fmtDay, fmtLong, capitalize, plural } from './meals.js';

const avg = list => (list.length ? list.reduce((s, r) => s + r.score, 0) / list.length : 0);
const fmtAvg = n => n.toFixed(1).replace('.', ',');

// Students' meal ratings for staff with the ratings right: summary, per-meal averages, every rating
export default function RatingsView({ me }) {
  const today = me.clock.today;
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [meal, setMeal] = useState('');
  const [onlyScore, setOnlyScore] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);

  const load = () => {
    setError('');
    return api('ratings', { from, to, meal }).then(setData).catch(err => setError(err.message));
  };
  useEffect(() => { if (from && to) load(); }, [from, to, meal]);

  const ratings = data?.ratings || [];
  const shown = onlyScore ? ratings.filter(r => r.score === onlyScore) : ratings;
  const counts = [1, 2, 3, 4, 5].map(n => ratings.filter(r => r.score === n).length);
  const most = Math.max(1, ...counts);

  // One row per served meal (day + meal + dish), worst first
  const perMeal = useMemo(() => {
    const map = new Map();
    for (const r of ratings) {
      const k = `${r.day}|${r.meal}`;
      if (!map.has(k)) map.set(k, { day: r.day, meal: r.meal, dishes: new Set(), list: [] });
      const e = map.get(k);
      if (r.dish) e.dishes.add(r.dish);
      e.list.push(r);
    }
    return [...map.values()].map(e => ({ ...e, avg: avg(e.list) })).sort((a, b) => a.avg - b.avg || b.day.localeCompare(a.day));
  }, [data]);

  async function openPhoto(r) {
    setPhoto({ r, src: null });
    try {
      const { photo: src } = await api('ratingPhoto', { id: r.id });
      setPhoto({ r, src });
    } catch (err) {
      setPhoto(null);
      alert(err.message);
    }
  }

  async function remove(r) {
    if (!confirm('Izbrišem to oceno skupaj s fotografijo? Tega ni mogoče razveljaviti.')) return;
    try {
      await api('deleteRating', { id: r.id });
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="ratings-view">
      <div className="toolbar">
        <label className="inline-field">Od<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label className="inline-field">Do<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <div className="seg">
          <button className={meal === '' ? 'on' : ''} onClick={() => setMeal('')}>Vsi obroki</button>
          {MEALS.map(m => <button key={m} className={meal === m ? 'on' : ''} onClick={() => setMeal(m)}>{MEAL_NAMES[m]}</button>)}
        </div>
        <div className="grow" />
        {data && (data.anonymous
          ? <span className="muted anon-note"><EyeOff size={14} /> Ocene so anonimne</span>
          : <span className="muted anon-note">Pri ocenah je zapisan dijak</span>)}
      </div>

      {error && <p className="error banner">{error}</p>}
      {!data && !error && <p className="muted pad">Nalaganje …</p>}

      {data && ratings.length === 0 && <p className="muted pad">V tem obdobju ni ocen.</p>}

      {data && ratings.length > 0 && (
        <>
          <div className="rating-top">
            <section className="table-card pad-card rating-stat">
              <p className="eyebrow">Povprečna ocena</p>
              <p className="rating-big">{fmtAvg(avg(ratings))}<small> / 5</small></p>
              <p className="muted">{ratings.length} {plural(ratings.length, 'ocena', 'oceni', 'ocene', 'ocen')} · {fmtDay(from)} – {fmtDay(to)}</p>
            </section>
            <section className="table-card pad-card rating-dist">
              <p className="eyebrow">Razporeditev ocen <small>klik na vrstico prikaže samo te ocene</small></p>
              {[5, 4, 3, 2, 1].map(n => (
                <button key={n} className={`dist-row ${onlyScore === n ? 'on' : ''}`} onClick={() => setOnlyScore(onlyScore === n ? 0 : n)}
                  title={`${n} – ${SCORE_LABEL[n]}: ${counts[n - 1]} (${Math.round((counts[n - 1] / ratings.length) * 100)} %)`}>
                  <span className="dist-label"><b>{n}</b> {SCORE_LABEL[n]}</span>
                  <span className="dist-track"><span className={`dist-bar s${n}`} style={{ width: `${(counts[n - 1] / most) * 100}%` }} /></span>
                  <span className="dist-n">{counts[n - 1]}</span>
                </button>
              ))}
            </section>
          </div>

          <section className="table-card">
            <header className="row-head pad-card"><h2>Po obrokih</h2><span className="muted">najslabše ocenjeni najprej</span></header>
            <table className="list rating-meals">
              <thead><tr><th>Dan</th><th>Obrok</th><th>Jed</th><th className="right">Ocen</th><th className="right">Povprečje</th></tr></thead>
              <tbody>
                {perMeal.map(e => (
                  <tr key={`${e.day}|${e.meal}`}>
                    <td>{capitalize(fmtLong(e.day))}</td>
                    <td>{MEAL_NAMES[e.meal]}</td>
                    <td>{[...e.dishes].join(' / ') || <span className="muted">—</span>}</td>
                    <td className="right">{e.list.length}</td>
                    <td className="right"><span className={`score-pill s${Math.round(e.avg)}`}>{fmtAvg(e.avg)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="table-card rating-list-card">
            <header className="row-head pad-card">
              <h2>Ocene{onlyScore ? ` z oceno ${onlyScore}` : ''}</h2>
              {onlyScore > 0 && <button className="btn ghost small" onClick={() => setOnlyScore(0)}>Prikaži vse</button>}
            </header>
            <ul className="rating-list">
              {shown.map(r => (
                <li key={r.id}>
                  <span className={`score-pill big s${r.score}`} title={SCORE_LABEL[r.score]}>{r.score}</span>
                  <div className="rating-body">
                    <p className="rating-meta">
                      <b>{MEAL_NAMES[r.meal]}</b>, {fmtLong(r.day)}
                      {r.dish && <> · {r.dish}</>}
                      <span className="muted"> · {VARIANT_LABEL[r.variant] || r.variant}</span>
                    </p>
                    <p className="rating-reason">{r.reason}</p>
                    <p className="muted rating-who">
                      {r.student_name ? <>{r.student_name}{r.group_name && `, ${r.group_name}`}</> : 'anonimno'}
                    </p>
                  </div>
                  <div className="rating-actions">
                    {r.has_photo && <button className="btn small" onClick={() => openPhoto(r)}><Image size={14} /> Fotografija</button>}
                    {data.canDelete && <button className="icon-btn" title="Izbriši oceno" onClick={() => remove(r)}><Trash2 size={14} /></button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {me.rights.includes('users') && (
        <p className="hint pad rating-access">Kdo vidi ocene: skrbnik in ravnatelj. Drugim zaposlenim pravico dodelite v zavihku Uporabniki → uredi račun → Dodatne pravice → »Ocene obrokov dijakov«.</p>
      )}

      {photo && (
        <Modal title={`${MEAL_NAMES[photo.r.meal]}, ${fmtDay(photo.r.day)}`} onClose={() => setPhoto(null)} wide>
          {photo.src ? <img className="rating-photo-full" src={photo.src} alt="Fotografija obroka" /> : <p className="muted">Nalaganje …</p>}
        </Modal>
      )}
    </div>
  );
}
