/**
 * Dormitory meals API
 *
 * POST { action, ...params } with `Authorization: Bearer <token>` (except login/setup).
 * Access is checked per right (see RIGHTS); a role grants a set of rights and an account
 * may get a few extra ones. Students only reach the my* actions and their own absences.
 */
import { init, getPool, getSettings, setSetting } from './db.mjs';
import crypto from 'node:crypto';
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

// Which roles hold which right
const RIGHTS = {
  users: ['admin', 'principal'],                               // accounts, roles, locking
  audit: ['admin', 'principal'],                               // change log
  students: ['admin', 'principal', 'teacher'],                 // full student records + student logins
  diets: ['admin', 'principal', 'teacher', 'dietitian'],       // diet and menu fields of students
  orders: ['admin', 'principal', 'teacher', 'dietitian'],      // orders grid, absences
  menu: ['admin', 'dietitian'],                                // edit the menu
  mealSettings: ['admin', 'dietitian'],                        // school year, closed days, student choices, serving times
  system: ['admin'],                                           // order deadline, time zone
  kitchen: ['admin', 'principal', 'teacher', 'dietitian', 'kitchen'],
  viewMenu: ['admin', 'principal', 'teacher', 'dietitian', 'kitchen'],
};
// Rights that can be granted to a single staff account on top of its role
const EXTRA_RIGHTS = ['orders', 'menu', 'mealSettings'];
const STAFF_ROLES = ['admin', 'principal', 'teacher', 'dietitian', 'kitchen'];

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

// Inserts planned rows for students matching `where` between $1 and $2; days inside an absence get 'none'
const planSql = where => `
  insert into orders (student_id, day, meal, variant, source)
  select s.id, d::date, m.meal,
    case when ab.id is null then ${DEFAULT_VARIANT_SQL} else 'none' end,
    case when ab.id is null then 'default' else 'absence' end
  from students s
  cross join generate_series($1::date, $2::date, interval '1 day') d
  cross join (values ('B'), ('L'), ('D')) m(meal)
  left join lateral (
    select a.id from absences a where a.student_id = s.id and d::date between a.day_from and a.day_to limit 1
  ) ab on true
  where ${where}
    and extract(isodow from d) <= 5
    and not (extract(isodow from d) = 5 and m.meal = 'D')
  on conflict do nothing`;

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
  await getPool().query(planSql('s.active'), [start, target]);
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
  const { rows: absent } = days.length ? await getPool().query(
    'select student_id, day_from, day_to from absences where student_id = any($1::int[]) and day_to >= $2 and day_from <= $3',
    [studentIds, days[0], days[days.length - 1]]) : { rows: [] };
  const isAbsent = (sid, day) => absent.some(a => a.student_id === sid && day >= a.day_from && day <= a.day_to);

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
    if (variant === 'default') {
      [variant, source] = isAbsent(s.id, r.day) ? ['none', 'absence'] : [defaultVariant(s, r.day, r.meal), 'default'];
    }
    if (!validVariant(r.meal, variant)) { skipped.invalid++; continue; }
    rows.push({ student_id: s.id, day: r.day, meal: r.meal, variant, source });
  }
  await writeOrders(rows, userId);
  return { saved: rows.length, skipped };
}

// ---------------------------------------------------------------- auth

// Part of the password hash inside the token: a new password signs out every other session
const pwTag = hash => hash.slice(-12);

// Locked accounts and students who moved out are signed out on their next request
async function currentUser(event, secret) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const payload = verifyToken(header.replace(/^Bearer\s+/i, ''), secret);
  if (!payload) return null;
  const { rows } = await getPool().query(`
    select u.id, u.username, u.name, u.role, u.student_id, u.must_change, u.perms, u.groups, u.pw_hash
    from users u left join students s on s.id = u.student_id
    where u.id = $1 and u.active and (u.role <> 'student' or s.active)`, [payload.uid]);
  const u = rows[0];
  if (!u || payload.v !== pwTag(u.pw_hash)) return null;
  delete u.pw_hash;
  return u;
}

function can(user, right) {
  return !!user && (RIGHTS[right].includes(user.role) || (user.role !== 'student' && user.perms?.includes(right)));
}

function rightsOf(user) {
  return Object.keys(RIGHTS).filter(r => can(user, r));
}

function requireRight(user, right) {
  if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
  if (!can(user, right)) throw new HttpError(403, 'Za vašo vlogo to ni dovoljeno');
}

function requireStudent(user) {
  if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
  if (user.role !== 'student' || !user.student_id) throw new HttpError(403, 'Na voljo samo dijakom');
}

async function audit(user, action, details = '') {
  await getPool().query('insert into audit_log (user_id, action, details) values ($1, $2, $3)', [user?.id || null, action, details]);
}

// ---------------------------------------------------------------- students

function cleanStudent(b) {
  const s = {
    first_name: String(b.first_name || '').trim(),
    last_name: String(b.last_name || '').trim(),
    ext_id: String(b.ext_id || '').trim().slice(0, 40),
    group_name: String(b.group_name || '').trim(),
    room: String(b.room || '').trim(),
    diet: String(b.diet || '').trim(),
    diet_reason: String(b.diet_reason || '').trim(),
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
  await getPool().query(planSql('s.id = $3 and s.active'), [from, through, studentId]);
}

async function saveStudent(ck, input, userId) {
  const db = getPool();
  let b = input;
  if (input.dietOnly) {
    // Meal planner: only the food-related fields change, the personal record stays as it is
    const { rows } = await db.query('select * from students where id = $1', [input.id]);
    if (!rows[0]) throw new HttpError(400, 'Dijaka ni mogoče najti');
    b = { ...rows[0] };
    for (const k of DIET_FIELDS) if (k in input) b[k] = input[k];
  }
  const s = cleanStudent(b);
  await horizon(ck);
  if (!b.id) {
    const { rows } = await db.query(`
      insert into students (first_name, last_name, group_name, room, diet, diet_reason, notes, def_b, def_l, def_d, weekly, active, ext_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [s.first_name, s.last_name, s.group_name, s.room, s.diet, s.diet_reason, s.notes, s.def_b, s.def_l, s.def_d, JSON.stringify(s.weekly), s.active, s.ext_id]);
    await fillStudent(ck, rows[0].id);
    return rows[0];
  }
  const { rows: before } = await db.query('select * from students where id = $1', [b.id]);
  if (!before[0]) throw new HttpError(400, 'Dijaka ni mogoče najti');
  const old = before[0];
  const { rows } = await db.query(`
    update students set first_name=$2, last_name=$3, group_name=$4, room=$5, diet=$6, diet_reason=$7, notes=$8,
      def_b=$9, def_l=$10, def_d=$11, weekly=$12, active=$13, ext_id=$14 where id=$1 returning *`,
    [b.id, s.first_name, s.last_name, s.group_name, s.room, s.diet, s.diet_reason, s.notes, s.def_b, s.def_l, s.def_d, JSON.stringify(s.weekly), s.active, s.ext_id]);

  if (old.active && !s.active) {
    // Moved out / on leave: drop all orders that can still be changed
    const { rows: future } = await db.query(
      `select student_id, day, meal::text as meal from orders where student_id = $1 and day >= $2 and variant <> 'none'`,
      [b.id, ck.firstEditable]);
    await writeOrders(future.map(r => ({ ...r, variant: 'none', source: 'default' })), userId);
    await db.query('update users set active = false where student_id = $1', [b.id]);
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

// What each right may see of a student
const DIET_FIELDS = ['diet', 'diet_reason', 'def_b', 'def_l', 'def_d', 'weekly'];
const STUDENT_VIEW = {
  full: ['id', 'ext_id', 'first_name', 'last_name', 'group_name', 'room', 'diet', 'diet_reason', 'notes', 'def_b', 'def_l', 'def_d', 'weekly', 'active'],
  diets: ['id', 'first_name', 'last_name', 'group_name', 'diet', 'diet_reason', 'def_b', 'def_l', 'def_d', 'weekly', 'active'],
};
const studentView = user => (can(user, 'students') ? STUDENT_VIEW.full : STUDENT_VIEW.diets);
const pick = (row, keys) => Object.fromEntries(keys.filter(k => k in row).map(k => [k, row[k]]));

// ---------------------------------------------------------------- absences

// Absences can only start on days whose orders are still open
async function addAbsence(ck, studentId, b, user) {
  const from = b.from;
  const to = isDate(b.to) ? b.to : b.from;
  daysBetween(from, to);
  if (from < ck.firstEditable) throw new HttpError(400, `Odsotnost lahko prijavite najprej za ${ck.firstEditable.split('-').reverse().join('. ')} — rok za prejšnje dni je potekel`);
  const db = getPool();
  const { rows: st } = await db.query('select * from students where id = $1 and active', [studentId]);
  if (!st[0]) throw new HttpError(400, 'Dijaka ni mogoče najti');
  const { rows } = await db.query(
    'insert into absences (student_id, day_from, day_to, reason, created_by) values ($1, $2, $3, $4, $5) returning *',
    [studentId, from, to, String(b.reason || '').trim().slice(0, 200), user.id]);
  await horizon(ck);
  const { rows: cells } = await db.query(
    `select student_id, day, meal::text as meal from orders where student_id = $1 and day between $2 and $3`, [studentId, from, to]);
  await writeOrders(cells.map(c => ({ ...c, variant: 'none', source: 'absence' })), user.id);
  await audit(user, 'absence.add', `${st[0].first_name} ${st[0].last_name}: ${from}${to !== from ? ' – ' + to : ''}`);
  return rows[0];
}

// Cancelling restores the default menu on open days that are not covered by another absence.
// Days whose deadline has passed stay as they are; an absence that has already started is shortened.
async function cancelAbsence(ck, absence, user) {
  const db = getPool();
  if (absence.day_to < ck.firstEditable) throw new HttpError(400, 'Ta odsotnost je že minila');
  if (absence.day_from >= ck.firstEditable) {
    await db.query('delete from absences where id = $1', [absence.id]);
  } else {
    await db.query('update absences set day_to = $2 where id = $1', [absence.id, addDays(ck.firstEditable, -1)]);
  }
  const from = maxDay(absence.day_from, ck.firstEditable);
  const { rows: st } = await db.query('select * from students where id = $1', [absence.student_id]);
  const { rows: cells } = await db.query(`
    select o.student_id, o.day, o.meal::text as meal from orders o
    where o.student_id = $1 and o.day between $2 and $3 and o.source = 'absence'
      and not exists (select 1 from absences a where a.student_id = o.student_id and o.day between a.day_from and a.day_to)`,
    [absence.student_id, from, absence.day_to]);
  const closed = new Set((await closedSet(from, absence.day_to)).map(c => c.day));
  await writeOrders(cells.filter(c => !closed.has(c.day))
    .map(c => ({ ...c, variant: st[0]?.active ? defaultVariant(st[0], c.day, c.meal) : 'none', source: 'default' })), user.id);
  await audit(user, 'absence.cancel', `${st[0]?.first_name} ${st[0]?.last_name}: ${absence.day_from} – ${absence.day_to}`);
}

async function absencesOf(studentId, fromDay) {
  const { rows } = await getPool().query(`
    select a.id, a.student_id, a.day_from, a.day_to, a.reason, a.created_at, u.name as created_by_name, u.role as created_by_role
    from absences a left join users u on u.id = a.created_by
    where a.student_id = $1 and a.day_to >= $2 order by a.day_from`, [studentId, fromDay]);
  return rows;
}

// ---------------------------------------------------------------- student logins

const PW_WORDS = ['juha', 'riba', 'pita', 'sir', 'med', 'kruh', 'hruska', 'sliva', 'repa', 'kaki', 'figa', 'limona', 'oreh', 'lesnik', 'kivi', 'melona'];
// Easy to read off paper: word-word-number, no look-alike characters
function tempPassword() {
  const w = () => PW_WORDS[crypto.randomInt(PW_WORDS.length)];
  return `${w()}-${w()}-${crypto.randomInt(100, 1000)}`;
}

const ascii = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function freeUsername(base) {
  const { rows } = await getPool().query('select username from users where username like $1', [base + '%']);
  const taken = new Set(rows.map(r => r.username));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(base + i)) return base + i;
}

// Creates the student's login, or gives a new temporary password if it exists. Returns what goes on the sheet.
async function issueStudentLogin(student) {
  const db = getPool();
  const password = tempPassword();
  const { rows } = await db.query('select id, username from users where student_id = $1', [student.id]);
  let username;
  if (rows[0]) {
    username = rows[0].username;
    await db.query('update users set pw_hash = $2, must_change = true, name = $3 where id = $1',
      [rows[0].id, hashPassword(password), `${student.first_name} ${student.last_name}`]);
  } else {
    username = await freeUsername(`${ascii(student.first_name)}.${ascii(student.last_name)}`.slice(0, 40));
    await db.query(`insert into users (username, name, role, pw_hash, student_id, must_change) values ($1, $2, 'student', $3, $4, true)`,
      [username, `${student.first_name} ${student.last_name}`, hashPassword(password), student.id]);
  }
  return { student_id: student.id, name: `${student.first_name} ${student.last_name}`, group_name: student.group_name, username, password, created: !rows[0] };
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
    select s.id, s.first_name, s.last_name, s.group_name, s.diet, o.meal::text as meal, o.variant
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

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

// Variants a student may pick for each meal (set by the meal planner); 'none' is always allowed
function studentChoices(ck) {
  const saved = parseJson(ck.settings.student_choices, null);
  return Object.fromEntries(MEALS.map(m => [m, Array.isArray(saved?.[m]) ? VARIANTS[m].filter(v => saved[m].includes(v)) : VARIANTS[m]]));
}

// Off by default: students change only what they eat; deregistering and absences go through the staff
const studentCanCancel = ck => ck.settings.student_can_cancel === '1';

const mealTimes = ck => ({ B: '', L: '', D: '', late: '', dry: '', ...parseJson(ck.settings.meal_times, {}) });

function cleanUsername(v) {
  const u = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new HttpError(400, 'Uporabniško ime: 3–40 znakov, samo črke brez strešic, številke, pika, vezaj');
  return u;
}

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
    const { rows } = await getPool().query(`
      select u.* from users u left join students s on s.id = u.student_id
      where u.username = $1 and u.active and (u.role <> 'student' or s.active)`,
      [String(b.username || '').trim().toLowerCase()]);
    const u = rows[0];
    if (!u || !verifyPassword(String(b.password || ''), u.pw_hash)) throw new HttpError(401, 'Napačno uporabniško ime ali geslo, ali pa je račun zaklenjen');
    await getPool().query('update users set last_login = now() where id = $1', [u.id]);
    return { token: signToken({ uid: u.id, v: pwTag(u.pw_hash) }, ck.settings.secret) };
  },

  async me(_b, user, ck) {
    if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
    const out = { user, rights: rightsOf(user), clock: publicClock(ck), variants: VARIANTS, times: mealTimes(ck) };
    if (user.role === 'student') {
      const { rows } = await getPool().query('select first_name, last_name, group_name, room, diet from students where id = $1', [user.student_id]);
      out.student = rows[0];
      out.choices = studentChoices(ck);
      out.canCancel = studentCanCancel(ck);
    }
    return out;
  },

  async changePassword(b, user, ck) {
    if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
    const { rows } = await getPool().query('select pw_hash from users where id = $1', [user.id]);
    if (!verifyPassword(String(b.current || ''), rows[0].pw_hash)) throw new HttpError(400, 'Trenutno geslo ni pravilno');
    if (String(b.password || '').length < 8) throw new HttpError(400, 'Novo geslo mora imeti vsaj 8 znakov');
    if (b.password === b.current) throw new HttpError(400, 'Novo geslo mora biti drugačno od trenutnega');
    const hash = hashPassword(b.password);
    await getPool().query('update users set pw_hash = $2, must_change = false where id = $1', [user.id, hash]);
    // Fresh token: the old one stops working together with the old password
    return { ok: true, token: signToken({ uid: user.id, v: pwTag(hash) }, ck.settings.secret) };
  },

  // ------------------------------------------------ orders (staff)

  async grid(b, user, ck) {
    requireRight(user, 'orders');
    const days = daysBetween(b.from, b.to);
    await horizon(ck);
    await materialize(ck, days[days.length - 1]);
    const db = getPool();
    // group: one group name, '@mine' = the teacher's own groups, empty = the whole home
    const only = b.group === '@mine' ? (user.groups || []) : b.group ? [b.group] : null;
    const params = [];
    let where = 'where active';
    if (only) { params.push(only); where += ` and group_name = any($${params.length}::text[])`; }
    const cols = can(user, 'students') ? 'room, ' : '';
    const { rows: students } = await db.query(
      `select id, first_name, last_name, group_name, ${cols}diet, def_b, def_l, def_d, weekly from students ${where}
       order by group_name, last_name, first_name`, params);
    const { rows: orders } = await db.query(`
      select o.student_id, o.day, o.meal::text as meal, o.variant, o.source
      from orders o join students s on s.id = o.student_id
      where o.day between $1 and $2 and s.active ${only ? 'and s.group_name = any($3::text[])' : ''}`,
      only ? [b.from, b.to, only] : [b.from, b.to]);
    const { rows: groups } = await db.query(
      `select group_name, count(*)::int as n from students where active group by group_name order by group_name`);
    const { rows: absences } = await db.query(
      `select id, student_id, day_from, day_to, reason from absences where day_to >= $1 and day_from <= $2`, [b.from, b.to]);
    return {
      days, students, orders, groups, absences,
      menu: await menuRows(b.from, b.to), closed: await closedSet(b.from, b.to), clock: publicClock(ck),
    };
  },

  // Individual cells: { changes: [{student_id, day, meal, variant}] }
  async setOrders(b, user, ck) {
    requireRight(user, 'orders');
    if (!Array.isArray(b.changes) || b.changes.length > 5000) throw new HttpError(400, 'Neveljavne spremembe');
    return applyChanges(ck, b.changes, user.id);
  },

  // Range: { student_ids, from, to, meals: ['B','L','D'], variant: 'none' | 'default' | <variant> }
  async bulkOrders(b, user, ck) {
    requireRight(user, 'orders');
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

  // ------------------------------------------------ absences

  async absences(b, user, ck) {
    requireRight(user, 'orders');
    return { absences: await absencesOf(Number(b.student_id), addDays(ck.today, -60)) };
  },

  // { student_ids, from, to, reason } — staff report absence for one or more students
  async addAbsence(b, user, ck) {
    requireRight(user, 'orders');
    const ids = (b.student_ids || [b.student_id]).map(Number).filter(Boolean);
    if (!ids.length || ids.length > 300) throw new HttpError(400, 'Izberite dijake');
    for (const id of ids) await addAbsence(ck, id, b, user);
    return { added: ids.length };
  },

  async cancelAbsence(b, user, ck) {
    requireRight(user, 'orders');
    const { rows } = await getPool().query('select * from absences where id = $1', [b.id]);
    if (!rows[0]) throw new HttpError(400, 'Odsotnosti ni mogoče najti');
    await cancelAbsence(ck, rows[0], user);
    return { ok: true };
  },

  // ------------------------------------------------ students (staff)

  async students(b, user) {
    requireRight(user, 'diets');
    const { rows } = await getPool().query(`
      select s.*, u.id as user_id, u.username, u.active as login_active, u.must_change, u.last_login
      from students s left join users u on u.student_id = s.id
      order by s.active desc, s.group_name, s.last_name, s.first_name`);
    const keys = [...studentView(user), ...(can(user, 'students') ? ['user_id', 'username', 'login_active', 'must_change', 'last_login'] : [])];
    return { students: rows.map(r => pick(r, keys)), full: can(user, 'students') };
  },

  async saveStudent(b, user, ck) {
    requireRight(user, 'diets');
    const input = b.student || {};
    if (!can(user, 'students')) {
      if (!input.id) throw new HttpError(403, 'Dijake dodajajo vzgojitelji');
      input.dietOnly = true;
    }
    const saved = await saveStudent(ck, input, user.id);
    await audit(user, input.id ? 'student.update' : 'student.create', `${saved.first_name} ${saved.last_name}${input.dietOnly ? ' (prehrana)' : ''}`);
    return { student: pick(saved, studentView(user)) };
  },

  // { rows: [{ext_id, first_name, last_name, group_name, room, diet, left}], dryRun }
  // A student is found by ext_id, else by full name; empty cells never overwrite what is already stored.
  // left = moved out (izstop in the past): an existing student is marked as moved out, a new one is skipped.
  async importStudents(b, user, ck) {
    requireRight(user, 'students');
    if (!Array.isArray(b.rows) || b.rows.length > 1000) throw new HttpError(400, 'Neveljaven uvoz');
    const { rows: all } = await getPool().query('select * from students');
    const key = (f, l) => `${f} ${l}`.toLocaleLowerCase('sl').replace(/\s+/g, ' ').trim();
    const byExt = new Map(all.filter(s => s.ext_id).map(s => [s.ext_id, s]));
    const byName = new Map();
    for (const s of all) { const k = key(s.first_name, s.last_name); byName.set(k, byName.has(k) ? null : s); }
    const plan = { create: [], update: [], moveOut: [], same: 0, skipped: 0 };
    const seen = new Set();
    for (const raw of b.rows) {
      const r = {};
      for (const k of ['ext_id', 'first_name', 'last_name', 'group_name', 'room', 'diet']) r[k] = String(raw[k] ?? '').trim();
      if (!r.first_name || !r.last_name) { plan.skipped++; continue; }
      const old = (r.ext_id && byExt.get(r.ext_id)) || byName.get(key(r.first_name, r.last_name));
      if (old && seen.has(old.id)) { plan.skipped++; continue; }
      if (!old) {
        if (raw.left) plan.skipped++;
        else plan.create.push(r);
        continue;
      }
      seen.add(old.id);
      const next = { ...old };
      for (const [k, v] of Object.entries(r)) if (v) next[k] = v;
      if (raw.left && old.active) next.active = false;
      const changed = ['ext_id', 'first_name', 'last_name', 'group_name', 'room', 'diet', 'active'].some(k => next[k] !== old[k]);
      if (!changed) plan.same++;
      else (next.active ? plan.update : plan.moveOut).push(next);
    }
    const summary = {
      create: plan.create.length, update: plan.update.length, moveOut: plan.moveOut.length, same: plan.same, skipped: plan.skipped,
    };
    if (b.dryRun) return { summary, moveOutNames: plan.moveOut.map(s => `${s.first_name} ${s.last_name}`) };
    for (const r of plan.create) await saveStudent(ck, r, user.id);
    for (const s of [...plan.update, ...plan.moveOut]) await saveStudent(ck, s, user.id);
    await audit(user, 'student.import',
      `novih ${summary.create}, posodobljenih ${summary.update}, izseljenih ${summary.moveOut}`);
    return { summary };
  },

  // Standing weekday exception for many students at once, e.g. no meals on Fridays or a dry lunch every Wednesday:
  // { student_ids, day: 1–5, meals: ['B','L','D'], variant } — variant 'dry' keeps a vegetarian student vegetarian,
  // '' removes the exception. Future days nobody changed by hand follow it to the end of the school year.
  async setWeekly(b, user, ck) {
    requireRight(user, 'students');
    const ids = (b.student_ids || []).map(Number).filter(Boolean);
    const day = Number(b.day);
    const meals = MEALS.filter(m => (b.meals || []).includes(m) && !(day === 5 && m === 'D'));
    const variant = String(b.variant || '');
    if (!ids.length || ids.length > 500) throw new HttpError(400, 'Izberite dijake');
    if (!(day >= 1 && day <= 5) || !meals.length) throw new HttpError(400, 'Izberite dan in obrok');
    if (variant && variant !== 'dry' && !meals.every(m => validVariant(m, variant))) throw new HttpError(400, 'Ta izbira ni mogoča za izbrani obrok');
    if (variant === 'dry' && meals.includes('B')) throw new HttpError(400, 'Suhi obrok je mogoč le pri kosilu in večerji');
    const { rows: students } = await getPool().query('select * from students where id = any($1::int[]) and active', [ids]);
    const vegetarian = v => ['veg', 'dry_veg', 'late_veg'].includes(v);
    let changed = 0;
    for (const s of students) {
      const weekly = structuredClone(s.weekly || {});
      const days = (weekly[day] ||= {});
      for (const m of meals) {
        if (!variant) delete days[m];
        else days[m] = variant === 'dry' ? (vegetarian(s[DEF_COL[m]]) ? 'dry_veg' : 'dry_normal') : variant;
      }
      if (!Object.keys(days).length) delete weekly[day];
      if (JSON.stringify(weekly) === JSON.stringify(s.weekly || {})) continue;
      await saveStudent(ck, { ...s, weekly }, user.id);
      changed++;
    }
    const DAY_NAMES = ['', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek'];
    const what = !variant ? 'brez izjeme' : variant === 'dry' ? 'suh obrok' : variant;
    await audit(user, 'student.weekly', `${DAY_NAMES[day]} ${meals.join('+')}: ${what}, dijakov ${changed}`);
    return { changed, total: students.length };
  },

  async studentLog(b, user) {
    requireRight(user, 'orders');
    const { rows } = await getPool().query(`
      select l.day, l.meal, l.old_variant, l.new_variant, l.at, u.name as user_name, u.role as user_role
      from order_log l left join users u on u.id = l.user_id
      where l.student_id = $1 order by l.at desc limit 200`, [b.student_id]);
    return { log: rows };
  },

  // Creates logins or issues new temporary passwords: { student_ids } -> sheets to print
  async studentLogins(b, user) {
    requireRight(user, 'students');
    const ids = (b.student_ids || []).map(Number).filter(Boolean);
    if (!ids.length || ids.length > 300) throw new HttpError(400, 'Izberite dijake');
    const { rows: students } = await getPool().query(
      'select * from students where id = any($1::int[]) and active order by group_name, last_name, first_name', [ids]);
    const sheets = [];
    for (const s of students) sheets.push(await issueStudentLogin(s));
    await audit(user, 'student.password', sheets.map(x => x.username).join(', '));
    return { sheets };
  },

  // ------------------------------------------------ student self-service

  async myWeek(b, user, ck) {
    requireStudent(user);
    const days = daysBetween(b.from, addDays(b.from, 4));
    await horizon(ck);
    await materialize(ck, days[4]);
    const db = getPool();
    const { rows: orders } = await db.query(
      `select day, meal::text as meal, variant, source from orders where student_id = $1 and day between $2 and $3`,
      [user.student_id, days[0], days[4]]);
    return {
      days, orders,
      menu: await menuRows(days[0], days[4]),
      closed: await closedSet(days[0], days[4]),
      absences: await absencesOf(user.student_id, addDays(ck.today, -14)),
      clock: publicClock(ck),
    };
  },

  // { day, meal, variant } — only the variants the meal planner offers to students, only before the deadline
  async mySetOrder(b, user, ck) {
    requireStudent(user);
    const allowed = studentChoices(ck)[b.meal] || [];
    if (b.variant !== 'none' && b.variant !== 'default' && !allowed.includes(b.variant)) {
      throw new HttpError(400, 'Te vrste obroka ni mogoče izbrati');
    }
    if (!studentCanCancel(ck)) {
      if (b.variant === 'none') throw new HttpError(403, 'Odjavo od obroka uredi vzgojitelj');
      // A meal the staff deregistered stays deregistered; the student can't sign up for it alone
      const { rows: cur } = await getPool().query(
        'select variant from orders where student_id = $1 and day = $2 and meal = $3', [user.student_id, b.day, b.meal]);
      if ((cur[0]?.variant || 'none') === 'none') throw new HttpError(403, 'Za ta obrok nisi prijavljen. Prijavo uredi vzgojitelj.');
      if (b.variant === 'default') {
        const { rows: st } = await getPool().query('select * from students where id = $1', [user.student_id]);
        if (defaultVariant(st[0], b.day, b.meal) === 'none') throw new HttpError(403, 'Odjavo od obroka uredi vzgojitelj');
      }
    }
    const { rows: away } = await getPool().query(
      'select 1 from absences where student_id = $1 and $2::date between day_from and day_to', [user.student_id, b.day]);
    if (away.length) throw new HttpError(400, 'Ta dan imaš prijavljeno odsotnost. Najprej jo prekliči.');
    const r = await applyChanges(ck, [{ student_id: user.student_id, day: b.day, meal: b.meal, variant: b.variant }], user.id);
    if (!r.saved) {
      const why = r.skipped.locked ? 'Rok za spremembe za ta dan je potekel'
        : r.skipped.closed ? 'Ta dan je kuhinja zaprta' : 'Sprememba ni mogoča';
      throw new HttpError(400, why);
    }
    return r;
  },

  async myAbsence(b, user, ck) {
    requireStudent(user);
    if (!studentCanCancel(ck)) throw new HttpError(403, 'Odsotnost sporoči vzgojitelju');
    return { absence: await addAbsence(ck, user.student_id, b, user) };
  },

  async myCancelAbsence(b, user, ck) {
    requireStudent(user);
    if (!studentCanCancel(ck)) throw new HttpError(403, 'Preklic odsotnosti uredi z vzgojiteljem');
    const { rows } = await getPool().query('select * from absences where id = $1 and student_id = $2', [b.id, user.student_id]);
    if (!rows[0]) throw new HttpError(400, 'Odsotnosti ni mogoče najti');
    if (rows[0].created_by !== user.id) throw new HttpError(403, 'To odsotnost je vpisal vzgojitelj; preklic uredi z njim');
    await cancelAbsence(ck, rows[0], user);
    return { ok: true };
  },

  // ------------------------------------------------ kitchen and menu

  async kitchenDay(b, user, ck) {
    requireRight(user, 'kitchen');
    return { ...(await kitchenDay(ck, b.day)), times: mealTimes(ck) };
  },

  async kitchenWeek(b, user, ck) {
    requireRight(user, 'kitchen');
    return kitchenWeek(ck, b.from);
  },

  // Menu for Mon–Fri starting at { from }; students see it too
  async menuWeek(b, user) {
    if (!user) throw new HttpError(401, 'Prosimo, prijavite se');
    if (user.role !== 'student') requireRight(user, 'viewMenu');
    const days = daysBetween(b.from, addDays(b.from, 4));
    return { days, items: await menuRows(days[0], days[4]), closed: await closedSet(days[0], days[4]) };
  },

  // { items: [{ day, meal, variant, dish }] } — an empty dish removes the entry
  async saveMenu(b, user) {
    requireRight(user, 'menu');
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
    requireRight(user, 'menu');
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
    await audit(user, 'menu.copy', `${b.from} → ${targets.length} tednov`);
    return { weeks: targets.length };
  },

  // ------------------------------------------------ accounts

  async users(b, user) {
    requireRight(user, 'users');
    const { rows } = await getPool().query(`
      select u.id, u.username, u.name, u.role, u.active, u.perms, u.groups, u.must_change, u.last_login, u.created_at, s.group_name
      from users u left join students s on s.id = u.student_id
      order by u.role = 'student', u.role, u.name`);
    const { rows: groups } = await getPool().query(
      `select distinct group_name from students where active and group_name <> '' order by group_name`);
    return { users: rows, extraRights: EXTRA_RIGHTS, groups: groups.map(g => g.group_name) };
  },

  // Staff accounts. Only an administrator can create or change administrators.
  async saveUser(b, user) {
    requireRight(user, 'users');
    const u = b.user || {};
    const db = getPool();
    const { rows: before } = u.id ? await db.query('select * from users where id = $1', [u.id]) : { rows: [] };
    const old = before[0];
    if (u.id && !old) throw new HttpError(400, 'Računa ni mogoče najti');
    const isAdmin = user.role === 'admin';
    if (!isAdmin && (u.role === 'admin' || old?.role === 'admin')) throw new HttpError(403, 'Skrbniške račune ureja samo skrbnik');

    if (old?.role === 'student') {
      // Student logins: only locking/unlocking here; the rest follows the student record
      await db.query('update users set active = $2 where id = $1', [old.id, u.active !== false]);
      if (old.active !== (u.active !== false)) await audit(user, u.active !== false ? 'user.unlock' : 'user.lock', old.username);
      return { ok: true };
    }

    const username = cleanUsername(u.username);
    const name = String(u.name || '').trim();
    if (!name) throw new HttpError(400, 'Ime je obvezno');
    if (!STAFF_ROLES.includes(u.role)) throw new HttpError(400, 'Neveljavna vloga');
    if (u.password && String(u.password).length < 8) throw new HttpError(400, 'Geslo mora imeti vsaj 8 znakov');
    const perms = (Array.isArray(u.perms) ? u.perms : []).filter(p => EXTRA_RIGHTS.includes(p) && !RIGHTS[p].includes(u.role));
    const groups = u.role === 'teacher'
      ? [...new Set((Array.isArray(u.groups) ? u.groups : []).map(g => String(g).trim()).filter(Boolean))].slice(0, 20)
      : [];
    const active = u.active !== false;
    if (old && old.id === user.id && (u.role !== old.role || !active)) throw new HttpError(400, 'Svoje vloge ali zaklepanja ne morete spremeniti sami');
    try {
      if (!old) {
        if (!u.password) throw new HttpError(400, 'Geslo je obvezno');
        await db.query('insert into users (username, name, role, pw_hash, perms, groups, must_change) values ($1,$2,$3,$4,$5,$6,true)',
          [username, name, u.role, hashPassword(u.password), perms, groups]);
        await audit(user, 'user.create', `${username} (${u.role}${groups.length ? ', skupine ' + groups.join(', ') : ''})`);
      } else {
        await db.query('update users set username=$2, name=$3, role=$4, active=$5, perms=$6, groups=$7 where id=$1',
          [old.id, username, name, u.role, active, perms, groups]);
        const changes = [];
        if (old.role !== u.role) changes.push(`vloga ${old.role} → ${u.role}`);
        if (old.active !== active) changes.push(active ? 'odklenjen' : 'zaklenjen');
        if ((old.perms || []).join() !== perms.join()) changes.push(`dodatne pravice: ${perms.join(', ') || '—'}`);
        if ((old.groups || []).join() !== groups.join()) changes.push(`skupine: ${groups.join(', ') || '—'}`);
        if (u.password) {
          await db.query('update users set pw_hash=$2, must_change=true where id=$1', [old.id, hashPassword(u.password)]);
          changes.push('novo geslo');
        }
        await audit(user, 'user.update', `${username}${changes.length ? ': ' + changes.join('; ') : ''}`);
      }
    } catch (err) {
      if (err.code === '23505') throw new HttpError(400, 'To uporabniško ime je že zasedeno');
      throw err;
    }
    return { ok: true };
  },

  async auditLog(b, user) {
    requireRight(user, 'audit');
    const { rows } = await getPool().query(`
      select a.at, a.action, a.details, u.name as user_name, u.role as user_role
      from audit_log a left join users u on u.id = a.user_id order by a.at desc limit 300`);
    return { log: rows };
  },

  // ------------------------------------------------ settings

  async settings(b, user, ck) {
    if (!can(user, 'mealSettings') && !can(user, 'system')) requireRight(user, 'mealSettings');
    const { rows: closed } = await getPool().query('select day, reason from closed_days where day >= $1 order by day', [addDays(ck.today, -30)]);
    return {
      timezone: ck.timezone, cutoff_hour: ck.cutoffHour, closed,
      school_year_start: yearStart(ck), school_year_end: yearEnd(ck),
      student_choices: studentChoices(ck), meal_times: mealTimes(ck), student_can_cancel: studentCanCancel(ck),
    };
  },

  // Meal organisation: school year, what students may choose, serving times
  async saveMealSettings(b, user, ck) {
    requireRight(user, 'mealSettings');
    const start = b.school_year_start || '';
    const end = b.school_year_end || '';
    if ((start && !isDate(start)) || (end && !isDate(end))) throw new HttpError(400, 'Neveljaven datum');
    if (start && end && start > end) throw new HttpError(400, 'Začetek šolskega leta mora biti pred koncem');
    if (end && end > addDays(ck.today, MAX_RANGE_DAYS)) throw new HttpError(400, 'Konec šolskega leta je predaleč v prihodnosti');
    const choices = Object.fromEntries(MEALS.map(m => [m, VARIANTS[m].filter(v => (b.student_choices?.[m] || []).includes(v))]));
    const times = Object.fromEntries(['B', 'L', 'D', 'late', 'dry'].map(k => [k, String(b.meal_times?.[k] || '').trim().slice(0, 80)]));
    await setSetting('school_year_start', start);
    await setSetting('school_year_end', end);
    await setSetting('student_choices', JSON.stringify(choices));
    await setSetting('meal_times', JSON.stringify(times));
    await setSetting('student_can_cancel', b.student_can_cancel ? '1' : '');
    await audit(user, 'settings.meals', `šolsko leto ${start || '—'} – ${end || '—'}, odjava dijakov ${b.student_can_cancel ? 'dovoljena' : 'ni dovoljena'}`);
    // Plan the whole school year right away so every screen shows it
    Object.assign(ck.settings, { school_year_start: start, school_year_end: end });
    await horizon(ck);
    return { ok: true, planned_through: ck.settings.materialized_through };
  },

  // House rules: the order deadline and the time zone
  async saveSystemSettings(b, user) {
    requireRight(user, 'system');
    try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }); } catch { throw new HttpError(400, 'Neznan časovni pas'); }
    const hour = Number(b.cutoff_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'Ura roka mora biti med 0 in 23');
    await setSetting('timezone', b.timezone);
    await setSetting('cutoff_hour', hour);
    await audit(user, 'settings.system', `rok ${hour}.00, časovni pas ${b.timezone}`);
    return { ok: true };
  },

  // { day, to?, reason } closes one day or every weekday of a range (holidays); { day, remove: true } reopens it
  async setClosedDay(b, user) {
    requireRight(user, 'mealSettings');
    if (!isDate(b.day)) throw new HttpError(400, 'Neveljaven datum');
    if (b.remove) {
      await getPool().query('delete from closed_days where day = $1', [b.day]);
      await audit(user, 'closed.remove', b.day);
      return { ok: true };
    }
    const days = daysBetween(b.day, isDate(b.to) ? b.to : b.day).filter(d => mealServed(d, 'B'));
    await getPool().query(`
      insert into closed_days (day, reason) select unnest($1::date[]), $2
      on conflict (day) do update set reason = excluded.reason`, [days, String(b.reason || '').trim()]);
    await audit(user, 'closed.add', `${b.day}${b.to && b.to !== b.day ? ' – ' + b.to : ''} ${String(b.reason || '').trim()}`);
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
    // A temporary password must be replaced before anything else
    if (user?.must_change && !['me', 'changePassword'].includes(body.action)) throw new HttpError(403, 'Najprej si nastavite svoje geslo');
    return json(await fn(body, user, ck));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Napaka na strežniku' }, 500);
  }
};
