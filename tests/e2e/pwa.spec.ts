import {expect, test} from '@playwright/test';

test.describe('installable app per studio', () => {
  test('own worker scope, manifest and caches; opens offline', async ({page, context}) => {
    await page.goto('/s/graphite/');
    await expect(page.getByRole('heading', {level: 1, name: 'GRAPHITE Detailing'})).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {timeout: 20_000}).catch(async () => {
      await page.reload(); // first visit: the worker takes control after install
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    });
    const info = await page.evaluate(async () => ({
      scopes: (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname),
      caches: await caches.keys(),
    }));
    expect(info.scopes).toContain('/s/graphite/');
    expect(info.caches.some(c => c.startsWith('studio-graphite-'))).toBe(true);
    expect(info.caches.some(c => c.startsWith('studio-severny-'))).toBe(false);

    const manifest = await (await page.request.get('/s/graphite/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({id: '/s/graphite/', scope: '/s/graphite/', display: 'standalone'});

    // One online load under the worker's control puts the public studio card into its cache.
    await page.reload();
    await expect(page.getByRole('heading', {level: 1, name: 'GRAPHITE Detailing'})).toBeVisible();
    await page.waitForFunction(async () => (await caches.keys()).includes('studio-graphite-public'));

    // Offline: the shell and the public studio card come from this studio's cache
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', {level: 1, name: 'GRAPHITE Detailing'})).toBeVisible();
    await context.setOffline(false);
  });

  test('deep links return the right studio shell', async ({request}) => {
    for (const [slug, name] of [
      ['graphite', 'GRAPHITE Detailing'],
      ['severny', 'Северный Бокс'],
    ]) {
      const html = await (await request.get(`/s/${slug}/my`, {headers: {accept: 'text/html'}})).text();
      expect(html).toContain(`/s/${slug}/manifest.webmanifest`);
      expect(html).toContain(name);
    }
  });
});

test.describe('motion and glass', () => {
  test('reduced motion: sections are visible without animation', async ({browser}, info) => {
    const ctx = await browser.newContext({...info.project.use, reducedMotion: 'reduce'});
    const page = await ctx.newPage();
    await page.goto('/s/graphite/');
    const section = page.getByRole('region', {name: 'Наши работы'});
    const style = await section.evaluate(el => ({opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform}));
    expect(style).toEqual({opacity: '1', transform: 'none'});
    await ctx.close();
  });

  test('glass lens refracts only the hero photo; the button stays clickable', async ({page}) => {
    await page.goto('/s/graphite/');
    const button = page.getByRole('button', {name: 'Записаться', exact: true});
    await expect(button).toBeVisible();
    const hit = await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el.contains(top);
    });
    expect(hit).toBe(true);
    // The lens target is decorative and sits under the button
    const lens = page.locator('[data-glass="hero-cta"]');
    await expect(lens).toHaveAttribute('aria-hidden', 'true');
    // Scroll: the button moves with the photo (not fixed to the viewport)
    const before = (await button.boundingBox())!.y;
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);
    const after = (await button.boundingBox())!.y;
    expect(before - after).toBeGreaterThan(200);
  });
});
