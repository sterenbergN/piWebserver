# Study room — plan

A place on the site for a PA student in her classroom year who already uses Anki
and makes practice tests by giving her notes to an AI. The site doesn't try to
replace Anki or commercial question banks. It does what they don't: remembers
what happened on those AI tests, plans the work around real deadlines, and makes
studying a little more fun.

Status (2026-10-31): phases 1 to 4 built. Everything after them is planned, not started.

## Ground rules

- **No AI runs on the Pi and there's no API bill.** She copies a prompt into her
  own AI and pastes back the reply. New kinds of import use the same pattern.
- **Anki stays her flashcard scheduler.** We read from it and send misses to it.
- **Each account sees only its own data**, with no copy kept on the device.
- **No patient details are ever stored**, in anything added for later rotations.
- **There's a "done for today."** She studies all the time, so every daily view
  needs a point where the site says she can stop.

## Build order

| Phase | What | Status |
|---|---|---|
| 1 | Test vault, miss bank, export to Anki | Built |
| 2 | PA Today and a space of its own | Built |
| 3 | Catch-up: class checklist, Anki import, PANCE coverage map | Built |
| 4 | Study planner and pancakes | Built |
| 5 | Study games: Trivia Death with her questions, The Night Shift | Planned |
| 6 | Quiz me, mock patient, comparison grids, Differential | Planned |

PA Today comes first because it's small and everything after it lands there. The
planner comes before games because it's what she'd open every day. The planner
replaces the "exam planner" from the earlier list and keeps its household link.

## Phase 1: test vault and miss bank (built)

`app/study`, `lib/study`, data in `.data/study/<userId>/`. Tests from a pasted AI
reply, exam and tutor modes, results by topic, fixing wrong answer keys with
regrading, misses returning after 1, 3, 7, 14 and 30 days, an Anki import file, a
card on Today, a linked habit, backups and data downloads.

Still to check with real use: a reply from her own AI, an import into real Anki,
and copying the prompt on her phone.

## Phase 2: PA Today and a space of its own (built)

The goal is that she can open the site and only see what's for her, without the
workout, kart and PLC parts weighing it down. Nothing is deleted or locked: the
rest of the site stays one tap away in Explore.

- **PA Today** is the front page of Study at `/study`: reviews due and tests left
  part way, a clear "you can stop here" when neither is waiting, a test she hasn't
  taken as a suggestion only, and links to everything else. Later phases add the next
  exams with days left, today's pancakes, and the map and games. Tests moved to
  `/study/tests`.
- **Its own navigation.** Inside Study the header's logo becomes "PA Study", her pins
  leave the header, and the section bar (wide screens) and phone dock show Study's
  pages. New pages get added to the Study group in `components/nav-links.ts`. The
  "new place found" toast stays quiet here.
- **A home for her account.** "Start on PA Today" is kept on her account
  (`studyHome`). It makes the logo go to PA Today everywhere, puts the Study room
  first in Explore, adds PA Today to the account menu, and sets default pins to
  Study's pages. Signing in from the home page lands on PA Today, but signing in from
  any other page stays there, since that's where she was going. Pins are saved per
  device, so any she's already chosen on a device stay as they are.
- **Its own home-screen icon.** `/study/manifest.webmanifest` makes it an app called
  "PA Study" that starts at `/study`, with its own icon. Its scope is `/study`, so on
  Android leaving for the rest of the site may show a browser bar. Not yet tried on a
  real phone, and iOS and Android treat this differently. On iPhone, the home-screen
  app keeps its own sign-in.
- **Anki page.** `/study/anki` replaced the collapsed section at the bottom of Review,
  which stayed hidden until something had been missed. Reading decks in comes in phase 3.

## Phase 3: catch-up (built)

She's 5 months in, so the map starts from what she's already done. `/study/map` shows
three separate levels, so nothing claims she knows a topic just because it was taught:

- **Covered:** at `/study/classes` she lists classes, ticks off the finished ones, and
  picks what each covers, with an exam average if she wants.
- **Studied:** on `/study/anki` she imports an export. Only counts per deck and tag and
  the most-forgotten cards are kept (`lib/study/anki-import.ts`), so her cards stay in
  Anki. Decks with an obvious name are matched for her and she fixes the rest. A new
  import replaces the last, and matches are kept by name.
- **Proven:** her latest answer to each question here. It takes 10 answers to judge a
  system, and 75% right counts as strong. Games count once phase 5 feeds them in.

The map also suggests where to look next, by weight on the exam and how little
evidence is behind it, and links to a test prompt focused on that system. It's a nudge
and says so, not a score prediction.

**Weights** are from NCCPA's "PANCE at a Glance" slides, "% distribution of content by
organ system", 2025. They add up to 94; the slides don't say where the rest goes. The
slides also give task areas (diagnosis 18%, history and physical 16%, and so on), which
aren't used yet.

**Second level:** the plan was organ system, then disorder. NCCPA's disorder list wasn't
in those slides and its blueprint page blocks automated reading, so for now the second
level is her own topics from her tests. Adding the official list means getting it from
NCCPA's site by hand and deciding whether it belongs in this public repo.

Still to check:

- **A real export.** The reader is tested against databases built to match Anki's two
  layouts, not a file Anki wrote. She should export with "Include Scheduling
  Information" and "Support older Anki versions" on and media off.
- **Node on the Pi.** Reading exports needs Node 22.13 or newer, and 22.15 for a modern
  export without the older-versions option. It says so plainly if the Pi's is too old.
- **Heavy imports.** Reading runs on the server's main thread, so a very large collection
  could briefly slow the site on a Pi.

## Phase 4: study planner and pancakes (built)

Pure logic is in `lib/study/plan.ts`, and the data in `plan.json`. The idea that does
most of the work: every uneaten pancake sits on the day it's planned for, so anything
dated before today is the pile. Eating takes the oldest first, and nothing has to run
overnight.

### The planner

- **Dates:** exams, quizzes, practicals and due dates at `/study/plan`, each with a
  countdown. Work toward them is sized in pancakes, or stands alone with no date.
- **From Google Calendar or a syllabus**, set up at `/study/plan/setup`, or by hand.
- **Her week:** which days she studies and roughly how many pancakes a day she can
  manage. The site offers her real pace once there's enough history.
- **Calendar:** week and month views of due dates and each day's pancakes.

### Pancakes

- **Size:** a rough size she picks for each task, not a fixed amount of time.
- **The plate:** pancakes are spaced across her study days before the date, leveling
  against what's already planned. Exams and practicals keep 2 clear days, quizzes and
  due dates 1. If time has run out, the clear days give way so nothing is lost.
- **Eating:** a tap. Handing in a test tied to a task eats that task. Due reviews add a
  pancake per 20 and aren't stored, since the miss bank already keeps them; clearing them
  eats those. Anki stays a tap, since there's no live link.
- **Piling up:** leftovers stay on the plate and never spread by themselves. The stack
  leans further and goes colder at 3 and 5 days old.
- **Where it shows:** on both PA Today and the main Today page.
- **A clean plate** says she can stop, with melting butter, syrup and confetti, and adds
  to a streak. Study XP is still in phase 6.

### Keeping the pile from becoming a punishment

- **Spread the pile:** one tap re-plans leftovers over the coming days.
- **Days off and sick days** move that day's pancakes along, including a day already past.
- **Passed deadlines clear:** once a date is past, its leftovers leave the stack.
- **Early warning:** says when a date needs more per day than she planned, counting
  everything due before it.
- **Pace check:** "At your recent pace you'd finish 2 days late", once there are 3 days
  of history in the last fortnight.
- **The streak** only breaks on a day still holding pancakes. Days off and empty days
  don't, and spreading a pile forgives it, so catching up is always worth doing.

### Google Calendar

One way only: the site reads her calendar and never changes it (`lib/study/ical.ts`,
`lib/study/calendar.ts`).

- **How it connects:** she pastes her calendar's secret iCal address once. The page asks
  for a fresh copy when it's over 6 hours old, so it stays current whenever she visits.
  If her account doesn't offer the address, she can upload an `.ics` file, which doesn't
  update by itself.
- **What comes in:** words in event titles suggest exams, quizzes and due dates, and she
  confirms each. The rest stay behind a link, and recurring events stay out altogether.
- **When things change:** a moved exam moves its countdown and re-spreads its upcoming
  pancakes, and says so. One that's gone from the calendar only asks; it's never deleted.
- **The address works like a password.** It's in its own file (`calendar-secret.json`),
  never sent back to the browser, left out of "Download my data", and deleted on
  disconnect. It is in the Pi's backups, like everything in `.data`. Only Google's
  calendar host is ever fetched, with redirects refused.

### Household link

For an exam or practical within two weeks, she can ask the household for help
(`lib/chores/exam-help.ts`). Her chores due by then move to the other member, or to
"anyone" if there are several, and a banner on Today, Chores and the meal plan says so,
with the quickest recipes on the meal plan. Anyone can end it, it ends itself after the
exam, and chores go back unless someone has reassigned them. It suggests meals rather
than changing the meal plan.

### Settled with her (2026-10-31)

1. A pancake is a rough size picked per task, not a fixed amount of time.
2. The rules above stand: leftovers pile up, she spreads them with a button, and the
   limits on the pile all stay.
3. Dates come from both Google Calendar and syllabus documents.
4. The pile shows on both PA Today and the main Today page.

Still to check with real use: her own calendar (only a public Google calendar has been
read so far), a syllabus through her own AI, and whether the suggested event words fit
how her program names things.

## Phase 5: study games

Both use her vault and miss bank, and a wrong answer always shows the explanation
and adds the question to the miss bank. Anki cards have no wrong choices, so those
get borrowed from similar cards in the deck, or improved through her AI.

- **Trivia Death, her edition.** Needs a longer timer option for patient scenarios,
  an explanation on the answer reveal, and picking her questions when hosting, since
  packs are currently site-wide and edited by the admin.
- **The Night Shift (solo).** The solo Trivia Death: a run of question rooms where
  wrong answers cost a life or send her to a mini-game, with items like 50/50 and a
  boss built from her weakest organ system. Lives in Study, not the public arcade.
- A finished run or game can eat pancakes planned for it.

## Phase 6: extras

- **Quiz me:** the other person's phone shows the question and answer. She answers
  out loud and they mark it.
- **Mock patient:** the other person gets a patient script that only reveals details
  if asked, plus a checklist to score her history-taking. For OSCE practice.
- **Comparison grids:** rows of conditions or drugs, columns of presentation, test
  and first-line treatment. She fills in hidden cells from memory.
- **Differential:** a daily clue-reveal puzzle, where fewer clues means more points.
- **Pharm Snake:** the existing Snake, eating the drug that matches. Optional.
- **Study XP:** Study counting toward site levels. Touches about six pages.

## Dropped

- Our own flashcard scheduler, since she uses Anki.
- Hands-free read-aloud review.
- A medical "case of the day" through the weekly generator, since its checks work by
  running the math, which doesn't apply to medical content.
