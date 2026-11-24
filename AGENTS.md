<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:engineering-manager-delegation -->
# Delegating to subagents

Work like a lead engineer: split big jobs, run the pieces in parallel, and check everything that comes back.

1. **Use Claude Code's subagents for big, separable work.** The user gives standing permission to use the Agent tool without asking each time when a task has several independent parts (separate files or features) or needs a broad search of the codebase: `Explore` for read-only searching, `general-purpose` for writing code. A cheaper model (Sonnet or Haiku) is fine for scouting and simple, well-specified edits. Do small fixes and quick questions yourself; a subagent starts cold and is slower for those.
2. **Give each one an explicit spec.** Name the exact files it may change, the types and interfaces it must keep, the edge cases, and how to check its work. Give parallel subagents files that don't overlap, so they can't overwrite each other.
3. **Audit before you report.** Never pass a subagent's result on unchecked: read its diff, run `npx tsc --noEmit -p tsconfig.json`, `npm test` and eslint on the changed files, check UI changes in the browser, then fix or send back what's wrong.
<!-- END:engineering-manager-delegation -->

# Working on this site

- **Commits** go straight to `master`; the user pushes. CI builds a release, and the Pi installs it from Admin › Updates (`scripts/deploy.sh`). Never tell the user to run npm on the Pi.
- **The pre-commit hook** runs typecheck, lint and the unit tests. If it fails, nothing is committed: fix the cause and commit again (never `--no-verify`).
- **Every bug fix gets a test that fails without the fix.** Check it by putting the old code back briefly (`git stash push <file>`), running the test, then restoring it. The test suite is the site's memory of past mistakes.
- **Find the cause, not the symptom**, and say in the commit how you checked it.
- **Self-filed tickets.** The site files its own tickets (`lib/tickets/auto.ts`): browser errors, server errors (`handleApiError`, `onRequestError`), unreadable AI replies, failed jobs and installs that rolled back. They show in Admin › Tickets as "Filed by the site", with a count, the pages and builds they were seen on, and samples. Fix them like any bug and leave `reply` empty: there's no person behind them.
- **Self-tuning features** adjust each person's own settings from results (`lib/tuning/`, `levelRule` in quick math, `aim` in chess, the study difficulty). Site-wide starting values change only through Admin › Tuning. Keep any new tuning within fixed limits, show the person why it moved, and give them a reset.

## Testing locally

- `npm test` (all unit tests), `npx tsc --noEmit -p tsconfig.json`, and `npx eslint <files>`. Errors only under `.next-dev/dev/types` are left over from the dev server, not real.
- Dev server: `.claude/launch.json` ("dev", port 3000). It can stop between sessions, so start it again if pages don't load.
- **Sign-ins:** `npm run seed:workout` creates `tester` / `tester-pass` (and `partner`). The admin passcode for `npm run dev` is in `.env.development.local` (local only, gitignored). Use them on localhost only.
- **Pi-only tools:** ffmpeg and LibreOffice are installed on the Pi but not on the dev PC. Test conversions with a stand-in runner (`createConvertJobs({ runner })`), and say that the real run happens on the Pi.
- **A connected AI** isn't set up locally. To see Generate-first layouts, load a page fresh, replace `window.fetch` so `/api/ai` answers `{ ready: true, … }`, then move with `window.next.router.push(…)`. The AI status is cached per page load, so a page that already asked has to be reloaded first.
- **Self-filed tickets** are only sent from production builds. Set `localStorage['autoTickets:dev'] = '1'` to try them locally.
- **Install checks:** `node scripts/smoke-check.mjs http://127.0.0.1:3000` is the page check `deploy.sh` and CI run. Add new top-level pages to its list.

## Gotchas this codebase has already hit

- **Hydration (React #418):** never read `localStorage`, `window` or the time in a `useState` initializer or in the first render. The server can't see them, so its HTML won't match. Start empty, and load in an effect (see `QuickMath`, `ChessPuzzle`).
- **`history.replaceState(window.history.state, …)`** keeps Next.js's own marker, so Next ignores the change and `useSearchParams` never updates. Pass `null` as the state. Hash-only changes don't fire `hashchange`; dispatch one.
- **A `FileList` empties when its `<input>` is cleared.** Copy it (`[...input.files]`) before clearing it or before a state update reads it.
- **Nav "places found":** the found list must be saved on first use (`markFound`); the recent-pages list can't stand in for it.
- **recharts y-axes:** a fixed `width` clips longer labels ("200.5"); size the axis from its labels.
- **pdf.js** needs its worker path set (`/reader-assets/pdfjs-<version>/pdf.worker.min.mjs`); close documents with `doc.loadingTask.destroy()`.
- **Tests:** `tsx --test` can't use top-level `await`. Tests that wait on background work should poll for the result rather than sleep a fixed time, which flakes when the whole suite runs.
- **Windows shell:** long inline `python - <<'EOF'` scripts can fail with "unexpected EOF". Write the script to the scratchpad and run it instead.

## Feedback tickets

To work through a batch of tickets, use the `feedback-batch` skill (`.claude/skills/feedback-batch/SKILL.md`).

**Keep this file current.** When a session learns something non-obvious about this codebase (a trap, a testing trick, a decision the user made), add it here in a line or two.
