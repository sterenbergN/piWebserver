import assert from 'node:assert/strict';
import test from 'node:test';
import { checkUrl, isPublicAddress, ImportFetchError } from './import-fetch';
import { buildSections, cleanText, isoMinutes, normalizeIngredientLine, recipeFromHtml, recipeFromText } from './import';
import { extractIngredients, formatBomAmount, formatIngredientAmount, parseStepTokens } from './recipes';

const PAGE = 'https://example.com/recipes/soup';

function jsonLdPage(data: unknown) {
  return `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>x</body></html>`;
}

const SAMPLE = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Site' },
    {
      '@type': ['Recipe', 'NewsArticle'],
      name: 'Tomato &amp; Basil Soup',
      description: '<p>A <b>simple</b> soup.</p>',
      image: [{ '@type': 'ImageObject', url: '/img/soup.jpg' }],
      recipeYield: ['6', '6 servings'],
      prepTime: 'PT10M',
      cookTime: 'PT1H5M',
      recipeCategory: 'Soup',
      recipeCuisine: 'Italian',
      keywords: 'soup, easy, weeknight',
      nutrition: { calories: '210 calories', proteinContent: '5 g', carbohydrateContent: '20 g', fatContent: '12 g' },
      recipeIngredient: [
        '2 tablespoons olive oil',
        '1 large onion, diced',
        '3 cloves garlic, minced',
        '1 (28 oz) can crushed tomatoes',
        '2-3 cups vegetable broth',
        '1 cup (240ml) heavy cream',
        'Salt and pepper, to taste',
        '&frac12; cup fresh basil',
      ],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Heat the olive oil in a large pot over medium heat. Add the onion and cook for 5 to 7 minutes.' },
        { '@type': 'HowToStep', text: 'Stir in the garlic and cook 1 minute.' },
        { '@type': 'HowToSection', name: 'Finish:', itemListElement: [
          { '@type': 'HowToStep', text: 'Add the tomatoes and broth. Simmer for 30 minutes, then stir in the cream.' },
          { '@type': 'HowToStep', text: 'Top with basil.' },
        ] },
      ],
    },
  ],
};

test('recipeFromHtml reads schema.org data, including inside @graph', () => {
  const r = recipeFromHtml(jsonLdPage(SAMPLE), PAGE);
  assert.ok(r);
  assert.equal(r.title, 'Tomato & Basil Soup');
  assert.equal(r.summary, 'A simple soup.');
  assert.equal(r.servings, 6);
  assert.equal(r.prepMinutes, 10);
  assert.equal(r.cookMinutes, 65);
  assert.equal(r.category, 'lunch');
  assert.deepEqual(r.macros, { calories: 210, protein: 5, carbs: 20, fat: 12 });
  assert.equal(r.imageUrl, 'https://example.com/img/soup.jpg');
  assert.equal(r.sourceUrl, PAGE);
  assert.ok(r.tags.includes('Italian'));
  assert.deepEqual(r.sections.map((s) => s.name), ['Main', 'Finish']);
});

test('imported ingredients land in the step that mentions them, and none are lost', () => {
  const r = recipeFromHtml(jsonLdPage(SAMPLE), PAGE)!;
  const first = r.sections[0].steps.find((s) => s.includes('olive oil'))!;
  assert.ok(first.includes('[2 tablespoons olive oil]'), first);
  assert.ok(first.includes('[1 large onion, diced]'), first);
  assert.ok(!first.includes('the [2 tablespoons'), 'drops the "the" before an amount');
  assert.ok(r.sections[1].steps[0].includes('[1 cup | 240 ml heavy cream]'), r.sections[1].steps[0]);
  const names = extractIngredients({ sections: r.sections }).map((b) => b.key);
  assert.equal(names.length, 8, names.join(', '));
});

test('imported steps get timers and temperatures, without counting amounts twice', () => {
  const r = recipeFromHtml(jsonLdPage(SAMPLE), PAGE)!;
  assert.ok(r.sections[0].steps.some((s) => s.includes('[5-7 min]')), r.sections[0].steps.join(' / '));
  assert.ok(r.sections[1].steps[0].includes('[30 min passive]'), r.sections[1].steps[0]);
  const sections = buildSections(['1 cup butter'], [{ name: 'Main', steps: ['Melt the butter, keeping 2 tbsp of the butter aside.'] }]);
  const bom = extractIngredients({ sections });
  assert.equal(bom.length, 1);
  assert.equal(formatBomAmount(bom[0], 1, 'us'), '1 cup');
});

test('an ingredient no step mentions goes in a "Have ready" step', () => {
  const sections = buildSections(['1 tsp cumin', '1 lb beef'], [{ name: 'Main', steps: ['Brown the beef.'] }]);
  assert.equal(sections[0].steps[0], 'Have ready: [1 tsp cumin].');
  assert.ok(sections[0].steps[1].includes('[1 lb beef]'));
});

test('a specific ingredient claims its mention before a general one', () => {
  const sections = buildSections(['1 tsp black pepper', '1 bell pepper, sliced'], [{ name: 'Main', steps: ['Fry the bell pepper. Season with pepper.'] }]);
  const tokens = parseStepTokens(sections[0].steps[0]).filter((t) => t.kind === 'ingredient');
  assert.equal(tokens.length, 2);
});

test('a whole-paragraph step is split up', () => {
  const long = Array.from({ length: 12 }, (_, i) => `Do the thing number ${i} carefully until it looks right.`).join(' ');
  const sections = buildSections([], [{ name: 'Main', steps: [long] }]);
  assert.ok(sections[0].steps.length >= 2);
  assert.ok(sections[0].steps.every((s) => s.length <= 350));
});

test('instructions given as one string with list tags still become steps', () => {
  const r = recipeFromHtml(
    jsonLdPage({ '@type': 'Recipe', name: 'X', recipeIngredient: ['1 egg'], recipeInstructions: '<ol><li>Crack the egg.</li><li>Fry it.</li></ol>' }),
    PAGE,
  )!;
  assert.equal(r.sections[0].steps.length, 2);
});

test('normalizeIngredientLine tidies the common ways of writing amounts', () => {
  const amount = (line: string) => {
    const token = parseStepTokens(`[${normalizeIngredientLine(line)}]`)[0];
    assert.ok(token.kind === 'ingredient', line);
    return { amount: formatIngredientAmount(token, 1, 'us'), metric: formatIngredientAmount(token, 1, 'metric'), name: token.name };
  };
  assert.deepEqual(amount('1 ½ cups all-purpose flour'), { amount: '1 ½ cups', metric: '180 g', name: 'all-purpose flour' });
  assert.deepEqual(amount('1 cup (140g) sugar'), { amount: '1 cup', metric: '140 g', name: 'sugar' });
  assert.deepEqual(amount('250 g / 1 cup milk'), { amount: '1 cup', metric: '250 g', name: 'milk' });
  assert.equal(amount('2-3 cloves garlic').amount, '3 cloves');
  assert.equal(amount('1 (14 oz) can tomatoes').amount, '1 can');
  assert.equal(amount('▢ 1⁄2 tsp salt').amount, '½ tsp');
  assert.equal(normalizeIngredientLine('salt [to taste] | extra'), 'salt to taste extra');
});

test('recipeFromText reads pasted text with and without headings', () => {
  const withHeads = recipeFromText(`Easy Pancakes
Serves 3

Ingredients
1 cup flour
For the topping:
2 tbsp maple syrup

Directions
1. Mix the flour with water.
2. Fry for 3 minutes, then add the syrup.

Notes
Keep warm.`);
  assert.ok(withHeads);
  assert.equal(withHeads.title, 'Easy Pancakes');
  assert.equal(withHeads.servings, 3);
  assert.equal(withHeads.sections[0].steps.length, 2);
  assert.equal(extractIngredients(withHeads).length, 2);
  assert.ok(withHeads.sections[0].steps[1].includes('[3 min]'));

  const noHeads = recipeFromText(`Toast
2 slices bread
1 tbsp butter
Toast the bread until it is golden all over.
Spread the butter on while it is still hot.`);
  assert.ok(noHeads);
  assert.equal(noHeads.title, 'Toast');
  assert.equal(noHeads.sections[0].steps.length, 2);
  assert.equal(extractIngredients(noHeads).length, 2);

  assert.equal(recipeFromText('just a shopping note'), null);
  assert.equal(recipeFromText(''), null);
});

test('pages without recipe data fall back on their text', () => {
  const html = `<html><head><title>Grandma's Toast</title><meta property="og:image" content="https://cdn.example.com/t.jpg"></head>
  <body><nav>Home About</nav><h2>Ingredients</h2><ul><li>2 slices bread</li></ul><h2>Instructions</h2><ol><li>Toast the bread.</li></ol></body></html>`;
  const r = recipeFromHtml(html, PAGE);
  assert.ok(r);
  assert.equal(r.title, "Grandma's Toast");
  assert.equal(r.imageUrl, 'https://cdn.example.com/t.jpg');
  assert.equal(r.sections[0].steps[0].includes('[2 slices bread]'), true);
  assert.equal(recipeFromHtml('<html><body><p>Nothing here.</p></body></html>', PAGE), null);
});

test('malformed recipe data doesn’t stop the page being read', () => {
  const html = `<script type="application/ld+json">{ not json</script>${jsonLdPage({ '@type': 'Recipe', name: 'Y', recipeInstructions: ['Eat.'] })}`;
  assert.equal(recipeFromHtml(html, PAGE)?.title, 'Y');
});

test('helpers', () => {
  assert.equal(isoMinutes('PT1H30M'), 90);
  assert.equal(isoMinutes('P0DT0H20M'), 20);
  assert.equal(isoMinutes('PT0S'), undefined);
  assert.equal(isoMinutes('soon'), undefined);
  assert.equal(cleanText('Fish &amp;amp; chips <br/> &#8211; now'), 'Fish & chips – now');
});

test('links can only reach the public internet', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:192.168.1.1', '::ffff:c0a8:0101', '::ffff:7f00:1', '64:ff9b::7f00:1', '2001:db8::1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://192.168.1.10/x', 'http://pi/', 'http://printer.local/', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'https://example.com:8080/', 'nonsense']) {
    assert.throws(() => checkUrl(url), ImportFetchError, url);
  }
  assert.equal(checkUrl(' https://www.seriouseats.com/soup ').hostname, 'www.seriouseats.com');
});

test('real-world page mess is cleaned up', () => {
  assert.equal(normalizeIngredientLine('1 tsp toasted sesame oil ((optional // or sub peanut or avocado oil))'), '1 tsp toasted sesame oil (optional)');
  assert.equal(normalizeIngredientLine('8 ounces extra-firm tofu* ((8 ounces yields ~1 cup and a bit more))'), '8 ounces extra-firm tofu');
  const sections = buildSections(['100g plain flour', '2 large eggs', '1 cup milk'], [{ name: 'Main', steps: ['Put 100g plain flour, 2 large eggs and 1 cup of milk into a bowl. Bake at 200C for 5 minutes.'] }]);
  assert.equal(sections[0].steps[0], 'Put [100g plain flour], [2 large eggs] and [1 cup milk] into a bowl. Bake at [200°C] for [5 min].');
  assert.equal(buildSections([], [{ name: 'Main', steps: ['Preheat to 400 degrees F (204 C).'] }])[0].steps[0], 'Preheat to [400°F].');
});

test('times mentioned in passing are not timers', () => {
  const [step] = buildSections([], [{ name: 'Main', steps: ['Bake for 26-30 minutes. If you like it softer, remove it around the 26 minute mark. I prefer mine crisp, so I bake it the full 30 minutes. Cool for 5 minutes.'] }])[0].steps;
  const timers = parseStepTokens(step).filter((t) => t.kind === 'timer');
  assert.deepEqual(timers.map((t) => t.kind === 'timer' && t.label), ['26–30 min', '5 min']);
  assert.ok(step.includes('around the 26 min mark'), step);
});
