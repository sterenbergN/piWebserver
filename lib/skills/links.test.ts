import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanQuestions } from '../notes/items';
import { readBookItems, readPageElements, saveInkText, syncLibrary, syncBook, syncPage } from '../notes/store';
import { libraryFile, saveProgress, syncNotes } from '../reader/store';
import { addProjectLog, addResource, addSubject, addTopic, saveCard, tiePage, untiePage } from './edit';
import { buildKnowledgeGraph, describePages, extractTags, extractWikiLinks, inquiryConceptAlias, linkableNames, materialFor, newTopicPage, skillsNotebook, syncReaderResources } from './links';
import { buildQueue } from './model';
import { buildQuestionsPrompt } from './prompts';
import { projectFilesFolder, readSkills, updateSkills } from './store';
import { emptyProgress, emptySkills, type KnowledgeInquiry } from './types';

// Skills' ties to the Reader and Notes, against real stores in a scratch folder.

const USER = 'links-test';
const NOW = '2026-11-12T15:00:00.000Z';
const original = process.cwd();
let dir = '';
let n = 0;
const makeId = () => `id${++n}`;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-links-'));
  process.chdir(dir);
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

function subjectWithBook() {
  const data = emptySkills();
  const subject = addSubject(data, { name: 'Controls' }, makeId, NOW);
  const topic = addTopic(subject, { name: 'PID' }, makeId, NOW);
  const book = addResource(subject, { title: 'Process Control', kind: 'book', readerBookId: 'book1', topicIds: [topic.id] }, makeId, '2026-11-12', NOW);
  return { data, subject, topic, book };
}

test('a linked book follows the Reader: started, pages read, finished', async () => {
  const { data, book } = subjectWithBook();
  assert.equal(book.readerBookId, 'book1');
  assert.equal(await syncReaderResources(USER, data), false, 'not opened yet: nothing to do');

  // The Reader only keeps progress for books on the shelf.
  await fs.mkdir(path.dirname(libraryFile(USER)), { recursive: true });
  await fs.writeFile(libraryFile(USER), JSON.stringify({ books: [{ id: 'book1', title: 'Process Control', author: '', format: 'pdf', size: 1, addedAt: NOW, hasCover: false }], folders: [], seqs: {} }));
  const started = Date.parse('2026-11-01T12:00:00Z');
  await saveProgress(USER, [{ book: 'book1', anchor: { page: 40 }, pct: 0.2, at: started, total: 200, startedAt: started }], started);
  assert.equal(await syncReaderResources(USER, data), true);
  assert.equal(book.status, 'doing');
  assert.equal(book.startedOn, '2026-11-01');
  assert.deepEqual(book.progress, { done: 40, total: 200, unit: 'pages' });
  assert.equal(await syncReaderResources(USER, data), false, 'nothing new the second time');

  const finished = Date.parse('2026-11-10T12:00:00Z');
  await saveProgress(USER, [{ book: 'book1', anchor: { page: 200 }, pct: 1, at: finished, total: 200, startedAt: started, finishedAt: finished }], finished);
  assert.equal(await syncReaderResources(USER, data), true);
  assert.equal(book.status, 'done');
  assert.equal(book.finishedOn, '2026-11-10');
  assert.equal(book.progress?.done, 200);
});

test('topic pages in Notes: made, described, untied; notes go into the prompt', async () => {
  const { data, subject, topic } = subjectWithBook();
  const notebook = await skillsNotebook(USER, data);
  assert.equal(data.notesNotebook, notebook);
  assert.equal(await skillsNotebook(USER, data), notebook, 'made once');

  const ref = await newTopicPage(USER, notebook, subject, topic, 'https://example.test');
  tiePage(subject, topic, ref, NOW);
  tiePage(subject, topic, ref, NOW);
  assert.equal(topic.notePages?.length, 1, 'tied once');
  const elements = await readPageElements(USER, notebook, ref.page);
  assert.ok(elements.some((e) => e.kind === 'text' && e.text === 'Controls: PID'));
  assert.ok(elements.some((e) => e.kind === 'mark' && e.target && 'url' in e.target && e.target.url === `https://example.test/skills/${subject.id}?tab=topics`));
  const [view] = await describePages(USER, topic.notePages!);
  assert.equal(view.label, 'Controls: PID (Skills, p. 1)');

  // Write on the page, and in the linked book: both come back as material.
  await syncPage(USER, notebook, ref.page, Number.MAX_SAFE_INTEGER, [{ id: 'typed', kind: 'text', x: 40, y: 300, w: 400, h: 20, rot: 0, text: 'Derivative kick: use derivative on measurement.', size: 12, color: '#000000', font: 'sans', createdAt: 1, updatedAt: 1 }], Date.now());
  await syncNotes(USER, 'book1', 0, [{ id: 'n1', kind: 'note', anchor: { page: 12 }, createdAt: 1, updatedAt: 1, text: 'Integral windup needs clamping.' }], Date.now());
  const material = await materialFor(USER, subject, [topic.id]);
  assert.deepEqual(material.map((m) => m.kind), ['book', 'page']);
  assert.ok(material[0].text.includes('p. 12: Integral windup'));
  assert.ok(material[1].text.includes('Derivative kick'));
  assert.ok(!material[1].text.includes('Controls: PID') && !material[1].text.includes('in Skills ↗'), 'the page’s own heading and link aren’t notes');
  const prompt = buildQuestionsPrompt({ subject: { name: 'Controls', resources: [], items: [] }, topics: [], count: 3, style: 'cards', difficulty: 'auto', material });
  assert.ok(prompt.includes('<<<NOTES: Your notes in Process Control\np. 12: Integral windup'));

  // A page thrown away in Notes drops out.
  await syncBook(USER, notebook, Number.MAX_SAFE_INTEGER, [{ ...(await readBookItems(USER, notebook))[0], deleted: true, updatedAt: Date.now() + 1 }], Date.now());
  assert.deepEqual(await describePages(USER, topic.notePages!), []);
  untiePage(subject, topic, ref.page, NOW);
  assert.equal(topic.notePages, undefined);

  // A trashed Skills notebook is replaced by a new one.
  await syncLibrary(USER, Number.MAX_SAFE_INTEGER, [{ id: notebook, kind: 'notebook', title: 'Skills', trashedAt: Date.now(), createdAt: 1, updatedAt: Date.now() + 5 }], Date.now());
  assert.notEqual(await skillsNotebook(USER, data), notebook);
});

test('one question by name, and Notes keeping its link back to Skills', () => {
  const data = emptySkills();
  const progress = emptyProgress();
  const subject = addSubject(data, { name: 'Paused one', status: 'paused' }, makeId, NOW);
  const topic = addTopic(subject, { name: 'T' }, makeId, NOW);
  const card = saveCard(subject, { topicId: topic.id, front: 'f', back: 'b' }, makeId, NOW);
  progress.attempts.push({ id: 'a', subjectId: subject.id, topicId: topic.id, itemId: card.id, day: '2026-11-12', at: NOW, score: 1, difficulty: 2 });
  assert.equal(buildQueue(data, progress, '2026-11-12').length, 0);
  assert.deepEqual(buildQueue(data, progress, '2026-11-12', { itemId: card.id }).map((e) => e.item.id), [card.id], 'even paused, even answered today');

  const links = cleanQuestions([
    { id: 'q1', date: '2026-11-12', title: 'A', href: '/skills/review?item=q1' },
    { id: 'q2', date: '2026-11-12', title: 'B', href: 'https://evil.example/x' },
  ]);
  assert.deepEqual(links, [{ id: 'q1', date: '2026-11-12', title: 'A', href: '/skills/review?item=q1' }, { id: 'q2', date: '2026-11-12', title: 'B' }]);
});

test('extractWikiLinks extracts deduplicated targets and handles aliases', () => {
  const sample = [
    'Review [[Eigenvalues]] and [[PID Control|PID]] before [[  Linear   Algebra ]].',
    'Case dedupe: [[eigenvalues|Eig]], empty [[]], multiline [[bad\nlink]].',
  ].join('\n');
  assert.deepEqual(extractWikiLinks(sample), ['Eigenvalues', 'PID Control', 'Linear Algebra']);
  assert.deepEqual(extractWikiLinks(''), []);
});

test('extractTags extracts hierarchical/kebab tags while ignoring URLs, hex colors, and LaTeX', () => {
  const sample = [
    'Covers #CAD #robotics/kinematics and #pid-control (#LinearAlgebra).',
    'Ignore colors #ffffff #3987e5 #fff, heading line:',
    '# Markdown Heading',
    'Ignore URL https://example.com/docs#section and /skills/sub1#overview and escaped \\#escaped.',
    'Ignore pure numbers #123 and math $x + #alpha$ $$y + #beta$$, keep price note $50 #budget.',
  ].join('\n');
  assert.deepEqual(extractTags(sample), ['cad', 'robotics/kinematics', 'pid-control', 'linearalgebra', 'budget']);
  assert.deepEqual(extractTags(''), []);
});

test('store.ts preserves schedule during updateSkills/readSkills and computes projectFilesFolder', async () => {
  const userId = 'store-schedule-user';
  assert.equal(projectFilesFolder(userId), path.join(process.cwd(), '.data', 'skills', userId, 'files'));

  await updateSkills(userId, (data) => {
    const sub = addSubject(data, { name: 'Control Theory', area: 'Engineering' }, makeId, NOW);
    const top = addTopic(sub, { name: 'State Space' }, makeId, NOW);
    data.schedule = {
      hoursPerDay: 2.5,
      updatedAt: NOW,
      tasks: [
        {
          id: 'task-1',
          subjectId: sub.id,
          topicId: top.id,
          title: 'Solve observability proofs',
          day: '2026-11-12',
          minutes: 60,
          done: false,
        },
      ],
    };
  });

  const saved = await readSkills(userId);
  assert.ok(saved.schedule);
  assert.equal(saved.schedule.hoursPerDay, 2.5);
  assert.equal(saved.schedule.updatedAt, NOW);
  assert.equal(saved.schedule.tasks.length, 1);
  assert.equal(saved.schedule.tasks[0].title, 'Solve observability proofs');
  assert.equal(saved.schedule.tasks[0].minutes, 60);
});

test('buildKnowledgeGraph resolves cross-subject wiki-links, tags, backlinks, Notes OCR, Reader notes, and project logs', async () => {
  const kbUser = 'kb-graph-user';
  const ts = Date.parse(NOW);
  const data = emptySkills();

  const math = addSubject(data, {
    name: 'Linear Algebra',
    area: 'Math',
    goal: 'Master [[Eigenvalues]] #math',
    roadmap: 'Foundational vectors and matrices',
  }, makeId, NOW);
  const robotics = addSubject(data, {
    name: 'Mobile Robotics',
    area: 'Robotics',
    goal: 'Autonomous differential drive #robotics/kinematics',
  }, makeId, NOW);
  robotics.parentIds = [math.id];

  const eig = addTopic(math, {
    name: 'Eigenvalues',
    description: 'Characteristic polynomial and spectrum',
    notes: 'Connects directly to [[PID Control]] and [[Linear Algebra|LA]] #spectral #control',
  }, makeId, NOW);
  const pid = addTopic(robotics, {
    name: 'PID Control',
    description: 'Closed-loop feedback',
    notes: 'Poles mirror [[Eigenvalues]] #control #pid-control',
  }, makeId, NOW);

  // Linked Reader book + highlight notes
  const readerBookId = 'reader-ladr-1';
  await fs.mkdir(path.dirname(libraryFile(kbUser)), { recursive: true });
  await fs.writeFile(libraryFile(kbUser), JSON.stringify({
    books: [
      {
        id: readerBookId,
        title: 'Linear Algebra Done Right',
        author: 'Sheldon Axler',
        format: 'pdf',
        fileName: 'ladr.pdf',
        addedAt: NOW,
      },
    ],
    folders: [],
    seqs: {},
  }));
  await syncNotes(kbUser, readerBookId, 0, [
    {
      id: 'rn-1',
      kind: 'note',
      anchor: { page: 42 },
      quote: 'Every operator on a complex space has an eigenvalue.',
      text: 'Relates directly to [[PID Control]] pole placement #theorem',
      createdAt: ts,
      updatedAt: ts,
    },
  ], ts);

  const book = addResource(math, {
    kind: 'book',
    title: 'Linear Algebra Done Right',
    author: 'Sheldon Axler',
    url: 'https://linear.axler.net/',
    freePdfUrl: 'https://linear.axler.net/LADR4e.pdf',
    takeaways: 'Proof-first view of invariant subspaces #proofs',
    topicIds: [eig.id],
  }, makeId, '2026-11-12', NOW);
  book.readerBookId = readerBookId;

  const paper = addResource(robotics, {
    kind: 'paper',
    title: 'Probabilistic Robotics Paper',
    youtubeAudioUrl: 'https://youtube.com/watch?v=demo',
    takeaways: 'Covariance uses [[Eigenvalues]] #bayes',
    topicIds: [pid.id],
  }, makeId, '2026-11-12', NOW);

  const project = addResource(robotics, {
    kind: 'project',
    title: 'Mini Rover Build',
    detail: 'Differential drive hardware',
    topicIds: [pid.id],
  }, makeId, '2026-11-12', NOW);
  const plog = addProjectLog(robotics, project, {
    day: '2026-11-12',
    title: 'Bench PID tuning',
    note: 'Tuned gains for [[PID Control]] #hardware',
    attachments: [
      {
        kind: 'video',
        name: 'rover-run.webm',
        url: '/api/skills/projects/file?id=att1__rover-run.webm',
        size: 2048,
        mime: 'video/webm',
      },
    ],
  }, makeId, '2026-11-12', NOW);

  robotics.steps = [
    {
      id: 'step-1',
      title: 'Verify closed-loop stability margins',
      kind: 'practice',
      topicId: pid.id,
      minutes: 30,
      done: false,
    },
  ];

  const card = saveCard(math, {
    topicId: eig.id,
    front: 'When is A diagonalizable? #spectral',
    back: 'When algebraic and geometric multiplicities match.',
  }, makeId, NOW);

  // Tied Notes page with typed text + handwriting OCR
  const nbId = 'nb-skills-1';
  const pageId = 'pg-eig-1';
  await syncLibrary(kbUser, 0, [
    { id: nbId, kind: 'notebook', title: 'Math Notes', createdAt: ts, updatedAt: ts },
  ], ts);
  await syncBook(kbUser, nbId, 0, [
    { id: pageId, kind: 'page', order: 0, w: 612, h: 792, title: 'Eigenvalues Scratchpad', createdAt: ts, updatedAt: ts },
  ], ts);
  await syncPage(kbUser, nbId, pageId, 0, [
    {
      id: 'el-txt-1',
      kind: 'text',
      x: 10,
      y: 10,
      w: 200,
      h: 40,
      text: 'Typed note linking [[PID Control]] #typed-note',
      size: 14,
      color: '#ffffff',
      createdAt: ts,
      updatedAt: ts,
    },
  ], ts);
  await saveInkText(kbUser, nbId, {
    id: pageId,
    kind: 'inktext',
    page: pageId,
    pageSeq: 1,
    text: 'Handwritten [[Mobile Robotics]] matrix sketch #ocr-note',
    lines: [{ text: 'Handwritten [[Mobile Robotics]] matrix sketch #ocr-note', box: { x: 1, y: 2, w: 100, h: 20 } }],
    keys: ['robotics', 'sketch'],
  }, ts);
  tiePage(math, eig, { notebook: nbId, page: pageId }, NOW);

  // Full graph verification
  const full = await buildKnowledgeGraph(kbUser, data);
  const nodeIds = new Set(full.nodes.map((n) => n.id));
  assert.ok(nodeIds.has(`sub:${math.id}`));
  assert.ok(nodeIds.has(`sub:${robotics.id}`));
  assert.ok(nodeIds.has(`top:${eig.id}`));
  assert.ok(nodeIds.has(`top:${pid.id}`));
  assert.ok(nodeIds.has(`res:${book.id}`));
  assert.ok(nodeIds.has(`res:${paper.id}`));
  assert.ok(nodeIds.has(`res:${project.id}`));
  assert.ok(nodeIds.has(`reader:${readerBookId}`));
  assert.ok(nodeIds.has(`note:${nbId}:${pageId}`));
  assert.ok(nodeIds.has(`log:${plog.id}`));
  assert.ok(nodeIds.has(`item:${card.id}`));
  assert.ok(nodeIds.has('tag:control'));
  assert.ok(nodeIds.has('tag:ocr-note'));

  const hasEdge = (from: string, to: string, kind: string) =>
    full.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

  assert.ok(hasEdge(`sub:${math.id}`, `sub:${robotics.id}`, 'subskill'));
  assert.ok(hasEdge(`sub:${math.id}`, `top:${eig.id}`, 'topic'));
  assert.ok(hasEdge(`top:${eig.id}`, `res:${book.id}`, 'resource'));
  assert.ok(hasEdge(`res:${book.id}`, `reader:${readerBookId}`, 'reader'));
  assert.ok(hasEdge(`top:${eig.id}`, `note:${nbId}:${pageId}`, 'note-page'));
  assert.ok(hasEdge(`res:${project.id}`, `log:${plog.id}`, 'project-log'));
  assert.ok(hasEdge(`top:${eig.id}`, `item:${card.id}`, 'question'));
  assert.ok(hasEdge(`top:${eig.id}`, `top:${pid.id}`, 'wiki-link'));
  assert.ok(hasEdge(`top:${pid.id}`, `top:${eig.id}`, 'wiki-link'));
  assert.ok(hasEdge(`reader:${readerBookId}`, `top:${pid.id}`, 'wiki-link'));
  assert.ok(hasEdge(`note:${nbId}:${pageId}`, `sub:${robotics.id}`, 'wiki-link'));
  assert.ok(hasEdge(`top:${eig.id}`, 'tag:control', 'tag'));

  const eigBacklinks = full.bundle.backlinks[`top:${eig.id}`] ?? [];
  assert.ok(eigBacklinks.some((b) => b.sourceId === `top:${pid.id}` && b.edgeKind === 'wiki-link'));
  assert.ok(eigBacklinks.some((b) => b.sourceId === `res:${paper.id}` && b.edgeKind === 'wiki-link'));

  const pidBacklinks = full.bundle.backlinks[`top:${pid.id}`] ?? [];
  assert.ok(pidBacklinks.some((b) => b.sourceId === `top:${eig.id}` && b.edgeKind === 'wiki-link'));
  assert.ok(pidBacklinks.some((b) => b.sourceId === `reader:${readerBookId}` && b.edgeKind === 'wiki-link'));

  assert.ok(full.bundle.ownKnowledge.some((m) => m.sourceKind === 'notes-page' && m.text?.includes('Typed note linking') && m.text?.includes('Handwritten')));
  assert.ok(full.bundle.ownKnowledge.some((m) => m.sourceKind === 'reader-notes' && m.text?.includes('Relates directly to [[PID Control]]')));
  assert.ok(full.bundle.ownKnowledge.some((m) => m.sourceKind === 'project-log' && m.attachments?.length === 1));
  assert.ok(full.bundle.sourceMaterials.some((m) => m.sourceKind === 'book' && m.freePdfUrl?.endsWith('LADR4e.pdf')));
  assert.ok(full.bundle.sourceMaterials.some((m) => m.sourceKind === 'paper' && m.youtubeAudioUrl?.includes('youtube.com')));
  assert.ok(full.bundle.qaAndActivities.some((m) => m.sourceKind === 'card'));
  assert.ok(full.bundle.qaAndActivities.some((m) => m.sourceKind === 'step' && m.title.includes('stability margins')));
  assert.ok(full.bundle.qaAndActivities.some((m) => m.sourceKind === 'project' && m.title === 'Mini Rover Build'));

  // Focused subjectId graph keeps cross-subject links while scoping bundle items
  const scoped = await buildKnowledgeGraph(kbUser, data, math.id);
  assert.equal(scoped.bundle.scopeSubjectId, math.id);
  assert.ok(scoped.nodes.some((n) => n.id === `top:${pid.id}`), 'cross-subject wiki-link neighbor kept in local graph');
  assert.ok(scoped.nodes.some((n) => n.id === `sub:${robotics.id}`), 'subskill child kept in local graph');
  assert.ok(!scoped.bundle.ownKnowledge.some((m) => m.sourceKind === 'project-log'), 'bundle excludes unrelated subject logs');
});

test('inquiryConceptAlias strips leading question phrases and trailing question marks', () => {
  assert.equal(inquiryConceptAlias('What is MCP?'), 'MCP');
  assert.equal(inquiryConceptAlias('What is R1 Redundancy?'), 'R1 Redundancy');
  assert.equal(inquiryConceptAlias('  What are eigenvalues?? '), 'eigenvalues');
  assert.equal(inquiryConceptAlias('Who is Claude Shannon?'), 'Claude Shannon');
  assert.equal(inquiryConceptAlias('How does a PID controller work?'), 'PID controller work');
  assert.equal(inquiryConceptAlias('How do transformers work?'), 'transformers work');
  assert.equal(inquiryConceptAlias('Why is an API idempotent?'), 'API idempotent');
  assert.equal(inquiryConceptAlias('Explain the Kalman filter?'), 'Kalman filter');
  assert.equal(inquiryConceptAlias('Define A* search'), 'A* search');
  assert.equal(inquiryConceptAlias("What's MCP?"), 'MCP');
  assert.equal(inquiryConceptAlias(''), '');
});

test('buildKnowledgeGraph integrates KnowledgeInquiry nodes, [[concept]] wiki-links, #tags, edges, and subject scoping', async () => {
  const user = 'kb-inquiry-user';
  const data = emptySkills();

  const robotics = addSubject(data, { name: 'Robotics', area: 'Engineering' }, makeId, NOW);
  const ai = addSubject(data, { name: 'AI Systems', area: 'Software' }, makeId, NOW);

  const pid = addTopic(robotics, {
    name: 'Controls',
    notes: 'Compare [[MCP]] and [[R1 Redundancy]] for telemetry reliability #architecture',
  }, makeId, NOW);
  const agents = addTopic(ai, {
    name: 'Tool Use',
    description: 'Agent tool calling protocols',
  }, makeId, NOW);

  const inqMcp: KnowledgeInquiry = {
    id: 'inq-mcp',
    question: 'What is MCP?',
    context: 'Heard during an AI engineering podcast',
    answer: 'Model Context Protocol standardizes connections between models and [[Tool Use]]. #protocol',
    takeaways: 'JSON-RPC interface for tools and resources',
    sources: ['https://modelcontextprotocol.io'],
    tags: ['ai-infra', '#MCP'],
    status: 'solved',
    subjectId: ai.id,
    topicId: agents.id,
    cardItemId: 'card-mcp',
    createdAt: NOW,
    updatedAt: NOW,
    solvedAt: NOW,
  };
  const inqR1: KnowledgeInquiry = {
    id: 'inq-r1',
    question: 'What is R1 Redundancy?',
    context: 'Came up in reliability design review',
    tags: ['reliability'],
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const inqRoboticsLocal: KnowledgeInquiry = {
    id: 'inq-servo',
    question: 'What is Servo Backlash?',
    context: 'Gearbox sizing note',
    status: 'open',
    subjectId: robotics.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const inqUnrelated: KnowledgeInquiry = {
    id: 'inq-zero-trust',
    question: 'What is Zero Trust?',
    context: 'Security architecture reading',
    status: 'open',
    subjectId: ai.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data.inquiries = [inqMcp, inqR1, inqRoboticsLocal, inqUnrelated];

  const missingScoped = await buildKnowledgeGraph(user, data, 'does-not-exist');
  assert.deepEqual(missingScoped.bundle.inquiries, []);

  const full = await buildKnowledgeGraph(user, data);
  const nodeById = new Map(full.nodes.map((n) => [n.id, n]));
  const mcpNode = nodeById.get('inq:inq-mcp');
  const r1Node = nodeById.get('inq:inq-r1');
  assert.ok(mcpNode);
  assert.equal(mcpNode.kind, 'inquiry');
  assert.equal(mcpNode.label, 'What is MCP?');
  assert.equal(mcpNode.subtitle, 'Answered · AI Systems');
  assert.equal(mcpNode.href, `/skills/${ai.id}?tab=knowledge`);
  assert.equal(mcpNode.status, 'solved');
  assert.ok(mcpNode.content?.includes('Context: Heard during an AI engineering podcast'));
  assert.ok(mcpNode.content?.includes('Takeaways: JSON-RPC interface'));
  assert.equal(mcpNode.meta?.sources, 'https://modelcontextprotocol.io');
  assert.equal(mcpNode.meta?.cardItemId, 'card-mcp');

  assert.ok(r1Node);
  assert.equal(r1Node.subtitle, 'To look up');
  assert.equal(r1Node.href, '/skills?view=graph');
  assert.equal(r1Node.status, 'open');

  const hasEdge = (from: string, to: string, kind: string) =>
    full.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

  assert.ok(hasEdge(`top:${agents.id}`, 'inq:inq-mcp', 'inquiry'));
  assert.ok(hasEdge(`sub:${robotics.id}`, 'inq:inq-servo', 'inquiry'));
  assert.ok(hasEdge(`sub:${ai.id}`, 'inq:inq-zero-trust', 'inquiry'));
  assert.ok(hasEdge(`top:${pid.id}`, 'inq:inq-mcp', 'wiki-link'), '[[MCP]] resolves to What is MCP?');
  assert.ok(hasEdge(`top:${pid.id}`, 'inq:inq-r1', 'wiki-link'), '[[R1 Redundancy]] resolves to What is R1 Redundancy?');
  assert.ok(hasEdge('inq:inq-mcp', `top:${agents.id}`, 'wiki-link'));
  assert.ok(hasEdge('inq:inq-mcp', 'tag:protocol', 'tag'));
  assert.ok(hasEdge('inq:inq-mcp', 'tag:ai-infra', 'tag'));
  assert.ok(hasEdge('inq:inq-mcp', 'tag:mcp', 'tag'));
  assert.ok(hasEdge('inq:inq-r1', 'tag:reliability', 'tag'));

  assert.equal(full.bundle.inquiries.length, 4);
  assert.ok(full.bundle.ownKnowledge.some((m) => m.id === 'ok-inq:inq-mcp' && m.sourceKind === 'inquiry-solved' && m.text?.includes('Takeaways: JSON-RPC')));
  assert.ok(full.bundle.qaAndActivities.some((m) => m.id === 'qa-inq:inq-r1' && m.sourceKind === 'inquiry-open' && m.status === 'open'));
  assert.ok((full.bundle.backlinks['inq:inq-mcp'] ?? []).some((b) => b.sourceId === `top:${pid.id}` && b.edgeKind === 'wiki-link'));

  // Subject scoping keeps inquiries belonging to the subject OR linked into it via [[wiki-link]].
  const scoped = await buildKnowledgeGraph(user, data, robotics.id);
  const scopedInqIds = new Set(scoped.bundle.inquiries.map((q) => q.id));
  assert.ok(scopedInqIds.has('inq-servo'), 'includes inquiries belonging to the subject');
  assert.ok(scopedInqIds.has('inq-mcp'), 'includes cross-subject inquiries linked via [[MCP]]');
  assert.ok(scopedInqIds.has('inq-r1'), 'includes global inquiries linked via [[R1 Redundancy]]');
  assert.ok(!scopedInqIds.has('inq-zero-trust'), 'excludes unrelated inquiries from other subjects');
  assert.ok(scoped.bundle.ownKnowledge.some((m) => m.id === 'ok-inq:inq-mcp' && m.sourceKind === 'inquiry-solved'));
  assert.ok(!scoped.bundle.qaAndActivities.some((m) => m.id === 'qa-inq:inq-zero-trust'));
});

test('a [[link]] to something not written yet shows as its own node, and becomes a real link once it exists', async () => {
  const user = 'kb-missing-user';
  const data = emptySkills();
  const s = addSubject(data, { name: 'Controls', area: 'Engineering' }, makeId, NOW);
  addTopic(s, { name: 'Loop tuning', notes: 'Start from [[Ziegler–Nichols]], then [[Loop tuning]] by feel. Mentions Controls in passing.' }, makeId, NOW);
  const before = await buildKnowledgeGraph(user, data);
  const ghost = before.nodes.find((n) => n.kind === 'missing');
  assert.ok(ghost, 'the unwritten target is there');
  assert.equal(ghost!.label, 'Ziegler–Nichols');
  assert.ok(before.edges.some((e) => e.to === ghost!.id && e.kind === 'wiki-link'));
  assert.ok((before.bundle.backlinks[ghost!.id] ?? []).length === 1, 'and what links to it is a backlink');

  // Written as a lookup, the same link points at it and the placeholder goes.
  data.inquiries = [{ id: 'inq-zn', question: 'What is Ziegler–Nichols?', status: 'open', createdAt: NOW, updatedAt: NOW }];
  const after = await buildKnowledgeGraph(user, data);
  assert.ok(!after.nodes.some((n) => n.kind === 'missing'));
  assert.ok(after.edges.some((e) => e.to === 'inq:inq-zn' && e.kind === 'wiki-link'));

  const names = linkableNames(data);
  assert.ok(names.some((n) => n.kind === 'subject' && n.name === 'Controls'));
  assert.ok(names.some((n) => n.kind === 'topic' && n.name === 'Loop tuning' && n.detail === 'Controls'));
  assert.ok(names.some((n) => n.kind === 'lookup' && n.name === 'Ziegler–Nichols'), 'a lookup is offered by the name it answers');
});
