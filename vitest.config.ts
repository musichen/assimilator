import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/cli/test/**/*.test.ts",
      "apps/telegram/test/**/*.test.ts",
      "packages/webscraping/tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"]
  }
});
