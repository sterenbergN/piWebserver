import fs from 'fs/promises';
import path from 'path';

const privateDir = () => path.join(process.cwd(), '.data', 'workouts');
const legacyDir = () => path.join(process.cwd(), 'public', 'uploads', 'workouts');

async function migrateLegacyWorkoutData(targetDir: string) {
  const sourceDir = legacyDir();

  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      try {
        await fs.access(targetPath);
      } catch {
        await fs.copyFile(sourcePath, targetPath);
      }

      await fs.unlink(sourcePath).catch(() => {});
    }
  } catch {
    // No legacy directory to migrate from.
  }
}

const getDir = () => privateDir();

export async function ensureWorkoutDir() {
  const dir = getDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  await migrateLegacyWorkoutData(dir);
}

export async function getWorkoutData<T>(filename: string, defaultData: T): Promise<T> {
  await ensureWorkoutDir();
  const filePath = path.join(getDir(), filename);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return defaultData;
  }
}

export async function saveWorkoutData<T>(filename: string, data: T): Promise<boolean> {
  await ensureWorkoutDir();
  const filePath = path.join(getDir(), filename);
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    return false;
  }
}
