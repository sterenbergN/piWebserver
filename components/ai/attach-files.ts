'use client';

import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_IMAGE_SIDE, base64Bytes, unsupportedReason, type AiAttachment } from '@/lib/ai/attachments';
import { kindOf } from '@/lib/convert/formats';

// Turning chosen files into what Generate sends: PDFs as they are, photos shrunk
// (a phone photo is several MB, and the models read about 2,000 pixels anyway),
// and plain-text files as text for the notes box.

export type Picked = { attachments: AiAttachment[]; text: string[]; problems: string[] };

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const base64Of = async (blob: Blob) => (await readDataUrl(blob)).replace(/^data:[^,]*,/, '');

/** A photo as a JPEG no larger than MAX_IMAGE_SIDE on its long side (PNG kept as PNG when it's small already). */
async function shrinkImage(file: File): Promise<{ type: AiAttachment['type']; data: string }> {
  // iPhone HEIC photos: Safari reads them itself; elsewhere the converter's decoder loads for them.
  const bitmap = await createImageBitmap(file).catch(async (error) => {
    if (kindOf(file.name, file.type) !== 'heic') throw error;
    const { heicTo } = await import('heic-to/next');
    return heicTo({ blob: file, type: 'bitmap' });
  });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')) {
    bitmap.close();
    return { type: file.type, data: await base64Of(file) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  // White behind see-through PNGs, so text on them stays readable as a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('no jpeg');
  return { type: 'image/jpeg', data: await base64Of(blob) };
}

/**
 * Read the chosen files, adding to what's attached already, within the limits.
 * `toPdf` turns a PowerPoint, Word or Excel file into a PDF (on the Pi) when it can,
 * or answers null when it can't, and the file gets the usual "save it as a PDF" note.
 */
export async function pickFiles(files: File[], already: AiAttachment[], toPdf?: (file: File) => Promise<File | null>): Promise<Picked> {
  const out: Picked = { attachments: [], text: [], problems: [] };
  let count = already.length;
  let bytes = already.reduce((sum, a) => sum + base64Bytes(a.data), 0);
  for (const picked of files) {
    let file = picked;
    // Office files go by what they are, so every kind (slides, Word, spreadsheets) gets the Pi's PDF.
    const kind = kindOf(picked.name, picked.type);
    const office = kind === 'slides' || kind === 'doc' || kind === 'sheet';
    const why = unsupportedReason(picked.name, picked.type) ?? (office ? `${picked.name}: Office files can’t be sent from here. Save it as a PDF and attach that, or copy the prompt into an AI of your choice (“Use your own AI instead”).` : null);
    if (why) {
      let pdf: File | null = null;
      if (toPdf && office) {
        try {
          pdf = await toPdf(picked);
        } catch (e) {
          out.problems.push(`${picked.name}: ${e instanceof Error ? e.message.replace(/\.$/, '') : 'it couldn’t be turned into a PDF'}. Save it as a PDF and attach that, or use your own AI instead.`);
          continue;
        }
      }
      if (!pdf) { out.problems.push(why); continue; }
      file = pdf;
    }
    try {
      if (file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(file.name)) {
        out.text.push(await file.text());
        continue;
      }
      if (count >= MAX_ATTACHMENTS) { out.problems.push(`${file.name}: at most ${MAX_ATTACHMENTS} files at once.`); continue; }
      let item: AiAttachment;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) item = { name: file.name, type: 'application/pdf', data: await base64Of(file) };
      else if (file.type.startsWith('image/') || kindOf(file.name, file.type) === 'heic') item = { name: file.name, ...(await shrinkImage(file)) };
      else { out.problems.push(`${file.name}: only PDFs, photos and text files can be attached.`); continue; }
      const size = base64Bytes(item.data);
      if (bytes + size > MAX_ATTACHMENT_BYTES) { out.problems.push(`${file.name}: that would be more than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB of files in all.`); continue; }
      bytes += size;
      count++;
      out.attachments.push(item);
    } catch {
      out.problems.push(`${file.name}: couldn’t be read on this device.`);
    }
  }
  return out;
}

export const fileSize = (a: AiAttachment) => {
  const b = base64Bytes(a.data);
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};
