import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const STATS_HISTORY_FILE = path.join(process.cwd(), 'public', 'stats-history.json');

export async function GET() {
  try {
    const raw = await fs.readFile(STATS_HISTORY_FILE, 'utf-8');
    const history = JSON.parse(raw);
    return NextResponse.json({ success: true, history });
  } catch (err) {
    return NextResponse.json({ success: false, history: [] });
  }
}
