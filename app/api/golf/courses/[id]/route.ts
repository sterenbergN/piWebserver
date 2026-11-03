import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { cleanLayout, cleanPoint, courseCenter, normalizeCourse } from '@/lib/golf/course';
import { updateCourses } from '@/lib/golf/store';

/**
 * Change a course. Two kinds of change:
 * - `{ hole: { layoutId, n, tee?, target?, par? } }` sets one hole's tee, target or par,
 *   which is what a round in progress sends, so two groups out at once don't undo each other;
 * - `{ course }` replaces the name and layouts, from the course editor.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireWorkoutUserId();
    const { id } = await ctx.params;
    const body = await readJsonObject(request);
    const course = await updateCourses((courses) => {
      const course = courses.find((c) => c.id === id);
      if (!course) throw new ApiError(404, 'Course not found');
      if (body.hole && typeof body.hole === 'object') {
        const layout = course.layouts.find((l) => l.id === body.hole.layoutId);
        const hole = layout?.holes[Number(body.hole.n) - 1];
        if (!hole) throw new ApiError(404, 'Hole not found');
        const tee = cleanPoint(body.hole.tee);
        const target = cleanPoint(body.hole.target);
        if (tee) hole.tee = tee;
        if (target) hole.target = target;
        const par = Number(body.hole.par);
        if (Number.isInteger(par) && par >= 2 && par <= 7) hole.par = par;
      } else if (body.course && typeof body.course === 'object') {
        const next = normalizeCourse({ ...body.course, id: course.id, sport: course.sport, createdBy: course.createdBy, createdAt: course.createdAt });
        if (!next) throw new ApiError(400, 'A course needs at least one hole');
        course.name = next.name;
        course.layouts = next.layouts.map((l) => cleanLayout(l, course.sport)!);
      } else {
        throw new ApiError(400, 'Nothing to change');
      }
      course.updatedAt = new Date().toISOString();
      const center = courseCenter(course);
      if (center) course.center = center;
      return course;
    });
    return NextResponse.json({ success: true, course });
  } catch (error) {
    return handleApiError(error, 'Change golf course');
  }
}

/** Only whoever added a course can delete it. Rounds played there keep their copy of the name and pars. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const { id } = await ctx.params;
    await updateCourses((courses) => {
      const i = courses.findIndex((c) => c.id === id);
      if (i === -1) throw new ApiError(404, 'Course not found');
      if (courses[i].createdBy !== userId) throw new ApiError(403, 'Only whoever added a course can delete it');
      courses.splice(i, 1);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, 'Delete golf course');
  }
}
