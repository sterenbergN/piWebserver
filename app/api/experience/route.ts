import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const experienceFile = path.join(process.cwd(), 'public', 'content', 'experience.json');

async function readExperience(): Promise<any[]> {
  try {
    const raw = await fs.readFile(experienceFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function GET() {
  const experience = await readExperience();
  return NextResponse.json({ success: true, experience });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const experience = await readExperience();
  const newEntry = {
    id: body.company.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now(),
    role: body.role,
    company: body.company,
    period: body.period,
    description: body.description || '',
    details: body.details || [] // Array of strings
  };
  experience.push(newEntry);
  await fs.mkdir(path.dirname(experienceFile), { recursive: true });
  await fs.writeFile(experienceFile, JSON.stringify(experience, null, 2));
  return NextResponse.json({ success: true, entry: newEntry });
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const body = await request.json();
  const experience = await readExperience();
  const idx = experience.findIndex(e => e.id === body.id);
  if (idx === -1) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

  experience[idx] = { ...experience[idx], ...body };
  await fs.writeFile(experienceFile, JSON.stringify(experience, null, 2));
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });

  const { id } = await request.json();
  let experience = await readExperience();
  experience = experience.filter(e => e.id !== id);
  await fs.writeFile(experienceFile, JSON.stringify(experience, null, 2));
  return NextResponse.json({ success: true });
}
