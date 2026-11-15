import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {test: {name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node'}},
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/db/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // One shared local database; files run one after another.
          fileParallelism: false,
        },
      },
    ],
  },
});
