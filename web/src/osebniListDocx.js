// Builds the home's "Osebni list" (landscape A4, one page) from their Word form (osebni-list.docx).
// The template keeps their header, footer, logo and title; the tables are generated here as ordinary
// (not floating) tables so longer entries push the rows down instead of overlapping, and the sizes are
// chosen so that a fully filled form still fits on one page.
import templateUrl from './osebni-list.docx?url';
import { unzip, zip } from './xlsx.js';

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = '<w:rFonts w:ascii="Rallway" w:hAnsi="Rallway" w:cs="Rallway"/>';
const SIZE = 18; // 9 pt
const GREY = 'D9D9D9';

function run(text, { bold, size = SIZE } = {}) {
  return `<w:r><w:rPr>${FONT}${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="sl-SI"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
const para = (text, opts = {}) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${opts.center ? '<w:jc w:val="center"/>' : ''}</w:pPr>${text ? run(text, opts) : ''}</w:p>`;

function cell(text, width, { fill, span, bold, center, size } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}`
    + `${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
    + `${String(text ?? '').split('\n').map(t => para(t, { bold, center, size })).join('')}</w:tc>`;
}
const row = (cells, height = 250) => `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>${cells.join('')}</w:tr>`;

function table(widths, rows, { borders = true } = {}) {
  const b = borders ? 'single' : 'nil';
  const edge = side => `<w:${side} w:val="${b}" w:sz="4" w:space="0" w:color="000000"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, x) => a + x, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge).join('')}</w:tblBorders>`
    + `<w:tblCellMar><w:top w:w="15" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="15" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

// Label/value pairs under a grey heading; a [title] entry is a grey sub-heading (Mati, Oče …)
function pairs(title, items, labelW, valueW) {
  const w = labelW + valueW;
  return table([labelW, valueW], [
    row([cell(title, w, { fill: GREY, span: 2, bold: true, size: 20 })], 300),
    ...items.map(it => (Array.isArray(it)
      ? row([cell(it[0], w, { fill: 'F2F2F2', span: 2, bold: true })])
      : row([cell(it.label, labelW), cell(it.value, valueW)]))),
  ]);
}

// The placement block is a single column: the label on one line, the value on the next
function stacked(title, items, w) {
  return table([w], [
    row([cell(title, w, { fill: GREY, bold: true, size: 20 })], 300),
    ...items.flatMap(it => [row([cell(it.label, w, { fill: 'F2F2F2' })]), row([cell(it.value, w)], 330)]),
  ]);
}

// v: { list_no, contract, admitted, left_on, left_reason, first_name, last_name, sex, emso, birth_date, birth_place,
//      birth_municipality, birth_country, citizenship, address, post, municipality, country,
//      mother: {first,last,address,post}, father: {…}, guardian: {…}, years: [{year, school, program, grade, group, activities, awards, signed}] }
export async function osebniListDocx(v) {
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Predloge osebnega lista ni mogoče naložiti');
  const read = await unzip(await res.arrayBuffer());

  // Usable width 15505 twips: three blocks with two gaps
  const COLS = [3500, 250, 5300, 250, 6205];
  const placement = stacked('Podatki o nastanitvi', [
    { label: 'Št. osebnega lista:', value: v.list_no },
    { label: 'Sklenitev pogodbe:', value: v.contract },
    { label: 'Datum sprejema:', value: v.admitted },
    { label: 'Datum izstopa:', value: v.left_on },
    { label: 'Razlog izstopa:', value: v.left_reason },
  ], COLS[0]);
  const student = pairs('Podatki o dijaku/dijakinji', [
    ['Ime', v.first_name], ['Priimek', v.last_name], ['Spol', v.sex], ['EMŠO', v.emso],
    ['Datum rojstva', v.birth_date], ['Kraj rojstva', v.birth_place], ['Občina rojstva', v.birth_municipality],
    ['Država rojstva', v.birth_country], ['Državljanstvo', v.citizenship], ['Naslov', v.address],
    ['Pošta', v.post], ['Občina', v.municipality], ['Država', v.country],
  ].map(([label, value]) => ({ label, value })), 1750, COLS[2] - 1750);
  const person = p => [
    { label: 'Ime', value: p.first }, { label: 'Priimek', value: p.last },
    { label: 'Naslov', value: p.address }, { label: 'Pošta', value: p.post },
  ];
  const parents = pairs('Podatki o starših oziroma skrbnikih', [
    ['Mati'], ...person(v.mother), ['Oče'], ...person(v.father), ['Skrbnik'], ...person(v.guardian),
  ], 1500, COLS[4] - 1500);

  const blank = w => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para('')}</w:tc>`;
  const layout = table(COLS, [
    `<w:tr>${[placement, null, student, null, parents].map((t, i) => (t
      ? `<w:tc><w:tcPr><w:tcW w:w="${COLS[i]}" w:type="dxa"/></w:tcPr>${t}${para('', { size: 2 })}</w:tc>` : blank(COLS[i]))).join('')}</w:tr>`,
  ], { borders: false });

  // Six school years side by side
  const LABEL_W = 2503;
  const YEAR_W = 2167;
  const yearRow = (label, key, height, opts) => row([cell(label, LABEL_W, { bold: true }), ...v.years.map(y => cell(y[key], YEAR_W, opts))], height);
  const years = table([LABEL_W, ...v.years.map(() => YEAR_W)], [
    row([cell('Podatki o bivanju in izobraževanju dijaka/dijakinje v dijaškem domu', LABEL_W + YEAR_W * v.years.length, { fill: GREY, span: v.years.length + 1, bold: true, size: 20 })], 300),
    row([cell('Šolsko leto', LABEL_W, { bold: true, fill: 'F2F2F2' }), ...v.years.map(y => cell(y.year, YEAR_W, { bold: true, center: true, fill: 'F2F2F2' }))]),
    yearRow('Šola', 'school', 420),
    yearRow('Program', 'program', 420),
    yearRow('Letnik', 'grade', 250, { center: true }),
    yearRow('Vzgojna skupina', 'group', 250, { center: true }),
    yearRow('Interesne dejavnosti v dijaškem domu', 'activities', 560),
    yearRow('Pohvale, nagrade in priznanja', 'awards', 560),
    yearRow('Datum in podpis vzgojitelja', 'signed', 620),
  ]);

  const body = layout + para('', { size: 12 }) + years;
  const files = [];
  for (const name of read.names) {
    const binary = !/\.(xml|rels)$/.test(name);
    let data = await read(name, binary);
    if (name === 'word/document.xml') data = data.replace('{{BODY}}', body);
    files.push([name, data]);
  }
  return zip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
