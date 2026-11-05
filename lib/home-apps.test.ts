import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { allPlaces, navGroups } from '@/components/nav-links';
import { appIcon, appManifest, HOME_APPS, homeApp, homeScreenMetadata } from './home-apps';

const root = process.cwd();

test('every section in the navigation goes on the home screen as some app', () => {
  const sections = new Set(allPlaces(navGroups(true)).map((p) => `/${p.href.split(/[?#]/)[0].split('/')[1]}`));
  const ownManifest = (s: string) => fs.existsSync(path.join(root, 'app', s, 'manifest.webmanifest', 'route.ts'));
  for (const section of sections) {
    if (section === '/' || section === '/workout') continue; // the site's main app
    assert.ok(homeApp(section.slice(1)) || ownManifest(section.slice(1)), `${section} has no home-screen app`);
  }
});

test('each app has its icons and its layout points at its manifest', () => {
  const slugs = HOME_APPS.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const app of HOME_APPS) {
    for (const kind of ['192', '512', 'maskable-192', 'maskable-512', 'apple-touch-icon'] as const) {
      assert.ok(fs.existsSync(path.join(root, 'public', appIcon(app.slug, kind))), `missing ${appIcon(app.slug, kind)}: run npm run icons:apps`);
    }
    const layout = fs.readFileSync(path.join(root, 'app', app.slug, 'layout.tsx'), 'utf-8');
    assert.ok(layout.includes(`homeScreenMetadata('${app.slug}')`), `app/${app.slug}/layout.tsx doesn’t use homeScreenMetadata`);
  }
});

test('a section’s app opens on that section and stays in it', () => {
  const journal = homeApp('journal')!;
  const manifest = appManifest(journal);
  assert.equal(manifest.start_url, '/journal');
  assert.equal(manifest.scope, '/journal');
  assert.equal(manifest.id, '/journal');
  assert.equal(manifest.short_name, 'Journal');
  assert.equal(homeScreenMetadata('journal').manifest, '/apps/journal/manifest.webmanifest');
  assert.throws(() => homeScreenMetadata('nope'));
});
