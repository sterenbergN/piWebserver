import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { deletePost, listPosts, savePost } from '@/lib/journal/private-posts';

// The signed-in account's private posts: list them, save one (create or
// update), or delete one. Only ever the caller's own.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    return NextResponse.json({ success: true, posts: await listPosts(userId) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load private posts failed');
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    let post;
    try {
      post = await savePost(userId, body);
    } catch (error) {
      if (error instanceof Error && error.message === 'Bad post id') throw new ApiError(400, error.message);
      throw error;
    }
    return NextResponse.json({ success: true, post }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save private post failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id') || '';
    return NextResponse.json({ success: await deletePost(userId, id) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Delete private post failed');
  }
}
