import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  css: {
    postcss: {},
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'worker/**/tests/**/*.test.ts',
      'sdk/ts/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@pai/email-shared': resolve(__dirname, './worker/shared/src'),
    },
  },
});