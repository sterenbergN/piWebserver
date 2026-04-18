import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const skillsFile = path.join(process.cwd(), 'public', 'content', 'skills.json');

async function readSkills(): Promise<any[]> {
  try {
    const raw = await fs.readFile(skillsFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function GET() {
  const skills = await readSkills();
  return NextResponse.json({ success: true, skills });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const skills = await readSkills();
  const newSkill = {
    id: body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: body.name,
    linkedPosts: body.linkedPosts || [] // Array of { title, slug }
  };
  skills.push(newSkill);
  await fs.mkdir(path.dirname(skillsFile), { recursive: true });
  await fs.writeFile(skillsFile, JSON.stringify(skills, null, 2));
  return NextResponse.json({ success: true, skill: newSkill });
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const skills = await readSkills();
  const idx = skills.findIndex(s => s.id === body.id);
  if (idx === -1) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

  skills[idx] = { ...skills[idx], ...body };
  await fs.writeFile(skillsFile, JSON.stringify(skills, null, 2));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const { id } = await request.json();
  let skills = await readSkills();
  skills = skills.filter(s => s.id !== id);
  await fs.writeFile(skillsFile, JSON.stringify(skills, null, 2));
  return NextResponse.json({ success: true });
}
