// 3D model files for the CAD section: which formats the viewer can show.
// (STEP and other CAD-native formats need converting to one of these first.)

export const MODEL_EXTENSIONS = ['.stl', '.3mf', '.obj', '.glb', '.ply'] as const;
export type ModelExtension = (typeof MODEL_EXTENSIONS)[number];
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export function modelExtension(name: string): ModelExtension | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return (MODEL_EXTENSIONS as readonly string[]).includes(ext) ? (ext as ModelExtension) : null;
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
