import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['sdk/**/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['sdk/**/src/**/*.ts', 'server/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
