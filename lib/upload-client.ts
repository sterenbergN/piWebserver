// Browser side of /api/upload, shared by the pages that take uploads
// (gallery, library, blog posts).

export type UploadResult = { success?: boolean; message?: string; [key: string]: unknown };

/** Send one form to /api/upload, reporting upload progress 0–100 (fetch can't). */
export function uploadWithProgress(form: FormData, onProgress?: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', '/api/upload');
    xhr.send(form);
  });
}
