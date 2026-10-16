import {expect, test} from '@playwright/test';

/**
 * Layout contract (src/components/layout/Page.tsx): at every width the hero
 * title, the hero button and every section heading start on one content line,
 * the button spans the column, nothing scrolls sideways.
 */
const WIDTHS = [360, 390, 768, 1024, 1440];

test.describe('one content line at every width', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'viewport is set explicitly; one project is enough'));

  for (const width of WIDTHS) {
    test(`home @ ${width}px`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await page.goto('/s/graphite/');
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      const m = await page.evaluate(() => {
        const left = (el: Element | null | undefined) => (el ? Math.round(el.getBoundingClientRect().left) : -1);
        const cta = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Записаться');
        const h2 = [...document.querySelectorAll('main h2')].filter(h => h.getBoundingClientRect().width > 0).map(left);
        const column = document.querySelector('main h2')?.closest('.astryx-section')?.parentElement;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: left(document.querySelector('h1')),
          cta: left(cta),
          ctaWidth: Math.round(cta?.getBoundingClientRect().width ?? 0),
          columnWidth: Math.round(column?.getBoundingClientRect().width ?? 0),
          h2,
        };
      });
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.cta).toBe(m.h1);
      // Sections follow one another: every heading sits on the same content line.
      expect(new Set(m.h2)).toEqual(new Set([m.h1]));
      // The hero button spans the whole column.
      expect(m.ctaWidth).toBeGreaterThanOrEqual(m.columnWidth - 1);
    });
  }

  test('cabinet login fits phone and desktop', async ({page}) => {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({width, height: 900});
      await page.goto('/s/graphite/owner/login');
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `login @ ${width}`).toBeLessThanOrEqual(0);
    }
  });
});
