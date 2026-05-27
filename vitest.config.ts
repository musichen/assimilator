import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"]
  }
});
