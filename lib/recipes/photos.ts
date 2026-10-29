import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { queueThumbnails, removeThumbnails } from '@/lib/media/thumbnails';
import { RECIPE_PHOTO_PREFIX, isRecipePhotoSrc } from './recipes';

// Dish photos: public like the gallery (public/uploads/recipes, served and
// resized by /api/media), but re-encoded like journal and machine photos —
// turned upright, shrunk, saved as WebP, and stripped of EXIF (so a phone's
// GPS location isn't published with the picture).

export const MAX_RECIPE_PHOTO_BYTES = 15 * 1024 * 1024;

const photoDir = () => path.join(process.cwd(), 'public', 'uploads', 'recipes');

/** Store an uploaded photo (any common format, any orientation); returns its src. */
export async function saveRecipePhoto(input: Buffer): Promise<string> {
  const webp = await sharp(input, { failOn: 'none' })
    .rotate() // respect the phone's EXIF orientation
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.webp`;
  await fs.mkdir(photoDir(), { recursive: true });
  await fs.writeFile(path.join(photoDir(), name), webp);
  queueThumbnails(`uploads/recipes/${name}`);
  return `${RECIPE_PHOTO_PREFIX}${name}`;
}

/** Delete a replaced or orphaned photo and its resized copies. Ignores anything that isn't one. */
export async function removeRecipePhoto(src: string | undefined) {
  if (!isRecipePhotoSrc(src)) return;
  await fs.unlink(path.join(photoDir(), src.slice(RECIPE_PHOTO_PREFIX.length))).catch(() => {});
  await removeThumbnails(src);
}
