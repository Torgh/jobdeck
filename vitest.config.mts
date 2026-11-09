import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./"),
      "server-only": root("./test/server-only.ts"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "mcp/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
