# Weekly daily-question generator

These are the instructions for the scheduled Claude Code run that keeps the
site's daily engineering questions topped up. Each run reads how people did
and what they said, fixes reported problems, writes and **verifies** new days,
uploads them to the Pi and records what it learned. Nothing goes through git:
packs live in `daily-packs/` (git-ignored) on this PC and on the Pi.

Work from the repository root. Settings (site address and upload token) are in
`daily-packs/.env`; see the top of `scripts/daily-pack.ts`.

## 1. Look at where things stand

```bash
npm run daily -- status
```

`readyAhead` is how many days from today are ready without a gap, and
`firstGap` is the first date with no questions. The target is **14 days ahead**
unless the generator notes say otherwise ("target buffer: N days").

If the status call fails (no token, site down), stop and report it. Don't guess.

## 2. Read the notes

```bash
npm run daily -- notes
```

The notes are guidance from the site owner (editable in Admin → Daily) plus
what earlier runs learned. Follow them; they override the defaults below.

## 3. Learn from feedback

```bash
npm run daily -- feedback --since <today minus 60 days>
```

For every question this lists: answered / solved / partial / wrong / studied
(solution opened without answering), hints used, 👍/👎, easy/right/hard votes
and problem reports.

1. **Reports first.** For each report (newest first), find the question's
   source in `daily-packs/src/` (search for its id) and check the claim
   properly: redo the calculation, re-read the cited source.
   - If the question is wrong (answer key, wording, units, figure, source),
     fix it in the source file, rebuild **just that date range** and upload it
     (step 7). Saved answers are regraded automatically; people see a
     "regraded" note.
   - If the report is mistaken, leave the question alone.
   - Either way, log it in the run log (step 8) with one line on why.
2. **Calibrate difficulty** per track and topic, from questions with at least
   2 answers or votes:
   - mostly "too hard", or a solve rate under 35 %, or many hints and
     "studied" → aim that topic one difficulty level lower next time, or
     add a gentler hint;
   - mostly "too easy", or a solve rate over 85 % with few hints → one
     level higher, or more steps;
   - many 👎 → look at what those questions share (wordy, ambiguous,
     tedious arithmetic) and avoid it.
   Write the calibration into the run log so the next run keeps it.
3. With no or little feedback, keep the default difficulty curve.
4. **Weak topics.** `npm run daily -- weak` sums up everyone's strengths and
   weaknesses per track/topic (ability on the 1–5 difficulty scale, share of
   parts right, how many people it is a weakness for). Use it for the practice
   questions in step 6b.

## 4. See what's been asked recently

```bash
npm run daily -- history 90
```

Use it to keep variety: don't repeat a **topic** in the same track within
21 days, or a near-identical setup ever. Rotate through `syllabus.md`,
favouring topics with higher weight and topics not seen for longest.

## 5. Plan the new days

Fill from `firstGap` until there are 14 days ready from today (or the
notes' target). Per day:

- **Core question** (answering it keeps the streak): tracks rotate
  mechanical → controls → automation, continuing from the last scheduled core.
- **Two bonus questions**: one from each of the other two tracks.
- **Fridays are boss days** (`boss: true`): the core is a multi-part problem
  (3–5 parts) at difficulty 4–5 that walks through a realistic task end to end.
- **Difficulty** (before calibration): Mon 2, Tue 2–3, Wed 3, Thu 3, Fri 4–5
  (boss), Sat and Sun 2–3. Bonus questions within one level of the core.
- **Answer types**: over a week, use at least one choice or multi-select,
  one ordering question, and at least one range or coefficients question in
  controls. Numeric is the default for calculations.
- **Formula of the day**: a different useful formula each day, not repeated
  within 60 days (check the existing sources in `daily-packs/src/`).

## 6. Write the questions

Create `daily-packs/src/<first date>.mjs` that exports an array of days, using
the builders in `scripts/daily-generator/helpers.mjs` (`num`, `choice`, `multi`,
`range`, `coeffs`, `order`, `SRC`, `fig`, `plot`, `step1`, `step2` for
diagrams, and `widget` for interactive simulators). The starter files `daily-packs/src/week1.mjs` and `week2.mjs` show
the format, `lib/daily/types.ts` is the exact shape, and
**`scripts/daily-generator/example-solution.mjs` is the model for how a
solution should read** (working, meaning, real-world use, computed diagrams, a simulator).

**Rules for every question**

- **Original.** Write new problems in the style of the FE/PE exams and
  textbooks; never copy problems from exam prep books, practice exams or
  textbooks.
- **Ids**: `<date>-<short-slug>`, unique for all time.
- **Math**: everything containing LaTeX goes in ``R`...` `` templates (the build
  refuses backslashes inside quoted strings). Put display math on its own
  line as `$$ ... $$`. Write currency as `\$`. In running text use `rac` or
  `a/b`; keep `\dfrac` for display math, or the line spacing blows up.
- **Tables**: Markdown tables render (a header row, then a `|---|---|`
  row; `---:` right-aligns a number column). Use them for data read across
  rows: property tables, data-type ranges, SIL bands, I/O lists. Keep to about
  5 columns so they fit a phone (wider ones scroll sideways). Math works in
  cells, but a `|` inside a cell ends the cell: write `\lvert x \rvert`, not
  `|x|`. Routh arrays and matrices are math, so they stay `\begin{array}` in
  `$$ ... $$`.
- **Units**: say the unit the answer is wanted in (the `unit` of a numeric
  part). Pick numbers so the default 2 % tolerance can't accept a wrong method;
  use `abs` for answers at or near zero.
- **Prompt**: self-contained, realistic numbers, one clear question per part.
- **Hints**: 1–3, each a step further, never the answer.
- **Solution**: teach the idea, not just the answer. Three parts, each under
  a `####` heading (see `example-solution.mjs`):
  1. `#### Working`: every step with the numbers substituted, then a quick
     check (another method, units, a sanity check).
  2. `#### What the numbers tell you`: what each result means physically, why
     it matters, and how it moves when the design changes (more stiffness,
     a bigger pipe, more gain…). A small table (quantity | this problem |
     what it tells you) works well when there are several results. Point out
     the insight a good engineer would take away (for example "overshoot
     depends only on ζ").
  3. `#### On a real job` (or "On a real loop", "On the machine"…): how this
     is used in practice. Tuning a real controller, sizing or selecting a
     part, commissioning and reading a trend, what goes wrong on site, rules of
     thumb, and where the textbook model stops being accurate (with a short
     caveat).
  Core and boss questions get all three in full (roughly 250–500 words beyond
  the working, more for a boss). Bonus and practice questions keep the same
  three parts, but shorter (a few sentences each). Be concrete and use this
  problem's numbers; no padding or generic advice.
- **Mistakes**: 1–3 per numeric or choice part for the slips people really
  make (wrong unit conversion, radius vs diameter, open- vs closed-loop, cp vs
  cv…), each with the value that slip produces **computed**, and a note on
  what went wrong.
- **Sources**: 1–3 real references: a textbook (title and chapter name), the
  NCEES FE Reference Handbook section, the IEC/ISO/ISA standard, or the
  Siemens manual. Name chapters and sections, not page numbers. Only cite a
  clause number, edition detail or product behaviour you are sure of; if
  unsure, leave the fact out of the question.
- **Formulas**: the day's formula sheet holds every formula the questions use
  (`formulas: [ids]` on each question), each with its source.
- **Figures** (optional): SVG markup with `xmlns`, dark lines on white, at
  most 500 px wide, all text inside the viewBox, arrow markers that point along
  their line, and a `figureAlt` that says everything the figure shows. The
  question's `figure` shows before answering, so it must not give away the
  answer.
- **Solution diagrams**: add 1–3 to most core and boss solutions, and to
  bonus or practice ones where a picture teaches more than a paragraph. Put
  them in `solutionFigures: [fig(id, svg, alt, caption)]` and place each one in
  the solution text with `![](figure:<id>)` on its own line, right after the
  step it illustrates (the build fails if one is missing or unplaced).
  - **Graphs are computed, never drawn by eye.** Use `plot()` from
    helpers.mjs with the same numbers as the answer key: step responses
    (`step1`, `step2`), a family of curves showing what changes when a
    parameter changes, pump and system curves, stress or moment along a beam,
    temperature through a wall, S-N or fatigue lines, Bode magnitude
    (`fn` over log frequency). Mark the answers on the graph (`marks`,
    `vlines`, `hlines`, `bands`). Use `equalAspect: true` for an s-plane or
    anything where angles and circles must look right.
  - Hand-written SVG for everything else: free-body and block diagrams,
    ladder rungs, timing diagrams, P&ID snippets, wiring, state machines. Same
    style rules as figures.
  - The `alt` describes what the diagram shows in words, and the caption is
    one plain-text line (no math).
- **Interactive simulators** (`solutionWidgets`): a solution can hold up to 3
  live widgets the site draws itself: sliders, a plot that redraws as they
  move (with the question's own curve dashed for comparison) and live
  readouts. Add one to most core and boss questions whose topic has a kind
  below, and to bonus or practice ones where playing with the numbers teaches
  the idea. Use `widget(id, kind, params, { caption, ranges })` from
  helpers.mjs, put it in `solutionWidgets: [...]`, and place it in the
  solution with `![](widget:<id>)` on its own line, after a sentence that says
  what to try ("drag ζ down and watch the overshoot grow; drag ωn and only the
  time scale changes"). The build fails if one is missing or unplaced. A pack
  only picks a kind and numbers: never put markup or code in a widget.

  | kind | system | params (sliders **bold**) | readouts |
  |---|---|---|---|
  | `step2` | $K\omega_n^2/(s^2+2\zeta\omega_n s+\omega_n^2)$, unit step | **`zeta`** (0.01–5), **`wn`** rad/s, `K` (default 1), `tMax` s (time axis; default about 1.5 × settling) | overshoot, peak time, rise time 10–90 % (and 0–100 %), exact 2 % settling time next to the 4/ζωn estimate, poles and ωd |
  | `step1` | $Ke^{-\theta s}/(\tau s+1)$, unit step | **`tau`** s, **`theta`** s (default 0), `K` (default 1), `tMax` s | 63 % point θ + τ, rise time, exact settling θ + τ ln 50 next to θ + 4τ, θ/τ |
  | `bode2` | the same second-order system, magnitude and phase | **`zeta`**, **`wn`** rad/s, `K` (default 1) | resonant peak and ωr, −3 dB bandwidth, phase at ωn, step overshoot for the same ζ |

  - Start the sliders at **this problem's numbers** (the same constants as the
    answer key), so the widget opens on the answer and the readouts match the
    working. Because the widget shows the answers, it is only shown after
    answering, like the rest of the solution.
  - By default ζ runs 0.05–2, ωn and τ from a quarter (τ: a fifth) to 4× (5×)
    their starting value, and θ from 0 to 4θ (at least 2τ). Give
    `ranges: { zeta: [0.1, 1] }` to focus a slider on what the question is
    about; the starting value must sit inside the range.
  - Readouts use exact definitions (10–90 % rise, true 2 % settling), so they
    can differ a little from textbook estimates in the working (4/ζωn,
    0–100 % rise). Say which one the working uses.
  - The caption is one plain-text line (no math), such as what the dashed
    curve is or what to look for.
- **Automation questions** should be the things an automation engineer
  actually meets: TIA Portal behaviour, PLC data and program structure,
  standards (IEC 61131-3, IEC 60204-1, ISO 13849-1, IEC 62061, ISA-88/95/18.2/101,
  IEC 62443), networks, I/O and drives.

## 6b. Practice questions

The Practice tab has generated questions (fresh numbers every time, from
`lib/daily/generated.ts`) plus a pool of practice-only questions you upload.
Each run, add **8–12 practice questions** to the same source file as
`export const practice = { formulas: [...], questions: [...] }`:

- Aim most of them at the weakest topics from `npm run daily -- weak`
  (lowest ability, or a weakness for the most people), at a difficulty about
  half a level above the topic's ability, so they stretch without crushing.
- Fill the rest from syllabus topics nobody has tried yet.
- Same rules as daily questions (original, verified, sources, hints, worked
  solution, computed mistakes). Ids: `p-<date>-<short-slug>`, unique for all
  time. Their formulas go in `practice.formulas`.
- Don't duplicate a generator's exact setup (see `GENERATORS` in
  `lib/daily/generated.ts`); go for the reasoning-heavy and conceptual kinds a
  generator can't do: choice, multi-select, ordering, multi-step design.
- `npm run daily -- practice` lists what is already uploaded; vary from it.

The build puts them in the pack's `practice` set; uploading adds them (an
existing id is replaced, which is how corrections go out).

## 7. Verify, build, upload

1. **Check every answer independently.** Write `daily-packs/checks/<first
   date>.mjs` that recomputes each numeric answer (and each mistake value)
   from the givens in the prompt, without copying from the solution, and
   prints it next to the answer key. Run it. Anything that doesn't match
   within tolerance is fixed or dropped. For conceptual questions, re-check
   each claim against what you know of the cited source. Put the method and
   the numbers in the question's `check` field (admins see it).
2. Build and validate:
   ```bash
   npm run daily:build -- daily-packs/src/<first date>.mjs
   npm run daily:validate -- daily-packs/<first>_<last>.json
   ```
   Fix every problem it reports.
3. Upload:
   ```bash
   npm run daily -- upload daily-packs/<first>_<last>.json
   ```
   Confirm `readyAhead` reached the target. Uploading a date that already
   exists replaces it, which is how corrections go out.

## 8. Record what was learned

Fetch the current notes into `daily-packs/notes.md`, then edit:

- leave the owner's guidance at the top untouched;
- under `## Run log`, add a dated entry: days added, reports handled (fixed
  or not, and why), calibration changes, anything to do differently;
- keep a short `## Calibration` section current (per track/topic: easier,
  harder or as is), so a run doesn't need to re-read every old entry;
- keep the whole file under about 150 lines: fold old log entries into a
  one-line summary.

```bash
npm run daily -- notes --set daily-packs/notes.md
```

## 9. Report

Finish with a short summary: dates added, practice questions added (and which weak topics they target), days ready ahead, reports fixed or
dismissed, calibration changes, and anything that needs the owner (for
example a question you dropped and why).
