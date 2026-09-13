import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/golden/**/*.test.ts',
      'test/cli/**/*.test.ts',
      'test/helpers/**/*.test.ts',
    ],
    passWithNoTests: false,
    restoreMocks: true,
    maxWorkers: 2,
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
