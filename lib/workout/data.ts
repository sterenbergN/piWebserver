import fs from 'fs/promises';
import path from 'path';

const getDir = () => path.join(process.cwd(), 'public', 'uploads', 'workouts');

export async function ensureWorkoutDir() {
  const dir = getDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
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
