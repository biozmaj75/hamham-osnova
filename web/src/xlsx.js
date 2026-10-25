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
