# Study room — plan

A place on the site for a PA student in her classroom year who already uses Anki
and makes practice tests by giving her notes to an AI. The site doesn't try to
replace Anki or commercial question banks. It does what they don't: remembers
what happened on those AI tests, plans the work around real deadlines, and makes
studying a little more fun.

Status (2026-10-31): phase 1 built. Everything after it is planned, not started.

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
| 2 | PA Today and a space of its own | Planned |
| 3 | Catch-up: class checklist, Anki import, PANCE coverage map | Planned |
| 4 | Study planner and pancakes | Planned |
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

## Phase 2: PA Today and a space of its own

The goal is that she can open the site and only see what's for her, without the
workout, kart and PLC parts weighing it down. Nothing is deleted or locked: the
rest of the site stays one tap away in Explore.

- **PA Today** becomes the front page of Study at `/study`. It shows, in order: the
  next exams with days left, today's plate of pancakes (phase 4), reviews due, and
  a way into tests, the map and games. Until phase 4 it shows what already exists.
  The current test list moves to `/study/tests`.
- **Its own navigation.** While in Study, the section bar and phone dock show only
  Study's pages (PA Today, Plan, Tests, Review, Map, Games). The dock is currently
  drawn from the account's pins everywhere, so this is a new rule for this section.
- **A home for her account.** A per-account setting, "Start on PA Today", sends
  her there after sign-in and from the logo, and puts the Study room first in
  Explore. Pins are already per account, so hers can be set to Study's pages.
- **Its own home-screen icon.** The site's app manifest starts at `/workout`. Study
  gets its own manifest named "PA Study" that starts at `/study`, so she can install
  it as its own app. Needs testing on her actual phone, since iOS and Android treat
  this differently.

## Phase 3: catch-up

She's 5 months in, so the map has to start from what she's already done. It shows
three separate levels, so nothing claims she knows a topic just because it was taught:

- **Covered:** she ticks off finished classes, with exam scores if she wants.
- **Studied:** from an Anki export with scheduling included, with each deck matched
  to a PANCE area once. Includes the cards she keeps forgetting.
- **Proven:** her results on tests and games here.

The map is by organ system first, then disorder, using NCCPA's 2025 blueprint.
Percentages must come from NCCPA's PDF; so far only third-party figures have been seen.

Needs a real export from her, with "Include Scheduling Information" and "Support
older Anki versions" on and media off.

## Phase 4: study planner and pancakes

### The planner

- **Things with dates:** exams, quizzes, assignments and practicals, each with a
  class, due date and days-left countdown.
- **Work toward them:** lectures to review, readings, tests to take and so on, each
  sized in pancakes and usually tied to something with a date.
- **Getting it in quickly:** she pastes a syllabus into her AI using a copied prompt
  and pastes the reply back, the same pattern as tests. Entering things by hand also
  works. A calendar file import can come later if her program offers one.
- **Her week:** which days she studies and how many pancakes a day is realistic.
- **Calendar view:** month and week, showing due dates and each day's pancakes.

### Pancakes

Every piece of work costs pancakes, and each day she has a plate to eat.

- **Size:** one pancake is about 30 minutes of work by default, and she can change
  that. New work gets a suggested size that she can adjust.
- **The plate:** pancakes are spread across her study days before the due date,
  ending a day or two early so the last days before an exam stay clear.
- **Eating:** she taps to eat one. Work done on the site counts by itself: handing
  in a test or clearing reviews eats the pancakes planned for it. Anki stays a tap,
  since there's no live link to it.
- **Piling up:** what she doesn't eat stays and joins tomorrow's plate. The stack
  visibly grows, gets wobbly and goes cold the longer it sits.
- **A clean plate** is the "done for today" moment: butter melts, syrup pours, and
  there's a garden-style streak and XP.

### Keeping the pile from becoming a punishment

The pile should push, not make her dread opening the page. For someone already
studying constantly, this matters as much as the mechanic.

- **Spread the pile:** one tap re-plans leftovers over the coming days.
- **Days off and sick days** are planned, and don't pile anything up.
- **Passed deadlines clear:** once an exam is over, its leftovers leave the stack,
  so there's no debt that outlives the thing it was for.
- **Early warning:** if the plan can't fit, it says so ("Cardio needs 4 a day and you
  planned 3") while there's still time to change it.
- **Pace check:** "At this pace you'll finish Cardio 2 days late" is the planner's
  most useful number, and shows next to the countdown.

### Household link

Near exams, chores can shift to the other person in the household and the meal plan
can lean on easy or prepped meals. Only with her say-so, and visible to both of them.

### Questions to settle with her first

1. Is a pancake a fixed amount of time, or just a rough size she picks per task?
2. Should leftovers pile onto tomorrow as described, or spread out automatically?
3. How fast can she realistically get dates in from her syllabus? Does her program
   have a calendar feed?
4. Should the pile show on the main Today page too, or stay inside Study?

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
