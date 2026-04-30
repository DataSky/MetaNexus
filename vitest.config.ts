import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';


export default defineConfig({
  resolve: {
    alias: {
      tweetnacl: fileURLToPath(new URL('node_modules/tweetnacl/nacl-fast.js', import.meta.url)),
      zod: fileURLToPath(new URL('node_modules/zod/index.js', import.meta.url)),
    },
  },
  test: {
    include: ['sdk/**/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['sdk/**/src/**/*.ts', 'server/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
