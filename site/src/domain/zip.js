// A small zip reader, so wall packs can be opened with no library. It reads the zip's table of contents (the "central
// directory") and then unpacks each file: stored as is, or deflated, which the browser can undo by itself
// (DecompressionStream). It reads plain zips as made by Windows, macOS, Python and the hold editor. It does not do
// encrypted zips or zips over 4 GB.

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function inflateRaw(data, expectedSize) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('This browser is too old to open wall packs. Update it (iPhone and iPad need iOS 16.4 or newer).');
  }
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = new Uint8Array(expectedSize);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // The zip says how big each file is. A file that unpacks to more than it claims is damaged or hostile.
    if (at + value.length > expectedSize) {
      await reader.cancel();
      throw new ZipError('That zip file is damaged.');
    }
    out.set(value, at);
    at += value.length;
  }
  if (at !== expectedSize) throw new ZipError('That zip file is damaged.');
  return out;
}

/** Returns a Map from each file's path in the zip to its bytes. */
export async function readZip(buffer, { maxBytes = 80 * 1024 * 1024 } = {}) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('That file is not a zip, or it is empty.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const files = new Map();
  let total = 0;
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new ZipError('That zip file is damaged.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || name.startsWith('__MACOSX')) continue;
    if (flags & 1) throw new ZipError('That zip is password protected.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('That zip is too big to open.');
    total += size;
    if (total > maxBytes) throw new ZipError('That pack is bigger than 80 MB.');
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL) throw new ZipError('That zip file is damaged.');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, await inflateRaw(raw, size));
    else throw new ZipError('That zip uses a compression this app cannot open.');
  }
  if (files.size === 0) throw new ZipError('That file is not a zip, or it is empty.');
  return files;
}

/** The file whose name (ignoring folders and capitals) matches, or undefined. */
export function findFile(files, wantedName) {
  const base = (path) => path.split('/').pop().split('\\').pop().toLowerCase();
  const wanted = base(wantedName);
  for (const [path, data] of files) if (base(path) === wanted) return data;
  return undefined;
}
