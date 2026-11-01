import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { addCard, addCards, cardFile, cardFileName, cardKey, deckSummary, editCard, editDeck, MAX_DECKS, newDeck, parseCardReply, unsentCards } from '@/lib/study/cards';
import { readAnki, readPractice, updatePractice } from '@/lib/study/store';
import { StudyInputError } from '@/lib/study/study';

// Flashcard decks her AI writes. Saving reads the reply again here rather than
// trusting what the browser made of it. Downloading is a POST, since it marks what
// it hands over.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const json = (body: Record<string, unknown>) => NextResponse.json({ success: true, ...body }, { headers: PRIVATE });
const MISSING = 'That deck isn’t here any more.';

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const wanted = new URL(request.url).searchParams.get('deck');
    const data = await readPractice(userId);
    if (wanted) {
      const deck = data.cardDecks.find((d) => d.id === wanted);
      if (!deck) throw new ApiError(404, MISSING);
      return json({ deck });
    }
    const anki = await readAnki(userId);
    return json({
      decks: data.cardDecks.map(deckSummary),
      // What she keeps forgetting in Anki, which is what's most worth rewriting.
      leeches: (anki?.leeches ?? []).slice(0, 40).map((card) => ({ front: card.front, back: card.back })),
    });
  } catch (error) {
    return handleApiError(error, 'Load cards failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const now = new Date().toISOString();

    switch (body.action) {
      case 'save': {
        const { cards } = parseCardReply(body.text);
        const skip = new Set(Array.isArray(body.skip) ? body.skip.filter((s): s is string => typeof s === 'string').map(cardKey) : []);
        const kept = cards.filter((c) => !skip.has(cardKey(c.front)));
        if (!kept.length) throw new ApiError(400, 'You took out every card, so there’s nothing to save.');
        const result = await updatePractice(userId, (data) => {
          let deck = data.cardDecks.find((d) => d.id === body.deckId);
          if (!deck) {
            if (body.deckId) throw new ApiError(404, MISSING);
            if (data.cardDecks.length >= MAX_DECKS) throw new ApiError(400, 'That’s as many decks as one account can keep.');
            deck = newDeck(body, randomUUID().slice(0, 12), now);
            data.cardDecks.unshift(deck);
          }
          return { id: deck.id, ...addCards(deck, kept) };
        });
        return json(result);
      }
      case 'edit-card':
      case 'remove-card':
        await updatePractice(userId, (data) => {
          const deck = data.cardDecks.find((d) => d.id === body.deckId);
          if (!deck) throw new ApiError(404, MISSING);
          if (body.action === 'remove-card') {
            deck.cards = deck.cards.filter((c) => c.id !== body.cardId);
            return;
          }
          const card = deck.cards.find((c) => c.id === body.cardId);
          if (!card) throw new ApiError(404, 'That card isn’t here any more.');
          editCard(card, body);
        });
        return json({});
      case 'edit-deck':
      case 'add-card':
        await updatePractice(userId, (data) => {
          const deck = data.cardDecks.find((d) => d.id === body.deckId);
          if (!deck) throw new ApiError(404, MISSING);
          if (body.action === 'edit-deck') editDeck(deck, body);
          else addCard(deck, body);
        });
        return json({});
      case 'delete-deck':
        await updatePractice(userId, (data) => { data.cardDecks = data.cardDecks.filter((d) => d.id !== body.deckId); });
        return json({});
      case 'download': {
        const made = await updatePractice(userId, (data) => {
          const deck = data.cardDecks.find((d) => d.id === body.deckId);
          if (!deck) throw new ApiError(404, MISSING);
          const chosen = body.scope === 'new' ? unsentCards(deck) : deck.cards;
          const text = cardFile(deck, chosen);
          for (const card of chosen) card.exportedAt = now;
          return { text, name: cardFileName(deck), count: chosen.length };
        });
        return new Response(made.text, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${made.name}"`,
            'Cache-Control': 'no-store, private',
            'X-Study-Count': String(made.count),
            'X-Study-File': made.name,
          },
        });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof StudyInputError) return handleApiError(new ApiError(400, error.message), 'Cards failed');
    return handleApiError(error, 'Cards failed');
  }
}
