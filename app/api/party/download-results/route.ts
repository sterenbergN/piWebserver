import fs from 'fs/promises';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json({ success: true });
}
