import { expect, test, type Page } from '@playwright/test';

// Loop Lab in a real browser. Each test says which setups it is for; the layout checks run in all.

const PAGES = ['/loop-lab', '/loop-lab/bench', '/loop-lab/builder', '/loop-lab/cases', '/loop-lab/processes', '/loop-lab/controllers'];
const SECTIONS = ['Bench', 'Block Studio', 'Case Studies', 'Processes', 'Controllers'];

/** Wait for the page's client code to have run (the nav is rendered by it). */
async function ready(page: Page) {
  await page.locator('.ll-nav').waitFor();
  await page.waitForLoadState('networkidle');
}

/** A clean Block Studio: nothing kept from an earlier test. */
async function freshStudio(page: Page) {
  await page.goto('/loop-lab/builder');
  await page.evaluate(() => {
    localStorage.removeItem('loop-lab:block-studio');
    localStorage.removeItem('loop-lab:block-studio:saved');
  });
  await page.reload();
  await ready(page);
}

const pos = (page: Page, id: string) => page.locator(`[data-block="${id}"]`).evaluate((el) => `${(el as HTMLElement).style.left},${(el as HTMLElement).style.top}`);

test.describe('layout', () => {
  for (const path of PAGES) {
    test(`${path}: nothing scrolls sideways, every section is in the nav`, async ({ page }) => {
      await page.goto(path);
      await ready(page);
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(widths.scroll, 'page wider than the screen').toBeLessThanOrEqual(widths.client);
      for (const name of SECTIONS) await expect(page.locator('.ll-nav-links').getByText(name, { exact: false })).toHaveCount(1);
    });
  }

  test('tablet width: all five sections fit without scrolling the nav', async ({ page }, info) => {
    test.skip(info.project.name !== 'ipad');
    await page.goto('/loop-lab');
    await ready(page);
    const fits = await page.locator('.ll-nav-links').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
  });

  test('page titles name the page', async ({ page }) => {
    for (const [path, title] of [['/loop-lab/cases', 'Case studies · Loop Lab'], ['/loop-lab/processes', 'Processes · Loop Lab'], ['/loop-lab/builder', 'Block Studio — Loop Lab']]) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
    }
  });
});

test.describe('bench', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'pointer and keyboard details; the layout tests cover the other setups');
    await page.goto('/loop-lab/bench?process=flow#tests');
    await ready(page);
  });

  test('the Kc slider holds its scale while it is held at the end', async ({ page }) => {
    const kc = page.locator('.ll-panel input[type=number]').first();
    await expect(kc).toHaveValue('0.45');
    const slider = page.getByLabel('Kc range slider');
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 5; i++) await page.mouse.move(box.x + box.width + 40 + i * 10, box.y + box.height / 2);
    await expect(kc).toHaveValue('20');
    await page.mouse.up();
  });

  test('undo takes back one setting at a time', async ({ page }) => {
    const fields = page.locator('.ll-panel input[type=number]');
    await fields.nth(0).fill('0.6');
    await fields.nth(1).fill('2.5');
    const undo = page.getByRole('button', { name: /Undo/ });
    await undo.click();
    await expect(fields.nth(1)).toHaveValue('1.8');
    await expect(fields.nth(0)).toHaveValue('0.6');
    await undo.click();
    await expect(fields.nth(0)).toHaveValue('0.45');
    await expect(undo).toBeDisabled();
  });

  test('a test runs on drifted plants and says how they did', async ({ page }) => {
    await page.getByText('This test on drifted plants').click();
    await page.getByRole('button', { name: /Run on 8 drifted plants/ }).click();
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
    await expect(page.locator('.ll-verdict-line', { hasText: 'drifted plants' })).toContainText('All 8 drifted plants settled and recovered');
  });
});

test.describe('Block Studio', () => {
  test('a block dragged by its header moves, survives a reload, and undo puts it back', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await freshStudio(page);
    const handle = page.locator('[data-block="pid"] [data-handle]');
    const start = await pos(page, 'pid');
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 40, { steps: 5 });
    await page.mouse.move(box.x + 90, box.y + 70, { steps: 5 });
    await page.mouse.up();
    const moved = await pos(page, 'pid');
    expect(moved).not.toBe(start);
    // Released: moving on doesn't drag it any further.
    await page.mouse.move(box.x + 300, box.y + 200);
    expect(await pos(page, 'pid')).toBe(moved);
    await page.waitForTimeout(500);
    await page.reload();
    await ready(page);
    expect(await pos(page, 'pid')).toBe(moved);
    // A drag undoes in one step.
    await handle.scrollIntoViewIfNeeded();
    const handle2 = (await handle.boundingBox())!;
    await page.mouse.move(handle2.x + 20, handle2.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle2.x + 60, handle2.y + 10, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: /Undo/ }).click();
    expect(await pos(page, 'pid')).toBe(moved);
  });

  test('touch: the drag handle takes the gesture, a drag moves the block, and tapping ports wires them', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'touch setups only');
    await freshStudio(page);
    const handle = page.locator('[data-block="sat"] [data-handle]');
    // The browser hands a touch on the handle to the page instead of scrolling with it.
    expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    const start = await pos(page, 'sat');
    const b = (await handle.boundingBox())!;
    const at = (dx: number, dy: number) => ({ clientX: b.x + 20 + dx, clientY: b.y + 10 + dy, pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: 1, bubbles: true });
    await handle.dispatchEvent('pointerdown', at(0, 0));
    for (let i = 1; i <= 4; i++) await handle.dispatchEvent('pointermove', at(15 * i, 12 * i));
    await handle.dispatchEvent('pointerup', at(60, 48));
    expect(await pos(page, 'sat')).not.toBe(start);
    // Tap an output, then an input: the input is now fed from that output (it replaces what fed it).
    const feeds = async (to: string, port: number) => {
      await page.waitForTimeout(500);
      return page.evaluate(([t, n]) => {
        const m = JSON.parse(localStorage.getItem('loop-lab:block-studio') ?? '{}');
        return (m.wires ?? []).filter((w: { toBlock: string; toPort: number }) => w.toBlock === t && w.toPort === n).map((w: { fromBlock: string }) => w.fromBlock);
      }, [to, port] as const);
    };
    expect(await feeds('scope', 2)).toEqual(['sat']);
    await page.locator('[data-block="ref"] [data-port="out:0"]').tap();
    await page.locator('[data-block="scope"] [data-port="in:2"]').tap();
    expect(await feeds('scope', 2)).toEqual(['ref']);
    // The port is a finger-sized target.
    const port = (await page.locator('[data-block="pid"] [data-port="out:0"]').boundingBox())!;
    expect(port.width).toBeGreaterThanOrEqual(26);
  });

  test('saved diagrams and a shared link', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'desktop');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await freshStudio(page);
    await page.getByRole('button', { name: /Cascade Control Loop/ }).click();
    await page.getByRole('button', { name: /Saved/ }).click();
    await page.getByLabel('Save this diagram as').fill('Test cascade');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Test cascade', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Share/ }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/loop-lab\/builder\?d=[A-Za-z0-9_-]+$/);
    // Something else in progress, then the link: it opens the cascade and keeps the other.
    await page.getByRole('button', { name: /Smith Predictor/ }).click();
    await page.waitForTimeout(500);
    await page.goto(link);
    await ready(page);
    await expect(page.locator('[data-block="pid2"]')).toHaveCount(1);
    await expect(page.getByText('Before the shared link')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    // The cascade opens on the bench.
    await page.getByRole('link', { name: /Open in Bench/ }).click();
    await expect(page.getByRole('combobox', { name: /Controller: Cascade control/ })).toBeVisible();
  });
});
