import {expect, test} from '@playwright/test';

/**
 * Layout contract (src/components/layout/Page.tsx): nothing scrolls sideways;
 * every section heading starts on one content line. Phones: the hero title and
 * button share that line and the button spans the column. Wide screens: the
 * hero is a card on the column; title and button share its inner line and the
 * button spans the card.
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
        const card = document.querySelector('[data-hero-card]');
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: left(document.querySelector('h1')),
          cta: left(cta),
          ctaWidth: Math.round(cta?.getBoundingClientRect().width ?? 0),
          columnWidth: Math.round(column?.getBoundingClientRect().width ?? 0),
          card: left(card),
          cardWidth: Math.round(card?.getBoundingClientRect().width ?? 0),
          h2,
        };
      });
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.cta).toBe(m.h1);
      if (width < 900) {
        // Full-bleed hero: title, button and every section heading on one line; the button spans the column.
        expect(new Set(m.h2)).toEqual(new Set([m.h1]));
        expect(m.ctaWidth).toBeGreaterThanOrEqual(m.columnWidth - 1);
      } else {
        // Hero card on the column: sections start at the card edge, the button spans the card inset evenly.
        expect(m.cardWidth).toBeGreaterThanOrEqual(m.columnWidth - 1);
        expect(new Set(m.h2)).toEqual(new Set([m.card]));
        expect(m.ctaWidth).toBe(m.cardWidth - 2 * (m.h1 - m.card));
      }
    });
  }

  for (const width of [360, 1440]) {
    test(`my booking @ ${width}px: title, section and card share the line`, async ({page}) => {
      await page.setViewportSize({width, height: 900});
      await page.goto('/s/graphite/my');
      await expect(page.getByRole('heading', {name: 'Записей пока нет'})).toBeVisible();
      const m = await page.evaluate(() => {
        const left = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().left) : -1);
        const button = [...document.querySelectorAll('main button')].find(b => b.textContent?.includes('Выбрать услугу и время'));
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: left(document.querySelector('main h1')),
          h2: left(document.querySelector('main h2')),
          card: left(button?.closest('.astryx-card') ?? null),
        };
      });
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.h2).toBe(m.h1);
      expect(m.card).toBe(m.h1);
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
