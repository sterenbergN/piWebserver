// Structured parsing and prompt generation for recording summaries. Pure TS so both the
// browser UI and Node unit tests share one implementation.

export type SummaryTimestamp = {
  raw: string;
  seconds: number;
  ms: number;
  label: string;
};

export type SummaryChapter = {
  time: SummaryTimestamp;
  title: string;
  summary: string;
};

export type SummaryKeyPoint = {
  time?: SummaryTimestamp;
  text: string;
};

export type SummaryTerm = {
  term: string;
  definition: string;
  time?: SummaryTimestamp;
};

export type SummaryActionItem = {
  task: string;
  due?: string;
  time?: SummaryTimestamp;
};

export type SummaryQA = {
  question: string;
  answer: string;
  time?: SummaryTimestamp;
};

export type ParsedRecordingSummary = {
  format: 'strict' | 'legacy';
  overview: string;
  chapters: SummaryChapter[];
  keyPoints: SummaryKeyPoint[];
  terms: SummaryTerm[];
  actionItems: SummaryActionItem[];
  questions: SummaryQA[];
};

export type SummaryTextToken =
  | { type: 'text'; text: string }
  | { type: 'time'; ts: SummaryTimestamp };

const KNOWN_STRICT_KEYS = [
  'overview',
  'chapters',
  'keyPoints',
  'key_points',
  'terms',
  'actionItems',
  'action_items',
  'questions',
] as const;

const TIMESTAMP_EXACT_RE = /^(?:\[\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*\]|\(\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*\)|(\d{1,3}:\d{2}(?::\d{2})?))$/;
const INLINE_TIMESTAMP_RE = /\[\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*\]|\(\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*\)/g;
const LEADING_TIMESTAMP_RE = /^(\[\s*\d{1,3}:\d{2}(?::\d{2})?\s*\]|\(\s*\d{1,3}:\d{2}(?::\d{2})?\s*\)|\d{1,3}:\d{2}(?::\d{2})?)(?:\s*[-–—:]\s*|\s+|$)/;

/** Format milliseconds as `M:SS` or `H:MM:SS`, matching `Recorder.fmtDuration`. */
export function fmtSummaryDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Parse `"MM:SS"`, `"M:SS"`, `"HH:MM:SS"`, `"[MM:SS]"`, or `"(MM:SS)"` into a normalized timestamp. */
export function parseTimestamp(raw: string): SummaryTimestamp | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = TIMESTAMP_EXACT_RE.exec(trimmed);
  if (!match) return null;
  const core = match[1] ?? match[2] ?? match[3];
  if (!core) return null;
  const parts = core.split(':').map((part) => Number(part));
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;

  let seconds = 0;
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (ss >= 60) return null;
    seconds = mm * 60 + ss;
  } else if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    if (hh > 99 || mm >= 60 || ss >= 60) return null;
    seconds = hh * 3600 + mm * 60 + ss;
  } else {
    return null;
  }

  const ms = seconds * 1000;
  return {
    raw: trimmed,
    seconds,
    ms,
    label: fmtSummaryDuration(ms),
  };
}

/** Split prose into plain text segments and clickable inline timestamp tokens. */
export function tokenizeInlineTimestamps(text: string): SummaryTextToken[] {
  if (typeof text !== 'string' || !text) return [];
  const tokens: SummaryTextToken[] = [];
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const prev = tokens[tokens.length - 1];
    if (prev?.type === 'text') prev.text += chunk;
    else tokens.push({ type: 'text', text: chunk });
  };

  let cursor = 0;
  INLINE_TIMESTAMP_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TIMESTAMP_RE.exec(text)) !== null) {
    const rawMatch = match[0];
    const ts = parseTimestamp(rawMatch);
    if (!ts) continue;
    pushText(text.slice(cursor, match.index));
    tokens.push({ type: 'time', ts });
    cursor = match.index + rawMatch.length;
  }
  pushText(text.slice(cursor));
  return tokens;
}

/** Build the strict JSON summary prompt for pasting into an external AI assistant. */
export function buildStrictSummaryPrompt(
  title: string,
  notebookTitle: string,
  startedAt: number,
  segments: { start: number; end?: number; text: string }[],
): string {
  const date = Number.isFinite(startedAt) ? new Date(startedAt) : new Date();
  const when = Number.isNaN(date.getTime())
    ? 'recently'
    : date.toLocaleString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

  const transcriptLines = segments
    .map((s) => `[${fmtSummaryDuration(s.start)}] ${s.text}`)
    .join('\n');

  return [
    `Below is a transcript of a recording from my notes ("${title}", in my notebook "${notebookTitle}", recorded ${when}). It's probably a lecture, class or meeting.`,
    'It was made by a small speech-recognition model, so some words, especially technical, medical or unusual ones, will be misheard. Work out what was really meant from the context, and fix those words in what you write.',
    '',
    'Respond with ONLY a single fenced ```json block (no extra prose before or after) matching this exact JSON schema:',
    '```json',
    '{',
    '  "overview": "3-5 sentence synthesis referencing [MM:SS] timestamps",',
    '  "chapters": [{ "time": "00:00", "title": "...", "summary": "..." }],',
    '  "keyPoints": [{ "time": "01:15", "text": "..." }],',
    '  "terms": [{ "term": "...", "definition": "...", "time": "02:40" }],',
    '  "actionItems": [{ "task": "...", "due": "...", "time": "05:10" }],',
    '  "questions": [{ "question": "...", "answer": "...", "time": "03:22" }]',
    '}',
    '```',
    '',
    'Rules:',
    '- Use exact "MM:SS" (or "HH:MM:SS") strings taken directly from the transcript [MM:SS] markers for every "time" field, and embed [MM:SS] markers inside "overview" where jumping back to listen helps.',
    '- Omit nothing structural: include every top-level key ("overview", "chapters", "keyPoints", "terms", "actionItems", "questions"), and use [] if a list is empty.',
    '- In "actionItems", set "due" to "" or omit it if no deadline was stated. In "questions", write concise self-test review Q&As grounded in the recording.',
    '',
    'Transcript:',
    transcriptLines,
  ].join('\n');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function escapeControlCharsInJsonStrings(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') {
        out += c;
        if (i + 1 < text.length) out += text[++i];
        continue;
      }
      if (c === '"') {
        inString = false;
        out += c;
        continue;
      }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      out += c;
    } else {
      if (c === '"') inString = true;
      out += c;
    }
  }
  return out;
}

function tryParseJson(slice: string): { ok: true; value: unknown } | { ok: false } {
  const candidates = [
    slice,
    slice.replace(/,(\s*[}\]])/g, '$1'),
    escapeControlCharsInJsonStrings(slice),
    escapeControlCharsInJsonStrings(slice).replace(/,(\s*[}\]])/g, '$1'),
  ];
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Try next variant.
    }
  }
  return { ok: false };
}

function scanBalancedObjectEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (!stack.length || stack[stack.length - 1] !== c) return -1;
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

function scanJsonState(slice: string): { inString: boolean; stack: string[]; endsWithDanglingEscape: boolean } {
  const stack: string[] = [];
  let inString = false;
  let endsWithDanglingEscape = false;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (inString) {
      if (c === '\\') {
        if (i + 1 >= slice.length) endsWithDanglingEscape = true;
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
    }
  }
  return { inString, stack, endsWithDanglingEscape };
}

function isStrictSummaryObject(val: unknown): val is Record<string, unknown> {
  if (!isRecord(val)) return false;
  return KNOWN_STRICT_KEYS.some((key) => key in val);
}

/** Close unclosed strings, arrays, and objects for a truncated JSON summary slice. */
function recoverTruncatedSummaryJson(slice: string): Record<string, unknown> | null {
  const buildClosed = (prefix: string): Record<string, unknown> | null => {
    const state = scanJsonState(prefix);
    let body = prefix;
    if (state.endsWithDanglingEscape) body = body.slice(0, -1);
    if (state.inString) body += '"';
    const trimmed = body.trimEnd();
    if (/[:,]\s*$/.test(trimmed)) {
      body = trimmed.endsWith(':') ? `${trimmed} null` : trimmed.slice(0, -1);
    }
    const afterState = scanJsonState(body);
    if (afterState.inString) body += '"';
    const closed = body + [...afterState.stack].reverse().join('');
    const parsed = tryParseJson(closed);
    return parsed.ok && isStrictSummaryObject(parsed.value) ? parsed.value : null;
  };

  // Strategy 1: direct closure (handles cutoffs inside string values, after ':', after ',', etc.).
  const direct = buildClosed(slice);
  if (direct) return direct;

  // Strategy 2: strip an incomplete trailing object key like `,"tit` or `{"title` or `,"title":`.
  const candidates = [slice];
  const state = scanJsonState(slice);
  if (state.inString) {
    const withQuote = (state.endsWithDanglingEscape ? slice.slice(0, -1) : slice) + '"';
    candidates.push(withQuote.replace(/,\s*"(?:\\.|[^"\\])*"\s*:?\s*$/, ''));
    candidates.push(withQuote.replace(/(\{\s*)"(?:\\.|[^"\\])*"\s*:?\s*$/, '$1'));
  } else {
    candidates.push(slice.replace(/,\s*"(?:\\.|[^"\\])*"\s*:?\s*$/, ''));
    candidates.push(slice.replace(/(\{\s*)"(?:\\.|[^"\\])*"\s*:?\s*$/, '$1'));
  }

  for (const candidate of candidates) {
    const recovered = buildClosed(candidate);
    if (recovered) return recovered;
  }

  // Strategy 3: iteratively trim back to earlier safe ',' / '{' / '[' delimiters.
  let pos = slice.length;
  for (let attempts = 0; attempts < 24 && pos > 1; attempts++) {
    const cut = Math.max(slice.lastIndexOf(',', pos - 1), slice.lastIndexOf('{', pos - 1), slice.lastIndexOf('[', pos - 1));
    if (cut <= 0) break;
    const prefix = slice[cut] === ',' ? slice.slice(0, cut) : slice.slice(0, cut + 1);
    const recovered = buildClosed(prefix);
    if (recovered) return recovered;
    pos = cut;
  }

  return null;
}

function extractStrictJsonObject(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const closedFenceRe = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = closedFenceRe.exec(raw)) !== null) {
    if (fenceMatch[1].includes('{')) candidates.push(fenceMatch[1]);
  }
  const openFenceMatch = /```(?:json)?\s*\n?([\s\S]*)$/i.exec(raw);
  if (openFenceMatch?.[1]?.includes('{')) candidates.push(openFenceMatch[1]);
  candidates.push(raw.replace(/```(?:json)?/gi, ''));

  for (const source of candidates) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== '{') continue;
      const end = scanBalancedObjectEnd(source, i);
      if (end >= 0) {
        const parsed = tryParseJson(source.slice(i, end + 1));
        if (parsed.ok && isStrictSummaryObject(parsed.value)) return parsed.value;
      }
    }
  }

  for (const source of candidates) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== '{') continue;
      const end = scanBalancedObjectEnd(source, i);
      if (end >= 0) {
        i = end;
        continue;
      }
      const recovered = recoverTruncatedSummaryJson(source.slice(i));
      if (recovered) return recovered;
    }
  }

  return null;
}

function firstInlineTimestamp(text: string): SummaryTimestamp | undefined {
  for (const token of tokenizeInlineTimestamps(text)) {
    if (token.type === 'time') return token.ts;
  }
  return undefined;
}

function resolveFieldTimestamp(rawTime: unknown, ...texts: string[]): SummaryTimestamp | undefined {
  if (typeof rawTime === 'string') {
    const direct = parseTimestamp(rawTime);
    if (direct) return direct;
    const inline = firstInlineTimestamp(rawTime);
    if (inline) return inline;
    const bareMatch = /(\d{1,3}:\d{2}(?::\d{2})?)/.exec(rawTime);
    if (bareMatch) {
      const bare = parseTimestamp(bareMatch[1]);
      if (bare) return bare;
    }
  } else if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime >= 0) {
    const sec = Math.round(rawTime);
    return { raw: fmtSummaryDuration(sec * 1000), seconds: sec, ms: sec * 1000, label: fmtSummaryDuration(sec * 1000) };
  }
  for (const text of texts) {
    if (!text) continue;
    const leading = LEADING_TIMESTAMP_RE.exec(text.trim());
    if (leading) {
      const ts = parseTimestamp(leading[1]);
      if (ts) return ts;
    }
    const inline = firstInlineTimestamp(text);
    if (inline) return inline;
  }
  return undefined;
}

function normalizeStrictSummary(obj: Record<string, unknown>): ParsedRecordingSummary {
  const overview = cleanStr(obj.overview);

  const rawChapters = Array.isArray(obj.chapters) ? obj.chapters : [];
  const chapters: SummaryChapter[] = [];
  for (const entry of rawChapters) {
    if (!isRecord(entry)) continue;
    const title = cleanStr(entry.title ?? entry.heading ?? entry.name);
    const summary = cleanStr(entry.summary ?? entry.description ?? entry.text);
    const time = resolveFieldTimestamp(entry.time ?? entry.timestamp, title, summary);
    if (!time || (!title && !summary)) continue;
    chapters.push({ time, title: title || time.label, summary });
  }

  const rawKeyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints
    : Array.isArray(obj.key_points)
      ? obj.key_points
      : [];
  const keyPoints: SummaryKeyPoint[] = [];
  for (const entry of rawKeyPoints) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (!text) continue;
      const time = resolveFieldTimestamp(undefined, text);
      keyPoints.push({ ...(time ? { time } : {}), text });
      continue;
    }
    if (!isRecord(entry)) continue;
    const text = cleanStr(entry.text ?? entry.point ?? entry.summary);
    if (!text) continue;
    const time = resolveFieldTimestamp(entry.time ?? entry.timestamp, text);
    keyPoints.push({ ...(time ? { time } : {}), text });
  }

  const rawTerms = Array.isArray(obj.terms) ? obj.terms : [];
  const terms: SummaryTerm[] = [];
  for (const entry of rawTerms) {
    if (typeof entry === 'string') {
      const line = entry.trim();
      if (!line) continue;
      const time = resolveFieldTimestamp(undefined, line);
      const split = splitTermDefinition(line);
      if (split) terms.push({ ...split, ...(time ? { time } : {}) });
      continue;
    }
    if (!isRecord(entry)) continue;
    const term = cleanStr(entry.term ?? entry.name ?? entry.concept);
    const definition = cleanStr(entry.definition ?? entry.meaning ?? entry.description ?? entry.text);
    if (!term && !definition) continue;
    const time = resolveFieldTimestamp(entry.time ?? entry.timestamp, definition, term);
    terms.push({
      term: term || definition,
      definition: term ? definition : '',
      ...(time ? { time } : {}),
    });
  }

  const rawActions = Array.isArray(obj.actionItems)
    ? obj.actionItems
    : Array.isArray(obj.action_items)
      ? obj.action_items
      : [];
  const actionItems: SummaryActionItem[] = [];
  for (const entry of rawActions) {
    if (typeof entry === 'string') {
      const task = entry.trim();
      if (!task) continue;
      const time = resolveFieldTimestamp(undefined, task);
      actionItems.push({ task, ...(time ? { time } : {}) });
      continue;
    }
    if (!isRecord(entry)) continue;
    const task = cleanStr(entry.task ?? entry.text ?? entry.title ?? entry.action);
    if (!task) continue;
    const due = cleanStr(entry.due ?? entry.deadline);
    const time = resolveFieldTimestamp(entry.time ?? entry.timestamp, task);
    actionItems.push({
      task,
      ...(due ? { due } : {}),
      ...(time ? { time } : {}),
    });
  }

  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: SummaryQA[] = [];
  for (const entry of rawQuestions) {
    if (!isRecord(entry)) continue;
    const question = cleanStr(entry.question ?? entry.q ?? entry.prompt);
    const answer = cleanStr(entry.answer ?? entry.a);
    if (!question) continue;
    const time = resolveFieldTimestamp(entry.time ?? entry.timestamp, question, answer);
    questions.push({
      question,
      answer,
      ...(time ? { time } : {}),
    });
  }

  return {
    format: 'strict',
    overview,
    chapters,
    keyPoints,
    terms,
    actionItems,
    questions,
  };
}

type LegacySection = 'overview' | 'chapters' | 'keyPoints' | 'terms' | 'actionItems' | 'questions';

const LEGACY_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*)?\*{0,2}(summary|overview|tl;?dr|abstract|recap|chapters?|timeline|key\s+points|key\s+takeaways|takeaways|main\s+points|highlights|terms(?:\s+(?:and|&)\s+facts(?:\s+to\s+remember)?)?|facts(?:\s+to\s+remember)?|definitions|key\s+terms|vocabulary|to[\s-]?do|action\s+items|next\s+steps|assignments|deadlines|tasks|self[\s-]?test(?:\s+review)?(?:\s+q\s*&?\s*as?)?|review\s+questions|practice\s+questions|questions|q\s*&\s*as?)\*{0,2}\s*(?::\s*(.*)|$)/i;

function classifyLegacyHeading(label: string): LegacySection {
  const lower = label.trim().toLowerCase();
  if (/^(summary|overview|tl;?dr|abstract|recap)$/.test(lower)) return 'overview';
  if (/^(chapters?|timeline)$/.test(lower)) return 'chapters';
  if (/^(terms|facts|definitions|key\s+terms|vocabulary)/.test(lower)) return 'terms';
  if (/^(to[\s-]?do|action\s+items|next\s+steps|assignments|deadlines|tasks)$/.test(lower)) return 'actionItems';
  if (/^(self[\s-]?test|review\s+questions|practice\s+questions|questions|q\s*&\s*as?)/.test(lower)) return 'questions';
  return 'keyPoints';
}

function stripBulletPrefix(line: string): { isBullet: boolean; text: string } {
  const trimmed = line.trim();
  const bulletMatch = /^(?:[-*•◦▪‣]|\[\s?[xX ]?\s?\]|\d+[.)])\s+(.*)$/.exec(trimmed);
  if (bulletMatch) return { isBullet: true, text: bulletMatch[1].trim() };
  return { isBullet: false, text: trimmed };
}

function extractLeadingOrInlineTime(text: string): { time?: SummaryTimestamp; body: string } {
  const trimmed = text.trim();
  const leading = LEADING_TIMESTAMP_RE.exec(trimmed);
  if (leading) {
    const ts = parseTimestamp(leading[1]);
    if (ts) {
      const rest = trimmed.slice(leading[0].length).trim();
      return { time: ts, body: rest || trimmed };
    }
  }
  return { time: firstInlineTimestamp(trimmed), body: trimmed };
}

function splitTermDefinition(text: string): { term: string; definition: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const boldColon = /^\*\*([^*]+)\*\*\s*(?::|—|–|-)\s*(.+)$/.exec(trimmed);
  if (boldColon) {
    return { term: boldColon[1].trim(), definition: boldColon[2].trim() };
  }
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0 && colonIdx < 100) {
    const left = trimmed.slice(0, colonIdx).replace(/\*\*/g, '').trim();
    const right = trimmed.slice(colonIdx + 1).trim();
    if (left && right) return { term: left, definition: right };
  }
  const dashMatch = /^(.{1,90}?)\s+[—–-]\s+(.+)$/.exec(trimmed);
  if (dashMatch) {
    const left = dashMatch[1].replace(/\*\*/g, '').trim();
    const right = dashMatch[2].trim();
    if (left && right) return { term: left, definition: right };
  }
  return { term: trimmed.replace(/\*\*/g, ''), definition: '' };
}

function parseLegacyActionLine(body: string): { task: string; due?: string } {
  let task = body.trim();
  let due: string | undefined;
  const parenDue = /\(\s*due[:\s]+([^)]+)\)(?=\s*(?:\[\s*\d{1,3}:\d{2}(?::\d{2})?\s*\]|\(\s*\d{1,3}:\d{2}(?::\d{2})?\s*\))?\s*$)/i.exec(task);
  if (parenDue) {
    due = parenDue[1].trim();
    task = `${task.slice(0, parenDue.index)} ${task.slice(parenDue.index + parenDue[0].length)}`.replace(/\s{2,}/g, ' ').trim();
  } else {
    const trailDue = /\s+[—–-]\s*due[:\s]+(.+)$/i.exec(task);
    if (trailDue) {
      due = trailDue[1].trim();
      task = task.slice(0, trailDue.index).trim();
    }
  }
  return { task: task || body.trim(), ...(due ? { due } : {}) };
}

function parseLegacySummary(raw: string): ParsedRecordingSummary {
  const result: ParsedRecordingSummary = {
    format: 'legacy',
    overview: '',
    chapters: [],
    keyPoints: [],
    terms: [],
    actionItems: [],
    questions: [],
  };

  let section: LegacySection | null = null;
  const overviewLines: string[] = [];
  let pendingQuestion: SummaryQA | null = null;

  const pushSectionLine = (target: LegacySection, line: string, isBullet: boolean) => {
    const { time, body } = extractLeadingOrInlineTime(line);
    if (!body) return;

    if (target === 'overview') {
      overviewLines.push(line.trim());
      return;
    }

    if (target === 'chapters') {
      if (time) {
        const split = splitTermDefinition(body);
        result.chapters.push({
          time,
          title: split?.term || body,
          summary: split?.definition || '',
        });
      } else {
        result.keyPoints.push({ text: body });
      }
      return;
    }

    if (target === 'keyPoints') {
      result.keyPoints.push({ ...(time ? { time } : {}), text: body });
      return;
    }

    if (target === 'terms') {
      const split = splitTermDefinition(body);
      if (split) {
        result.terms.push({ ...split, ...(time ? { time } : {}) });
      }
      return;
    }

    if (target === 'actionItems') {
      const parsedAction = parseLegacyActionLine(body);
      result.actionItems.push({ ...parsedAction, ...(time ? { time } : {}) });
      return;
    }

    if (target === 'questions') {
      const qaInline = /^(?:Q\s*:\s*)(.+?)\s+(?:A\s*:\s*)(.+)$/i.exec(body);
      if (qaInline) {
        pendingQuestion = null;
        const t = time ?? firstInlineTimestamp(qaInline[1]) ?? firstInlineTimestamp(qaInline[2]);
        result.questions.push({
          question: qaInline[1].trim(),
          answer: qaInline[2].trim(),
          ...(t ? { time: t } : {}),
        });
        return;
      }
      const aMatch = /^(?:A|Answer)\s*:\s*(.+)$/i.exec(body);
      if (aMatch && pendingQuestion) {
        pendingQuestion.answer = pendingQuestion.answer
          ? `${pendingQuestion.answer} ${aMatch[1].trim()}`
          : aMatch[1].trim();
        if (!pendingQuestion.time && time) pendingQuestion.time = time;
        return;
      }
      const qMatch = /^(?:Q|Question)\s*:\s*(.+)$/i.exec(body);
      if (qMatch) {
        const t = time ?? firstInlineTimestamp(qMatch[1]);
        pendingQuestion = {
          question: qMatch[1].trim(),
          answer: '',
          ...(t ? { time: t } : {}),
        };
        result.questions.push(pendingQuestion);
        return;
      }
      const dashSplit = /^(.+?\?)\s*(?:—|–|-|:)\s*(.+)$/.exec(body);
      if (dashSplit) {
        pendingQuestion = null;
        result.questions.push({
          question: dashSplit[1].trim(),
          answer: dashSplit[2].trim(),
          ...(time ? { time } : {}),
        });
        return;
      }
      if (isBullet || body.endsWith('?')) {
        pendingQuestion = {
          question: body,
          answer: '',
          ...(time ? { time } : {}),
        };
        result.questions.push(pendingQuestion);
      } else if (pendingQuestion && !pendingQuestion.answer) {
        pendingQuestion.answer = body;
      }
    }
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (section === 'overview' || section === null) overviewLines.push('');
      continue;
    }

    const headingMatch = LEGACY_HEADING_RE.exec(trimmed);
    if (headingMatch) {
      pendingQuestion = null;
      section = classifyLegacyHeading(headingMatch[1]);
      const inline = headingMatch[2]?.trim();
      if (inline) {
        const stripped = stripBulletPrefix(inline);
        pushSectionLine(section, stripped.text, stripped.isBullet);
      }
      continue;
    }

    const stripped = stripBulletPrefix(trimmed);
    if (section === null) {
      if (stripped.isBullet) {
        pushSectionLine('keyPoints', stripped.text, true);
      } else {
        overviewLines.push(trimmed);
      }
      continue;
    }

    pushSectionLine(section, stripped.text, stripped.isBullet);
  }

  result.overview = overviewLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result;
}

/**
 * Parse a recording summary string: extracts strict JSON (including truncated partial JSON)
 * first, falling back to structured parsing of legacy/freeform text summaries.
 */
export function parseRecordingSummary(raw: string): ParsedRecordingSummary {
  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      format: 'legacy',
      overview: '',
      chapters: [],
      keyPoints: [],
      terms: [],
      actionItems: [],
      questions: [],
    };
  }

  const strictObj = extractStrictJsonObject(raw);
  if (strictObj) {
    return normalizeStrictSummary(strictObj);
  }

  return parseLegacySummary(raw);
}

/** Count distinct clickable timestamp anchors across all sections of a parsed summary. */
export function countSummaryTimestamps(parsed: ParsedRecordingSummary): number {
  let count = 0;

  const countInline = (text: string, knownSeconds?: number) => {
    let n = 0;
    for (const token of tokenizeInlineTimestamps(text)) {
      if (token.type === 'time' && token.ts.seconds !== knownSeconds) n++;
    }
    return n;
  };

  count += countInline(parsed.overview);

  for (const ch of parsed.chapters) {
    count += 1 + countInline(ch.title, ch.time.seconds) + countInline(ch.summary, ch.time.seconds);
  }
  for (const kp of parsed.keyPoints) {
    count += (kp.time ? 1 : 0) + countInline(kp.text, kp.time?.seconds);
  }
  for (const t of parsed.terms) {
    count += (t.time ? 1 : 0) + countInline(t.term, t.time?.seconds) + countInline(t.definition, t.time?.seconds);
  }
  for (const a of parsed.actionItems) {
    count += (a.time ? 1 : 0) + countInline(a.task, a.time?.seconds);
  }
  for (const qa of parsed.questions) {
    count += (qa.time ? 1 : 0) + countInline(qa.question, qa.time?.seconds) + countInline(qa.answer, qa.time?.seconds);
  }

  return count;
}

/** Format a parsed recording summary into clean plain outline text for a notebook text box. */
export function formatSummaryForNotebookPage(title: string, parsed: ParsedRecordingSummary): string {
  const blocks: string[] = [];
  const cleanTitle = title.trim();
  if (cleanTitle) blocks.push(`${cleanTitle} — Summary`);

  if (parsed.overview) {
    blocks.push(`Overview\n${parsed.overview}`);
  }

  if (parsed.chapters.length) {
    blocks.push(
      [
        'Chapters',
        ...parsed.chapters.map((ch) =>
          `• [${ch.time.label}] ${ch.title}${ch.summary ? ` — ${ch.summary}` : ''}`,
        ),
      ].join('\n'),
    );
  }

  if (parsed.keyPoints.length) {
    blocks.push(
      [
        'Key Points',
        ...parsed.keyPoints.map((kp) =>
          `• ${kp.time ? `[${kp.time.label}] ` : ''}${kp.text}`,
        ),
      ].join('\n'),
    );
  }

  if (parsed.terms.length) {
    blocks.push(
      [
        'Terms & Facts',
        ...parsed.terms.map((t) => {
          const def = t.definition ? `: ${t.definition}` : '';
          const stamp = t.time ? ` [${t.time.label}]` : '';
          return `• ${t.term}${def}${stamp}`;
        }),
      ].join('\n'),
    );
  }

  if (parsed.actionItems.length) {
    blocks.push(
      [
        'Action Items',
        ...parsed.actionItems.map((a) => {
          const due = a.due ? ` (due ${a.due})` : '';
          const stamp = a.time ? ` [${a.time.label}]` : '';
          return `• [ ] ${a.task}${due}${stamp}`;
        }),
      ].join('\n'),
    );
  }

  return blocks.join('\n\n');
}

/** Convert a notebook title into a URL/tag-safe lowercase slug for Skills inquiry tagging. */
export function slugifyNotebookTag(notebookTitle: string): string {
  return notebookTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
