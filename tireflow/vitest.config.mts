import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"], environment: "node" } },
      // needs `pnpm db:start` + `pnpm db:reset` (local Supabase with demo seed)
      { resolve: { alias }, test: { name: "db", include: ["tests/db/**/*.test.ts"], environment: "node", testTimeout: 30000, fileParallelism: false } },
    ],
  },
});
