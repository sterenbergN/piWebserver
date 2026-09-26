import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_PROFILE, normalizeResume, type ExperienceEntry, type Profile, type Project, type Resume, type Skill } from './resume';

const contentDir = () => path.join(process.cwd(), 'public', 'content');
const FILES = {
  profile: 'profile.json',
  experience: 'experience.json',
  skills: 'skills.json',
  projects: 'projects.json',
} as const;

// ─── Storage ───────────────────────────────────────────────────────────────────

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(contentDir(), file), 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  const full = path.join(contentDir(), file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, full);
}

export async function getResume(): Promise<Resume> {
  const [profile, experience, skills, projects] = await Promise.all([
    readJson<Profile | null>(FILES.profile, null),
    readJson<unknown[]>(FILES.experience, []),
    readJson<unknown[]>(FILES.skills, []),
    readJson<unknown[]>(FILES.projects, []),
  ]);
  return {
    // Until the admin saves a profile, show the details the site always had.
    profile: profile ? { ...DEFAULT_PROFILE, ...profile } : DEFAULT_PROFILE,
    experience: experience as ExperienceEntry[],
    skills: skills as Skill[],
    projects: projects as Project[],
  };
}

export async function saveResume(input: unknown): Promise<Resume> {
  const resume = normalizeResume(input);
  await writeJson(FILES.profile, resume.profile);
  await writeJson(FILES.experience, resume.experience);
  await writeJson(FILES.skills, resume.skills);
  await writeJson(FILES.projects, resume.projects);
  return resume;
}
