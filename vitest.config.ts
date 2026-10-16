import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/db/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Files share one database; each creates its own isolated studio.
          fileParallelism: false,
        },
      },
    ],
  },
});
