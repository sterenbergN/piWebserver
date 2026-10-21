import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';

// A small zip writer/reader that streams to and from disk, so backups with
// gigabytes of photos never sit in memory (a Pi runs out of RAM otherwise).
// Photos are stored as-is (they're already compressed); data files are
// deflated. ZIP64 records are written when the archive passes 4 GB.

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `buf`, continuing from `prev` (Node's zlib.crc32 when it exists). */
export function crc32(buf: Uint8Array, prev = 0): number {
  const native = (zlib as unknown as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;
  if (native) return native(buf, prev);
  let c = (prev ^ MAX32) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ MAX32) >>> 0;
}

/** Extensions that are already compressed, so deflating them only burns CPU. */
const STORED = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a', '.zip', '.gz', '.pdf', '.epub', '.docx', '.xlsx', '.pptx']);

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

type CentralEntry = { name: Buffer; method: number; crc: number; compressed: number; size: number; offset: number; time: number; day: number };

/** Writes a zip file entry by entry. Call `close()` once at the end. */
export class ZipWriter {
  private entries: CentralEntry[] = [];
  private offset = 0;
  private constructor(private handle: fs.FileHandle) {}

  static async create(file: string) {
    return new ZipWriter(await fs.open(file, 'w'));
  }

  private async write(buf: Buffer, position?: number) {
    await this.handle.write(buf, 0, buf.length, position ?? this.offset);
    if (position === undefined) this.offset += buf.length;
  }

  private localHeader(name: Buffer, method: number, crc: number, compressed: number, size: number, time: number, day: number) {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4); // version needed
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(day, 12);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(compressed, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    return Buffer.concat([h, name]);
  }

  /** Add an in-memory file (deflated). */
  async addBuffer(entryName: string, data: Buffer, mtime = new Date()) {
    const name = Buffer.from(entryName, 'utf-8');
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const { time, day } = dosTime(mtime);
    const crc = crc32(data);
    const offset = this.offset;
    await this.write(this.localHeader(name, useDeflate ? 8 : 0, crc, body.length, data.length, time, day));
    await this.write(body);
    this.entries.push({ name, method: useDeflate ? 8 : 0, crc, compressed: body.length, size: data.length, offset, time, day });
  }

  /**
   * Add a file from disk. Already-compressed media streams in stored as-is;
   * small data files are read and deflated. Returns the bytes added, or null
   * if the file vanished or is too big for one entry (4 GB).
   */
  async addFile(entryName: string, source: string): Promise<number | null> {
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile() || stat.size >= MAX32) return null;
    if (!STORED.has(path.extname(source).toLowerCase()) && stat.size < 64 * 1024 * 1024) {
      const data = await fs.readFile(source).catch(() => null);
      if (!data) return null;
      await this.addBuffer(entryName, data, stat.mtime);
      return data.length;
    }
    const name = Buffer.from(entryName, 'utf-8');
    const { time, day } = dosTime(stat.mtime);
    const headerAt = this.offset;
    // Write the header with a blank CRC, stream the bytes, then patch the CRC in.
    await this.write(this.localHeader(name, 0, 0, stat.size, stat.size, time, day));
    let crc = 0;
    let written = 0;
    for await (const chunk of createReadStream(source, { highWaterMark: 1024 * 1024 })) {
      const buf = chunk as Buffer;
      crc = crc32(buf, crc);
      await this.write(buf);
      written += buf.length;
    }
    if (written !== stat.size) {
      // The file changed while we read it; rewind and leave it out.
      this.offset = headerAt;
      return null;
    }
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32LE(crc >>> 0, 0);
    await this.write(crcBuf, headerAt + 14);
    this.entries.push({ name, method: 0, crc, compressed: stat.size, size: stat.size, offset: headerAt, time, day });
    return stat.size;
  }

  async close() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const zip64 = e.offset >= MAX32;
      const extra = zip64 ? Buffer.alloc(12) : Buffer.alloc(0);
      if (zip64) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(e.offset), 4);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(zip64 ? 45 : 20, 4); // version made by
      h.writeUInt16LE(zip64 ? 45 : 20, 6); // version needed
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.day, 14);
      h.writeUInt32LE(e.crc >>> 0, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE(zip64 ? MAX32 : e.offset, 42);
      await this.write(Buffer.concat([h, e.name, extra]));
    }
    const cdSize = this.offset - cdStart;
    const needs64 = this.entries.length >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32;
    if (needs64) {
      const recordAt = this.offset;
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0);
      rec.writeBigUInt64LE(BigInt(44), 4);
      rec.writeUInt16LE(45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(this.entries.length), 24);
      rec.writeBigUInt64LE(BigInt(this.entries.length), 32);
      rec.writeBigUInt64LE(BigInt(cdSize), 40);
      rec.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(recordAt), 8);
      loc.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([rec, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(this.entries.length, MAX16), 8);
    end.writeUInt16LE(Math.min(this.entries.length, MAX16), 10);
    end.writeUInt32LE(needs64 ? MAX32 : cdSize, 12);
    end.writeUInt32LE(needs64 ? MAX32 : cdStart, 16);
    await this.write(end);
    // Drop anything left past the end by a file that was rewound out.
    await this.handle.truncate(this.offset);
    await this.handle.close();
  }

  /** Close a half-written zip (the caller deletes it). */
  async abort() {
    await this.handle.close().catch(() => {});
  }
}

export type ZipEntry = { name: string; method: number; compressed: number; size: number; localOffset: number; isDirectory: boolean };

async function readAt(handle: fs.FileHandle, position: number, length: number) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** List a zip's entries from its central directory (handles ZIP64). */
export async function readZipEntries(file: string): Promise<ZipEntry[]> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 22 + MAX16);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('That file is not a zip');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdStart = tail.readUInt32LE(eocd + 16);
    if (count === MAX16 || cdSize === MAX32 || cdStart === MAX32) {
      const locAt = size - tailLength + eocd - 20;
      const loc = await readAt(handle, locAt, 20);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error('Broken ZIP64 archive');
      const rec = await readAt(handle, Number(loc.readBigUInt64LE(8)), 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('Broken ZIP64 archive');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdStart = Number(rec.readBigUInt64LE(48));
    }
    const cd = await readAt(handle, cdStart, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip directory');
      const method = cd.readUInt16LE(p + 10);
      let compressed = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf-8');
      // ZIP64 extra field: 8-byte values for whichever fields were maxed out, in order.
      let x = p + 46 + nameLen;
      const extraEnd = x + extraLen;
      while (x + 4 <= extraEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (uncompressed === MAX32) { uncompressed = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compressed === MAX32) { compressed = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === MAX32) { localOffset = Number(cd.readBigUInt64LE(q)); }
        }
        x += 4 + len;
      }
      entries.push({ name, method, compressed, size: uncompressed, localOffset, isDirectory: name.endsWith('/') });
      p = extraEnd + commentLen;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** Read one (small) entry into memory. */
export async function readZipEntry(file: string, entry: ZipEntry): Promise<Buffer> {
  const parts: Buffer[] = [];
  await streamEntry(file, entry, new Writable({ write(chunk, _enc, done) { parts.push(chunk); done(); } }));
  return Buffer.concat(parts);
}

async function streamEntry(file: string, entry: ZipEntry, sink: NodeJS.WritableStream) {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported zip compression in ${entry.name}`);
  const handle = await fs.open(file, 'r');
  let dataStart: number;
  try {
    const local = await readAt(handle, entry.localOffset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`Broken zip entry ${entry.name}`);
    dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await handle.close();
  }
  if (entry.compressed === 0) { sink.end(); return; }
  const source = createReadStream(file, { start: dataStart, end: dataStart + entry.compressed - 1 });
  if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), sink);
  else await pipeline(source, sink);
}

/** Extract one entry to `target`, via a temp file so a failure never leaves half a file. */
export async function extractZipEntry(file: string, entry: ZipEntry, target: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.restore.tmp`;
  try {
    await streamEntry(file, entry, createWriteStream(tmp));
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}
