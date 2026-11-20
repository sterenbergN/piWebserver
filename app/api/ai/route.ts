import { NextResponse } from 'next/server';
import { aiCaller } from '@/lib/ai/server';
import { PROVIDERS } from '@/lib/ai/providers-list';
import { getAiSettings, isAiReady, mayUseAi } from '@/lib/ai/settings';

export const dynamic = 'force-dynamic';

/** Whether this visitor gets a Generate button: an AI connected, and allowed to use it. Never the key. */
export async function GET() {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ ready: false });
  try {
    const settings = await getAiSettings();
    if (!isAiReady(settings) || !mayUseAi(settings, caller.who)) return NextResponse.json({ ready: false });
    return NextResponse.json({ ready: true, provider: PROVIDERS[settings.provider].label, model: settings.model });
  } catch {
    return NextResponse.json({ ready: false });
  }
}
