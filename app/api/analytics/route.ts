import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const analyticsFile = path.join(process.cwd(), '.data', 'analytics.json');

export async function GET() {
  try {
    const isAdmin = await isAdminAuthenticated();
    if (!isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    try {
      await fs.access(analyticsFile);
    } catch {
      return NextResponse.json({ success: true, visits: [] });
    }

    const data = await fs.readFile(analyticsFile, 'utf-8');
    const visits = JSON.parse(data);
    return NextResponse.json({ success: true, visits });
  } catch (error) {
    console.error("Analytics GET Error:", error);
    return NextResponse.json({ success: false, message: "Error reading analytics" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const visitPath = body.path || '/';

    const analyticsDir = path.join(process.cwd(), '.data');
    try {
      await fs.access(analyticsDir);
    } catch {
      await fs.mkdir(analyticsDir, { recursive: true });
    }

    let visits = [];
    try {
      const data = await fs.readFile(analyticsFile, 'utf-8');
      visits = JSON.parse(data);
    } catch {
      visits = [];
    }

    // append new visit
    visits.push({
      timestamp: new Date().toISOString(),
      path: visitPath,
    });

    // Optional: limit to last 10,000 to prevent ballooning file size
    if (visits.length > 10000) {
      visits = visits.slice(visits.length - 10000);
    }

    await fs.writeFile(analyticsFile, JSON.stringify(visits));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Analytics POST Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
