// Minimal PDF writer for printable login slips (no library): A4, three slips per page, built-in fonts.
// Built-in fonts use WinAnsi; the Slovenian/Croatian letters outside it are mapped to bytes 128–137.

const EXTRA = { Č: 128, č: 129, Š: 130, š: 131, Ž: 132, ž: 133, Ć: 134, ć: 135, Đ: 136, đ: 137 };
const DIFFERENCES = '[128 /Ccaron /ccaron /Scaron /scaron /Zcaron /zcaron /Cacute /cacute /Dcroat /dcroat]';

function encode(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = EXTRA[ch] ?? ch.codePointAt(0);
    const c = code > 255 || (code > 127 && code < 160 && !(ch in EXTRA)) ? 63 : code; // '?' for anything else
    out += c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : String.fromCharCode(c);
  }
  return out;
}

const FONT = { regular: 'F1', bold: 'F2', mono: 'F3' };

function text(x, y, size, font, value) {
  return `BT /${FONT[font]} ${size} Tf ${x} ${y} Td (${encode(value)}) Tj ET\n`;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PER_PAGE = 3;
const SLIP_H = PAGE_H / PER_PAGE;

function slip(s, i, meta) {
  const top = PAGE_H - i * SLIP_H;
  const x = 56;
  let c = '';
  c += text(x, top - 52, 9, 'regular', meta.home.toUpperCase());
  c += text(x, top - 72, 16, 'bold', 'Dostop do prijave na obroke');
  c += text(x, top - 98, 13, 'regular', `${s.name}${s.group_name ? ', ' + s.group_name : ''}`);
  c += text(x, top - 128, 9, 'regular', 'Spletni naslov');
  c += text(x + 110, top - 128, 11, 'bold', meta.url);
  c += text(x, top - 154, 9, 'regular', 'Uporabniško ime');
  c += text(x + 110, top - 155, 15, 'mono', s.username);
  c += text(x, top - 180, 9, 'regular', 'Začasno geslo');
  c += text(x + 110, top - 181, 15, 'mono', s.password);
  // box around the credentials
  c += `0.6 w 0.75 G ${x - 8} ${top - 192} ${PAGE_W - 2 * x + 16} 80 re S 0 G\n`;
  c += text(x, top - 212, 9.5, 'regular', 'Ob prvi prijavi si boste morali izbrati svoje geslo. Začasno geslo potem ne velja več.');
  c += text(x, top - 226, 9.5, 'regular', 'Listka ne dajajte drugim. Če geslo pozabite, vam vzgojitelj izda novo.');
  c += text(x, top - 250, 7.5, 'regular', `Izdano ${meta.date}${meta.issuer ? ', ' + meta.issuer : ''}`);
  if (i < PER_PAGE - 1) {
    const y = (top - SLIP_H).toFixed(2);
    c += `q 0.5 w 0.6 G [5 4] 0 d 28 ${y} m ${PAGE_W - 28} ${y} l S Q\n`;
    c += `q 0.6 g ${text(PAGE_W - 76, Number(y) + 3, 6.5, 'regular', 'odrežite')}Q\n`;
  }
  return c;
}

// sheets: [{ name, group_name, username, password }]; meta: { home, url, date, issuer }
export function loginSlipsPdf(sheets, meta) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };

  const catalogId = add(null);
  const pagesId = add(null);
  const enc = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${DIFFERENCES} >>`;
  const fonts = {
    F1: add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${enc} >>`),
    F2: add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${enc} >>`),
    F3: add(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding ${enc} >>`),
  };
  const fontRes = `<< ${Object.entries(fonts).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >>`;

  const pageIds = [];
  for (let p = 0; p < Math.max(1, Math.ceil(sheets.length / PER_PAGE)); p++) {
    const content = sheets.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE).map((s, i) => slip(s, i, meta)).join('');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontRes} >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Every character is a single byte, so string length equals byte offset
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

// Shows the PDF in a tab opened beforehand (window.open must run in the click itself, before any await),
// or downloads it when the browser blocked the tab. Returns the object URL for "open again" links.
export function openPdf(blob, filename, win) {
  const url = URL.createObjectURL(blob);
  if (win && !win.closed) win.location.href = url;
  else downloadBlob(blob, filename);
  return url;
}

// A tab for a PDF that is still being prepared; call synchronously in a click handler
export function pdfTab() {
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font:16px sans-serif;padding:24px">Pripravljam PDF …</p>');
  return win;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
