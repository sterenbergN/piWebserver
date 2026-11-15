'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { skillsPost, type KnowledgeSubjectOption } from '@/components/skills/api';
import { ErrorNote } from '@/components/skills/Ui';
import WikiTextarea from '@/components/skills/WikiTextarea';
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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    while (line) {
      const next = line
        .replace(/^(?:[-*•◦▪‣]|\d+[.)])(?:\s+|$)/, '')
        .replace(/^\[(?: |x|X)?\](?:\s+|$)/, '')
        .trim();
      if (next === line) break;
      line = next;
    }
    const cleaned = line.replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
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
}: {
  text: string;
  resolveWiki?: (target: string) => string | undefined;
  onSelectGraphNode?: (nodeId: string) => void;
  onFilterTag?: (tag: string) => void;
  inquiries?: KnowledgeInquiry[];
  subjects?: KnowledgeSubjectOption[];
  onFocusInquiry?: (inquiryId: string) => void;
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
            return <span key={idx} className="kv-inline-token is-unresolved">{tok.raw}</span>;
          }
          if (resolved.kind === 'graph' && onSelectGraphNode) {
            return (
              <button key={idx} type="button" className="kv-inline-token" onClick={() => onSelectGraphNode(resolved.id)}>
                {tok.raw}
              </button>
            );
          }
          if (resolved.kind === 'inq' && onFocusInquiry) {
            return (
              <button key={idx} type="button" className="kv-inline-token" onClick={() => onFocusInquiry(resolved.id)}>
                {tok.raw}
              </button>
            );
          }
          if (resolved.kind === 'subject') {
            return (
              <Link key={idx} className="kv-inline-token" href={`/skills/${resolved.id}`}>
                {tok.raw}
              </Link>
            );
          }
          return <span key={idx} className="kv-inline-token is-unresolved">{tok.raw}</span>;
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
              {tok.raw}
            </button>
          );
        }

        if (tok.type === 'url') {
          return (
            <a key={idx} className="inq-source-link" href={tok.value} target="_blank" rel="noopener noreferrer">
              {tok.raw}
            </a>
          );
        }

        return <Fragment key={idx}>{tok.value}</Fragment>;
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
  const [parseBusy, setParseBusy] = useState(false);
  const [createCards, setCreateCards] = useState(false);
  const [applyAiBusy, setApplyAiBusy] = useState(false);

  // Filter & list state
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const scopedInquiries = useMemo(() => {
    const base = fixedSubjectId
      ? inquiries.filter((q) => q.subjectId === fixedSubjectId)
      : skillFilter === 'all'
        ? inquiries
        : skillFilter === '__unassigned__'
          ? inquiries.filter((q) => !q.subjectId)
          : inquiries.filter((q) => q.subjectId === skillFilter);

    return [...base].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    });
  }, [inquiries, fixedSubjectId, skillFilter]);

  const openCount = useMemo(() => scopedInquiries.filter((q) => q.status === 'open').length, [scopedInquiries]);
  const solvedCount = useMemo(() => scopedInquiries.filter((q) => q.status === 'solved').length, [scopedInquiries]);

  const matchesSearch = (item: KnowledgeInquiry, q: string, tagQuery: string): boolean => {
    if (!q) return true;
    const inQuestion = item.question.toLowerCase().includes(q);
    const inContext = item.context?.toLowerCase().includes(q) ?? false;
    const inAnswer = item.answer?.toLowerCase().includes(q) ?? false;
    const inTakeaways = item.takeaways?.toLowerCase().includes(q) ?? false;
    const inSources = item.sources?.some((s) => s.toLowerCase().includes(q)) ?? false;
    const inTags = item.tags?.some((t) => t.toLowerCase().includes(tagQuery)) ?? false;
    return inQuestion || inContext || inAnswer || inTakeaways || inSources || inTags;
  };

  const filteredInquiries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tagQuery = q.replace(/^#+/, '');
    return scopedInquiries.filter((item) => {
      if (statusTab !== 'all' && item.status !== statusTab) return false;
      return matchesSearch(item, q, tagQuery);
    });
  }, [scopedInquiries, statusTab, search]);

  const filteredOpenInquiries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tagQuery = q.replace(/^#+/, '');
    return scopedInquiries.filter((item) => item.status === 'open' && matchesSearch(item, q, tagQuery));
  }, [scopedInquiries, search]);

  const selectedAiIds = useMemo(
    () => filteredOpenInquiries.filter((q) => !excludedAiIds.has(q.id)).map((q) => q.id),
    [filteredOpenInquiries, excludedAiIds],
  );

  // Live preview of running list lines
  const parsedRunningItems = useMemo(() => previewRunningList(bulkText), [bulkText]);
  const existingQuestionKeys = useMemo(
    () => new Set(inquiries.map((q) => q.question.trim().replace(/\s+/g, ' ').toLowerCase())),
    [inquiries],
  );
  const newRunningCount = useMemo(
    () => parsedRunningItems.filter((line) => !existingQuestionKeys.has(line.toLowerCase())).length,
    [parsedRunningItems, existingQuestionKeys],
  );

  // Focus inquiry when prop changes
  useEffect(() => {
    if (!focusInquiryId) return;
    setHighlightedId(focusInquiryId);
    setStatusTab('all');
    const el = document.getElementById(`inq-card-${focusInquiryId}`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusInquiryId]);

  // Debounced preview of pasted AI reply
  useEffect(() => {
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
        if (!cancelled) setParsedReply(res.parsed);
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

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (captureBusy || !qInput.trim()) return;
    setCaptureBusy(true);
    setError('');
    setNotice('');
    try {
      const tags = parseTagsInput(qTags);
      await skillsPost('add-inquiry', {
        question: qInput.trim(),
        ...(qContext.trim() ? { context: qContext.trim() } : {}),
        ...(tags.length ? { tags } : {}),
        ...(effectiveQuickSubjectId ? { subjectId: effectiveQuickSubjectId } : {}),
        ...(validQuickTopicId ? { topicId: validQuickTopicId } : {}),
        status: 'open',
      });
      setQInput('');
      setQContext('');
      setQTags('');
      setNotice('Jotted down to your lookups list.');
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add lookup.');
    } finally {
      setCaptureBusy(false);
    }
  }

  async function handleBulkImport(e: React.FormEvent) {
    e.preventDefault();
    if (bulkBusy || parsedRunningItems.length === 0) return;
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
      const addedLen = Array.isArray(res.added) ? res.added.length : 0;
      const skippedLen = typeof res.skipped === 'number' ? res.skipped : 0;
      setNotice(`Imported ${addedLen} lookup${addedLen === 1 ? '' : 's'}${skippedLen > 0 ? ` (${skippedLen} duplicate${skippedLen === 1 ? '' : 's'} skipped)` : ''}.`);
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

  async function handleApplyAiAnswers() {
    if (applyAiBusy || !aiReply.trim()) return;
    setApplyAiBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await skillsPost<{ updated: number; created: number; cardsCreated: number }>('apply-inquiry-answers', {
        reply: aiReply,
        createCards,
      });
      setAiReply('');
      setParsedReply(null);
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

  function focusLocalInquiry(id: string) {
    setStatusTab('all');
    setSearch('');
    setHighlightedId(id);
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
              Jot down anything you hear and want to understand later. Link it to a skill or to
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

        <form className="inq-capture-form" onSubmit={(e) => void handleQuickAdd(e)}>
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
              {captureBusy ? 'Saving…' : 'Jot down'}
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
        </form>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && <p className="inq-notice" role="status">{notice}</p>}
      </section>

      {/* Paste Running List Bulk Import Drawer */}
      {showBulk && (
        <section className="inq-drawer" aria-label="Paste running list bulk import">
          <div className="inq-drawer-head">
            <h3>📋 Paste a list</h3>
            <button type="button" className="sk-text-btn" onClick={() => setShowBulk(false)}>
              Close
            </button>
          </div>
          <p className="sk-hint">
            Paste bullet points, checkboxes, or numbered lines (one lookup per line). Duplicates are skipped automatically.
          </p>
          <form className="sk-inline-form" onSubmit={(e) => void handleBulkImport(e)}>
            <label className="sk-field">
              <span>Running list</span>
              <textarea
                rows={5}
                value={bulkText}
                placeholder={'- what is MCP\n- what is R1 Redundancy\n- how does Raft consensus work'}
                onChange={(e) => setBulkText(e.target.value)}
              />
            </label>
            <div className="inq-preview-meta">
              <strong>{parsedRunningItems.length}</strong> parsed item{parsedRunningItems.length === 1 ? '' : 's'}
              {parsedRunningItems.length > 0 && (
                <span>
                  ({newRunningCount} new · {parsedRunningItems.length - newRunningCount} already in list)
                </span>
              )}
            </div>
            {parsedRunningItems.length > 0 && (
              <div className="sk-chips">
                {parsedRunningItems.slice(0, 8).map((line) => (
                  <span key={line} className="sk-chip">{line}</span>
                ))}
                {parsedRunningItems.length > 8 && (
                  <span className="sk-chip">+{parsedRunningItems.length - 8} more</span>
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
                disabled={bulkBusy || parsedRunningItems.length === 0}
              >
                {bulkBusy ? 'Importing…' : `Import ${parsedRunningItems.length} lookup${parsedRunningItems.length === 1 ? '' : 's'}`}
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
                <strong>Preview:</strong> {parsedReply.data.length} parsed answer{parsedReply.data.length === 1 ? '' : 's'} ready
              </div>
              {parsedReply.warnings.map((w, i) => (
                <p key={i} className="sk-warning">{w}</p>
              ))}
              <ul className="inq-preview-list">
                {parsedReply.data.map((ans, idx) => (
                  <li key={`${ans.inquiryId ?? ans.question}-${idx}`} className="inq-preview-item">
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
                    <strong>{ans.question}</strong>
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
              disabled={applyAiBusy || !parsedReply?.ok || parsedReply.data.length === 0}
              onClick={() => void handleApplyAiAnswers()}
            >
              {applyAiBusy ? 'Applying…' : 'Apply Answers to Knowledge Base'}
            </button>
          </div>
        </section>
      )}

      {/* Search & Status Filters */}
      <div className="inq-filter-bar">
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
          <input
            type="search"
            className="inq-filter-search"
            value={search}
            placeholder="Search questions, answers, takeaways, #tags…"
            aria-label="Search lookups"
            onChange={(e) => setSearch(e.target.value)}
          />
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
        </div>
      </div>

      {/* Inquiry Cards List */}
      {filteredInquiries.length === 0 ? (
        <p className="sk-empty">
          {scopedInquiries.length === 0
            ? 'No lookups captured yet. Jot down anything you hear above, or paste your running list!'
            : 'No lookups match those filters.'}
        </p>
      ) : (
        <ul className="inq-list">
          {filteredInquiries.map((inq) => {
            const sub = inq.subjectId ? subjectMap.get(inq.subjectId) : undefined;
            const topic = sub && inq.topicId ? sub.topics.find((t) => t.id === inq.topicId) : undefined;
            const isEditing = editingId === inq.id;
            const isFocused = highlightedId === inq.id;
            const isBusy = cardBusyId === inq.id;
            const canPromoteCard = !inq.cardItemId && !!inq.subjectId && !!inq.topicId && !!(inq.answer?.trim() || inq.takeaways?.trim());

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
                    <h3 className="inq-card-question">{inq.question}</h3>
                  </div>
                </div>

                {inq.context && (
                  <p className="inq-card-context">
                    <strong>Context:</strong> {inq.context}
                  </p>
                )}

                {inq.answer && (
                  <div className="inq-answer-box">
                    <RichInquiryText
                      text={inq.answer}
                      resolveWiki={resolveWiki}
                      onSelectGraphNode={onSelectGraphNode}
                      onFilterTag={(t) => setSearch(`#${t}`)}
                      inquiries={inquiries}
                      subjects={subjects}
                      onFocusInquiry={focusLocalInquiry}
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
                      onFilterTag={(t) => setSearch(`#${t}`)}
                      inquiries={inquiries}
                      subjects={subjects}
                      onFocusInquiry={focusLocalInquiry}
                    />
                  </div>
                )}

                {inq.sources && inq.sources.length > 0 && (
                  <div className="inq-sources">
                    <strong>Sources:</strong>
                    {inq.sources.map((src, i) =>
                      /^https?:\/\//i.test(src) ? (
                        <a key={`${src}-${i}`} className="inq-source-link" href={src} target="_blank" rel="noopener noreferrer">
                          {src}
                        </a>
                      ) : (
                        <span key={`${src}-${i}`} className="sk-chip">{src}</span>
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
                        className="inq-tag-chip"
                        onClick={() => {
                          if (onSelectGraphNode) onSelectGraphNode(`tag:${tag}`);
                          else setSearch((prev) => (prev === `#${tag}` ? '' : `#${tag}`));
                        }}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                <div className="sk-actions">
                  <button
                    type="button"
                    className="sk-small-btn"
                    aria-expanded={isEditing}
                    onClick={() => setEditingId(isEditing ? null : inq.id)}
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
              </li>
            );
          })}
        </ul>
      )}
      {popup}
    </div>
  );
}
