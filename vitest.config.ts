import { defineConfig } from 'vitest/config'

// Playwright의 e2e/*.spec.ts와 겹치지 않도록, vitest는 *.test.ts만 단위테스트로 다룬다.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
})
