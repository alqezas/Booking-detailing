import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {env} from './helpers.ts';

/**
 * The car-wash SQL checks (price list = TS quote, peak hours, passes,
 * plates, walk-ins and the regression of other studios) live in one
 * script that can also run against the cloud database inside a rolled-back
 * transaction; here it runs against the local stack.
 */
describe('car wash SQL', () => {
  it('passes tests/integration/wash-sql-check.ts', () => {
    const out = execFileSync('npx', ['tsx', 'tests/integration/wash-sql-check.ts', '--db', env().db], {encoding: 'utf8', shell: process.platform === 'win32'});
    expect(out).toContain('all checks passed');
  }, 120_000);
});
