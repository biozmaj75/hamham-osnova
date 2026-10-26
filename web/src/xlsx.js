// Minimal .xlsx reader (no library): first worksheet -> array of rows, each an array of cell values.
// An .xlsx file is a zip of XML parts; entries are inflated with the browser's DecompressionStream.

async function unzip(buffer) {
  const view = new DataView(buffer);
  // End of central directory record: last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Datoteka ni v obliki .xlsx');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + view.getUint16(f.local + 26, true) + view.getUint16(f.local + 28, true);
    const raw = new Uint8Array(buffer, start, f.size);
    if (f.method === 0) return dec.decode(raw);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

// "AB12" -> 27
function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export async function readXlsx(file) {
  const buffer = await file.arrayBuffer();
  if (new Uint8Array(buffer, 0, 2).join() !== '80,75') {
    throw new Error('To ni datoteka .xlsx. V Excelu jo shranite kot »Excelov delovni zvezek (.xlsx)«.');
  }
  const read = await unzip(buffer);

  // First sheet of the workbook, through the workbook relationships
  const wb = xml(await read('xl/workbook.xml'));
  const firstSheet = byTag(wb, 'sheet')[0];
  const rid = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  let path = 'xl/worksheets/sheet1.xml';
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    const rel = byTag(xml(rels), 'Relationship').find(r => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }

  const sstText = await read('xl/sharedStrings.xml');
  const strings = sstText ? byTag(xml(sstText), 'si').map(si => byTag(si, 't').map(t => t.textContent).join('')) : [];

  const sheetText = await read(path);
  if (!sheetText) throw new Error('V datoteki ni mogoče najti delovnega lista');
  const rows = [];
  for (const row of byTag(xml(sheetText), 'row')) {
    const out = [];
    for (const c of byTag(row, 'c')) {
      const t = c.getAttribute('t');
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      let value;
      if (t === 's') value = strings[Number(v)] ?? '';
      else if (t === 'inlineStr') value = byTag(c, 't').map(x => x.textContent).join('');
      else if (t === 'str' || t === 'e') value = v;
      else if (t === 'b') value = v === '1';
      else value = v === '' ? '' : Number(v);
      out[colIndex(c.getAttribute('r') || '')] = value;
    }
    rows[Number(row.getAttribute('r')) - 1] = out;
  }
  return Array.from(rows, r => Array.from(r || [], v => v ?? ''));
}

// Excel stores dates as days since 1899-12-30; text dates are usually "d. m. yyyy"
export function excelDate(value) {
  if (typeof value === 'number' && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const m = String(value).trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(value).trim().match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : '';
}

// ------------------------------------------------------------ writer

// Minimal .xlsx writer (no library). sheets: [{ name, rows: [[cell]], widths: [chars], freeze: rows }]
// A cell is a string, a number, null, { date: 'yyyy-mm-dd' } or { v, bold: true }.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Stored (uncompressed) zip
function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    parts.push(head, nameBytes, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const serial = iso => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

// Style ids in styles.xml: 0 plain, 1 bold, 2 date, 3 bold date
function cellXml(cell, ref) {
  if (cell === null || cell === undefined || cell === '') return '';
  const obj = typeof cell === 'object' ? cell : { v: cell };
  const bold = obj.bold ? 1 : 0;
  if (obj.date) return `<c r="${ref}" s="${2 + bold}"><v>${serial(obj.date)}</v></c>`;
  if (typeof obj.v === 'number') return `<c r="${ref}"${bold ? ' s="1"' : ''}><v>${obj.v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(obj.v)}</t></is></c>`;
}

function sheetXml({ rows, widths = [], freeze = 0 }) {
  const pane = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const data = rows.map((r, y) => `<row r="${y + 1}">${r.map((c, x) => cellXml(c, `${colName(x)}${y + 1}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${data}</sheetData></worksheet>`;
}

export function writeXlsx(sheets) {
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="d\\.\\ m\\.\\ yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files);
}
