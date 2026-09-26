// The home page is edited like a resume: one profile header plus ordered
// experience, skills and projects. Each list keeps its own JSON file (the
// files predate the editor), and the whole resume is saved in one request.

export interface ResumeLink { label: string; url: string }

export interface Profile {
  name: string;
  headline: string;
  location: string;
  email: string;
  summary: string;      // short paragraph for the printable resume
  skillsIntro: string;  // blurb above the skills on the home page
  links: ResumeLink[];
}

export interface ExperienceEntry {
  id: string;
  role: string;
  company: string;
  period: string;
  description: string;
  details: string[];
}

export interface Skill {
  id: string;
  name: string;
  linkedPosts: { title: string; slug: string }[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: string;
  blogSlug: string;
}

export interface Resume {
  profile: Profile;
  experience: ExperienceEntry[]; // newest first
  skills: Skill[];
  projects: Project[];
}

export const PROJECT_CATEGORIES = ['Automation', 'Infrastructure', 'Software', 'Hardware', 'Other'];

export const DEFAULT_PROFILE: Profile = {
  name: 'Noah Sterenberg',
  headline: 'Mechanical / Automation Engineer, Maker, and Technology Enthusiast weaving software and hardware into seamless solutions.',
  location: '',
  email: 'NoahSterenberg@gmail.com',
  summary: '',
  skillsIntro: 'A multidisciplinary toolset spanning hardware control, software development, and modern web infrastructure.',
  links: [
    { label: 'GitHub', url: 'https://github.com/sterenbergN/' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/noah-sterenberg' },
  ],
};

// ─── Validation ────────────────────────────────────────────────────────────────

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

/** Stable, unique ids: keep a valid existing id, otherwise derive one from the name. */
function assignIds<T extends { id: string }>(items: T[], nameOf: (item: T) => string): T[] {
  const used = new Set<string>();
  return items.map((item) => {
    let id = /^[a-z0-9-]{1,80}$/.test(item.id) ? item.id : slugify(nameOf(item));
    let n = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return { ...item, id };
  });
}

function safeUrl(value: unknown): string {
  const url = text(value, 500);
  if (/^mailto:/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeProfile(input: any): Profile {
  const links = Array.isArray(input?.links) ? input.links : [];
  return {
    name: text(input?.name, 80) || DEFAULT_PROFILE.name,
    headline: text(input?.headline, 300),
    location: text(input?.location, 80),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(input?.email, 120)) ? text(input?.email, 120) : '',
    summary: text(input?.summary, 1200),
    skillsIntro: text(input?.skillsIntro, 300),
    links: links
      .map((l: any) => ({ label: text(l?.label, 40), url: safeUrl(l?.url) }))
      .filter((l: ResumeLink) => l.label && l.url)
      .slice(0, 8),
  };
}

export function normalizeExperience(input: unknown): ExperienceEntry[] {
  if (!Array.isArray(input)) return [];
  const entries = input
    .map((e: any) => ({
      id: text(e?.id, 80),
      role: text(e?.role, 120),
      company: text(e?.company, 120),
      period: text(e?.period, 60),
      description: text(e?.description, 1000),
      details: (Array.isArray(e?.details) ? e.details : []).map((d: unknown) => text(d, 400)).filter(Boolean).slice(0, 15),
    }))
    .filter((e) => e.role || e.company);
  return assignIds(entries, (e) => `${e.company}-${e.role}`);
}

export function normalizeSkills(input: unknown): Skill[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const s of input as any[]) {
    const name = text(s?.name, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const linkedPosts = (Array.isArray(s?.linkedPosts) ? s.linkedPosts : [])
      .map((p: any) => ({ title: text(p?.title, 200), slug: text(p?.slug, 200) }))
      .filter((p: { slug: string }) => p.slug);
    skills.push({ id: text(s?.id, 80), name, linkedPosts });
  }
  return assignIds(skills, (s) => s.name);
}

export function normalizeProjects(input: unknown): Project[] {
  if (!Array.isArray(input)) return [];
  const projects = (input as any[])
    .map((p) => ({
      id: text(p?.id, 80),
      name: text(p?.name, 120),
      description: text(p?.description, 1000),
      category: PROJECT_CATEGORIES.includes(p?.category) ? p.category : 'Other',
      blogSlug: text(p?.blogSlug, 200),
    }))
    .filter((p) => p.name);
  return assignIds(projects, (p) => p.name);
}

export function normalizeResume(input: any): Resume {
  return {
    profile: normalizeProfile(input?.profile),
    experience: normalizeExperience(input?.experience),
    skills: normalizeSkills(input?.skills),
    projects: normalizeProjects(input?.projects),
  };
}
