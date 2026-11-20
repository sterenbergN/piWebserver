'use client';

import Link from 'next/link';
import GenerateReply from '@/components/ai/GenerateReply';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { skillsPost, type KnowledgeSubjectOption } from '@/components/skills/api';
import { ErrorNote } from '@/components/skills/Ui';
import WikiTextarea from '@/components/skills/WikiTextarea';
import {
  deckTagCounts,
  extractInquirySearchTerms,
  filterAndSortInquiries,
  formatInquiriesMarkdown,
  normalizeInquiryQuestionKey,
  parseBulkQAInput,
  type InquirySortMode,
} from '@/lib/skills/parse';
import type { DraftInquiryAnswer, InquiryStatus, KnowledgeInquiry, ParseResult } from '@/lib/skills/types';
import './knowledge.css';

export type InquiryDeskProps = {
  inquiries: KnowledgeInquiry[];
  subjects?: KnowledgeSubjectOption[];
  fixedSubjectId?: string;
  focusInquiryId?: string;
  onReload: () => Promise<void> | void;
  onSelectGraphNode?: (nodeId: string) => void;
  resolveWiki?: (target: string) => string | undefined;
  compact?: boolean;
};

type StatusTab = 'all' | InquiryStatus;

export function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const cleaned = part.trim().replace(/^#+/, '').replace(/[/_-]+$/, '').toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function parseSourcesInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Allow comma-separated plain source names on a single line while preserving URLs.
    const pieces = /^https?:\/\//i.test(trimmed) ? [trimmed] : trimmed.split(',');
    for (const piece of pieces) {
      const s = piece.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

export function previewRunningList(raw: string): string[] {
  return parseBulkQAInput(raw).map((item) => item.question);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function HighlightText({ text, terms }: { text: string; terms?: string[] }) {
  const parts = useMemo(() => {
    if (!text || !terms?.length) return null;
    const clean = terms.filter((t) => t.trim().length > 0);
    if (!clean.length) return null;
    const re = new RegExp(`(${clean.map(escapeRegExp).join('|')})`, 'gi');
    return text.split(re);
  }, [text, terms]);

  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((part, idx) =>
        idx % 2 === 1 ? (
          <mark key={idx} className="inq-highlight">{part}</mark>
        ) : (
          <Fragment key={idx}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function accordionPreviewSnippet(text: string, terms: string[], maxLen = 115): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  if (terms.length > 0) {
    const lower = flat.toLowerCase();
    let firstAt = -1;
    let firstLen = 0;
    for (const t of terms) {
      const idx = lower.indexOf(t.toLowerCase());
      if (idx >= 0 && (firstAt < 0 || idx < firstAt)) {
        firstAt = idx;
        firstLen = t.length;
      }
    }
    if (firstAt >= 0) {
      const start = Math.max(0, firstAt - 45);
      const end = Math.min(flat.length, firstAt + firstLen + 65);
      return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
    }
  }
  return flat.length > maxLen ? `${flat.slice(0, maxLen)}…` : flat;
}

function localConceptAlias(question: string): string {
  return question
    .trim()
    .replace(/^(?:what\s+(?:is|are)|how\s+(?:does|do|to)|why\s+(?:is|are|do|does)|when\s+(?:is|to)|who\s+is)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function RichInquiryText({
  text,
  resolveWiki,
  onSelectGraphNode,
  onFilterTag,
  inquiries,
  subjects,
  onFocusInquiry,
  highlightTerms,
}: {
  text: string;
  resolveWiki?: (target: string) => string | undefined;
  onSelectGraphNode?: (nodeId: string) => void;
  onFilterTag?: (tag: string) => void;
  inquiries?: KnowledgeInquiry[];
  subjects?: KnowledgeSubjectOption[];
  onFocusInquiry?: (inquiryId: string) => void;
  highlightTerms?: string[];
}) {
  const tokens = useMemo(() => {
    const list: Array<{ type: 'text' | 'wiki' | 'url' | 'tag'; raw: string; value: string }> = [];
    const re = /\[\[([^[\]\r\n]+?)\]\]|(https?:\/\/[^\s<>"')]+)|(?:^|(?<=[\s(\[{,;:]))#([a-zA-Z][a-zA-Z0-9_/-]{0,63})/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        list.push({ type: 'text', raw: text.slice(last, m.index), value: text.slice(last, m.index) });
      }
      if (m[1]) {
        const target = m[1].split('|')[0].trim();
        list.push({ type: 'wiki', raw: m[0], value: target });
      } else if (m[2]) {
        list.push({ type: 'url', raw: m[0], value: m[0] });
      } else if (m[3]) {
        const tag = m[3].replace(/[/_-]+$/, '').toLowerCase();
        if (/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(tag) || /^([a-f])\1\1$/i.test(tag)) {
          list.push({ type: 'text', raw: m[0], value: m[0] });
        } else {
          list.push({ type: 'tag', raw: m[0], value: tag });
        }
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      list.push({ type: 'text', raw: text.slice(last), value: text.slice(last) });
    }
    return list;
  }, [text]);

  const localResolve = (target: string): { kind: 'graph'; id: string } | { kind: 'inq'; id: string } | { kind: 'subject'; id: string } | null => {
    if (resolveWiki && onSelectGraphNode) {
      const nodeId = resolveWiki(target);
      if (nodeId) return { kind: 'graph', id: nodeId };
    }
    const key = target.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key) return null;
    const matchedInq = inquiries?.find(
      (q) => q.question.trim().replace(/\s+/g, ' ').toLowerCase() === key || localConceptAlias(q.question) === key,
    );
    if (matchedInq) {
      if (onSelectGraphNode) return { kind: 'graph', id: `inq:${matchedInq.id}` };
      return { kind: 'inq', id: matchedInq.id };
    }
    const matchedSub = subjects?.find((s) => s.name.trim().replace(/\s+/g, ' ').toLowerCase() === key);
    if (matchedSub) {
      if (onSelectGraphNode) return { kind: 'graph', id: `sub:${matchedSub.id}` };
      return { kind: 'subject', id: matchedSub.id };
    }
    return null;
  };

  return (
    <>
      {tokens.map((tok, idx) => {
        if (tok.type === 'wiki') {
          const resolved = localResolve(tok.value);
          if (!resolved) {
            return (
              <span key={idx} className="kv-inline-token is-unresolved">
                <HighlightText text={tok.raw} terms={highlightTerms} />
              </span>
            );
          }
          if (resolved.kind === 'graph' && onSelectGraphNode) {
            return (
              <button key={idx} type="button" className="kv-inline-token" onClick={() => onSelectGraphNode(resolved.id)}>
                <HighlightText text={tok.raw} terms={highlightTerms} />
              </button>
            );
          }
          if (resolved.kind === 'inq' && onFocusInquiry) {
            return (
              <button key={idx} type="button" className="kv-inline-token" onClick={() => onFocusInquiry(resolved.id)}>
                <HighlightText text={tok.raw} terms={highlightTerms} />
              </button>
            );
          }
          if (resolved.kind === 'subject') {
            return (
              <Link key={idx} className="kv-inline-token" href={`/skills/${resolved.id}`}>
                <HighlightText text={tok.raw} terms={highlightTerms} />
              </Link>
            );
          }
          return (
            <span key={idx} className="kv-inline-token is-unresolved">
              <HighlightText text={tok.raw} terms={highlightTerms} />
            </span>
          );
        }

        if (tok.type === 'tag') {
          return (
            <button
              key={idx}
              type="button"
              className="kv-inline-token is-tag"
              onClick={() => {
                if (onSelectGraphNode) onSelectGraphNode(`tag:${tok.value}`);
                else onFilterTag?.(tok.value);
              }}
            >
              <HighlightText text={tok.raw} terms={highlightTerms} />
            </button>
          );
        }

        if (tok.type === 'url') {
          return (
            <a key={idx} className="inq-source-link" href={tok.value} target="_blank" rel="noopener noreferrer">
              <HighlightText text={tok.raw} terms={highlightTerms} />
            </a>
          );
        }

        return <HighlightText key={idx} text={tok.value} terms={highlightTerms} />;
      })}
    </>
  );
}

export function InquiryEditForm({
  inquiry,
  subjects = [],
  fixedSubjectId,
  onSaved,
  onCancel,
  compact,
}: {
  inquiry: KnowledgeInquiry;
  subjects?: KnowledgeSubjectOption[];
  fixedSubjectId?: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const [question, setQuestion] = useState(inquiry.question);
  const [context, setContext] = useState(inquiry.context ?? '');
  const [answer, setAnswer] = useState(inquiry.answer ?? '');
  const [takeaways, setTakeaways] = useState(inquiry.takeaways ?? '');
  const [sourcesRaw, setSourcesRaw] = useState((inquiry.sources ?? []).join('\n'));
  const [tagsRaw, setTagsRaw] = useState((inquiry.tags ?? []).map((t) => `#${t}`).join(' '));
  const [subjectId, setSubjectId] = useState(fixedSubjectId ?? inquiry.subjectId ?? '');
  const [topicId, setTopicId] = useState(inquiry.topicId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const effectiveSubjectId = fixedSubjectId ?? subjectId;
  const availableTopics = useMemo(
    () => subjects.find((s) => s.id === effectiveSubjectId)?.topics ?? [],
    [subjects, effectiveSubjectId],
  );
  const validTopicId = availableTopics.some((t) => t.id === topicId) ? topicId : '';

  async function save(nextStatus?: InquiryStatus) {
    if (busy) return;
    if (!question.trim()) {
      setError('Question cannot be empty.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await skillsPost('edit-inquiry', {
        inquiryId: inquiry.id,
        changes: {
          question: question.trim(),
          context: context.trim(),
          answer: answer.trim(),
          takeaways: takeaways.trim(),
          sources: parseSourcesInput(sourcesRaw),
          tags: parseTagsInput(tagsRaw),
          subjectId: effectiveSubjectId || '',
          topicId: validTopicId || '',
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save lookup.');
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await skillsPost('toggle-inquiry', { inquiryId: inquiry.id, status: 'open' });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen lookup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? 'kv-inquiry-edit-box' : 'inq-edit-form'}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="sk-field">
        <span>Question</span>
        <input
          value={question}
          maxLength={300}
          required
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <label className="sk-field">
        <span>Context / Where I heard it</span>
        <input
          value={context}
          maxLength={600}
          placeholder="e.g. Mentioned in architecture review or podcast"
          onChange={(e) => setContext(e.target.value)}
        />
      </label>
      <label className="sk-field">
        <span>Answer</span>
        <WikiTextarea
          rows={compact ? 3 : 4}
          value={answer}
          placeholder="In your own words. Type [[ to link a topic or skill, # for a tag."
          onChange={(e) => setAnswer(e.target.value)}
        />
      </label>
      <label className="sk-field">
        <span>What to remember</span>
        <WikiTextarea
          rows={2}
          value={takeaways}
          placeholder="A line or three"
          onChange={(e) => setTakeaways(e.target.value)}
        />
      </label>
      <div className="sk-grid-2">
        <label className="sk-field">
          <span>Sources (one per line or comma-separated)</span>
          <textarea
            rows={2}
            value={sourcesRaw}
            placeholder="https://modelcontextprotocol.io&#10;Designing Data-Intensive Applications"
            onChange={(e) => setSourcesRaw(e.target.value)}
          />
        </label>
        <label className="sk-field">
          <span>Tags</span>
          <input
            value={tagsRaw}
            placeholder="#systems #architecture #ai"
            onChange={(e) => setTagsRaw(e.target.value)}
          />
        </label>
      </div>
      <div className="sk-grid-2">
        {!fixedSubjectId && (
          <label className="sk-field">
            <span>Skill</span>
            <select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTopicId('');
              }}
            >
              <option value="">No specific skill</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {availableTopics.length > 0 && (
          <label className="sk-field">
            <span>Topic</span>
            <select value={validTopicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">No specific topic</option>
              {availableTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="sk-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save('solved')}
        >
          {busy ? 'Saving…' : 'Save & Mark Solved'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void save()}
        >
          Save Changes
        </button>
        {inquiry.status === 'solved' && (
          <button
            type="button"
            className="sk-small-btn"
            disabled={busy}
            onClick={() => void reopen()}
          >
            Reopen
          </button>
        )}
        <button type="button" className="sk-text-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function InquiryDesk({
  inquiries,
  subjects = [],
  fixedSubjectId,
  focusInquiryId,
  onReload,
  onSelectGraphNode,
  resolveWiki,
  compact,
}: InquiryDeskProps) {
  const { confirm, popup } = useSitePopup();

  // Quick capture state
  const [qInput, setQInput] = useState('');
  const [qContext, setQContext] = useState('');
  const [qTags, setQTags] = useState('');
  const [qSubjectId, setQSubjectId] = useState(fixedSubjectId ?? '');
  const [qTopicId, setQTopicId] = useState('');
  const [showCaptureAnswer, setShowCaptureAnswer] = useState(false);
  const [qAnswer, setQAnswer] = useState('');
  const [qTakeaway, setQTakeaway] = useState('');
  const [qCreateCard, setQCreateCard] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);

  // Bulk import drawer
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSubjectId, setBulkSubjectId] = useState(fixedSubjectId ?? '');
  const [bulkTopicId, setBulkTopicId] = useState('');
  const [bulkTags, setBulkTags] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // AI Solve panel
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [excludedAiIds, setExcludedAiIds] = useState<Set<string>>(() => new Set());
  const [aiPrompt, setAiPrompt] = useState('');
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [aiReply, setAiReply] = useState('');
  const [pasteFailed, setPasteFailed] = useState(false);
  const [parsedReply, setParsedReply] = useState<ParseResult<DraftInquiryAnswer[]> | null>(null);
  const [offAnswers, setOffAnswers] = useState<Set<number>>(() => new Set());
  const [parseBusy, setParseBusy] = useState(false);
  const [createCards, setCreateCards] = useState(false);
  const [applyAiBusy, setApplyAiBusy] = useState(false);

  // Filter, explorer & display state
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<InquirySortMode>('open-first');
  const [viewMode, setViewMode] = useState<'cards' | 'accordion'>('cards');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [mdCopyState, setMdCopyState] = useState<'idle' | 'copied'>('idle');

  // Card editing & 1-click inline answer composer
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inlineAnswerId, setInlineAnswerId] = useState<string | null>(null);
  const [inlineAnswer, setInlineAnswer] = useState('');
  const [inlineTakeaway, setInlineTakeaway] = useState('');
  const [inlineCreateCard, setInlineCreateCard] = useState(false);
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(focusInquiryId ?? null);

  // Feedback
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const promptBoxRef = useRef<HTMLTextAreaElement>(null);
  const replyBoxRef = useRef<HTMLTextAreaElement>(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const effectiveQuickSubjectId = fixedSubjectId ?? qSubjectId;
  const quickTopics = useMemo(
    () => subjectMap.get(effectiveQuickSubjectId)?.topics ?? [],
    [subjectMap, effectiveQuickSubjectId],
  );
  const validQuickTopicId = quickTopics.some((t) => t.id === qTopicId) ? qTopicId : '';

  const effectiveBulkSubjectId = fixedSubjectId ?? bulkSubjectId;
  const bulkTopics = useMemo(
    () => subjectMap.get(effectiveBulkSubjectId)?.topics ?? [],
    [subjectMap, effectiveBulkSubjectId],
  );
  const validBulkTopicId = bulkTopics.some((t) => t.id === bulkTopicId) ? bulkTopicId : '';

  const scopedInquiries = useMemo(
    () => filterAndSortInquiries(inquiries, {
      fixedSubjectId,
      skillFilter,
      sort: sortMode,
      subjectLookup: subjectMap,
    }),
    [inquiries, fixedSubjectId, skillFilter, sortMode, subjectMap],
  );

  const openCount = useMemo(() => scopedInquiries.filter((q) => q.status === 'open').length, [scopedInquiries]);
  const solvedCount = useMemo(() => scopedInquiries.filter((q) => q.status === 'solved').length, [scopedInquiries]);
  const availableTags = useMemo(() => deckTagCounts(scopedInquiries), [scopedInquiries]);
  const searchTerms = useMemo(() => extractInquirySearchTerms(search), [search]);

  const filteredInquiries = useMemo(
    () => filterAndSortInquiries(inquiries, {
      fixedSubjectId,
      skillFilter,
      statusTab,
      tagFilter,
      search,
      sort: sortMode,
      subjectLookup: subjectMap,
    }),
    [inquiries, fixedSubjectId, skillFilter, statusTab, tagFilter, search, sortMode, subjectMap],
  );

  const filteredOpenInquiries = useMemo(
    () => filterAndSortInquiries(inquiries, {
      fixedSubjectId,
      skillFilter,
      statusTab: 'open',
      tagFilter,
      search,
      sort: sortMode,
      subjectLookup: subjectMap,
    }),
    [inquiries, fixedSubjectId, skillFilter, tagFilter, search, sortMode, subjectMap],
  );

  const selectedAiIds = useMemo(
    () => filteredOpenInquiries.filter((q) => !excludedAiIds.has(q.id)).map((q) => q.id),
    [filteredOpenInquiries, excludedAiIds],
  );

  // Live preview of running list / Q&A pairs
  const parsedBulkItems = useMemo(() => parseBulkQAInput(bulkText), [bulkText]);
  const answeredBulkCount = useMemo(
    () => parsedBulkItems.filter((item) => !!item.answer?.trim()).length,
    [parsedBulkItems],
  );
  const existingQuestionKeys = useMemo(
    () => new Set(inquiries.map((q) => normalizeInquiryQuestionKey(q.question))),
    [inquiries],
  );
  const newBulkCount = useMemo(
    () => parsedBulkItems.filter((item) => !existingQuestionKeys.has(normalizeInquiryQuestionKey(item.question))).length,
    [parsedBulkItems, existingQuestionKeys],
  );

  // Focus inquiry when prop changes
  useEffect(() => {
    if (!focusInquiryId) return;
    setHighlightedId(focusInquiryId);
    setStatusTab('all');
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(focusInquiryId);
      return next;
    });
    const el = document.getElementById(`inq-card-${focusInquiryId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusInquiryId]);

  // Debounced preview of pasted AI reply
  useEffect(() => {
    setOffAnswers(new Set());
    const trimmed = aiReply.trim();
    if (!trimmed) {
      setParsedReply(null);
      setParseBusy(false);
      return;
    }
    let cancelled = false;
    setParseBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await skillsPost<{ parsed: ParseResult<DraftInquiryAnswer[]> }>('parse-inquiry-reply', { reply: aiReply });
        if (!cancelled) {
          setOffAnswers(new Set());
          setParsedReply(res.parsed);
        }
      } catch (e) {
        if (!cancelled) {
          setParsedReply({
            ok: false,
            error: e instanceof Error ? e.message : 'Could not parse AI reply.',
            warnings: [],
          });
        }
      } finally {
        if (!cancelled) setParseBusy(false);
      }
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiReply]);

  async function submitQuickAdd() {
    if (captureBusy || !qInput.trim()) return;
    setCaptureBusy(true);
    setError('');
    setNotice('');
    try {
      const tags = parseTagsInput(qTags);
      const hasAnswer = !!qAnswer.trim();
      const hasCard = hasAnswer && qCreateCard && !!effectiveQuickSubjectId && !!validQuickTopicId;
      await skillsPost('add-inquiry', {
        question: qInput.trim(),
        ...(qContext.trim() ? { context: qContext.trim() } : {}),
        ...(hasAnswer ? { answer: qAnswer.trim() } : {}),
        ...(qTakeaway.trim() ? { takeaway: qTakeaway.trim() } : {}),
        ...(tags.length ? { tags } : {}),
        ...(effectiveQuickSubjectId ? { subjectId: effectiveQuickSubjectId } : {}),
        ...(validQuickTopicId ? { topicId: validQuickTopicId } : {}),
        ...(hasCard ? { createCard: true } : {}),
        status: hasAnswer ? 'solved' : 'open',
      });
      setQInput('');
      setQContext('');
      setQTags('');
      setQAnswer('');
      setQTakeaway('');
      setQCreateCard(false);
      setNotice(
        hasAnswer
          ? hasCard
            ? 'Saved Q&A to Knowledge Base and created recall flashcard.'
            : 'Saved Q&A straight to Knowledge Base as Solved.'
          : 'Jotted down to your lookups list.',
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add lookup.');
    } finally {
      setCaptureBusy(false);
    }
  }

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    void submitQuickAdd();
  }

  async function handleBulkImport(e: React.FormEvent) {
    e.preventDefault();
    if (bulkBusy || parsedBulkItems.length === 0) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      const tags = parseTagsInput(bulkTags);
      const res = await skillsPost<{ added: KnowledgeInquiry[]; skipped: number }>('import-inquiries', {
        text: bulkText,
        ...(effectiveBulkSubjectId ? { subjectId: effectiveBulkSubjectId } : {}),
        ...(validBulkTopicId ? { topicId: validBulkTopicId } : {}),
        ...(tags.length ? { tags } : {}),
      });
      setBulkText('');
      setBulkTags('');
      setShowBulk(false);
      const addedArr = Array.isArray(res.added) ? res.added : [];
      const addedLen = addedArr.length;
      const solvedAdded = addedArr.filter((q) => q.status === 'solved').length;
      const skippedLen = typeof res.skipped === 'number' ? res.skipped : 0;
      setNotice(
        `Imported ${addedLen} lookup${addedLen === 1 ? '' : 's'}`
          + `${solvedAdded > 0 ? ` (${solvedAdded} saved as Solved)` : ''}`
          + `${skippedLen > 0 ? ` · ${skippedLen} duplicate${skippedLen === 1 ? '' : 's'} skipped` : ''}.`,
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import lookups.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleCopyPrompt() {
    if (promptBusy) return;
    setPromptBusy(true);
    setError('');
    setCopyStatus('idle');
    try {
      const res = await skillsPost<{ prompt: string }>('inquiry-prompt', {
        ...(selectedAiIds.length > 0 ? { inquiryIds: selectedAiIds } : {}),
      });
      setAiPrompt(res.prompt);
      try {
        await navigator.clipboard.writeText(res.prompt);
        setCopyStatus('copied');
      } catch {
        setCopyStatus('failed');
        setPromptVisible(true);
        window.setTimeout(() => {
          promptBoxRef.current?.focus();
          promptBoxRef.current?.select();
        }, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate AI solve prompt.');
    } finally {
      setPromptBusy(false);
    }
  }

  async function handlePasteReply() {
    try {
      const text = await navigator.clipboard.readText();
      setPasteFailed(false);
      if (text) setAiReply(text);
    } catch {
      setPasteFailed(true);
      replyBoxRef.current?.focus();
    }
  }

  const parsedAnswers = parsedReply?.ok ? parsedReply.data : [];
  const selectedAnswers = parsedAnswers.filter((_, idx) => !offAnswers.has(idx));

  function toggleAnswer(idx: number) {
    setOffAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleApplyAiAnswers() {
    if (applyAiBusy || !parsedReply?.ok || selectedAnswers.length === 0) return;
    setApplyAiBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await skillsPost<{ updated: number; created: number; cardsCreated: number }>('apply-inquiry-answers', {
        answers: selectedAnswers,
        createCards,
      });
      setAiReply('');
      setParsedReply(null);
      setOffAnswers(new Set());
      setShowAiPanel(false);
      setNotice(
        `Applied AI answers: ${res.updated} updated, ${res.created} added${res.cardsCreated > 0 ? `, ${res.cardsCreated} flashcard${res.cardsCreated === 1 ? '' : 's'} created` : ''}.`,
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply AI answers.');
    } finally {
      setApplyAiBusy(false);
    }
  }

  async function handleQuickToggle(inq: KnowledgeInquiry) {
    if (cardBusyId) return;
    const nextStatus: InquiryStatus = inq.status === 'open' ? 'solved' : 'open';
    setCardBusyId(inq.id);
    setError('');
    try {
      await skillsPost('toggle-inquiry', { inquiryId: inq.id, status: nextStatus });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update lookup status.');
    } finally {
      setCardBusyId(null);
    }
  }

  async function handleCreateFlashcard(inq: KnowledgeInquiry) {
    if (cardBusyId) return;
    setCardBusyId(inq.id);
    setError('');
    setNotice('');
    try {
      await skillsPost('promote-inquiry-to-card', {
        inquiryId: inq.id,
        ...(inq.subjectId ? { subjectId: inq.subjectId } : {}),
        ...(inq.topicId ? { topicId: inq.topicId } : {}),
      });
      setNotice(`Created recall flashcard for "${inq.question}".`);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create flashcard.');
    } finally {
      setCardBusyId(null);
    }
  }

  async function handleDelete(inq: KnowledgeInquiry) {
    if (cardBusyId) return;
    const ok = await confirm({
      title: 'Delete lookup?',
      message: `Remove "${inq.question}" from your Knowledge Base? This cannot be undone.`,
      confirmLabel: 'Delete lookup',
      danger: true,
    });
    if (!ok) return;
    setCardBusyId(inq.id);
    setError('');
    try {
      await skillsPost('remove-inquiry', { inquiryId: inq.id });
      if (editingId === inq.id) setEditingId(null);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete lookup.');
    } finally {
      setCardBusyId(null);
    }
  }

  function openInlineAnswer(inq: KnowledgeInquiry) {
    if (inlineAnswerId === inq.id) {
      setInlineAnswerId(null);
      return;
    }
    setEditingId(null);
    setInlineAnswerId(inq.id);
    setInlineAnswer(inq.answer ?? '');
    setInlineTakeaway(inq.takeaways ?? '');
    setInlineCreateCard(false);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(inq.id);
      return next;
    });
  }

  async function saveInlineAnswer(inq: KnowledgeInquiry) {
    const ans = inlineAnswer.trim();
    if (!ans || cardBusyId) return;
    setCardBusyId(inq.id);
    setError('');
    setNotice('');
    try {
      await skillsPost('edit-inquiry', {
        inquiryId: inq.id,
        changes: {
          answer: ans,
          takeaways: inlineTakeaway.trim(),
          status: 'solved',
        },
      });
      let madeCard = false;
      if (inlineCreateCard && inq.subjectId && inq.topicId && !inq.cardItemId) {
        await skillsPost('promote-inquiry-to-card', {
          inquiryId: inq.id,
          subjectId: inq.subjectId,
          topicId: inq.topicId,
        });
        madeCard = true;
      }
      setInlineAnswerId(null);
      setInlineAnswer('');
      setInlineTakeaway('');
      setInlineCreateCard(false);
      setNotice(
        madeCard
          ? `Saved answer for "${inq.question}" and created recall flashcard.`
          : `Saved answer for "${inq.question}".`,
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save answer.');
    } finally {
      setCardBusyId(null);
    }
  }

  async function handleCopyMarkdown() {
    if (!filteredInquiries.length) return;
    const md = formatInquiriesMarkdown(filteredInquiries, subjectMap);
    try {
      await navigator.clipboard.writeText(md);
      setMdCopyState('copied');
      setNotice(`Copied ${filteredInquiries.length} Knowledge Base ${filteredInquiries.length === 1 ? 'entry' : 'entries'} as Markdown.`);
      window.setTimeout(() => setMdCopyState('idle'), 2200);
    } catch {
      setError('Clipboard access was blocked — could not copy Markdown.');
    }
  }

  function toggleAccordion(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusLocalInquiry(id: string) {
    setStatusTab('all');
    setSearch('');
    setTagFilter(null);
    setHighlightedId(id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      document.getElementById(`inq-card-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 40);
  }

  return (
    <div className={`inq-desk${compact ? ' is-compact' : ''}`}>
      {/* Quick Capture Bar */}
      <section className="inq-capture-card" aria-label="Quick capture lookup">
        <div className="inq-capture-head">
          <div>
            <h2>Things to look up</h2>
            <p className="sk-hint">
              Jot down anything you hear and want to understand later. Link it to a skill or to{' '}
              <code>[[a topic]]</code>, and have your AI answer a batch at once.
            </p>
          </div>
          <div className="sk-actions">
            <button
              type="button"
              className="sk-small-btn"
              aria-expanded={showBulk}
              onClick={() => {
                setShowBulk((v) => !v);
                setShowAiPanel(false);
              }}
            >
              {showBulk ? 'Close' : '📋 Paste a list'}
            </button>
            <button
              type="button"
              className="sk-small-btn"
              aria-expanded={showAiPanel}
              onClick={() => {
                setShowAiPanel((v) => !v);
                setShowBulk(false);
              }}
            >
              {showAiPanel ? 'Close' : `🤖 Answer with AI (${openCount})`}
            </button>
          </div>
        </div>

        <form
          className="inq-capture-form"
          onSubmit={(e) => void handleQuickAdd(e)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && qInput.trim()) {
              e.preventDefault();
              void submitQuickAdd();
            }
          }}
        >
          <div className="inq-capture-main">
            <input
              type="text"
              className="inq-capture-input"
              value={qInput}
              maxLength={300}
              placeholder="Heard something you don't know? e.g. What is MCP, What is R1 Redundancy…"
              aria-label="New question or concept to look up"
              onChange={(e) => setQInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={captureBusy || !qInput.trim()}>
              {captureBusy ? 'Saving…' : qAnswer.trim() ? 'Save Q&A' : 'Jot down'}
            </button>
          </div>
          <div className="inq-capture-extras">
            {!fixedSubjectId && (
              <select
                aria-label="Optional skill"
                value={qSubjectId}
                onChange={(e) => {
                  setQSubjectId(e.target.value);
                  setQTopicId('');
                }}
              >
                <option value="">Optional: Link to skill…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.name}
                  </option>
                ))}
              </select>
            )}
            {quickTopics.length > 0 && (
              <select
                aria-label="Optional topic"
                value={validQuickTopicId}
                onChange={(e) => setQTopicId(e.target.value)}
              >
                <option value="">Optional: Topic…</option>
                {quickTopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={qTags}
              placeholder="#tags (e.g. #networking #ai)"
              aria-label="Optional tags"
              onChange={(e) => setQTags(e.target.value)}
            />
            <input
              type="text"
              value={qContext}
              maxLength={600}
              placeholder="Why / Context (where did you hear it?)"
              aria-label="Optional context"
              onChange={(e) => setQContext(e.target.value)}
            />
          </div>
          <div className="inq-capture-answer-bar">
            <button
              type="button"
              className="sk-small-btn"
              aria-expanded={showCaptureAnswer}
              aria-pressed={showCaptureAnswer}
              onClick={() => setShowCaptureAnswer((v) => !v)}
            >
              {showCaptureAnswer
                ? '▾ Hide Answer / Explanation'
                : qAnswer.trim()
                  ? '✍️ Answer added — edit'
                  : '✍️ Answer / Explanation (optional — saves straight to Knowledge Base as Solved)'}
            </button>
            {qAnswer.trim() && (
              <span className="inq-status-pill is-solved">Saves as Solved</span>
            )}
          </div>
          {showCaptureAnswer && (
            <div className="inq-capture-answer-panel">
              <label className="sk-field">
                <span>✍️ Answer / Explanation (optional — saves straight to Knowledge Base as Solved)</span>
                <WikiTextarea
                  rows={3}
                  value={qAnswer}
                  placeholder="Write it in your own words. Type [[ to link a concept or skill, # for a tag. (Cmd/Ctrl+Enter to save)"
                  onChange={(e) => setQAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && qInput.trim()) {
                      e.preventDefault();
                      void submitQuickAdd();
                    }
                  }}
                />
              </label>
              <div className="inq-capture-answer-row">
                <label className="sk-field">
                  <span>💡 Key takeaway (optional)</span>
                  <input
                    type="text"
                    value={qTakeaway}
                    maxLength={600}
                    placeholder="1-line core takeaway to remember…"
                    onChange={(e) => setQTakeaway(e.target.value)}
                  />
                </label>
                {effectiveQuickSubjectId && validQuickTopicId && (
                  <label className="sk-check inq-capture-card-check">
                    <input
                      type="checkbox"
                      checked={qCreateCard}
                      onChange={(e) => setQCreateCard(e.target.checked)}
                    />
                    <span>Also create a review flashcard 🃏</span>
                  </label>
                )}
              </div>
            </div>
          )}
        </form>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && <p className="inq-notice" role="status">{notice}</p>}
      </section>

      {/* Paste Running List / Q&A Pairs Bulk Import Drawer */}
      {showBulk && (
        <section className="inq-drawer" aria-label="Paste running list bulk import">
          <div className="inq-drawer-head">
            <h3>📋 Paste a list</h3>
            <button type="button" className="sk-text-btn" onClick={() => setShowBulk(false)}>
              Close
            </button>
          </div>
          <p className="sk-hint">
            Paste plain bullet lists or Q&amp;A pairs (<code>Q: / A:</code>, <code>Question :: Answer</code>,{' '}
            <code>Question -&gt; Answer</code>, or <code>Question — Answer</code>). Answered pairs save straight to your Knowledge Base as Solved.
          </p>
          <form className="sk-inline-form" onSubmit={(e) => void handleBulkImport(e)}>
            <label className="sk-field">
              <span>Questions or Q&amp;A pairs</span>
              <textarea
                rows={6}
                value={bulkText}
                placeholder={'- What is MCP?\nWhat is Raft? :: Consensus algorithm for replicated logs\nQ: What is gRPC?\nA: High-performance RPC over HTTP/2'}
                onChange={(e) => setBulkText(e.target.value)}
              />
            </label>
            <div className="inq-preview-meta">
              <span>
                <strong>{parsedBulkItems.length}</strong> question{parsedBulkItems.length === 1 ? '' : 's'}
                {' · '}
                <strong>{answeredBulkCount}</strong> already answered
              </span>
              {parsedBulkItems.length > 0 && (
                <span>
                  ({newBulkCount} new · {parsedBulkItems.length - newBulkCount} already in list)
                </span>
              )}
            </div>
            {parsedBulkItems.length > 0 && (
              <div className="sk-chips">
                {parsedBulkItems.slice(0, 8).map((item) => (
                  <span
                    key={item.question}
                    className={`sk-chip${item.answer ? ' is-strong' : ''}`}
                    title={item.answer ? `Answer: ${item.answer}` : 'Open lookup'}
                  >
                    {item.answer ? '💡 ' : ''}{item.question}
                  </span>
                ))}
                {parsedBulkItems.length > 8 && (
                  <span className="sk-chip">+{parsedBulkItems.length - 8} more</span>
                )}
              </div>
            )}
            <div className="inq-capture-extras">
              {!fixedSubjectId && (
                <label className="sk-field">
                  <span>Default Skill (optional)</span>
                  <select
                    value={bulkSubjectId}
                    onChange={(e) => {
                      setBulkSubjectId(e.target.value);
                      setBulkTopicId('');
                    }}
                  >
                    <option value="">No default skill</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.icon} {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {bulkTopics.length > 0 && (
                <label className="sk-field">
                  <span>Default Topic (optional)</span>
                  <select value={validBulkTopicId} onChange={(e) => setBulkTopicId(e.target.value)}>
                    <option value="">No default topic</option>
                    {bulkTopics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="sk-field">
                <span>Default #tags (optional)</span>
                <input
                  value={bulkTags}
                  placeholder="#systems #reading-list"
                  onChange={(e) => setBulkTags(e.target.value)}
                />
              </label>
            </div>
            <div className="sk-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={bulkBusy || parsedBulkItems.length === 0}
              >
                {bulkBusy
                  ? 'Importing…'
                  : answeredBulkCount > 0
                    ? `Import ${parsedBulkItems.length} (${answeredBulkCount} Solved)`
                    : `Import ${parsedBulkItems.length} lookup${parsedBulkItems.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="sk-text-btn" onClick={() => setShowBulk(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Solve with AI (Copy / Paste) Panel */}
      {showAiPanel && (
        <section className="inq-drawer" aria-label="Solve lookups with AI">
          <div className="inq-drawer-head">
            <h3>🤖 Answer with AI</h3>
            <button type="button" className="sk-text-btn" onClick={() => setShowAiPanel(false)}>
              Close
            </button>
          </div>
          <p className="sk-hint">
            Select the open questions you want answered, copy the prompt into your AI app, and paste its JSON reply below to populate your Knowledge Base.
          </p>

          <div className="sk-field">
            <div className="sk-card-head">
              <span>1. Open questions to include ({selectedAiIds.length} of {filteredOpenInquiries.length})</span>
              {filteredOpenInquiries.length > 0 && (
                <div className="sk-actions">
                  <button
                    type="button"
                    className="sk-text-btn"
                    onClick={() => setExcludedAiIds(new Set())}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="sk-text-btn"
                    onClick={() => setExcludedAiIds(new Set(filteredOpenInquiries.map((q) => q.id)))}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {filteredOpenInquiries.length === 0 ? (
              <p className="sk-hint">No open questions match your current filter. Jot one down above or switch filters to include more.</p>
            ) : (
              <div className="inq-ai-select-list">
                {filteredOpenInquiries.map((q) => {
                  const checked = !excludedAiIds.has(q.id);
                  return (
                    <label key={q.id} className="inq-ai-select-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setExcludedAiIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(q.id);
                            else next.add(q.id);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <strong>{q.question}</strong>
                        {q.context && <span className="sk-muted"> — {q.context}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="sk-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={promptBusy || selectedAiIds.length === 0}
              onClick={() => void handleCopyPrompt()}
            >
              {promptBusy
                ? 'Preparing prompt…'
                : copyStatus === 'copied'
                  ? '✓ Copied AI Solve Prompt'
                  : 'Copy AI Solve Prompt'}
            </button>
            {aiPrompt && (
              <button
                type="button"
                className="sk-text-btn"
                aria-expanded={promptVisible}
                onClick={() => setPromptVisible((v) => !v)}
              >
                {promptVisible ? 'Hide prompt' : 'View / copy manually'}
              </button>
            )}
          </div>

          {copyStatus === 'copied' && (
            <p className="sk-hint">Prompt copied! Paste it into your AI chat, then paste the JSON reply in Step 2 below.</p>
          )}
          {copyStatus === 'failed' && (
            <p className="sk-warning">Clipboard access was blocked. Copy the selected prompt below manually.</p>
          )}
          {promptVisible && aiPrompt && (
            <textarea
              ref={promptBoxRef}
              className="sk-mono"
              readOnly
              rows={8}
              value={aiPrompt}
              aria-label="Generated AI solve prompt"
            />
          )}

          <GenerateReply
            disabled={selectedAiIds.length === 0}
            prompt={async () => {
              const res = await skillsPost<{ prompt: string }>('inquiry-prompt', {
                ...(selectedAiIds.length > 0 ? { inquiryIds: selectedAiIds } : {}),
              });
              setAiPrompt(res.prompt);
              return res.prompt;
            }}
            onReply={setAiReply}
          />

          <div className="sk-field">
            <div className="sk-card-head">
              <span>2. Paste AI JSON Reply</span>
              <button type="button" className="sk-small-btn" onClick={() => void handlePasteReply()}>
                Paste
              </button>
            </div>
            <textarea
              ref={replyBoxRef}
              className="sk-mono"
              rows={aiReply ? 7 : 4}
              value={aiReply}
              placeholder="Paste the AI's JSON response here…"
              aria-label="Paste AI JSON reply"
              onChange={(e) => setAiReply(e.target.value)}
            />
            {pasteFailed && (
              <p className="sk-hint">Browser blocked clipboard read — paste manually inside the box above.</p>
            )}
          </div>

          {parseBusy && <p className="sk-hint">Parsing AI reply…</p>}
          {parsedReply && !parsedReply.ok && (
            <div>
              <ErrorNote>{parsedReply.error}</ErrorNote>
              {parsedReply.warnings.map((w, i) => (
                <p key={i} className="sk-warning">{w}</p>
              ))}
            </div>
          )}

          {parsedReply?.ok && (
            <div className="sk-field">
              <div className="inq-preview-meta">
                <span>
                  <strong>Preview:</strong> {selectedAnswers.length} of {parsedAnswers.length} parsed answer{parsedAnswers.length === 1 ? '' : 's'} selected
                </span>
                {parsedAnswers.length > 0 && (
                  <div className="sk-actions">
                    <button
                      type="button"
                      className="sk-text-btn"
                      onClick={() => setOffAnswers(new Set())}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="sk-text-btn"
                      onClick={() => setOffAnswers(new Set(parsedAnswers.map((_, i) => i)))}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {parsedReply.warnings.map((w, i) => (
                <p key={i} className="sk-warning">{w}</p>
              ))}
              <ul className="inq-preview-list">
                {parsedReply.data.map((ans, idx) => (
                  <li key={`${ans.inquiryId ?? ans.question}-${idx}`} className="inq-preview-item">
                    <label className="inq-ai-select-row">
                      <input
                        type="checkbox"
                        checked={!offAnswers.has(idx)}
                        onChange={() => toggleAnswer(idx)}
                        aria-label={`Include ${ans.question}`}
                      />
                      <strong>{ans.question}</strong>
                    </label>
                    <div className="inq-card-badges">
                      <span className={`inq-status-pill ${ans.inquiryId ? 'is-solved' : 'is-open'}`}>
                        {ans.inquiryId ? 'Updates existing' : 'New lookup'}
                      </span>
                      {(ans.suggestedSubject || ans.suggestedTopic) && (
                        <span className="sk-chip">
                          {[ans.suggestedSubject, ans.suggestedTopic].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {ans.flashcard && <span className="sk-chip">🃏 Flashcard ready</span>}
                    </div>
                    <p>{ans.answer.length > 260 ? `${ans.answer.slice(0, 260)}…` : ans.answer}</p>
                    {ans.takeaways && <p className="sk-muted">Takeaways: {ans.takeaways}</p>}
                    {ans.tags.length > 0 && (
                      <div className="inq-tags">
                        {ans.tags.map((t) => (
                          <span key={t} className="inq-tag-chip">#{t}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="sk-check">
            <input
              type="checkbox"
              checked={createCards}
              onChange={(e) => setCreateCards(e.target.checked)}
            />
            <span>Also create recall flashcards for matched skills/topics</span>
          </label>

          <div className="sk-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={applyAiBusy || !parsedReply?.ok || selectedAnswers.length === 0}
              onClick={() => void handleApplyAiAnswers()}
            >
              {applyAiBusy
                ? 'Applying…'
                : `Apply ${selectedAnswers.length === 1 ? '1 Answer' : `${selectedAnswers.length} Answers`} to Knowledge Base`}
            </button>
          </div>
        </section>
      )}

      {/* Searchable Knowledge Base Explorer */}
      <div className="inq-explorer-bar">
        <div className="inq-explorer-search-row">
          <div className="inq-search-wrap">
            <input
              type="search"
              className="inq-filter-search"
              value={search}
              placeholder="🔍 Search questions, answers, [[concepts]], #tags, or sources…"
              aria-label="Search Knowledge Base"
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="inq-search-clear"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                ✕
              </button>
            )}
          </div>
          <span className="inq-result-count" aria-live="polite">
            {filteredInquiries.length} {filteredInquiries.length === 1 ? 'result' : 'results'}
            {filteredInquiries.length !== scopedInquiries.length && ` of ${scopedInquiries.length}`}
          </span>
          <div className="inq-view-toggle" role="group" aria-label="Display mode">
            <button
              type="button"
              className={`inq-view-btn${viewMode === 'cards' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
            >
              🃏 Cards
            </button>
            <button
              type="button"
              className={`inq-view-btn${viewMode === 'accordion' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'accordion'}
              onClick={() => setViewMode('accordion')}
            >
              📖 Compact Accordion
            </button>
          </div>
          <button
            type="button"
            className="sk-small-btn"
            disabled={filteredInquiries.length === 0}
            onClick={() => void handleCopyMarkdown()}
          >
            {mdCopyState === 'copied' ? '✓ Copied (.md)' : '📋 Copy Filtered (.md)'}
          </button>
        </div>

        <div className="inq-filter-bar-row">
          <div className="inq-status-tabs" role="tablist" aria-label="Lookup status filter">
            <button
              type="button"
              role="tab"
              className="inq-status-tab"
              aria-selected={statusTab === 'all'}
              onClick={() => setStatusTab('all')}
            >
              All ({scopedInquiries.length})
            </button>
            <button
              type="button"
              role="tab"
              className="inq-status-tab"
              aria-selected={statusTab === 'open'}
              onClick={() => setStatusTab('open')}
            >
              To look up ({openCount})
            </button>
            <button
              type="button"
              role="tab"
              className="inq-status-tab"
              aria-selected={statusTab === 'solved'}
              onClick={() => setStatusTab('solved')}
            >
              Answered ({solvedCount})
            </button>
          </div>

          <div className="inq-filter-controls">
            {!fixedSubjectId && (
              <select
                className="inq-filter-skill"
                aria-label="Filter by skill"
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
              >
                <option value="all">All skills</option>
                <option value="__unassigned__">Unassigned</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="inq-filter-sort"
              aria-label="Sort lookups"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as InquirySortMode)}
            >
              <option value="open-first">Sort: Open first</option>
              <option value="newest">Sort: Newest</option>
              <option value="recently-answered">Sort: Recently answered</option>
              <option value="alphabetical">Sort: Alphabetical</option>
            </select>
            {viewMode === 'accordion' && filteredInquiries.length > 1 && (
              <div className="sk-actions">
                <button
                  type="button"
                  className="sk-text-btn"
                  onClick={() => setExpandedIds(new Set(filteredInquiries.map((q) => q.id)))}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="sk-text-btn"
                  onClick={() => setExpandedIds(new Set())}
                >
                  Collapse all
                </button>
              </div>
            )}
          </div>
        </div>

        {availableTags.length > 0 && (
          <div className="inq-tag-filter-row" role="group" aria-label="Filter by tag">
            <span className="inq-tag-filter-label">Tags:</span>
            {availableTags.map(({ tag, count }) => {
              const active = tagFilter === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  className={`inq-tag-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                >
                  #{tag} <span className="inq-tag-count">{count}</span>
                </button>
              );
            })}
            {(tagFilter || search || statusTab !== 'all' || (!fixedSubjectId && skillFilter !== 'all')) && (
              <button
                type="button"
                className="sk-text-btn"
                onClick={() => {
                  setSearch('');
                  setTagFilter(null);
                  setStatusTab('all');
                  if (!fixedSubjectId) setSkillFilter('all');
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Inquiry Cards / Compact Accordion List */}
      {filteredInquiries.length === 0 ? (
        <p className="sk-empty">
          {scopedInquiries.length === 0
            ? 'No lookups captured yet. Jot down anything you hear above, or paste your running list!'
            : 'No lookups match those filters.'}
        </p>
      ) : (
        <ul className={`inq-list${viewMode === 'accordion' ? ' is-accordion' : ''}`}>
          {filteredInquiries.map((inq) => {
            const sub = inq.subjectId ? subjectMap.get(inq.subjectId) : undefined;
            const topic = sub && inq.topicId ? sub.topics.find((t) => t.id === inq.topicId) : undefined;
            const isEditing = editingId === inq.id;
            const isInlineAnswering = inlineAnswerId === inq.id;
            const isFocused = highlightedId === inq.id;
            const isBusy = cardBusyId === inq.id;
            const isExpanded = viewMode === 'cards' || expandedIds.has(inq.id) || isEditing || isInlineAnswering;
            const canPromoteCard = !inq.cardItemId && !!inq.subjectId && !!inq.topicId && !!(inq.answer?.trim() || inq.takeaways?.trim());

            const renderDetailsAndActions = () => (
              <>
                {inq.context && (
                  <p className="inq-card-context">
                    <strong>Context:</strong>{' '}
                    <HighlightText text={inq.context} terms={searchTerms} />
                  </p>
                )}

                {inq.answer && (
                  <div className="inq-answer-box">
                    <RichInquiryText
                      text={inq.answer}
                      resolveWiki={resolveWiki}
                      onSelectGraphNode={onSelectGraphNode}
                      onFilterTag={(t) => setTagFilter((cur) => (cur === t ? null : t))}
                      inquiries={inquiries}
                      subjects={subjects}
                      onFocusInquiry={focusLocalInquiry}
                      highlightTerms={searchTerms}
                    />
                  </div>
                )}

                {inq.takeaways && (
                  <div className="inq-takeaways-box">
                    <strong>Key Takeaways:</strong>{' '}
                    <RichInquiryText
                      text={inq.takeaways}
                      resolveWiki={resolveWiki}
                      onSelectGraphNode={onSelectGraphNode}
                      onFilterTag={(t) => setTagFilter((cur) => (cur === t ? null : t))}
                      inquiries={inquiries}
                      subjects={subjects}
                      onFocusInquiry={focusLocalInquiry}
                      highlightTerms={searchTerms}
                    />
                  </div>
                )}

                {inq.sources && inq.sources.length > 0 && (
                  <div className="inq-sources">
                    <strong>Sources:</strong>
                    {inq.sources.map((src, i) =>
                      /^https?:\/\//i.test(src) ? (
                        <a key={`${src}-${i}`} className="inq-source-link" href={src} target="_blank" rel="noopener noreferrer">
                          <HighlightText text={src} terms={searchTerms} />
                        </a>
                      ) : (
                        <span key={`${src}-${i}`} className="sk-chip">
                          <HighlightText text={src} terms={searchTerms} />
                        </span>
                      ),
                    )}
                  </div>
                )}

                {inq.tags && inq.tags.length > 0 && (
                  <div className="inq-tags">
                    {inq.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`inq-tag-chip${tagFilter === tag ? ' is-active' : ''}`}
                        onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                <div className="sk-actions">
                  {inq.status === 'open' && (
                    <button
                      type="button"
                      className="sk-small-btn inq-write-answer-btn"
                      aria-expanded={isInlineAnswering}
                      onClick={() => openInlineAnswer(inq)}
                    >
                      {isInlineAnswering ? 'Cancel answer' : '✍️ Write answer'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="sk-small-btn"
                    aria-expanded={isEditing}
                    onClick={() => {
                      setInlineAnswerId(null);
                      setEditingId(isEditing ? null : inq.id);
                    }}
                  >
                    {isEditing ? 'Close editor' : inq.status === 'open' ? 'Solve / Edit' : 'Edit'}
                  </button>

                  {inq.status === 'solved' ? (
                    <button
                      type="button"
                      className="sk-text-btn"
                      disabled={isBusy}
                      onClick={() => void handleQuickToggle(inq)}
                    >
                      Reopen
                    </button>
                  ) : (
                    (inq.answer?.trim() || inq.takeaways?.trim()) && (
                      <button
                        type="button"
                        className="sk-text-btn"
                        disabled={isBusy}
                        onClick={() => void handleQuickToggle(inq)}
                      >
                        Mark Solved
                      </button>
                    )
                  )}

                  {canPromoteCard && (
                    <button
                      type="button"
                      className="sk-small-btn"
                      disabled={isBusy}
                      onClick={() => void handleCreateFlashcard(inq)}
                    >
                      + Create Flashcard
                    </button>
                  )}

                  {onSelectGraphNode && (
                    <button
                      type="button"
                      className="sk-text-btn"
                      onClick={() => onSelectGraphNode(`inq:${inq.id}`)}
                    >
                      Focus Graph
                    </button>
                  )}

                  <button
                    type="button"
                    className="sk-text-btn is-danger"
                    disabled={isBusy}
                    onClick={() => void handleDelete(inq)}
                  >
                    Delete
                  </button>
                </div>

                {isInlineAnswering && (
                  <div className="inq-inline-answer-box">
                    <label className="sk-field">
                      <span>✍️ Answer</span>
                      <WikiTextarea
                        rows={3}
                        value={inlineAnswer}
                        autoFocus
                        placeholder="Write the answer in your own words. Type [[ to link a concept, # for a tag. (Cmd/Ctrl+Enter to save)"
                        onChange={(e) => setInlineAnswer(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && inlineAnswer.trim()) {
                            e.preventDefault();
                            void saveInlineAnswer(inq);
                          }
                        }}
                      />
                    </label>
                    <label className="sk-field">
                      <span>💡 Takeaway (optional)</span>
                      <input
                        type="text"
                        value={inlineTakeaway}
                        maxLength={600}
                        placeholder="Optional 1-line key takeaway…"
                        onChange={(e) => setInlineTakeaway(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && inlineAnswer.trim()) {
                            e.preventDefault();
                            void saveInlineAnswer(inq);
                          }
                        }}
                      />
                    </label>
                    {sub && topic && !inq.cardItemId && (
                      <label className="sk-check">
                        <input
                          type="checkbox"
                          checked={inlineCreateCard}
                          onChange={(e) => setInlineCreateCard(e.target.checked)}
                        />
                        <span>🃏 Create flashcard in {sub.name} · {topic.name}</span>
                      </label>
                    )}
                    <div className="sk-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={isBusy || !inlineAnswer.trim()}
                        onClick={() => void saveInlineAnswer(inq)}
                      >
                        {isBusy ? 'Saving…' : 'Save Answer'}
                      </button>
                      <button
                        type="button"
                        className="sk-text-btn"
                        disabled={isBusy}
                        onClick={() => setInlineAnswerId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <InquiryEditForm
                    inquiry={inq}
                    subjects={subjects}
                    fixedSubjectId={fixedSubjectId}
                    onSaved={async () => {
                      setEditingId(null);
                      await onReload();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </>
            );

            if (viewMode === 'accordion') {
              const previewSource = inq.answer?.trim() || inq.takeaways?.trim() || inq.context?.trim() || '';
              const previewText = previewSource ? accordionPreviewSnippet(previewSource, searchTerms) : '';

              return (
                <li
                  key={inq.id}
                  id={`inq-card-${inq.id}`}
                  className={`inq-acc-item ${inq.status === 'open' ? 'is-open' : 'is-solved'}${isExpanded ? ' is-expanded' : ''}${isFocused ? ' is-focused' : ''}`}
                >
                  <div className="inq-acc-head">
                    <button
                      type="button"
                      className="inq-acc-trigger"
                      aria-expanded={isExpanded}
                      onClick={() => toggleAccordion(inq.id)}
                    >
                      <span className="inq-acc-chevron" aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                      <span className={`inq-status-pill ${inq.status === 'open' ? 'is-open' : 'is-solved'}`}>
                        {inq.status === 'open' ? '❓' : '💡'}
                      </span>
                      <span className="inq-acc-title-block">
                        <span className="inq-acc-question">
                          <HighlightText text={inq.question} terms={searchTerms} />
                        </span>
                        {!isExpanded && previewText && (
                          <span className="inq-acc-snippet">
                            <HighlightText text={previewText} terms={searchTerms} />
                          </span>
                        )}
                      </span>
                      <span className="inq-acc-meta">
                        {sub && (
                          <span className="inq-skill-badge">
                            <span aria-hidden>{sub.icon}</span>
                            <span>{sub.name}{topic ? ` · ${topic.name}` : ''}</span>
                          </span>
                        )}
                        {inq.cardItemId && <span className="sk-chip">🃏</span>}
                        {(inq.tags ?? []).slice(0, 2).map((t) => (
                          <span key={t} className="inq-tag-chip">#{t}</span>
                        ))}
                      </span>
                    </button>
                    {inq.status === 'open' && !isInlineAnswering && (
                      <button
                        type="button"
                        className="sk-small-btn inq-write-answer-btn"
                        onClick={() => openInlineAnswer(inq)}
                      >
                        ✍️ Write answer
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="inq-acc-body">
                      {renderDetailsAndActions()}
                    </div>
                  )}
                </li>
              );
            }

            return (
              <li
                key={inq.id}
                id={`inq-card-${inq.id}`}
                className={`inq-card ${inq.status === 'open' ? 'is-open' : 'is-solved'}${isFocused ? ' is-focused' : ''}`}
              >
                <div className="inq-card-head">
                  <div className="inq-card-title-wrap">
                    <div className="inq-card-badges">
                      <span className={`inq-status-pill ${inq.status === 'open' ? 'is-open' : 'is-solved'}`}>
                        {inq.status === 'open' ? '❓ To Solve' : '💡 Knowledge'}
                      </span>
                      {sub && (
                        <Link className="inq-skill-badge" href={`/skills/${sub.id}`}>
                          <span aria-hidden>{sub.icon}</span>
                          <span>{sub.name}{topic ? ` · ${topic.name}` : ''}</span>
                        </Link>
                      )}
                      {inq.cardItemId && (
                        <Link
                          className="sk-chip"
                          href={sub ? `/skills/${sub.id}?tab=questions` : '/skills'}
                        >
                          🃏 Flashcard
                        </Link>
                      )}
                    </div>
                    <h3 className="inq-card-question">
                      <HighlightText text={inq.question} terms={searchTerms} />
                    </h3>
                  </div>
                </div>

                {renderDetailsAndActions()}
              </li>
            );
          })}
        </ul>
      )}
      {popup}
    </div>
  );
}
