import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { courseCenter, normalizeCourse } from '@/lib/golf/course';
import { readCourses, updateCourses } from '@/lib/golf/store';

/** Every course anyone has added. There are only ever a handful, so the phone filters them. */
export async function GET() {
  try {
    await requireWorkoutUserId();
    return NextResponse.json({ success: true, courses: await readCourses() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Golf courses');
  }
}

/** Add a course. The phone makes the id, so a retry returns the course already saved. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const course = normalizeCourse({ ...body.course, createdBy: userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (!course) throw new ApiError(400, 'A course needs a name and at least one hole');
    const center = courseCenter(course);
    if (center) course.center = center;
    const saved = await updateCourses((courses) => {
      const existing = courses.find((c) => c.id === course.id);
      if (existing) return existing;
      if (courses.length >= 500) throw new ApiError(400, 'Too many courses');
      courses.push(course);
      return course;
    });
    return NextResponse.json({ success: true, course: saved });
  } catch (error) {
    return handleApiError(error, 'Add golf course');
  }
}
