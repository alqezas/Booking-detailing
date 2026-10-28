import {execFileSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {env} from './helpers.ts';

/**
 * The tyre-service SQL checks (price matrix = TS quote, calculator slots,
 * seasonal posts and horizon, plates, tyre hotel, walk-ins) live in one
 * script that can also run against the cloud database inside a rolled-back
 * transaction; here it runs against the local stack.
 */
describe('tyre service SQL', () => {
  it('passes tests/integration/tire-sql-check.ts', () => {
    const out = execFileSync('npx', ['tsx', 'tests/integration/tire-sql-check.ts', '--db', env().db], {encoding: 'utf8', shell: process.platform === 'win32'});
    expect(out).toContain('all checks passed');
  }, 120_000);
});
