import {describe, expect, it} from 'vitest';
import {MAX_COLS, MIN_COLS, colsForPinch, liveScale} from '../../src/lib/gridZoom.ts';

describe('liveScale', () => {
  it('follows the fingers between steps', () => {
    expect(liveScale(2, 0.8)).toBeCloseTo(0.8);
    expect(liveScale(2, 1.5)).toBeCloseTo(1.5);
  });
  it('only stretches a little at 1 and 4 per row', () => {
    expect(liveScale(1, 2)).toBeLessThanOrEqual(1.05);
    expect(liveScale(4, 0.3)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('colsForPinch', () => {
  it('pinching in adds one column per gesture, up to 4', () => {
    expect(colsForPinch(1, 0.5)).toBe(2);
    expect(colsForPinch(2, 0.79)).toBe(3);
    expect(colsForPinch(MAX_COLS, 0.3)).toBe(MAX_COLS);
  });
  it('spreading fingers removes one column per gesture, down to 1', () => {
    expect(colsForPinch(4, 2)).toBe(3);
    expect(colsForPinch(2, 1.25)).toBe(1);
    expect(colsForPinch(MIN_COLS, 3)).toBe(MIN_COLS);
  });
  it('small finger movement keeps the grid as is', () => {
    expect(colsForPinch(2, 0.9)).toBe(2);
    expect(colsForPinch(2, 1.1)).toBe(2);
  });
});
