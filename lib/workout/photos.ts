import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// Machine photos: resized to a small WebP and kept with the workout data
// (.data/workouts/photos), referenced from a station by id.

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;

const photoDir = () => path.join(process.cwd(), '.data', 'workouts', 'photos');

export const isPhotoId = (id: string) => ID_PATTERN.test(id);

export function photoPath(id: string) {
  if (!isPhotoId(id)) throw new Error('Invalid photo id');
  return path.join(photoDir(), `${id}.webp`);
}

/** Store a photo (any common image format, any orientation); returns its id. */
export async function savePhoto(input: Buffer): Promise<string> {
  const webp = await sharp(input, { failOn: 'none' })
    .rotate() // respect the phone's EXIF orientation
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 74 })
    .toBuffer();
  const id = crypto.randomBytes(12).toString('base64url');
  await fs.mkdir(photoDir(), { recursive: true });
  await fs.writeFile(photoPath(id), webp);
  return id;
}

export async function readPhoto(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(photoPath(id));
  } catch {
    return null;
  }
}
