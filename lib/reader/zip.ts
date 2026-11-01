import { inflateSync } from 'fflate';

// EPUBs and comics are zip files. This reads just the parts asked for from the file,
// so opening a 300 MB comic on a phone doesn't mean holding all of it in memory.

type Entry = { method: number; compressedSize: number; offset: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const NOT_32_BIT = 0xffffffff;

export class ZipReader {
  private entries = new Map<string, Entry>();
  private lower = new Map<string, string>();

  private constructor(private blob: Blob) {}

  static async open(blob: Blob) {
    const zip = new ZipReader(blob);
    await zip.readDirectory();
    return zip;
  }

  private async readDirectory() {
    // The directory's locator is at the very end, behind a comment of up to 64 KB.
    const tailStart = Math.max(0, this.blob.size - 66_000);
    const tail = new DataView(await this.blob.slice(tailStart).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file isn’t a readable zip.');
    const count = tail.getUint16(eocd + 10, true);
    const size = tail.getUint32(eocd + 12, true);
    const start = tail.getUint32(eocd + 16, true);
    if (start === NOT_32_BIT) throw new Error('This file is too big to read.');

    const directory = new DataView(await this.blob.slice(start, start + size).arrayBuffer());
    const decoder = new TextDecoder();
    let at = 0;
    for (let i = 0; i < count && at + 46 <= directory.byteLength; i++) {
      if (directory.getUint32(at, true) !== CENTRAL) break;
      const nameLength = directory.getUint16(at + 28, true);
      const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));
      if (!name.endsWith('/')) {
        this.entries.set(name, { method: directory.getUint16(at + 10, true), compressedSize: directory.getUint32(at + 20, true), offset: directory.getUint32(at + 42, true) });
        this.lower.set(name.toLowerCase(), name);
      }
      at += 46 + nameLength + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    }
  }

  names() {
    return [...this.entries.keys()];
  }

  /** The stored name for a path. Some books link with the wrong capitals, which their makers' Windows PCs forgave. */
  resolve(name: string) {
    return this.entries.has(name) ? name : this.lower.get(name.toLowerCase()) ?? null;
  }

  async bytes(name: string) {
    const resolved = this.resolve(name);
    const entry = resolved ? this.entries.get(resolved) : undefined;
    if (!entry) throw new Error(`Missing from the book: ${name}`);
    const header = new DataView(await this.blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
    const dataStart = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = new Uint8Array(await this.blob.slice(dataStart, dataStart + entry.compressedSize).arrayBuffer());
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateSync(data);
    throw new Error('This book is compressed in a way that can’t be read.');
  }

  async text(name: string) {
    return new TextDecoder().decode(await this.bytes(name));
  }
}

export const isImageName = (name: string) => /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(name);

/** Natural order, so page10 comes after page9. */
export const naturalSort = (names: string[]) => [...names].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare);
