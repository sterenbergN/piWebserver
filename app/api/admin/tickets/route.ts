import { NextResponse } from 'next/server';
import { readJson, updateJson } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { forgetEnabledCache, settingsFile, ticketsFile } from '@/lib/tickets/store';
import { emptySettings, emptyTickets, isNew, normalizeSettings, normalizeTickets, type TicketSettings } from '@/lib/tickets/tickets';
import { loadUsersData } from '@/lib/workout/users';

// Admin view of tickets. GET returns everything (or just `?count=1` for the Admin tab's
// badge), PUT chooses which accounts can file tickets.

export const dynamic = 'force-dynamic';
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const { tickets } = normalizeTickets(await readJson(ticketsFile(), emptyTickets()));
  const newCount = tickets.filter(isNew).length;
  if (new URL(request.url).searchParams.get('count')) return NextResponse.json({ new: newCount });

  const settings = normalizeSettings(await readJson(settingsFile(), emptySettings()));
  const users = await loadUsersData().catch(() => ({ users: [] as Record<string, any>[], deletedUserIds: [] as string[] }));
  const deleted = new Set(users.deletedUserIds ?? []);
  const accounts = users.users.filter((u) => !deleted.has(u.id)).map((u) => ({ id: String(u.id), username: String(u.username ?? u.id) }));
  return NextResponse.json({ tickets, newCount, accounts, enabledUserIds: settings.enabledUserIds });
}

export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.enabledUserIds)) return NextResponse.json({ error: 'Expected enabledUserIds' }, { status: 400 });
  const next: TicketSettings = normalizeSettings({ enabledUserIds: body.enabledUserIds });
  await updateJson<TicketSettings>(settingsFile(), emptySettings(), (stored) => { stored.enabledUserIds = next.enabledUserIds; });
  forgetEnabledCache();
  return NextResponse.json({ enabledUserIds: next.enabledUserIds });
}
