import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    env: { NODE_ENV: 'test', DB_NAME: 'nexgen_hms_test', LOG_LEVEL: 'silent' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: ['default', ['json', { outputFile: '../docs/qa/test-results.json' }]],
  },
});
