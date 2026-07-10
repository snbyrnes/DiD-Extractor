/* Minimal dependency-free XLSX writer + template filler.
   - build(): writes a single-sheet workbook. Numeric columns are written as real
     number cells with format code "0" (full integer, never scientific).
   - fillTemplate(): opens an existing .xlsx (ArrayBuffer), injects data rows into
     named sheets (keeping all other tabs, styles, dropdowns and images), and
     returns the rebuilt file. Uses CompressionStream/DecompressionStream.
   Exposed as window.XLSX in the browser, and module.exports in Node. */
(function (root) {
  "use strict";

  // ---- CRC32 (for ZIP entries) ----
  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---- ZIP writer ----
  // files: { name, data (raw Uint8Array), compData? (deflate-raw Uint8Array) }.
  // Entries with compData are written as method 8 (deflate), others stored.
  function buildZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const stored = f.compData || f.data;
      const method = f.compData ? 8 : 0;
      const crc = crc32(f.data);
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);   // UTF-8 flag
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true);    // 1980-01-01
      dv.setUint32(14, crc, true);
      dv.setUint32(18, stored.length, true);
      dv.setUint32(22, f.data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, stored);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, stored.length, true);
      cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + stored.length;
    }
    const centralSize = central.reduce((a, c) => a + c.length, 0);
    const centralOffset = offset;
    for (const c of central) parts.push(c);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    parts.push(eocd);
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---- XML helpers ----
  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function colName(i) {
    let s = ''; i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const WORKBOOK =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Extract" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildSheet(header, dataRows, numCols) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    xml += '<row r="1">';
    header.forEach((h, ci) => {
      xml += `<c r="${colName(ci)}1" t="inlineStr" s="2"><is><t xml:space="preserve">${xmlEsc(h)}</t></is></c>`;
    });
    xml += '</row>';
    dataRows.forEach((row, ri) => {
      const r = ri + 2;
      xml += `<row r="${r}">`;
      row.forEach((val, ci) => {
        if (val === '' || val == null) return;              // blank cell
        const ref = colName(ci) + r;
        if (numCols.has(ci)) xml += `<c r="${ref}" s="1"><v>${val}</v></c>`;
        else xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
      });
      xml += '</row>';
    });
    xml += '</sheetData></worksheet>';
    return xml;
  }

  // header: string[]; dataRows: (string|number)[][]; numCols: Set<number>
  function build(header, dataRows, numCols) {
    const enc = new TextEncoder();
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(RELS) },
      { name: 'xl/workbook.xml', data: enc.encode(WORKBOOK) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(buildSheet(header, dataRows, numCols)) }
    ];
    return buildZip(files);
  }

  // ---- ZIP reader ----
  function parseZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
      const method   = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen  = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen   = dv.getUint16(p + 32, true);
      const lhOff    = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lhNameLen  = dv.getUint16(lhOff + 26, true);
      const lhExtraLen = dv.getUint16(lhOff + 28, true);
      const dataOff = lhOff + 30 + lhNameLen + lhExtraLen;
      entries.push({ name, method, raw: u8.subarray(dataOff, dataOff + compSize) });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
  }

  async function pipeStream(u8, stream) {
    const s = new Blob([u8]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function inflate(u8) { return pipeStream(u8, new DecompressionStream('deflate-raw')); }
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;   // fall back to stored
    return pipeStream(u8, new CompressionStream('deflate-raw'));
  }

  // ---- template row injection ----
  // Builds cell XML for one value. Numbers become numeric cells; strings become
  // inline strings (independent of the template's sharedStrings table).
  function cellXml(ref, s, val) {
    const style = s ? ` s="${s}"` : '';
    if (val === '' || val == null) return s ? `<c r="${ref}"${style}/>` : '';
    if (typeof val === 'number') return `<c r="${ref}"${style}><v>${val}</v></c>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
  }

  // Replaces rows 2..(n+1) of a worksheet XML with `rows` (array of arrays of
  // string|number|null). Row 1 (headers) and any template rows below the data
  // block (empty styled rows carrying borders/dropdown shading) are kept.
  // Cell styles for injected rows are copied column-by-column from template row 2.
  function injectRows(xml, rows) {
    const open = xml.indexOf('<sheetData');
    const close = xml.indexOf('</sheetData>');
    if (open < 0) throw new Error('sheetData not found');
    const bodyStart = xml.indexOf('>', open) + 1;
    const body = xml.slice(bodyStart, close < 0 ? xml.length : close);
    const rowRe = /<row [^>]*r="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
    const tplRows = [];
    let m;
    while ((m = rowRe.exec(body)) !== null) tplRows.push({ r: +m[1], xml: m[0] });

    const header = tplRows.find(t => t.r === 1);
    const proto  = tplRows.find(t => t.r === 2);
    // per-column style map + row attributes from the first template data row
    const styles = {};
    let rowAttrs = '';
    if (proto) {
      const am = proto.xml.match(/^<row ([^>]*?)\/?>/);
      if (am) rowAttrs = ' ' + am[1].replace(/r="\d+"\s*/, '').replace(/spans="[^"]*"\s*/, '').trim();
      for (const c of proto.xml.matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?s="(\d+)")?[^>]*?\/?>/g)) {
        if (c[2]) styles[c[1]] = c[2];
      }
    }
    const styledCols = Object.keys(styles);

    let out = header ? header.xml : '';
    rows.forEach((vals, i) => {
      const r = i + 2;
      let cells = '';
      const used = new Set();
      vals.forEach((v, ci) => {
        const col = colName(ci);
        used.add(col);
        cells += cellXml(col + r, styles[col], v);
      });
      for (const col of styledCols) {           // keep styling on trailing blank cells
        if (!used.has(col)) cells += `<c r="${col + r}" s="${styles[col]}"/>`;
      }
      out += `<row r="${r}"${rowAttrs}>${cells}</row>`;
    });
    for (const t of tplRows) if (t.r > rows.length + 1) out += t.xml;

    return xml.slice(0, bodyStart) + out + xml.slice(close < 0 ? xml.length : close);
  }

  // fills: { "Sheet Name": rows[][] } — rows of string|number|null cells.
  // buf: ArrayBuffer/Uint8Array of the template .xlsx. Returns Promise<Uint8Array>.
  async function fillTemplate(buf, fills) {
    const dec = new TextDecoder(), enc = new TextEncoder();
    const entries = parseZip(buf);
    const files = [];
    for (const e of entries) {
      files.push({ name: e.name, data: e.method === 8 ? await inflate(e.raw) : e.raw.slice() });
    }
    const byName = {};
    for (const f of files) byName[f.name] = f;

    // resolve sheet name -> worksheet part via workbook.xml + its rels
    const wb = dec.decode(byName['xl/workbook.xml'].data);
    const rels = dec.decode(byName['xl/_rels/workbook.xml.rels'].data);
    const relMap = {};
    for (const r of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[r[1]] = r[2];
    const sheetPart = {};
    for (const s of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      const target = relMap[s[2]];
      if (target) sheetPart[s[1]] = 'xl/' + target.replace(/^\//, '');
    }

    for (const [sheetName, rows] of Object.entries(fills)) {
      const part = byName[sheetPart[sheetName]];
      if (!part) throw new Error('sheet not found in template: ' + sheetName);
      part.data = enc.encode(injectRows(dec.decode(part.data), rows));
    }

    for (const f of files) f.compData = await deflate(f.data);
    return buildZip(files);
  }

  const api = { build, colName, fillTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLSX = api;
})(typeof self !== 'undefined' ? self : this);
