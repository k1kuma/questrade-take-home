import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Upstream-call and failure logs are useful when a test fails, noise when it passes.
    silent: 'passed-only',
  },
});
