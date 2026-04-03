import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const cadFile = path.join(process.cwd(), 'public', 'content', 'cad.json');

async function readCADProjects(): Promise<any[]> {
  try {
    const raw = await fs.readFile(cadFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function GET() {
  const projects = await readCADProjects();
  return NextResponse.json({ success: true, projects });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const projects = await readCADProjects();
  const newProject = {
    id: body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: body.name,
    description: body.description || '',
    link: body.link || ''
  };
  projects.push(newProject);
  await fs.mkdir(path.dirname(cadFile), { recursive: true });
  await fs.writeFile(cadFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true, project: newProject });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const projects = await readCADProjects();
  const idx = projects.findIndex((p: any) => p.id === body.id);
  if (idx === -1) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

  projects[idx] = { ...projects[idx], ...body };
  await fs.writeFile(cadFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

  const { id } = await request.json();
  let projects = await readCADProjects();
  projects = projects.filter((p: any) => p.id !== id);
  await fs.writeFile(cadFile, JSON.stringify(projects, null, 2));
  return NextResponse.json({ success: true });
}
