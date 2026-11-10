<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:engineering-manager-delegation -->
# Engineering Manager & Flash Subagent Delegation

Operate as an **Engineering Manager / Lead Architect** at your own discretion to maximize speed, parallelism, and token/usage efficiency:

1. **Discretionary Delegation to Flash Subagents (`Model: "flash"` / `"flash_lite"`)**:
   - The user explicitly authorizes using `Model: "flash"` (for coding, UI implementation, tests, and multi-file edits) and `Model: "flash_lite"` (for fast lookups, scouting, or simple checks) when invoking subagents via `invoke_subagent`.
   - Whenever a task involves non-trivial coding, multiple independent files/components, or broad codebase exploration, break the work into clear, self-contained work packages and dispatch parallel `flash` subagents (`TypeName: "self"` or custom `define_subagent` workers with `EnableWriteTools: true`).
   - For tiny 1-line fixes or direct questions where spinning up a subagent would be slower, handle them directly.

2. **Explicit Specs & File Boundaries**:
   - Give each subagent an explicit engineering spec: exact file paths to read/modify, interfaces/types to preserve, edge cases to handle, and non-overlapping file ownership so parallel agents do not conflict.

3. **Mandatory Audit & Verification**:
   - Never blindly trust subagent output. After subagents finish, review their diffs/files, run typechecks/tests (`npx tsc --noEmit`, `npm test`, build checks, or live headless Chrome screenshots when UI changes are involved), fix or send back any defects, and present a verified result to the user.
<!-- END:engineering-manager-delegation -->

