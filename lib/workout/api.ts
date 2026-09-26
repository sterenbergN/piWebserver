import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

/** An error that maps directly to an HTTP response. Throw it from route logic
 *  (including inside updateWorkoutData mutators, which aborts the write). */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

export function handleApiError(error: unknown, context?: string) {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.message);
  }
  console.error(context ? `${context}:` : 'Workout API error:', error);
  return jsonError(500, 'Server error');
}

export async function requireWorkoutUserId(): Promise<string> {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) throw new ApiError(401, 'Unauthorized');
  return userId;
}

/** Parse a JSON object body, rejecting malformed or non-object payloads with a 400. */
export async function readJsonObject(request: Request): Promise<Record<string, any>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Expected a JSON object');
  }
  return body as Record<string, any>;
}

/** Remove fields a client must never be able to set on an owned record. */
export function stripProtectedFields<T extends Record<string, any>>(value: T): Omit<T, 'id' | 'ownerId' | 'createdAt' | 'shareToken'> {
  // shareToken is only ever set by the share endpoint, never by a client PUT.
  const { id, ownerId, createdAt, shareToken, ...rest } = value;
  return rest;
}
