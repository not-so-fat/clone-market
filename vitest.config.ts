import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cache: false,
    include: ["packages/**/*.test.ts", "fixtures/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: { enabled: false },
  },
});
