import crypto from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { resolvePathInside } from '@/lib/security/paths';
import { projectFilesFolder } from '@/lib/skills/store';
import type { ProjectAttachment } from '@/lib/skills/types';

// Private project attachments (demo videos, source archives, screenshots, docs)
// stored under .data/skills/<userId>/files/ and streamed only to the owner.

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const CACHE_CONTROL = 'private, max-age=3600';
const NO_STORE = { 'Cache-Control': 'no-store, private' };

const VIDEO_EXTS = new Set(['.webm', '.mp4', '.mov', '.m4v']);
const ZIP_EXTS = new Set(['.zip', '.tar', '.gz', '.7z', '.rar']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const INLINE_EXTS = new Set([...VIDEO_EXTS, ...IMAGE_EXTS, '.pdf']);

const MIME_BY_EXT: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const EXT_BY_MIME: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/x-7z-compressed': '.7z',
  'application/vnd.rar': '.rar',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

function resolveAttachmentKind(ext: string, mime: string): Exclude<ProjectAttachment['kind'], 'link'> {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (VIDEO_EXTS.has(ext) || m === 'video/webm' || m === 'video/mp4' || m === 'video/quicktime' || m === 'video/x-m4v') {
    return 'video';
  }
  if (ZIP_EXTS.has(ext) || m === 'application/zip' || m === 'application/x-zip-compressed' || m === 'application/x-tar' || m === 'application/gzip' || m === 'application/x-7z-compressed' || m === 'application/vnd.rar') {
    return 'zip';
  }
  if (IMAGE_EXTS.has(ext) || m === 'image/png' || m === 'image/jpeg' || m === 'image/webp' || m === 'image/gif') {
    return 'image';
  }
  return 'file';
}

function sanitizeStoredName(rawName: string, mime: string): { fileId: string; storedName: string; ext: string } {
  const base = path.basename(rawName || 'file');
  const rawExt = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  const ext = rawExt || EXT_BY_MIME[mime.toLowerCase().split(';')[0].trim()] || '';
  const stemRaw = base.slice(0, base.length - path.extname(base).length);
  const stem = stemRaw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'file';
  const safeName = `${stem}${ext}`.replace(/\.{2,}/g, '.');
  const fileId = crypto.randomBytes(8).toString('hex');
  return { fileId, storedName: `${fileId}__${safeName}`, ext };
}

function validateStoredId(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, 'Missing file id.');
  const id = raw.trim();
  if (
    !id
    || id.length > 160
    || id.includes('/')
    || id.includes('\\')
    || id.includes('\0')
    || id.includes('..')
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)
  ) {
    throw new ApiError(400, 'Invalid file id.');
  }
  return id;
}

function resolveUserFile(userId: string, storedName: string): string {
  const folder = projectFilesFolder(userId);
  const resolved = resolvePathInside(folder, storedName);
  if (!resolved || path.dirname(resolved) !== path.resolve(folder)) {
    throw new ApiError(400, 'Invalid file path.');
  }
  return resolved;
}

/** Parse a single HTTP byte range as inclusive [start, end], null if absent, or 'bad' if unsatisfiable. */
function byteRange(header: string | null, size: number): [number, number] | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'bad';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffixLen = Number(m[2]);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0 || size <= 0) return 'bad';
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && start < size
    ? [start, end]
    : 'bad';
}

function headerSafeFilename(storedName: string): string {
  const afterPrefix = storedName.includes('__') ? storedName.slice(storedName.indexOf('__') + 2) : storedName;
  return (afterPrefix || 'attachment').replace(/["\\\r\n]/g, '_');
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError(400, 'Expected multipart/form-data.');
    }

    const rawFile = formData.get('file');
    if (!(rawFile instanceof File)) {
      throw new ApiError(400, 'Missing file.');
    }
    if (rawFile.size <= 0) {
      throw new ApiError(400, 'File is empty.');
    }
    if (rawFile.size > MAX_FILE_BYTES) {
      throw new ApiError(413, 'File exceeds 100 MB limit.');
    }

    const rawName = formData.get('name');
    const customName = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 200) : '';
    const originalName = rawFile.name || customName || 'attachment';
    const rawMime = (rawFile.type || '').trim();
    const { fileId, storedName, ext } = sanitizeStoredName(originalName, rawMime);
    const kind = resolveAttachmentKind(ext, rawMime);
    const mime = MIME_BY_EXT[ext] ?? (rawMime && !rawMime.includes('html') && !rawMime.includes('svg') ? rawMime : 'application/octet-stream');

    const folder = projectFilesFolder(userId);
    await fs.mkdir(folder, { recursive: true });
    const targetPath = resolveUserFile(userId, storedName);
    const bytes = Buffer.from(await rawFile.arrayBuffer());
    await fs.writeFile(targetPath, bytes);

    const attachment: ProjectAttachment = {
      id: fileId,
      kind,
      name: customName || rawFile.name || storedName,
      url: `/api/skills/projects/file?id=${encodeURIComponent(storedName)}`,
      size: rawFile.size,
      mime,
    };

    return NextResponse.json({ success: true, attachment }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error, 'Upload project file failed');
  }
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const storedName = validateStoredId(params.get('id'));
    const filePath = resolveUserFile(userId, storedName);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new ApiError(404, 'File not found.');
    }

    const ext = path.extname(storedName).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const forceDownload = params.get('download') === '1';
    const inline = !forceDownload && INLINE_EXTS.has(ext);
    const safeName = headerSafeFilename(storedName);
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;

    const rangeHeader = request.headers.get('range');
    if (stat.size === 0) {
      if (rangeHeader) {
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */0' } });
      }
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': '0',
          'Accept-Ranges': 'bytes',
          'Content-Disposition': disposition,
          'Cache-Control': CACHE_CONTROL,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const range = byteRange(rangeHeader, stat.size);
    if (range === 'bad') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }

    const [start, end] = range ?? [0, stat.size - 1];
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
        'Content-Disposition': disposition,
        'Cache-Control': CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Get project file failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    let rawId: unknown = params.get('id');
    if (!rawId) {
      const body = await request.json().catch(() => null);
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        rawId = (body as Record<string, unknown>).id;
      }
    }
    const storedName = validateStoredId(rawId);
    const filePath = resolveUserFile(userId, storedName);

    let removed = true;
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        removed = false;
      } else {
        throw err;
      }
    }

    return NextResponse.json({ success: true, removed }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error, 'Delete project file failed');
  }
}
