// Files sent along with a Generate request (a lecture PDF, photos of a syllabus):
// what's accepted and how much. Shared by the page, which checks before sending,
// and the server, which checks again. They go straight to the AI with that one
// request and are never saved on the Pi.
//
// The limits keep one request inside what both providers take inline (Claude's
// 32 MB request, Gemini's inline-data limit), counting base64's extra third.

export type AttachmentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

/** A file as it travels: base64 data, never a path or a URL. */
export type AiAttachment = { name: string; type: AttachmentType; data: string };

export const ATTACHMENT_TYPES: AttachmentType[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_ATTACHMENTS = 5;
/** All files together, before base64. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Photos are shrunk to this many pixels on their long side before sending (models read about that much anyway). */
export const MAX_IMAGE_SIDE = 2000;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a base64 string decodes to. */
export const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

export const isAttachmentType = (value: unknown): value is AttachmentType => ATTACHMENT_TYPES.includes(value as AttachmentType);

/** Office files the AIs can't read, with what to do instead. */
export function unsupportedReason(name: string, type: string): string | null {
  const lower = name.toLowerCase();
  if (/\.(pptx?|key)$/.test(lower) || type.includes('presentation')) return `${name}: save the slides as a PDF first (Keynote or PowerPoint: Export › PDF).`;
  if (/\.(docx?|pages)$/.test(lower) || type.includes('wordprocessing') || type === 'application/msword') return `${name}: save it as a PDF first, or copy its text into the box.`;
  if (/\.hei[cf]$/.test(lower) || type.includes('heic') || type.includes('heif')) return `${name}: this photo format can’t be read here. Choose it from Photos instead of Files, or take a screenshot.`;
  return null;
}

export class AttachmentError extends Error {}

/**
 * Check files that arrived with a request. Throws AttachmentError with a short
 * reason; returns the files, cleaned, otherwise.
 */
export function cleanAttachments(raw: unknown): AiAttachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AttachmentError('Those files couldn’t be read.');
  if (raw.length > MAX_ATTACHMENTS) throw new AttachmentError(`Attach at most ${MAX_ATTACHMENTS} files.`);
  let total = 0;
  return raw.map((item) => {
    const f = (item && typeof item === 'object' ? item : {}) as Partial<AiAttachment>;
    if (!isAttachmentType(f.type)) throw new AttachmentError('Only PDFs and photos (JPEG, PNG, WebP) can be attached.');
    if (typeof f.data !== 'string' || !f.data || !BASE64.test(f.data)) throw new AttachmentError('A file came through damaged. Attach it again.');
    total += base64Bytes(f.data);
    if (total > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`The files come to more than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. Attach fewer or smaller ones.`);
    const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 120) : 'file';
    return { name, type: f.type, data: f.data };
  });
}
