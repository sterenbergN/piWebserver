# Skills: a map of what I know

A place to track every subject I know, am learning or want to learn: plan how to
master it, keep the books, courses and projects for it, test myself on it again
and again, and see on one board where I'm an expert and where I'm not. Built for
work first ("where am I the SME, and how do I get better?"), but any subject fits.

Lives at `/skills`. Signed in only (same accounts as the rest of the site); data
in `.data/skills/<userId>/` so backups keep it.

## The pieces

- **Subject**: "Rocket propulsion", "PID tuning", "TIA Portal", "Thermodynamics".
  It has an **area** (groups on the board: Controls, Mechanical, Software, …),
  a **status** (want to learn → learning → maintaining, or paused), a **goal**
  (why), a **target level** and an optional **roadmap** (how to get there).
- **Topic**: the parts of a subject, in four **stages**: Foundations, Core,
  Applied, Mastery. Core topics count fully toward the subject's level, optional
  ones half. Each can carry my own **self-rating** (0–5).
- **Resource**: books, courses, videos, articles, papers, **projects** and
  activities, each tied to the topics it teaches, with planned / doing / done /
  dropped, progress (pages, chapters, hours), and takeaways when done.
- **Question**: two kinds, both tied to a topic.
  - *Graded* questions use exactly the daily engineering question format
    (numeric with units and tolerance, choice, multi, order, range, transfer
    function coefficients), with hints, a worked solution and sources. Same card,
    same grading, up to three checks.
  - *Recall cards*: a front and a back, rated Again / Hard / Good / Easy. For the
    "explain how a turbopump works" kind of knowledge that has no number.

## The scale

Levels follow the Dreyfus model, so they mean something at work:

| Level | Name              | Meaning |
|------:|-------------------|---------|
| 0     | Not started       | Haven't looked at it |
| 1     | Novice            | Know the words, follow rules with help |
| 2     | Advanced beginner | Can do routine problems with a reference |
| 3     | Competent         | Work independently on normal problems |
| 4     | Proficient        | Handle the unusual cases, see the big picture |
| 5     | Expert            | The go-to person; teach it, judge others' work |

**Topic level** is a rating fitted to my answers, like a chess rating: every
question has a difficulty 1–5, and the rating moves up when I get one right that
was expected to be hard for me, and down when I miss one I "should" have got.
The chance of getting a difficulty-*d* question right at level θ is
`1 / (1 + e^(-1.7·(θ − d + 0.5)))` (70 % at θ = d). The rating starts at my
self-rating (or 0) and steps get smaller as evidence builds up. It's worked out
again from the history every time, so deleting a bad question fixes the past.

**Fading.** Knowledge that isn't used fades. Each topic has a stability (21 days,
×1.5 for every separate day I got it right, up to 8 such days); retention is
`e^(−days since last practice / stability)`. The level shown on the board is the
fitted level × (0.5 + 0.5 × retention), so an untouched skill slowly drops to
half and says so ("fading"). A finished resource on the topic counts as practice;
a self-rating counts as two good days, so claims fade too until they're tested.

**Subject level** is the weighted average of its topics' current levels (core 1,
optional ½), untested topics at 0, so it reflects breadth as well as depth.

**Confidence**: *self-rated* (no answers yet), *some evidence* (under 6 answers in
the topic) or *verified*.

**SME** is a badge, not a level: subject level ≥ 4, at least 75 % of core topics
at ≥ 3.5, at least 10 answers in the subject, and tested in the last 90 days.
Lose freshness and the badge goes until I test again: that's the point.

**Strong / weak / gaps / fading** per subject:
- strong: level within ½ of target (and ≥ 3), with evidence;
- weak: tested but more than 1½ below target, or under 50 % right in the last 10;
- gap: no evidence at all;
- fading: was ≥ 2 but retention under 50 %.

## Testing, continually

Every question has its own spaced-repetition schedule (SM-2 style: intervals grow
when I get it right, reset to tomorrow when I don't). **Review** builds a session:

1. due questions, most overdue and weakest topic first, mixed across subjects;
2. then questions from fading topics (oldest first), so old skills get tested
   even when nothing is formally due;
3. then a few new questions (5 a day by default).

It can be narrowed to one subject, one topic, or "weak spots only".

## Planning and writing questions (AI, copy the prompt / paste the reply)

Same pattern as Recipes and PA Study: no API key, any AI app.

- **Plan this subject**: name, goal, my background, target level, hours a week and
  what I like learning from → topics by stage, books / courses / projects /
  activities tied to topics, and a roadmap. I tick what to keep. Running it again
  later includes where I stand, so it adds the next steps instead of repeating.
- **Write questions**: pick topics (defaults: weak, fading and untested ones),
  count, style (worked calculations like the daily questions, concept checks,
  recall cards, mixed, or a *placement test* spanning difficulties 1–5 to find my
  level fast), and difficulty (default: one above my level per topic). The prompt
  lists questions I already have so it doesn't repeat them. Every graded question
  goes through the daily validator (answer keys, math renders, sources).
- Questions I report as wrong are **retired**: no longer asked, and no longer
  counted toward my level.

## Next steps ("how do I improve")

Worked out from the numbers, never AI, on the board and each subject:
- reviews due → review now;
- weak topic → practise it, or the unfinished resource tied to it;
- topic with fewer than 3 live questions → write questions for it;
- fading topic → a quick refresh;
- finished a resource but never tested the topic → test yourself;
- topic with nothing tied to it → plan it (find material);
- subject with no topics → plan it with AI.

## Pages

- `/skills` — the board: expertise summary (SME / proficient / competent /
  developing / not started), areas → subjects with a level bar against the
  target, badges, due and fading counts, next steps.
- `/skills/new` — add a subject (and optionally go straight to planning).
- `/skills/[id]` — a subject: overview (topic map by stage with levels,
  strong / weak / fading, level over time, next steps), topics (edit, self-rate),
  resources, questions.
- `/skills/[id]/plan` — plan with AI.
- `/skills/[id]/questions` — write questions with AI, or add a card by hand.
- `/skills/review` — the test session (`?subject=`, `?topic=`, `?mode=weak`).

## Around the site

- **XP**: Skills counts toward the site-wide level. 1 XP per finished question
  or card, 2 + its difficulty more when you get it (the same question twice in a
  day counts once), 5 for a day with 3+ answers, and 5–30 for finishing a
  resource (a project is worth most). Rules in `lib/skills/xp.ts`.
- **Today**: a Skills card with what's due, a "Reviewed" mark once you've answered
  3 (or cleared what was due), and the next step. It can be hidden like the others.
- **Habits**: a habit can tick itself "on days I answer 3 or more Skills questions".
- **Weekly questions**: switch it on per subject (Questions tab). The weekly
  Claude Code run that writes the daily questions then tops up topics with
  fewer than 3 fresh (never answered) questions, weakest and most faded first,
  up to 12 a subject a week, from the same prompt the site gives you. It goes
  through `npm run daily -- skills | skills-check | skills-upload` and
  `/api/skills/weekly`, with the daily upload token, which can only read and
  add to subjects that have it switched on. Steps in
  `scripts/daily-generator/INSTRUCTIONS.md` (6c).

## Reader and Notes

- **Reader books**: a resource can be linked to a book in the Reader (Resources
  tab: link one, or add a book from the shelf). Whenever Skills loads, the
  resource takes its progress from your reading: opening the book makes it in
  progress, finishing it makes it done, and the pages so far are its progress.
  It never goes backwards, and dropped resources are left alone.
- **Topic pages**: a topic can have Notes pages (Topics tab): a new one is made
  in a "Skills" notebook with the topic at the top and a link back, or tie a
  page you already have. Thrown-away pages drop off by themselves.
- **Work it out in Notes**: graded Skills questions have the same button as the
  daily questions. The page goes in the Skills notebook, and its link opens
  that one question again (`/skills/review?item=…`).
- **Use my notes**: the question writer can put your notes into the prompt:
  typed and handwritten notes in linked Reader books, and the typed text,
  read handwriting and recording transcripts on a topic's Notes pages (each
  ticked in or out, up to about 40,000 characters in all). Code in
  `lib/skills/links.ts`.

## Phases

1. Built 2026-11-12: everything above the line "Around the site".
2. Built 2026-11-12: XP, the Today card, the habit link and weekly questions.
3. Built 2026-11-12: the Reader and Notes ties.
4. Still open: a printable "skills summary" for work reviews; audiobooks (text to
   speech for Reader books, and maybe YouTube audio) were discussed, not built.
