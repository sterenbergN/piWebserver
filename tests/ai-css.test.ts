import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// The Generate panel is a one-column grid. Left to size itself, that column grows
// to its widest content, and an attached file's long name doesn't wrap, so every
// box in the panel ran past its tile (seen on Add a test). Its column must be
// capped at the panel's width.

test('the Generate panel’s column can’t grow past the panel', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'components', 'ai', 'ai.css'), 'utf8');
  const rule = /\.ai-gen\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  // The name itself is cut short with "…" rather than pushing the row wider.
  const name = /\.ai-gen-file-name\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(name, /min-width:\s*0/);
  assert.match(name, /text-overflow:\s*ellipsis/);
});
