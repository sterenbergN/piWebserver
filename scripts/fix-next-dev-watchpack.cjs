/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Work around a Next.js 16.2.2 dev-mode race on Windows where setup-dev-bundler
// creates Watchpack({ aggregateTimeout: 5 }) with an unserialized async 'aggregated'
// callback, allowing concurrent runs to overwrite .next-dev/dev/types/routes.d.ts.

const MIN_AGGREGATE_TIMEOUT_MS = 250;
const PATCHED = Symbol.for('piWebserver.watchpackPatched');

function wrapAggregatedListener(fn) {
  let running = false;
  let pending = null;

  const run = async (ctx, args) => {
    running = true;
    try {
      await fn.apply(ctx, args);
    } finally {
      if (pending) {
        const next = pending;
        pending = null;
        void run(next.ctx, [next.changes, next.removals, ...next.extraArgs]);
      } else {
        running = false;
      }
    }
  };

  return function serializedAggregatedListener(...args) {
    const [changes, removals, ...extraArgs] = args;
    if (!running) {
      void run(this, args);
      return;
    }
    if (!pending) {
      pending = {
        ctx: this,
        changes: changes instanceof Set ? new Set(changes) : changes,
        removals: removals instanceof Set ? new Set(removals) : removals,
        extraArgs,
      };
      return;
    }
    pending.ctx = this;
    if (pending.changes instanceof Set && changes instanceof Set) {
      for (const c of changes) {
        pending.changes.add(c);
        if (pending.removals instanceof Set) pending.removals.delete(c);
      }
    } else {
      pending.changes = changes;
    }
    if (pending.removals instanceof Set && removals instanceof Set) {
      for (const r of removals) {
        pending.removals.add(r);
        if (pending.changes instanceof Set) pending.changes.delete(r);
      }
    } else {
      pending.removals = removals;
    }
    pending.extraArgs = extraArgs;
  };
}

try {
  const watchpackPath = require.resolve('next/dist/compiled/watchpack');
  const OriginalWatchpack = require(watchpackPath);

  if (OriginalWatchpack && !OriginalWatchpack.prototype[PATCHED]) {
    OriginalWatchpack.prototype[PATCHED] = true;

    const origWatch = OriginalWatchpack.prototype.watch;
    OriginalWatchpack.prototype.watch = function patchedWatch(...args) {
      this.aggregateTimeout = Math.max(this.aggregateTimeout || 0, MIN_AGGREGATE_TIMEOUT_MS);
      return origWatch.apply(this, args);
    };

    const origAddListener = OriginalWatchpack.prototype.addListener;
    OriginalWatchpack.prototype.addListener = function patchedAddListener(event, listener, ...rest) {
      const wrapped = event === 'aggregated' && typeof listener === 'function'
        ? wrapAggregatedListener(listener)
        : listener;
      return origAddListener.call(this, event, wrapped, ...rest);
    };
    OriginalWatchpack.prototype.on = OriginalWatchpack.prototype.addListener;

    class PatchedWatchpack extends OriginalWatchpack {
      constructor(options, ...rest) {
        const nextOptions = options && typeof options === 'object'
          ? { ...options, aggregateTimeout: Math.max(options.aggregateTimeout || 0, MIN_AGGREGATE_TIMEOUT_MS) }
          : { aggregateTimeout: MIN_AGGREGATE_TIMEOUT_MS };
        super(nextOptions, ...rest);
        this.aggregateTimeout = Math.max(this.aggregateTimeout || 0, MIN_AGGREGATE_TIMEOUT_MS);
      }
    }

    const cached = require.cache[watchpackPath];
    if (cached) {
      cached.exports = PatchedWatchpack;
    }
  }
} catch {
  // Best-effort preload hook; do not crash non-Next processes if watchpack isn't resolvable.
}
