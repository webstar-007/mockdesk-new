// Read the text of a .docx file without any extra package: a .docx is a zip, and the words live in word/document.xml.
import zlib from 'node:zlib';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));

/** Pull one file out of a zip buffer. Returns a Buffer, or null when it is not in the archive. */
export function unzipEntry(buf, wanted) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This does not look like a Word (.docx) file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen); p += 46 + nlen + elen + clen;
    if (name !== wanted) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28); const data = buf.subarray(start, start + csize);
    if (method === 0) return data; if (method === 8) return zlib.inflateRawSync(data); throw new Error('This Word file uses a compression method we cannot read');
  }
  return null;
}

/** The paragraphs of a .docx as plain text lines. */
export function docxLines(buf) {
  const xml = unzipEntry(buf, 'word/document.xml'); if (!xml) throw new Error('This does not look like a Word (.docx) file');
  return xml.toString('utf8').split(/<\/w:p>/).map((p) => decode(p.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n').replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, '$1\u0001').replace(/<[^>]+>/g, '').replace(/\u0001/g, '')).replace(/\s+$/g, '')).filter((l, i, a) => l.trim() || (a[i - 1] || '').trim());
}
