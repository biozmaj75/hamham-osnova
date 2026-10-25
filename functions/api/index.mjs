/**
 * Dormitory meals API
 *
 * POST { action, ...params } with `Authorization: Bearer <token>` (except login/setup).
 * Roles: admin (everything), teacher (orders + students + kitchen view),
 * dietitian (like teacher, plus the menu), kitchen (kitchen view + menu, read only).
 */
import { init, getPool, getSettings, setSetting } from './db.mjs';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.mjs';
import {
  MEALS, VARIANTS, MENU_VARIANTS, DEF_COL, validVariant, defaultVariant, mealServed, addDays, isDate, localNow, firstEditableDay,
} from './rules.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// How far ahead default orders are created when no school year is set
const HORIZON_DAYS = 28;
const MAX_RANGE_DAYS = 400;

const STAFF = ['admin', 'teacher', 'dietitian'];
const EVERYONE = [...STAFF, 'kitchen'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(data) };
}

// ---------------------------------------------------------------- time

async function clock() {
  const s = await getSettings();
  const cutoffHour = Number(s.cutoff_hour) || 18;
  const { today, hour, minute } = localNow(s.timezone);
  return {
    settings: s,
    timezone: s.timezone,
    cutoffHour,
    today,
    nowLocal: `${today} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    firstEditable: firstEditableDay(s.timezone, cutoffHour),
  };
}

function daysBetween(from, to) {
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Neveljaven datum');
  if (from > to) throw new HttpError(400, 'Začetni datum ne sme biti za končnim');
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > MAX_RANGE_DAYS) throw new HttpError(400, 'Obdobje je predolgo');
  }
  return out;
}

// ---------------------------------------------------------------- default orders

// SQL twin of defaultVariant(): weekday exception, else the default menu (needs aliases s, d, m)
const DEFAULT_VARIANT_SQL = `coalesce(
  (s.weekly -> (extract(isodow from d)::int)::text) ->> m.meal,
  case m.meal when 'B' then s.def_b when 'L' then s.def_l else s.def_d end)`;

const maxDay = (a, b) => (a > b ? a : b);
const yearStart = ck => (isDate(ck.settings.school_year_start) ? ck.settings.school_year_start : '');
const yearEnd = ck => (isDate(ck.settings.school_year_end) ? ck.settings.school_year_end : '');

// Creates default-menu rows for all active students up to `upTo`, for days that have none yet.
// When a school year is set, only its days are filled. Existing rows (including deregistrations) are never touched.
async function materialize(ck, upTo) {
  let target = upTo;
  if (target > addDays(ck.today, MAX_RANGE_DAYS)) target = addDays(ck.today, MAX_RANGE_DAYS);
  if (yearEnd(ck) && target > yearEnd(ck)) target = yearEnd(ck);
  const done = ck.settings.materialized_through;
  const start = maxDay(maxDay(done ? addDays(done, 1) : ck.today, ck.today), yearStart(ck));
  if (start > target) return;
  await getPool().query(`
    insert into orders (student_id, day, meal, variant, source)
    select s.id, d::date, m.meal, ${DEFAULT_VARIANT_SQL}, 'default'
    from students s
    cross join generate_series($1::date, $2::date, interval '1 day') d
    cross join (values ('B'), ('L'), ('D')) m(meal)
    where s.active
      and extract(isodow from d) <= 5
      and not (extract(isodow from d) = 5 and m.meal = 'D')
    on conflict do nothing`, [start, target]);
  await setSetting('materialized_through', target);
  ck.settings.materialized_through = target;
}

// Plans default orders ahead: to the end of the school year, or four weeks when none is set
async function horizon(ck) {
  const base = addDays(ck.today, HORIZON_DAYS);
  await materialize(ck, maxDay(base, yearEnd(ck)));
  return ck.settings.materialized_through;
}

// Writes order rows and logs every real change. rows: [{student_id, day, meal, variant, source}]
async function writeOrders(rows, userId) {
  if (!rows.length) return 0;
  const { rowCount } = await getPool().query(`
    with input as (
      select * from unnest($1::int[], $2::date[], $3::text[], $4::text[], $5::text[])
        as t(student_id, day, meal, variant, source)
    ),
    old as (
      select o.student_id, o.day, o.meal::text as meal, o.variant
      from orders o join input i on i.student_id = o.student_id and i.day = o.day and i.meal = o.meal
    ),
    up as (
      insert into orders (student_id, day, meal, variant, source, updated_by, updated_at)
      select student_id, day, meal, variant, source, $6, now() from input
      on conflict (student_id, day, meal) do update
        set variant = excluded.variant, source = excluded.source,
            updated_by = excluded.updated_by, updated_at = now()
      returning student_id, day, meal::text as meal, variant
    )
    insert into order_log (student_id, day, meal, old_variant, new_variant, user_id)
    select up.student_id, up.day, up.meal, old.variant, up.variant, $6
    from up left join old using (student_id, day, meal)
    where old.variant is distinct from up.variant`,
    [rows.map(r => r.student_id), rows.map(r => r.day), rows.map(r => r.meal),
     rows.map(r => r.variant), rows.map(r => r.source), userId]);
  return rowCount;
}

async function closedSet(from, to) {
  const { rows } = await getPool().query('select day, reason from closed_days where day between $1 and $2 order by day', [from, to]);
  return rows;
}

// Validates a batch of requested changes, resolves 'default', and writes what is allowed.
// Returns how many cells were saved and why the others were skipped.
async function applyChanges(ck, requests, userId) {
  const studentIds = [...new Set(requests.map(r => Number(r.student_id)))];
  const { rows: students } = await getPool().query('select * from students where id = any($1::int[])', [studentIds]);
  const byId = new Map(students.map(s => [s.id, s]));
  const days = requests.map(r => r.day).filter(isDate).sort();
  const closed = days.length ? new Set((await closedSet(days[0], days[days.length - 1])).map(c => c.day)) : new Set();

  const skipped = { locked: 0, notServed: 0, closed: 0, invalid: 0, inactive: 0 };
  const rows = [];
  for (const r of requests) {
    const s = byId.get(Number(r.student_id));
    if (!s || !isDate(r.day) || !MEALS.includes(r.meal)) { skipped.invalid++; continue; }
    if (!s.active) { skipped.inactive++; continue; }
    if (r.day < ck.firstEditable) { skipped.locked++; continue; }
    if (!mealServed(r.day, r.meal)) { skipped.notServed++; continue; }
    if (closed.has(r.day)) { skipped.closed++; continue; }
    let variant = r.variant;
    let source = 'manual';
    if (variant === 'default') { variant = defaultVariant(s, r.day, r.meal); source = 'default'; }
    if (!validVariant(r.meal, variant)) { skipped.invalid++; continue; }
    rows.push({ student_id: s.id, day: r.day, meal: r.meal, variant, source });
  }
  await writeOrders(rows, userId);
  return { saved: rows.length, skipped };
}

// ---------------------------------------------------------------- auth

async function currentUser(event, secret) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const payload = verifyToken(header.replace(/^Bearer\s+/i, ''), secret);
  if (!payload) return null;
  const { rows } = await getPool().query('select id, username, name, role from users where id = $1 and active', [payload.uid]);
  return rows[0] || null;
}

function requireRole(user, ...roles) {
  if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
  if (!roles.includes(user.role)) throw new HttpError(403, 'Za vašo vlogo to ni dovoljeno');
}

// ---------------------------------------------------------------- students

function cleanStudent(b) {
  const s = {
    first_name: String(b.first_name || '').trim(),
    last_name: String(b.last_name || '').trim(),
    group_name: String(b.group_name || '').trim(),
    room: String(b.room || '').trim(),
    diet: String(b.diet || '').trim(),
    notes: String(b.notes || '').trim(),
    def_b: b.def_b || 'normal',
    def_l: b.def_l || 'normal',
    def_d: b.def_d || 'normal',
    weekly: {},
    active: b.active !== false,
  };
  if (!s.first_name || !s.last_name) throw new HttpError(400, 'Ime in priimek sta obvezna');
  for (const m of MEALS) {
    if (!validVariant(m, s[DEF_COL[m]])) throw new HttpError(400, 'Neveljaven privzeti obrok');
  }
  // Weekday exceptions, ISO weekday 1–5 -> { meal: variant }; Friday has no dinner
  for (const [dow, meals] of Object.entries(b.weekly && typeof b.weekly === 'object' ? b.weekly : {})) {
    const n = Number(dow);
    if (!(n >= 1 && n <= 5) || !meals || typeof meals !== 'object') continue;
    for (const [m, v] of Object.entries(meals)) {
      if (!MEALS.includes(m) || (n === 5 && m === 'D') || !v) continue;
      if (!validVariant(m, v)) throw new HttpError(400, 'Neveljavna izjema za dan v tednu');
      (s.weekly[n] ||= {})[m] = v;
    }
  }
  return s;
}

// Fill unlocked, already-planned days for a (re)activated or new student
async function fillStudent(ck, studentId) {
  const through = ck.settings.materialized_through;
  const from = maxDay(ck.firstEditable, yearStart(ck));
  if (!through || through < from) return;
  await getPool().query(`
    insert into orders (student_id, day, meal, variant, source)
    select s.id, d::date, m.meal, ${DEFAULT_VARIANT_SQL}, 'default'
    from students s
    cross join generate_series($2::date, $3::date, interval '1 day') d
    cross join (values ('B'), ('L'), ('D')) m(meal)
    where s.id = $1 and s.active
      and extract(isodow from d) <= 5
      and not (extract(isodow from d) = 5 and m.meal = 'D')
    on conflict do nothing`, [studentId, from, through]);
}

async function saveStudent(ck, b, userId) {
  const s = cleanStudent(b);
  const db = getPool();
  await horizon(ck);
  if (!b.id) {
    const { rows } = await db.query(`
      insert into students (first_name, last_name, group_name, room, diet, notes, def_b, def_l, def_d, weekly, active)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [s.first_name, s.last_name, s.group_name, s.room, s.diet, s.notes, s.def_b, s.def_l, s.def_d, JSON.stringify(s.weekly), s.active]);
    await fillStudent(ck, rows[0].id);
    return rows[0];
  }
  const { rows: before } = await db.query('select * from students where id = $1', [b.id]);
  if (!before[0]) throw new HttpError(400, 'Dijaka ni mogoče najti');
  const old = before[0];
  const { rows } = await db.query(`
    update students set first_name=$2, last_name=$3, group_name=$4, room=$5, diet=$6, notes=$7,
      def_b=$8, def_l=$9, def_d=$10, weekly=$11, active=$12 where id=$1 returning *`,
    [b.id, s.first_name, s.last_name, s.group_name, s.room, s.diet, s.notes, s.def_b, s.def_l, s.def_d, JSON.stringify(s.weekly), s.active]);

  if (old.active && !s.active) {
    // Moved out / on leave: drop all orders that can still be changed
    const { rows: future } = await db.query(
      `select student_id, day, meal::text as meal from orders where student_id = $1 and day >= $2 and variant <> 'none'`,
      [b.id, ck.firstEditable]);
    await writeOrders(future.map(r => ({ ...r, variant: 'none', source: 'default' })), userId);
  } else if (s.active) {
    // Unchanged-by-hand future days follow the new default menu and weekday exceptions
    const { rows: future } = await db.query(
      `select student_id, day, meal::text as meal, variant from orders
       where student_id = $1 and day >= $2 and source = 'default'`, [b.id, ck.firstEditable]);
    const changes = future
      .map(r => ({ ...r, newVariant: defaultVariant(s, r.day, r.meal) }))
      .filter(r => r.newVariant !== r.variant)
      .map(r => ({ student_id: r.student_id, day: r.day, meal: r.meal, variant: r.newVariant, source: 'default' }));
    await writeOrders(changes, userId);
    if (!old.active) await fillStudent(ck, b.id);
  }
  return rows[0];
}

// ---------------------------------------------------------------- kitchen

async function kitchenDay(ck, day) {
  if (!isDate(day)) throw new HttpError(400, 'Neveljaven datum');
  await horizon(ck);
  await materialize(ck, day);
  const db = getPool();
  const closed = await closedSet(day, day);
  const { rows: counts } = await db.query(`
    select meal::text as meal, variant, count(*)::int as n from orders
    where day = $1 and variant <> 'none' group by meal, variant`, [day]);
  const { rows: special } = await db.query(`
    select s.id, s.first_name, s.last_name, s.group_name, s.room, s.diet, o.meal::text as meal, o.variant
    from orders o join students s on s.id = o.student_id
    where o.day = $1 and o.variant <> 'none'
      and (o.variant like 'dry_%' or o.variant like 'late_%' or s.diet <> '')
    order by s.last_name, s.first_name`, [day]);
  return {
    day,
    menu: await menuRows(day, day),
    closed: closed[0] || null,
    locked: day < ck.firstEditable,
    counts,
    dry: special.filter(r => r.variant.startsWith('dry_')),
    late: special.filter(r => r.variant.startsWith('late_')),
    diets: special.filter(r => r.diet),
  };
}

async function kitchenWeek(ck, from) {
  const days = daysBetween(from, addDays(from, 4));
  await horizon(ck);
  await materialize(ck, days[4]);
  const { rows } = await getPool().query(`
    select day, meal::text as meal, variant, count(*)::int as n from orders
    where day between $1 and $2 and variant <> 'none' group by day, meal, variant`, [days[0], days[4]]);
  return { days, counts: rows, closed: await closedSet(days[0], days[4]) };
}

// ---------------------------------------------------------------- menu

async function menuRows(from, to) {
  const { rows } = await getPool().query(
    'select day, meal::text as meal, variant, dish from menus where day between $1 and $2', [from, to]);
  return rows;
}

// ---------------------------------------------------------------- actions

const actions = {
  async setup(b) {
    const db = getPool();
    const { rows } = await db.query('select count(*)::int as n from users');
    if (rows[0].n > 0) throw new HttpError(403, 'Namestitev je že opravljena');
    if (!b.username || !b.password || String(b.password).length < 8) throw new HttpError(400, 'Potrebna sta uporabniško ime in geslo z vsaj 8 znaki');
    await db.query('insert into users (username, name, role, pw_hash) values ($1, $2, $3, $4)',
      [String(b.username).trim().toLowerCase(), b.name || 'Administrator', 'admin', hashPassword(b.password)]);
    return { ok: true };
  },

  async login(b, _user, ck) {
    const { rows } = await getPool().query('select * from users where username = $1 and active',
      [String(b.username || '').trim().toLowerCase()]);
    const u = rows[0];
    if (!u || !verifyPassword(String(b.password || ''), u.pw_hash)) throw new HttpError(401, 'Napačno uporabniško ime ali geslo');
    return {
      token: signToken({ uid: u.id }, ck.settings.secret),
      user: { id: u.id, username: u.username, name: u.name, role: u.role },
    };
  },

  async me(_b, user, ck) {
    requireRole(user, ...EVERYONE);
    return { user, clock: publicClock(ck), variants: VARIANTS };
  },

  async changePassword(b, user) {
    requireRole(user, ...EVERYONE);
    const { rows } = await getPool().query('select pw_hash from users where id = $1', [user.id]);
    if (!verifyPassword(String(b.current || ''), rows[0].pw_hash)) throw new HttpError(400, 'Trenutno geslo ni pravilno');
    if (String(b.password || '').length < 8) throw new HttpError(400, 'Novo geslo mora imeti vsaj 8 znakov');
    await getPool().query('update users set pw_hash = $2 where id = $1', [user.id, hashPassword(b.password)]);
    return { ok: true };
  },

  // Orders grid for a date range
  async grid(b, user, ck) {
    requireRole(user, ...STAFF);
    const days = daysBetween(b.from, b.to);
    await horizon(ck);
    await materialize(ck, days[days.length - 1]);
    const db = getPool();
    const params = [];
    let where = 'where active';
    if (b.group) { params.push(b.group); where += ` and group_name = $${params.length}`; }
    const { rows: students } = await db.query(
      `select id, first_name, last_name, group_name, room, diet, def_b, def_l, def_d, weekly from students ${where}
       order by group_name, last_name, first_name`, params);
    const { rows: orders } = await db.query(`
      select o.student_id, o.day, o.meal::text as meal, o.variant, o.source
      from orders o join students s on s.id = o.student_id
      where o.day between $1 and $2 and s.active ${b.group ? 'and s.group_name = $3' : ''}`,
      b.group ? [b.from, b.to, b.group] : [b.from, b.to]);
    const { rows: groups } = await db.query(
      `select group_name, count(*)::int as n from students where active group by group_name order by group_name`);
    return {
      days, students, orders, groups,
      menu: await menuRows(b.from, b.to), closed: await closedSet(b.from, b.to), clock: publicClock(ck),
    };
  },

  // Individual cells: { changes: [{student_id, day, meal, variant}] }
  async setOrders(b, user, ck) {
    requireRole(user, ...STAFF);
    if (!Array.isArray(b.changes) || b.changes.length > 5000) throw new HttpError(400, 'Neveljavne spremembe');
    return applyChanges(ck, b.changes, user.id);
  },

  // Range: { student_ids, from, to, meals: ['B','L','D'], variant: 'none' | 'default' | <variant> }
  async bulkOrders(b, user, ck) {
    requireRole(user, ...STAFF);
    const days = daysBetween(b.from, b.to);
    const ids = (b.student_ids || []).map(Number).filter(Boolean);
    const meals = (b.meals || []).filter(m => MEALS.includes(m));
    if (!ids.length || !meals.length) throw new HttpError(400, 'Izberite vsaj enega dijaka in en obrok');
    if (ids.length * days.length * meals.length > 150000) throw new HttpError(400, 'Preveč sprememb hkrati — skrajšajte obdobje');
    const requests = [];
    for (const student_id of ids) for (const day of days) for (const meal of meals) {
      if (mealServed(day, meal)) requests.push({ student_id, day, meal, variant: b.variant });
    }
    return applyChanges(ck, requests, user.id);
  },

  async students(b, user) {
    requireRole(user, ...STAFF);
    const { rows } = await getPool().query('select * from students order by active desc, group_name, last_name, first_name');
    return { students: rows };
  },

  async saveStudent(b, user, ck) {
    requireRole(user, ...STAFF);
    return { student: await saveStudent(ck, b.student || {}, user.id) };
  },

  // { rows: [{first_name, last_name, group_name, room, diet}] }
  async importStudents(b, user, ck) {
    requireRole(user, ...STAFF);
    if (!Array.isArray(b.rows) || b.rows.length > 1000) throw new HttpError(400, 'Neveljaven uvoz');
    const clean = b.rows.map(cleanStudent);
    let created = 0;
    for (const s of clean) { await saveStudent(ck, s, user.id); created++; }
    return { created };
  },

  async studentLog(b, user) {
    requireRole(user, ...STAFF);
    const { rows } = await getPool().query(`
      select l.day, l.meal, l.old_variant, l.new_variant, l.at, u.name as user_name
      from order_log l left join users u on u.id = l.user_id
      where l.student_id = $1 order by l.at desc limit 200`, [b.student_id]);
    return { log: rows };
  },

  async kitchenDay(b, user, ck) {
    requireRole(user, ...EVERYONE);
    return kitchenDay(ck, b.day);
  },

  async kitchenWeek(b, user, ck) {
    requireRole(user, ...EVERYONE);
    return kitchenWeek(ck, b.from);
  },

  // Menu for Mon–Fri starting at { from }
  async menuWeek(b, user) {
    requireRole(user, ...EVERYONE);
    const days = daysBetween(b.from, addDays(b.from, 4));
    return { days, items: await menuRows(days[0], days[4]), closed: await closedSet(days[0], days[4]) };
  },

  // { items: [{ day, meal, variant, dish }] } — an empty dish removes the entry
  async saveMenu(b, user) {
    requireRole(user, 'admin', 'dietitian');
    if (!Array.isArray(b.items) || b.items.length > 500) throw new HttpError(400, 'Neveljaven jedilnik');
    const keep = [];
    const drop = [];
    for (const it of b.items) {
      if (!isDate(it.day) || !(MENU_VARIANTS[it.meal] || []).includes(it.variant)) throw new HttpError(400, 'Neveljaven jedilnik');
      const dish = String(it.dish || '').trim().slice(0, 300);
      (dish ? keep : drop).push({ ...it, dish });
    }
    const db = getPool();
    if (keep.length) await db.query(`
      insert into menus (day, meal, variant, dish, updated_by)
      select * , $5::int from unnest($1::date[], $2::text[], $3::text[], $4::text[])
      on conflict (day, meal, variant) do update set dish = excluded.dish, updated_by = excluded.updated_by, updated_at = now()`,
      [keep.map(i => i.day), keep.map(i => i.meal), keep.map(i => i.variant), keep.map(i => i.dish), user.id]);
    for (const i of drop) await db.query('delete from menus where day = $1 and meal = $2 and variant = $3', [i.day, i.meal, i.variant]);
    return { saved: keep.length, removed: drop.length };
  },

  // Copies the Mon–Fri menu starting at { from } to the weeks starting at { to } (one or more Mondays)
  async copyMenu(b, user) {
    requireRole(user, 'admin', 'dietitian');
    const targets = (Array.isArray(b.to) ? b.to : [b.to]).filter(isDate);
    if (!isDate(b.from) || !targets.length || targets.length > 60) throw new HttpError(400, 'Neveljaven datum');
    const db = getPool();
    for (const to of targets) {
      if (to === b.from) continue;
      await db.query('delete from menus where day between $1 and $2', [to, addDays(to, 4)]);
      await db.query(`
        insert into menus (day, meal, variant, dish, updated_by)
        select day + ($2::date - $1::date), meal, variant, dish, $4 from menus where day between $1 and $3`,
        [b.from, to, addDays(b.from, 4), user.id]);
    }
    return { weeks: targets.length };
  },

  async users(b, user) {
    requireRole(user, 'admin');
    const { rows } = await getPool().query('select id, username, name, role, active, created_at from users order by role, name');
    return { users: rows };
  },

  async saveUser(b, user) {
    requireRole(user, 'admin');
    const u = b.user || {};
    const username = String(u.username || '').trim().toLowerCase();
    const name = String(u.name || '').trim();
    if (!username || !name) throw new HttpError(400, 'Uporabniško ime in ime sta obvezna');
    if (!EVERYONE.includes(u.role)) throw new HttpError(400, 'Neveljavna vloga');
    if (u.password && String(u.password).length < 8) throw new HttpError(400, 'Geslo mora imeti vsaj 8 znakov');
    const db = getPool();
    try {
      if (!u.id) {
        if (!u.password) throw new HttpError(400, 'Geslo je obvezno');
        await db.query('insert into users (username, name, role, pw_hash) values ($1,$2,$3,$4)',
          [username, name, u.role, hashPassword(u.password)]);
      } else {
        if (Number(u.id) === user.id && (u.role !== 'admin' || u.active === false)) {
          throw new HttpError(400, 'Sami sebi ne morete odvzeti skrbniških pravic');
        }
        await db.query('update users set username=$2, name=$3, role=$4, active=$5 where id=$1',
          [u.id, username, name, u.role, u.active !== false]);
        if (u.password) await db.query('update users set pw_hash=$2 where id=$1', [u.id, hashPassword(u.password)]);
      }
    } catch (err) {
      if (err.code === '23505') throw new HttpError(400, 'To uporabniško ime je že zasedeno');
      throw err;
    }
    return { ok: true };
  },

  async settings(b, user, ck) {
    requireRole(user, 'admin');
    const { rows: closed } = await getPool().query('select day, reason from closed_days where day >= $1 order by day', [addDays(ck.today, -30)]);
    return {
      timezone: ck.timezone, cutoff_hour: ck.cutoffHour, closed,
      school_year_start: yearStart(ck), school_year_end: yearEnd(ck),
    };
  },

  async saveSettings(b, user, ck) {
    requireRole(user, 'admin');
    try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { throw new HttpError(400, 'Neznan časovni pas'); }
    const hour = Number(b.cutoff_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'Ura roka mora biti med 0 in 23');
    const start = b.school_year_start || '';
    const end = b.school_year_end || '';
    if ((start && !isDate(start)) || (end && !isDate(end))) throw new HttpError(400, 'Neveljaven datum');
    if (start && end && start > end) throw new HttpError(400, 'Začetek šolskega leta mora biti pred koncem');
    if (end && end > addDays(ck.today, MAX_RANGE_DAYS)) throw new HttpError(400, 'Konec šolskega leta je predaleč v prihodnosti');
    await setSetting('timezone', b.timezone);
    await setSetting('cutoff_hour', hour);
    await setSetting('school_year_start', start);
    await setSetting('school_year_end', end);
    // Plan the whole school year right away so every screen shows it
    Object.assign(ck.settings, { school_year_start: start, school_year_end: end });
    await horizon(ck);
    return { ok: true, planned_through: ck.settings.materialized_through };
  },

  // { day, to?, reason } closes one day or every weekday of a range (holidays); { day, remove: true } reopens it
  async setClosedDay(b, user) {
    requireRole(user, 'admin');
    if (!isDate(b.day)) throw new HttpError(400, 'Neveljaven datum');
    if (b.remove) {
      await getPool().query('delete from closed_days where day = $1', [b.day]);
      return { ok: true };
    }
    const days = daysBetween(b.day, isDate(b.to) ? b.to : b.day).filter(d => mealServed(d, 'B'));
    await getPool().query(`
      insert into closed_days (day, reason) select unnest($1::date[]), $2
      on conflict (day) do update set reason = excluded.reason`, [days, String(b.reason || '').trim()]);
    return { ok: true, closed: days.length };
  },
};

function publicClock(ck) {
  return { today: ck.today, nowLocal: ck.nowLocal, firstEditable: ck.firstEditable, cutoffHour: ck.cutoffHour, timezone: ck.timezone };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const body = event.body
      ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
      : {};
    const fn = actions[body.action];
    if (!fn) return json({ error: 'Neznano dejanje' }, 400);
    await init();
    const ck = await clock();
    const user = ['login', 'setup'].includes(body.action) ? null : await currentUser(event, ck.settings.secret);
    return json(await fn(body, user, ck));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Napaka na strežniku' }, 500);
  }
};
