import test from 'node:test';
import { strict as assert } from 'node:assert';
import { allPlaces, atPlace, isCurrentItem, matchNavItems, navGroups, orderRooms, pickSurprise, placesFor } from '../components/nav-links';
import { GAMES } from './games/registry';
import { GAME_CATALOG } from './party/catalog';
import { addListItem, emptyKitchen, groceriesLeft, mealsToday } from './recipes/kitchen';
import { withoutBlogAlbums } from './site-content';

const items = navGroups(true).flatMap((g) => g.items);
const item = (href: string) => items.find((i) => i.href === href)!;
const current = (href: string, path: string, hash = '', search = '') => isCurrentItem(item(href), path, hash, items, search);

test('the most specific page in a section is the current one', () => {
  assert.ok(current('/workout/health', '/workout/health'));
  assert.ok(!current('/workout', '/workout/health'));
  assert.ok(current('/daily/leaderboard', '/daily/leaderboard'));
  assert.ok(!current('/daily', '/daily/leaderboard'));
  assert.ok(current('/journal', '/journal/posts/abc'));
  assert.ok(!current('/', '/journal'));
});

test('pages sharing a path are told apart by query or hash', () => {
  assert.ok(current('/recipes', '/recipes'));
  assert.ok(current('/recipes?view=list', '/recipes', '', 'view=list'));
  assert.ok(!current('/recipes', '/recipes', '', 'view=list'));
  assert.ok(current('/recipes?view=week', '/recipes', '', 'recipe=stew&view=week'));
  assert.ok(current('/tools#calculators', '/tools'));
  assert.ok(current('/tools#golf', '/tools', 'golf'));
  assert.ok(!current('/tools#calculators', '/tools', 'golf'));
});

test('every page is listed once, and the buried ones can be found by name', () => {
  const hrefs = items.map((i) => i.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.equal(matchNavItems(items, 'grocery')[0].href, '/recipes?view=list');
  assert.equal(matchNavItems(items, 'diary')[0].href, '/journal');
  assert.deepEqual(matchNavItems(items, '   '), []);
  assert.ok(!navGroups(false).flatMap((g) => g.items).some((i) => i.href === '/admin'));
});

test('every place is on the map once, and every game has its own way in', () => {
  const groups = navGroups(true);
  const hrefs = allPlaces(groups).map((p) => p.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const game of GAMES) assert.ok(hrefs.includes(`/game?game=${game.id}`), `${game.id} is in the arcade`);
  assert.equal(hrefs.filter((h) => h.startsWith('/game?')).length, GAMES.length);
  for (const game of GAME_CATALOG) assert.ok(hrefs.includes(`/party?tab=host&guide=${game.id}`), `${game.id} is at the party`);
  assert.equal(hrefs.filter((h) => h.includes('guide=')).length, GAME_CATALOG.length);
});

test('a game can be found by name, and the party is easy to find', () => {
  const places = allPlaces(navGroups(false));
  assert.equal(matchNavItems(places, 'snake')[0].href, '/game?game=snake');
  assert.equal(matchNavItems(places, 'party')[0].href, '/party');
  assert.equal(matchNavItems(places, 'wavelength')[0].href, '/party?tab=host&guide=wavelength');
});

test('your day comes first once signed in; a visitor starts with who this is', () => {
  const groups = navGroups(false);
  assert.equal(orderRooms(groups, true)[0].id, 'day');
  assert.equal(orderRooms(groups, false)[0].id, 'noah');
  assert.equal(orderRooms(groups, true).length, groups.length);
  assert.ok(orderRooms(groups, false).findIndex((r) => r.id === 'play') <= 1, 'party games stay near the top for a visitor');
});

test('a surprise is somewhere new, and never where you are', () => {
  const places = allPlaces(navGroups(false)).slice(0, 3);
  const [a, b, c] = places.map((p) => p.href);
  assert.equal(pickSurprise(places, [a, b], undefined, () => 0).href, c);
  assert.equal(pickSurprise(places, [a, b, c], a, () => 0).href, b, 'seen it all: anywhere but here');
  assert.equal(pickSurprise(places, [], c, () => 0.99).href, b);
});

test('account-only places stay on the map but aren\'t a goal for a visitor', () => {
  const groups = navGroups(false);
  const visitor = placesFor(groups, false).map((p) => p.href);
  assert.ok(allPlaces(groups).some((p) => p.href === '/journal'));
  assert.ok(!visitor.includes('/journal'));
  assert.ok(placesFor(groups, true).some((p) => p.href === '/journal'));
});

test('a corner is only reached by its exact link', () => {
  const places = allPlaces(navGroups(false));
  const at = (href: string) => places.find((p) => p.href === href)!;
  assert.ok(atPlace(at('/habits#garden'), '/habits', 'garden'));
  assert.ok(!atPlace(at('/habits#garden'), '/habits', 'stats'));
  assert.ok(atPlace(at('/game?game=snake'), '/game', '', 'game=snake'));
  assert.ok(!atPlace(at('/game?game=snake'), '/game', '', 'game=flap'));
});

test('adding to the list skips what is already waiting there', () => {
  const once = addListItem(emptyKitchen(), '  Milk ');
  assert.deepEqual(once.listItems.map((i) => i.text), ['Milk']);
  assert.equal(addListItem(once, 'milk').listItems.length, 1);
  const bought = { ...once, got: [once.listItems[0].id] };
  assert.equal(addListItem(bought, 'milk').listItems.length, 2);
  assert.equal(groceriesLeft([], once, '2026-10-26'), 1);
  assert.equal(groceriesLeft([], bought, '2026-10-26'), 0);
});

test('today\'s meals come from the right day of the week', () => {
  const recipe = { id: 'r1', title: 'Stew', servings: 2, sections: [] } as never;
  const kitchen = { ...emptyKitchen(), plans: { '2026-10-26': [
    { id: 'a', recipeId: 'r1', servings: 2, day: 4 },
    { id: 'b', recipeId: 'r1', servings: 2, day: 0 },
    { id: 'c', recipeId: 'r1', servings: 2, day: null },
    { id: 'd', recipeId: 'gone', servings: 2, day: 4 },
  ] } };
  const meals = mealsToday([recipe], kitchen, '2026-10-30');
  assert.equal(meals.week, '2026-10-26');
  assert.deepEqual(meals.tonight.map((m) => m.entry.id), ['a']);
  assert.deepEqual(meals.prep.map((m) => m.entry.id), ['c']);
});

test('the old album of blog pictures stays out of the gallery, and other albums stay in', () => {
  const albums = [{ id: 'general' }, { id: 'blog-post-images' }, { id: 'trip' }];
  assert.deepEqual(withoutBlogAlbums(albums).map((a) => a.id), ['general', 'trip']);
});
