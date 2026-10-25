import crypto from 'node:crypto';
import pg from 'pg';

// Return DATE columns as plain 'YYYY-MM-DD' strings
pg.types.setTypeParser(1082, v => v);

let pool;
let ready;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', err => console.error('[pg] idle connection dropped:', err.message));
  }
  return pool;
}

const SCHEMA = `
create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists users (
  id serial primary key,
  username text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'teacher', 'kitchen')),
  pw_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists students (
  id serial primary key,
  first_name text not null,
  last_name text not null,
  group_name text not null default '',
  room text not null default '',
  diet text not null default '',
  notes text not null default '',
  def_b text not null default 'normal',
  def_l text not null default 'normal',
  def_d text not null default 'normal',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per student, day and meal. variant 'none' = deregistered.
-- source 'default' rows follow the student's default menu; 'manual' rows were set by a person.
create table if not exists orders (
  student_id int not null references students(id) on delete cascade,
  day date not null,
  meal char(1) not null check (meal in ('B', 'L', 'D')),
  variant text not null,
  source text not null default 'default',
  updated_by int references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_id, day, meal)
);
create index if not exists orders_day_idx on orders(day);

create table if not exists order_log (
  id bigserial primary key,
  student_id int not null references students(id) on delete cascade,
  day date not null,
  meal char(1) not null,
  old_variant text,
  new_variant text not null,
  user_id int references users(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists order_log_student_idx on order_log(student_id, at desc);

create table if not exists closed_days (
  day date primary key,
  reason text not null default ''
);
`;

const DEFAULT_SETTINGS = {
  timezone: 'Europe/Ljubljana',
  cutoff_hour: '18',
  materialized_through: '',
};

export async function init() {
  if (!ready) {
    ready = (async () => {
      const db = getPool();
      await db.query(SCHEMA);
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.query('insert into settings(key, value) values ($1, $2) on conflict do nothing', [key, value]);
      }
      await db.query('insert into settings(key, value) values ($1, $2) on conflict do nothing',
        ['secret', crypto.randomBytes(32).toString('hex')]);
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

export async function getSettings() {
  const { rows } = await getPool().query('select key, value from settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function setSetting(key, value) {
  await getPool().query(
    'insert into settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value',
    [key, String(value)]
  );
}
