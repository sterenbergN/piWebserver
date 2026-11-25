// A screenshot pasted into the Feedback sheet (Ctrl+V after a screen snip). The
// clipboard can hold text and files together; only an image is taken, and a
// plain text paste is left alone so it lands in the message as usual.

/** The first image among pasted files, renamed so the ticket says where it came from. */
export function pastedImage(files: ArrayLike<File> | null | undefined): File | null {
  const image = Array.from(files ?? []).find((f) => f.type.startsWith('image/'));
  if (!image) return null;
  const ext = image.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
  // Snipping tools name it "image.png" (or nothing): say what it is instead.
  return /^image\.\w+$|^$/i.test(image.name) ? new File([image], `Pasted screenshot.${ext}`, { type: image.type }) : image;
}
