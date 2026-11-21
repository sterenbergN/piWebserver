import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { toGtin13 } from '@/lib/food/barcode';
import { lookupBarcode } from '@/lib/food/sources';
import { forViewer } from '@/lib/food/foods';

// A packaged food by barcode (?code=…): the library, then FatSecret, then Open Food Facts.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const raw = new URL(request.url).searchParams.get('code') || '';
    const gtin = toGtin13(raw.slice(0, 20));
    if (!gtin) throw new ApiError(400, 'That barcode doesn’t add up. Check the digits.');
    const result = await lookupBarcode(gtin, userId);
    return NextResponse.json({ success: true, barcode: gtin, ...result, food: forViewer(result.food) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Barcode lookup failed');
  }
}
