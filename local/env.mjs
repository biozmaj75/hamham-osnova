// Reads local/nastavitve.env; its values win over variables already set on the computer (e.g. a PORT used by something else)
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nastavitve.env');
if (!fs.existsSync(file)) {
  console.error('Manjka datoteka local/nastavitve.env – kopirajte nastavitve.env.primer in jo uredite (Kakoinstaliram.pdf).');
  process.exit(1);
}
Object.assign(process.env, parseEnv(fs.readFileSync(file, 'utf8')));
if (!process.env.DATABASE_URL) {
  console.error('V local/nastavitve.env manjka DATABASE_URL.');
  process.exit(1);
}
