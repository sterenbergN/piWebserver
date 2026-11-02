# Study room — plan

A place on the site for a PA student in her classroom year who already uses Anki
and makes practice tests by giving her notes to an AI. The site doesn't try to
replace Anki or commercial question banks. It does what they don't: remembers
what happened on those AI tests, plans the work around real deadlines, and makes
studying a little more fun.

Status (2026-10-31): phases 1 to 6 built. Nothing has been used for real yet.

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
| 5 | Study games: Trivia Death with her questions, The Night Shift | Built |
| 6 | Quiz me, mock patient, comparison grids, Differential, Study Snake, Study XP | Built |

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

### Test sets (added after phase 5)

A set (`lib/study/sets.ts`) keeps several tests on one subject together at
`/study/tests/sets/<id>`, and remembers how its prompt was made. Each new test's prompt
lists what the set has already asked, with instructions not to repeat or reword it. Once
tests have been taken, it adds scores, weakest and strongest topics, what she got wrong
and what she picked, and what she marked "Not sure". She can untick her misses, trouble
areas, "Not sure" retests or going easy on strong topics for any test; only the rule
against repeats is fixed. The list of past questions is capped
at the newest 120, each cut to a line, to keep the prompt a sensible length. A reply is
also checked when it's pasted: exact and near-identical repeats within the set are
dropped and listed, ignoring numbers, so a new age doesn't make a question new. Sets can't
catch the same fact asked in very different words.

A 5-level difficulty slider feeds the prompt and is kept with each test and set. After a
score of 85% or more, or under 50%, the page suggests moving a level, and she decides.

Math in choices is typeset now (`lib/study/math.ts`). The reply reader also repairs LaTeX
with single backslashes, which JSON would otherwise turn into a form feed or tab, and
already-saved tests are mended when read. Party screens can't typeset, so math there is
flattened to text like PO₂.

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
- **Proven:** her latest answer to each question here, on a test or in a game. It takes
  10 answers to judge a system, and 75% right counts as strong.

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
- **Where it shows:** on both PA Today and the main Today page, unless an account has
  taken it off Today ("Choose what's on this page", which also covers the engineering
  question).
- **A clean plate** says she can stop, with melting butter, syrup and confetti, and adds
  to a streak. Study also counts toward site levels (phase 6).

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

## Phase 5: study games (built)

Both draw from her tests through `lib/study/games.ts`, at `/study/games`, and lean on
what she's been missing. An answer counts like a review: a wrong one goes in the miss
bank, a right one moves a due miss along, and the latest answer counts toward Proven
on the map.

- **The Night Shift (solo).** `lib/study/night-shift.ts`, a seeded set of rules with no
  page in it. Twelve hours, 7 pm to 7 am, picking a door each hour: Clinic, the ER (long
  cases, double points), Chart review (a past miss), or a rest room for coffee or an item.
  A wrong answer always stops for the explanation, then calls a code to fight for her
  coffee: 2 of 3 quick questions, or a defibrillator timing game. Out of coffee ends the
  shift. Items are Consult (removes wrong choices) and Second Opinion (one retry, with
  the first answer still the one saved). At 6 am the Attending quizzes her on her weakest
  system. There's a speed bonus but never a time limit, so she can still read a long
  case. Each answer is saved as she goes. The run itself isn't saved, so leaving ends it.
- **Trivia Death, study edition.** Opened from Games, she picks a class or system, 30 to
  90 seconds a question, and TV or phones. The explanation shows on the TV and phones
  after each round, which stays up for 15 seconds unless the host pauses to talk it
  through (`lib/party/pause.ts`). A pause freezes the clock and locks answers. It needs 11 questions with one right
  answer; select-all questions are left out, and five-choice ones drop to four. Only
  regular rounds are saved, not the final escape or Killing Floor mini-games.
- **Whose answers count.** Each phone sends its answer to its own account, and the server
  only saves it if that account owns the question. So she has to be signed in on the phone
  she plays on. Classmates' answers are never saved anywhere.
- **Keeping answers private in a room.** The deck is in a server-only field (`studyDeck`),
  never sent to the TV or phones; each round's question reaches them only as it's asked.
  It does sit in the room's file in `.data/party` until the room is cleaned up.
- **Anki cards.** The import only keeps the cards she keeps forgetting, so those are what
  the Night Shift can add, as a checkbox. Their wrong answers are borrowed from her other
  cards, the same deck first, and can be weak. They aren't test questions, so answers on
  them aren't saved. Using whole decks would mean keeping far more of her Anki data.
- **Pancakes.** A task can be tied to The Night Shift, and each shift she finishes eats
  one. A shift also counts as a study day for a linked habit.

## Phase 6: extras (built)

Grids, Quiz me and the mock patient are on a Practice page at `/study/practice`.
Differential and Study Snake joined the Games page. Grids, patient cases and
Differential cases are written by her AI from a copied prompt, like tests, and live
in `practice.json`, which "Download my data" includes.

- **Comparison grids:** rows of things she mixes up against columns of what tells
  them apart. Some, most or all cells are hidden. She says each to herself, taps to
  check, and says whether she knew it. What she misses is hidden first next time.
- **Quiz me:** the other person's phone shows one question at a time with its answer.
  She answers out loud and they mark it. Results count like a review, through the
  same path as the games, and her screen shows only the score as it happens.
- **Mock patient:** the other person gets the opening line, what to say only if
  asked, exam findings, and a checklist to tick. Finishing scores it and shows both
  people the diagnosis, what was missed, and the teaching points. Until she's played
  a case, the server sends her only what's on the door. Patients are made up, and
  the prompt says so.
- **Differential:** one case a day, one clue at a time. A wrong guess or asking for a
  clue reveals the next one, and fewer clues score more. There's a streak, a result to
  copy that doesn't spoil the case, and "done for today" with another if she wants it.
- **Study Snake:** took the place of Pharm Snake. Drug names don't fit on a grid
  cell, so food is lettered and the question and its answers sit above the board.
  This way it works with any of her questions, not just drugs. The snake waits while
  she reads, and walls cost a heart but don't count as a wrong answer.
- **Study XP:** Study is a fourth source for the site level, shown only to accounts
  that have some. Each question counts once, so retaking a test can't farm it. Rates
  are in `lib/study/xp.ts`.

### Private links

Quiz me and the mock patient use a link with a long random token, so the other
person needs no account. Sessions live in `.data/study-sessions`, outside backups,
and hold question ids rather than questions. A link shows only that one sitting and
never whose it is. It stops showing content when the sitting finishes, and stops
working when she ends it, opens another, or after 24 hours. One account has one open
link at a time. Her screen warns that anyone with the link can see that sitting.

## Flashcards for Anki (added after phase 6)

`/study/anki/cards` is a prompt maker for flashcards, the same copy-and-paste pattern
as tests. She picks what to cover, how many, question and answer or fill in the blank,
and how much depth. The prompt carries the rules for cards that are easy to remember:
one idea each, no lists, one right answer. She can also have her AI rewrite the cards
Anki says she keeps forgetting, once she's imported a deck.

She reads the reply, takes out what she doesn't want, and saves it as a deck. A deck
lives in `practice.json`, can make more without repeating itself, and downloads as a
file for File → Import that can mix Basic and Cloze. Each card has a fixed ID, so
importing again can't add a second copy. Downloading only what's new is the default,
so edits she's made in Anki aren't at risk. Anki still does all the
scheduling: these cards aren't reviewed here and don't count toward the PANCE map until
they come back in through an Anki import.

## Editing

Everything her AI writes can be changed, since it gets things wrong. A test has its
own edit page, and the same question editor opens from results and from review, once
she's seen the answer. It covers the question, choices, the right answer, why each
choice is wrong, the explanation, topic, organ system and source line, and she can
write questions of her own. Grids, mock patients, Differential cases and flashcard
decks each have an editor too.

The rules that keep her history honest:

- Past answers are stored by a choice's position, so every answer moves with its
  choice. One whose choice is deleted counts as blank, never as another choice.
- Fixing wording leaves the review schedule alone. Only changing what's right
  regrades her last answer and updates the miss bank.
- What she's missed on a grid stays with the right cell when rows and columns move.
- Editing a mock patient or Differential case shows its answers, so a page warns her
  first if she hasn't played it, and nothing is fetched until she agrees. A patient
  case can't be edited while someone's using it through a private link.

## How it looks

Study has its own look, set while a Study page is showing (`app/study/theme.css`), so
the rest of the site keeps its palette. Ink surfaces in dark mode and warm paper in
light, one honey accent taken from the pancakes, a serif (Newsreader, served from the
site itself) for headings and for reading questions, and line icons in place of emoji
(`components/study/Icon.tsx`). The Night Shift keeps its emoji, since that's a game
with its own character. Taking a test hides the nav, and a helper on a private link
sees only the page, with no sign of the site around it.

## Dropped

- Our own flashcard scheduler, since she uses Anki.
- Hands-free read-aloud review.
- A medical "case of the day" through the weekly generator, since its checks work by
  running the math, which doesn't apply to medical content.
