import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const projectsFile = path.join(process.cwd(), 'public', 'content', 'projects.json');

async function readProjects(): Promise<any[]> {
  try {
    const raw = await fs.readFile(projectsFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function GET() {
  const projects = await readProjects();
  return NextResponse.json({ success: true, projects });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const projects = await readProjects();
  const newProject = {
    id: body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: body.name,
    description: body.description || '',
    category: body.category || '',
    blogSlug: body.blogSlug || ''
  };
  projects.push(newProject);
  await fs.mkdir(path.dirname(projectsFile), { recursive: true });
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true, project: newProject });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const projects = await readProjects();
  const idx = projects.findIndex(p => p.id === body.id);
  if (idx === -1) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

  projects[idx] = { ...projects[idx], ...body };
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const { id } = await request.json();
  let projects = await readProjects();
  projects = projects.filter(p => p.id !== id);
  await fs.writeFile(projectsFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true });
}
