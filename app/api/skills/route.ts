import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { publicQuestion, revealedQuestion } from '@/lib/daily/grade';
import { boardSummary, buildQueue, levelHistory, nextSteps, subjectStats, wouldCreateSkillCycle, type ReviewMode } from '@/lib/skills/model';
import { readSkills, readSkillsProgress, updateBoth, updateSkills, updateSkillsProgress } from '@/lib/skills/store';
import {
  SkillsInputError, addResource, addSubject, addTopic, answerGraded, applySkillEdit, asDailyQuestion, editResource, editSubject, editTopic,
  findItem, findItemAnywhere, findSubject, findTopic, importPlan, importQuestions, itemFeedback, moveItem, moveTopic, rateCard, rateTopics,
  removeItem, removeResource, removeSubject, removeTopic, resourceOf, retireItem, saveCard, setParents, tiePage, untiePage,
} from '@/lib/skills/edit';
import { parseInquiryReply, parsePlanReply, sameName } from '@/lib/skills/parse';
import { buildInquiryPrompt } from '@/lib/skills/prompts';
import { reviewDays, skillsXp } from '@/lib/skills/xp';
import { buildKnowledgeGraph, describePages, materialFor, newTopicPage, notesPageChoices, readerShelf, skillsNotebook, syncReaderResources } from '@/lib/skills/links';
import {
  itemDifficulty, itemTitle,
  type Item, type KnowledgeInquiry, type ProgressData, type ProjectLogEntry, type ScheduledSkillTask, type SkillAttempt,
  type SkillEdit, type SkillSchedule, type SkillStep, type Subject,
} from '@/lib/skills/types';

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

    // Every subject with its topics' standing, in one request: what the planner across subjects reads.
    if (params.get('all') !== null) {
      return ok({
        board: boardSummary(data, progress, today),
        subjects: data.subjects.map((s) => ({ subject: { ...s, items: undefined }, stats: subjectStats(s, progress, today) })),
      });
    }

    if (params.get('knowledge') !== null) {
      const requestedSubject = params.get('subject');
      const focusedId = requestedSubject !== null && requestedSubject !== '' ? findSubject(data, requestedSubject).id : undefined;
      const { nodes, edges, bundle } = await buildKnowledgeGraph(userId, data, focusedId);
      return ok({
        graph: { nodes, edges },
        bundle,
        inquiries: data.inquiries ?? [],
        subjects: data.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon,
          area: s.area,
          topics: s.topics.map((t) => ({ id: t.id, name: t.name })),
        })),
      });
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
        allSubjects: data.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon,
          area: s.area,
          status: s.status,
          level: subjectStats(s, progress, today).level,
          parentIds: s.parentIds ?? [],
        })),
        inquiries: (data.inquiries ?? []).filter((q) => q.subjectId === subject.id),
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
        const result = await updateSkills(userId, (data) => {
          const subject = findSubject(data, body.subjectId);
          const imported = importPlan(subject, body.reply, body, newId, now);
          if (body.includeParents === true) {
            const parsed = parsePlanReply(typeof body.reply === 'string' ? body.reply : '', subject);
            if (parsed.parentSubjects.length) {
              const nextParents = [...(subject.parentIds ?? [])];
              for (const ref of parsed.parentSubjects) {
                const parent = data.subjects.find((s) => s.id === ref || sameName(s.name, ref));
                if (
                  parent
                  && parent.id !== subject.id
                  && !nextParents.includes(parent.id)
                  && !wouldCreateSkillCycle(data, subject.id, parent.id)
                ) {
                  nextParents.push(parent.id);
                }
              }
              if (nextParents.length) setParents(data, subject.id, nextParents, now);
            }
          }
          return imported;
        });
        return ok(result);
      }
      case 'import-questions': {
        const result = await updateSkills(userId, (data) => importQuestions(findSubject(data, body.subjectId), body.reply, body, newId, now));
        return ok(result);
      }

      // ── Interconnected parents & explicit study steps ──
      case 'set-parents':
        await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'set-parents' } as unknown as SkillEdit, newId, today, now));
        return ok();
      case 'add-step': {
        const step = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'add-step' } as unknown as SkillEdit, newId, today, now) as SkillStep);
        return ok({ id: step.id, step });
      }
      case 'edit-step':
      case 'toggle-step': {
        const step = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, ...(body.action === 'edit-step' ? { changes: body.changes ?? {} } : {}), op: body.action } as unknown as SkillEdit, newId, today, now) as SkillStep);
        return ok({ step });
      }
      case 'move-step':
      case 'remove-step':
        await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: body.action } as unknown as SkillEdit, newId, today, now));
        return ok();

      // ── Multi-day schedule & interconnected AI plan ──
      case 'set-schedule':
      case 'rebuild-schedule-from-steps': {
        const schedule = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: body.action } as unknown as SkillEdit, newId, today, now) as SkillSchedule);
        return ok({ schedule });
      }
      case 'shift-schedule':
      case 'toggle-schedule-task':
      case 'apply-interconnected-plan': {
        const result = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: body.action } as unknown as SkillEdit, newId, today, now) as Record<string, unknown>);
        return ok(result);
      }
      case 'add-schedule-task': {
        const task = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'add-schedule-task' } as unknown as SkillEdit, newId, today, now) as ScheduledSkillTask);
        return ok({ id: task.id, task });
      }
      case 'remove-schedule-task':
        await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'remove-schedule-task' } as unknown as SkillEdit, newId, today, now));
        return ok();

      // ── Project logs ──
      case 'add-project-log': {
        const log = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'add-project-log' } as unknown as SkillEdit, newId, today, now) as ProjectLogEntry);
        return ok({ id: log.id, log });
      }
      case 'edit-project-log': {
        const log = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, changes: body.changes ?? {}, op: 'edit-project-log' } as unknown as SkillEdit, newId, today, now) as ProjectLogEntry);
        return ok({ log });
      }
      case 'remove-project-log':
        await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'remove-project-log' } as unknown as SkillEdit, newId, today, now));
        return ok();

      // ── Knowledge lookups & running inbox ──
      case 'add-inquiry': {
        const inquiry = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'add-inquiry' } as unknown as SkillEdit, newId, today, now) as KnowledgeInquiry);
        return ok({ id: inquiry.id, inquiry });
      }
      case 'import-inquiries': {
        const result = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'import-inquiries' } as unknown as SkillEdit, newId, today, now) as Record<string, unknown>);
        return ok(result);
      }
      case 'edit-inquiry': {
        const inquiry = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, changes: body.changes ?? {}, op: 'edit-inquiry' } as unknown as SkillEdit, newId, today, now) as KnowledgeInquiry);
        return ok({ inquiry });
      }
      case 'toggle-inquiry': {
        const inquiry = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'toggle-inquiry' } as unknown as SkillEdit, newId, today, now) as KnowledgeInquiry);
        return ok({ inquiry });
      }
      case 'remove-inquiry':
        await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'remove-inquiry' } as unknown as SkillEdit, newId, today, now));
        return ok();
      case 'promote-inquiry-to-card': {
        const result = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'promote-inquiry-to-card' } as unknown as SkillEdit, newId, today, now) as Record<string, unknown>);
        return ok(result);
      }
      case 'apply-inquiry-answers': {
        const result = await updateSkills(userId, (data) => applySkillEdit(data, { ...body, op: 'apply-inquiry-answers' } as unknown as SkillEdit, newId, today, now) as Record<string, unknown>);
        return ok(result);
      }
      case 'inquiry-prompt': {
        const data = await readSkills(userId);
        const inquiryIds = Array.isArray(body.inquiryIds)
          ? body.inquiryIds.filter((id): id is string => typeof id === 'string')
          : undefined;
        return ok({ prompt: buildInquiryPrompt(data, inquiryIds) });
      }
      case 'parse-inquiry-reply': {
        const data = await readSkills(userId);
        const parsed = parseInquiryReply(typeof body.reply === 'string' ? body.reply : '', data);
        return ok({ parsed });
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
