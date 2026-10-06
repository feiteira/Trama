// Test helper: a ZIP whose central directory claims an entry is far larger than it is, as a zip
// bomb's does. fflate allocates exactly the declared size before inflating, so this exercises
// the size checks without building gigabytes.

/** Sets the declared uncompressed size of `name` (or of every entry `name` matches) in place. */
export function forgeSize(zip: Uint8Array, name: string | RegExp, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let eocd = out.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  let hits = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const entry = new TextDecoder().decode(out.subarray(at + 46, at + 46 + nameLen));
    if (typeof name === 'string' ? entry === name : name.test(entry)) {
      view.setUint32(at + 24, size, true);
      hits++;
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (!hits) throw new Error(`no entry ${String(name)}`);
  return out;
}
