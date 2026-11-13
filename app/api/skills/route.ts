import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { publicQuestion, revealedQuestion } from '@/lib/daily/grade';
import { boardSummary, buildQueue, levelHistory, nextSteps, subjectStats, type ReviewMode } from '@/lib/skills/model';
import { readSkills, readSkillsProgress, updateBoth, updateSkills, updateSkillsProgress } from '@/lib/skills/store';
import {
  SkillsInputError, addResource, addSubject, addTopic, answerGraded, asDailyQuestion, editResource, editSubject, editTopic, findItem, findItemAnywhere,
  findSubject, findTopic, importPlan, importQuestions, itemFeedback, moveItem, moveTopic, rateCard, rateTopics, removeItem, removeResource,
  removeSubject, removeTopic, resourceOf, retireItem, saveCard, tiePage, untiePage,
} from '@/lib/skills/edit';
import { reviewDays, skillsXp } from '@/lib/skills/xp';
import { describePages, materialFor, newTopicPage, notesPageChoices, readerShelf, skillsNotebook, syncReaderResources } from '@/lib/skills/links';
import { itemDifficulty, itemTitle, type Item, type ProgressData, type SkillAttempt, type Subject } from '@/lib/skills/types';

// The signed-in account's skills: subjects, their topics, resources and
// questions, and every answer. Each request only reads or writes the caller's
// own folder; signed out there's nothing here (401).

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const newId = () => crypto.randomBytes(9).toString('base64url');

const ok = (body: Record<string, unknown> = {}) => NextResponse.json({ success: true, ...body }, { headers: PRIVATE });

/** A question in a list: enough to show it, without the answer. */
function itemRow(item: Item, progress: ProgressData) {
  const attempts = progress.attempts.filter((a) => a.itemId === item.id);
  const last = attempts[attempts.length - 1];
  const schedule = progress.schedule[item.id];
  return {
    id: item.id, kind: item.kind, topicId: item.topicId, title: itemTitle(item), difficulty: itemDifficulty(item), source: item.source,
    createdAt: item.createdAt, retired: !!item.retired, feedback: item.feedback ?? null,
    answers: attempts.length, lastScore: last?.score ?? null, lastDay: last?.day ?? null, due: schedule?.due ?? null,
  };
}

/** What the review page needs to ask a question: graded ones without their answer key. */
function askable(item: Item, subject: Subject, topicName: string) {
  const base = { id: item.id, kind: item.kind, subjectId: subject.id, subjectName: subject.name, subjectIcon: subject.icon, topicId: item.topicId, topicName };
  if (item.kind === 'card') return { ...base, difficulty: item.difficulty, front: item.front, back: item.back, feedback: item.feedback ?? null };
  return { ...base, difficulty: item.question.difficulty, question: publicQuestion(asDailyQuestion(item.question, topicName)), feedback: item.feedback ?? null };
}

/** A finished graded question as QuestionCard shows it. */
function answeredView(item: Item & { kind: 'graded' }, topicName: string, attempt: SkillAttempt, parts: { id: string; correct: boolean; mistake?: string }[], correct: number, total: number) {
  return {
    status: attempt.status, correct, total, parts, responses: attempt.responses ?? null, hints: attempt.hints ?? 0, tries: attempt.tries ?? 1, xp: 0,
    question: revealedQuestion(asDailyQuestion(item.question, topicName)),
    feedback: { rating: item.feedback?.rating ?? null, difficulty: item.feedback?.difficulty ?? null, report: item.feedback?.report ?? null },
  };
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const [data, progress] = await Promise.all([readSkills(userId), readSkillsProgress(userId)]);
    // Books linked to the Reader take their progress from it; only written when something moved.
    if (await syncReaderResources(userId, data)) await updateSkills(userId, (fresh) => syncReaderResources(userId, fresh));

    if (params.get('shelf') !== null) return ok({ books: await readerShelf(userId) });
    if (params.get('notesPages') !== null) return ok({ notebooks: await notesPageChoices(userId) });
    if (params.get('material') !== null) {
      const subject = findSubject(data, params.get('subject'));
      const topics = (params.get('topics') ?? '').split(',').filter(Boolean);
      return ok({ material: await materialFor(userId, subject, topics) });
    }

    const itemId = params.get('item');
    if (itemId !== null) {
      const { subject, item } = findItemAnywhere(data, itemId);
      const topic = subject.topics.find((t) => t.id === item.topicId);
      return ok({
        item: item.kind === 'graded' ? { ...item, question: revealedQuestion(asDailyQuestion(item.question, topic?.name ?? '')) } : item,
        row: itemRow(item, progress),
        attempts: progress.attempts.filter((a) => a.itemId === item.id).slice(-20),
      });
    }

    if (params.get('review') !== null) {
      const mode = (['due', 'weak', 'all'] as const).find((m) => m === params.get('mode')) as ReviewMode | undefined;
      const limit = Math.min(50, Math.max(1, Number(params.get('limit')) || 20));
      const queue = buildQueue(data, progress, today, { subjectId: params.get('subject') ?? undefined, topicId: params.get('topic') ?? undefined, itemId: params.get('one') ?? undefined, mode, limit });
      return ok({ queue: queue.map((e) => ({ ...askable(e.item, e.subject, e.topic.name), reason: e.reason })) });
    }

    const subjectId = params.get('subject');
    if (subjectId !== null) {
      const subject = findSubject(data, subjectId);
      const stats = subjectStats(subject, progress, today);
      return ok({
        subject: { ...subject, items: undefined },
        items: subject.items.map((i) => itemRow(i, progress)),
        stats,
        nextSteps: nextSteps(subject, stats, today),
        history: levelHistory(subject, progress, today),
        topicPages: Object.fromEntries(await Promise.all(subject.topics.filter((t) => t.notePages?.length).map(async (t) => [t.id, await describePages(userId, t.notePages!)] as const))),
        areas: [...new Set(data.subjects.map((s) => s.area))].sort(),
      });
    }

    return ok({ board: boardSummary(data, progress, today), xp: skillsXp(data, progress), reviewDays: reviewDays(progress).slice(-60) });
  } catch (error) {
    if (error instanceof SkillsInputError) return handleApiError(new ApiError(404, error.message));
    return handleApiError(error, 'Load skills failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const now = new Date().toISOString();

    switch (body.action) {
      // ── Subjects ──
      case 'add-subject': {
        const subject = await updateSkills(userId, (data) => addSubject(data, body, newId, now));
        return ok({ id: subject.id });
      }
      case 'edit-subject':
        await updateSkills(userId, (data) => editSubject(findSubject(data, body.subjectId), body.changes ?? {}, now));
        return ok();
      case 'remove-subject':
        await updateBoth(userId, (data, progress) => removeSubject(data, progress, body.subjectId));
        return ok();

      // ── Topics ──
      case 'add-topic': {
        const topic = await updateSkills(userId, (data) => addTopic(findSubject(data, body.subjectId), body, newId, now));
        return ok({ id: topic.id });
      }
      case 'edit-topic':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          editTopic(subject, findTopic(subject, body.topicId), body.changes ?? {}, today, now);
        });
        return ok();
      case 'rate-topics':
        await updateSkills(userId, (data) => rateTopics(findSubject(data, body.subjectId), body.ratings, today, now));
        return ok();
      case 'move-topic':
        await updateSkills(userId, (data) => moveTopic(findSubject(data, body.subjectId), body.topicId, body.direction));
        return ok();
      case 'remove-topic':
        await updateBoth(userId, (data, progress) => removeTopic(findSubject(data, body.subjectId), progress, body.topicId, now));
        return ok();

      // ── Notes pages on topics ──
      case 'topic-notes-new': {
        const origin = new URL(request.url).origin;
        const ref = await updateSkills(userId, async (data) => {
          const subject = findSubject(data, body.subjectId);
          const topic = findTopic(subject, body.topicId);
          const made = await newTopicPage(userId, await skillsNotebook(userId, data), subject, topic, origin);
          tiePage(subject, topic, made, now);
          return made;
        });
        return ok({ page: ref, href: `/notes?notebook=${encodeURIComponent(ref.notebook)}&page=${encodeURIComponent(ref.page)}` });
      }
      case 'topic-notes-tie':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          tiePage(subject, findTopic(subject, body.topicId), body, now);
        });
        return ok();
      case 'topic-notes-untie':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          untiePage(subject, findTopic(subject, body.topicId), body.page, now);
        });
        return ok();

      // ── Resources ──
      case 'add-resource': {
        const resource = await updateSkills(userId, (data) => addResource(findSubject(data, body.subjectId), body, newId, today, now));
        return ok({ id: resource.id });
      }
      case 'edit-resource':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          editResource(subject, resourceOf(subject, body.resourceId), body.changes ?? {}, today, now);
        });
        return ok();
      case 'remove-resource':
        await updateSkills(userId, (data) => removeResource(findSubject(data, body.subjectId), body.resourceId, now));
        return ok();

      // ── From an AI ──
      case 'import-plan': {
        const result = await updateSkills(userId, (data) => importPlan(findSubject(data, body.subjectId), body.reply, body, newId, now));
        return ok(result);
      }
      case 'import-questions': {
        const result = await updateSkills(userId, (data) => importQuestions(findSubject(data, body.subjectId), body.reply, body, newId, now));
        return ok(result);
      }

      // ── Questions ──
      case 'save-card': {
        const card = await updateSkills(userId, (data) => saveCard(findSubject(data, body.subjectId), body, newId, now));
        return ok({ id: card.id });
      }
      case 'move-item':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          moveItem(subject, findItem(subject, body.itemId), body.topicId, now);
        });
        return ok();
      case 'retire-item':
        await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          retireItem(subject, findItem(subject, body.itemId), body.retired !== false, now);
        });
        return ok();
      case 'remove-item':
        await updateBoth(userId, (data, progress) => {
          const subject = findSubject(data, body.subjectId);
          removeItem(subject, progress, findItem(subject, body.itemId), now);
        });
        return ok();
      case 'feedback': {
        const feedback = await updateSkills(userId, (data) => {
          const { subject, item } = findItemAnywhere(data, body.itemId);
          return itemFeedback(subject, item, body.changes ?? {}, now);
        });
        return ok({ feedback });
      }

      // ── Answering ──
      case 'answer': {
        const data = await readSkills(userId);
        const { subject, item } = findItemAnywhere(data, body.itemId);
        if (item.kind !== 'graded') throw new SkillsInputError('That one is a card.');
        const topicName = subject.topics.find((t) => t.id === item.topicId)?.name ?? '';
        // Answering only changes progress.json; the questions are just read.
        const out = await updateSkillsProgress(userId, (progress) => answerGraded(subject, item, progress, body, newId, today, now));
        if (!out.final) return ok({ result: out });
        return ok({ result: { final: true, ...answeredView(item, topicName, out.attempt, out.result.parts, out.result.correct, out.result.total) } });
      }
      case 'rate-card': {
        const { subject, item } = findItemAnywhere(await readSkills(userId), body.itemId);
        const attempt = await updateSkillsProgress(userId, (progress) => rateCard(subject, item, progress, body.rating, newId, today, now));
        return ok({ attempt });
      }

      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof SkillsInputError) return handleApiError(new ApiError(400, error.message));
    return handleApiError(error, 'Save skills failed');
  }
}
