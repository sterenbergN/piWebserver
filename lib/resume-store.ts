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

type PostMeta = { slug: string; title?: string };
type AlbumMeta = { id: string; albums?: AlbumMeta[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function albumIds(albums: AlbumMeta[], out = new Set<string>()) {
  for (const a of albums) {
    out.add(a.id);
    albumIds(a.albums || [], out);
  }
  return out;
}

/**
 * Attach each project's write-up and photo album: the chosen blog post (or a
 * post whose title matches the project name) and the gallery album that
 * publishing that post created (albums share the post's slug).
 */
export async function linkProjects(projects: Project[]): Promise<Project[]> {
  const uploads = path.join(process.cwd(), 'public', 'uploads');
  const [posts, albums] = await Promise.all([
    fs.readFile(path.join(uploads, 'blog', 'posts.json'), 'utf-8').then((t) => JSON.parse(t) as PostMeta[]).catch(() => [] as PostMeta[]),
    fs.readFile(path.join(uploads, 'gallery', 'albums.json'), 'utf-8').then((t) => JSON.parse(t) as AlbumMeta[]).catch(() => [] as AlbumMeta[]),
  ]);
  const ids = albumIds(Array.isArray(albums) ? albums : []);
  return projects.map((project) => {
    const post = (Array.isArray(posts) ? posts : []).find((p) =>
      project.blogSlug ? p.slug === project.blogSlug : !!p.title && norm(p.title) === norm(project.name));
    const { post: _post, albumId: _album, ...rest } = project;
    return {
      ...rest,
      ...(post ? { post: { slug: post.slug, title: post.title || post.slug } } : {}),
      ...(post && ids.has(post.slug) ? { albumId: post.slug } : {}),
    };
  });
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
    projects: await linkProjects(projects as Project[]),
  };
}

export async function saveResume(input: unknown): Promise<Resume> {
  const resume = normalizeResume(input);
  resume.profile.updatedAt = new Date().toISOString();
  await writeJson(FILES.profile, resume.profile);
  await writeJson(FILES.experience, resume.experience);
  await writeJson(FILES.skills, resume.skills);
  await writeJson(FILES.projects, resume.projects);
  return { ...resume, projects: await linkProjects(resume.projects) };
}
