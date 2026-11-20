import { NextResponse } from 'next/server';
import { modelForTask, savedCatalog } from '@/lib/ai/catalog';
import { aiCaller } from '@/lib/ai/server';
import { PROVIDERS } from '@/lib/ai/providers-list';
import { getAiSettings, isAiReady, mayUseAi } from '@/lib/ai/settings';
import { AI_TASK_IDS } from '@/lib/ai/tasks';

export const dynamic = 'force-dynamic';

/** Whether this visitor gets a Generate button: an AI connected, and allowed to use it. Never the key. */
export async function GET() {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ ready: false });
  try {
    const settings = await getAiSettings();
    if (!isAiReady(settings) || !mayUseAi(settings, caller.who)) return NextResponse.json({ ready: false });
    // The saved model list only: this runs on every page with a Generate button, so it never waits on the provider.
    const catalog = await savedCatalog(settings);
    const models = Object.fromEntries(AI_TASK_IDS.map((task) => [task, modelForTask(settings, catalog, task).label]));
    return NextResponse.json({ ready: true, provider: PROVIDERS[settings.provider].label, model: modelForTask(settings, catalog).label, models });
  } catch {
    return NextResponse.json({ ready: false });
  }
}
