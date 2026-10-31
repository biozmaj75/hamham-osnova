// "npm run admin": on a new install creates the first administrator; later sets a new password for any user
// (when the administrator has forgotten theirs).
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import './env.mjs';
const { init, getPool } = await import('../functions/api/db.mjs');
const { hashPassword } = await import('../functions/api/auth.mjs');

const rl = readline.createInterface({ input: stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(q) {
  stdout.write(q);
  const r = await lines.next();
  if (r.done) throw new Error('vnos je prekinjen');
  return r.value;
}
async function password() {
  for (;;) {
    const p = await ask('Geslo (vsaj 8 znakov): ');
    if (p.length >= 8) return p;
    console.log('Geslo je prekratko.');
  }
}

try {
  await init();
  const db = getPool();
  const { rows } = await db.query('select count(*)::int as n from users');
  if (rows[0].n === 0) {
    console.log('Baza je prazna – ustvarimo prvega administratorja.');
    const username = (await ask('Uporabniško ime (npr. admin): ')).trim().toLowerCase() || 'admin';
    const name = (await ask('Ime in priimek: ')).trim() || 'Administrator';
    await db.query('insert into users (username, name, role, pw_hash) values ($1, $2, $3, $4)',
      [username, name, 'admin', hashPassword(await password())]);
    console.log(`Administrator »${username}« je ustvarjen. Odprite aplikacijo in se prijavite.`);
  } else {
    console.log('Nastavitev novega gesla za obstoječega uporabnika.');
    const username = (await ask('Uporabniško ime: ')).trim().toLowerCase();
    const r = await db.query('update users set pw_hash = $2, must_change = false, active = true where username = $1 returning name',
      [username, hashPassword(await password())]);
    console.log(r.rowCount ? `Geslo za ${r.rows[0].name} je nastavljeno.` : `Uporabnika »${username}« ni.`);
  }
} catch (err) {
  console.error('Napaka:', err.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await getPool().end().catch(() => {});
}
