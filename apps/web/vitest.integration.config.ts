import { defineConfig } from 'vitest/config'
import base from './vite.config.ts'

// Frontend ↔ Rust API integration tests (start the real server in global setup).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/integration/**/*.test.{ts,tsx}'],
    globalSetup: ['./tests/integration/global-setup.ts'],
    environment: 'jsdom',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
