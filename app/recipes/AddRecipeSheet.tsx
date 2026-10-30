'use client';

import { useState } from 'react';
import { recipeFromText, type ImportedRecipe } from '@/lib/recipes/import';

/** The ways to get a recipe in: a link, pasted text, or from scratch. */
export default function AddRecipeSheet({
  onClose,
  onImported,
  onBlank,
}: {
  onClose: () => void;
  onImported: (recipe: ImportedRecipe & { photo?: string }) => void;
  onBlank: () => void;
}) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'link' | 'text'>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const importLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: /^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}` }),
      });
      const data = await res.json();
      if (!res.ok || !data?.recipe) {
        setError(data?.message || 'Couldn’t import that page.');
        if (res.status === 422) setMode('text');
        return;
      }
      onImported(data.recipe);
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const importText = (e: React.FormEvent) => {
    e.preventDefault();
    const recipe = recipeFromText(text);
    if (!recipe) {
      setError('Couldn’t find any steps in that. Put each ingredient and step on its own line.');
      return;
    }
    onImported(recipe);
  };

  return (
    <div className="rc-sheet-backdrop" onClick={onClose}>
      <div className="rc-sheet" role="dialog" aria-modal="true" aria-label="Add a recipe" onClick={(e) => e.stopPropagation()}>
        <div className="rc-sheet-head">
          <h2>Add a recipe</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="rc-seg rc-seg-wide" role="group" aria-label="How to add it">
          <button type="button" className={mode === 'link' ? 'is-active' : ''} aria-pressed={mode === 'link'} onClick={() => setMode('link')}>
            From a link
          </button>
          <button type="button" className={mode === 'text' ? 'is-active' : ''} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
            Paste the text
          </button>
        </div>

        {error && <p className="rc-sheet-error" role="alert">{error}</p>}

        {mode === 'link' ? (
          <form className="rc-import-form" onSubmit={importLink}>
            <input
              className="rc-input"
              // Plain text, not type="url": the browser would refuse a link without https://, which is added on send.
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              placeholder="https://…/a-recipe-you-like"
              aria-label="Link to a recipe"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="rc-meta">We’ll read the ingredients, steps, timers and photo. You check it over before it’s saved, and it stays private to signed-in people unless you change that.</p>
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? 'Reading the page…' : 'Import'}
            </button>
          </form>
        ) : (
          <form className="rc-import-form" onSubmit={importText}>
            <textarea
              className="rc-input"
              rows={9}
              aria-label="Recipe text"
              placeholder={'Honey-garlic chicken\n\nIngredients\n2 lb chicken thighs\n1/3 cup honey\n\nDirections\n1. Sear the chicken for 8 minutes.\n2. Add the honey and simmer for 5 minutes.'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
              Read it
            </button>
          </form>
        )}

        <button type="button" className="rc-text-btn rc-write-own" onClick={onBlank}>
          Or write one from scratch
        </button>
      </div>
    </div>
  );
}
