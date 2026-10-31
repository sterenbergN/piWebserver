import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clientAddress, createLimiter } from '@/lib/security/rate-limit';
import { HouseholdError, joinHousehold, leaveHousehold, setInvite } from '@/lib/chores/households';
import { isDateKey } from '@/lib/habits/dates';

// Sharing a household: make or turn off an invite code, join one, or leave. What
// it shares is at /api/chores and /api/recipes/kitchen.

// Wrong codes: 10 tries per account and address per 15 minutes.
const wrongCodes = createLimiter({ max: 10, windowMs: 15 * 60_000 });

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = isDateKey(body.today) ? body.today : new Date().toISOString().slice(0, 10);
    try {
      switch (body.op) {
        case 'invite': {
          const household = await setInvite(userId, true);
          return NextResponse.json({ success: true, invite: household.invite });
        }
        case 'invite-off': {
          await setInvite(userId, false);
          return NextResponse.json({ success: true, invite: null });
        }
        case 'join': {
          const key = `${userId}:${clientAddress(request)}`;
          const wait = wrongCodes.retryAfter(key);
          if (wait) throw new ApiError(429, `Too many wrong codes. Try again in ${Math.ceil(wait / 60)} min.`);
          try {
            await joinHousehold(userId, String(body.code || ''), today);
          } catch (error) {
            if (error instanceof HouseholdError) wrongCodes.hit(key);
            throw error;
          }
          return NextResponse.json({ success: true });
        }
        case 'leave': {
          await leaveHousehold(userId);
          return NextResponse.json({ success: true });
        }
        default:
          throw new ApiError(400, 'Unknown change');
      }
    } catch (error) {
      if (error instanceof HouseholdError) throw new ApiError(400, error.message);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Household change failed');
  }
}
