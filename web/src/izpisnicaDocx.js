// Fills the home's own "Izpisnica" Word form (izpisnica.docx). The template was made from their file by
// replacing the blank lines with markers: {{key|N}} a blank of N underscores, {{g|male|female|both}}
// a gendered word, {{key:da}} / {{key:ne}} the yes/no answers of the closing checklist.
import templateUrl from './izpisnica.docx?url';
import { unzip, zip } from './xlsx.js';

const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CHECKS = [
  ['keys', 'Vrnil_a vse zadolžene ključe'],
  ['linen', 'Vrnil_a posteljnino'],
  ['damage', 'Poravnal_a morebitno namerno povzročeno škodo'],
];

// values: { sex: 'M' | 'Z' | '', name, birth_date, …, keys: 'da' | 'ne' | '' }
export async function izpisnicaDocx(values) {
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Predloge izpisnice ni mogoče naložiti');
  const read = await unzip(await res.arrayBuffer());
  const files = [];
  for (const name of read.names) {
    let text = await read(name);
    if (name === 'word/document.xml') {
      text = text
        .replace(/\{\{g\|([^|}]*)\|([^|}]*)\|([^|}]*)\}\}/g, (_, m, f, both) => (values.sex === 'M' ? m : values.sex === 'Z' ? f : both))
        .replace(/\{\{(\w+):(da|ne)\}\}/g, (_, k, answer) => `${values[k] === answer ? '☒' : '☐'} ${answer}`)
        .replace(/\{\{(\w+)\|(\d+)\}\}/g, (_, k, n) => {
          const v = String(values[k] ?? '').trim();
          return v ? ` ${esc(v)} ` : '_'.repeat(Number(n));
        });
    }
    files.push([name, text]);
  }
  return zip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
