import { NextResponse } from 'next/server';
import { getPrompts, listPacks } from '@/lib/party/prompts';

// Public: pack names and sizes for the host's lobby picker (no prompt text).
export async function GET() {
  return NextResponse.json({ success: true, packs: listPacks(await getPrompts()) });
}
