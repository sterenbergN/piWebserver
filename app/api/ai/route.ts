import { NextResponse } from 'next/server';
import { modelForTask, savedCatalog } from '@/lib/ai/catalog';
import { aiCaller } from '@/lib/ai/server';
import { PROVIDERS } from '@/lib/ai/providers-list';
import { connectionFor, getAiSettings } from '@/lib/ai/settings';
import { AI_TASK_IDS } from '@/lib/ai/tasks';

export const dynamic = 'force-dynamic';

/** Whether this visitor gets a Generate button (their own key, or the site's if they may share it), and with which models. Never the key. */
export async function GET() {
  const caller = await aiCaller();
  if (!caller) return NextResponse.json({ ready: false });
  try {
    const settings = await getAiSettings();
    const conn = connectionFor(settings, caller.who);
    if (!conn) return NextResponse.json({ ready: false });
    // The saved model list only: this runs on every page with a Generate button, so it never waits on the provider.
    const catalog = await savedCatalog(conn);
    const models = Object.fromEntries(AI_TASK_IDS.map((task) => [task, modelForTask(conn, catalog, task).label]));
    return NextResponse.json({ ready: true, provider: PROVIDERS[conn.provider].label, model: modelForTask(conn, catalog).label, models });
  } catch {
    return NextResponse.json({ ready: false });
  }
}
