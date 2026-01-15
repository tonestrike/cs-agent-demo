import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "node",
    include: [
      "packages/**/*.unit.test.ts",
      "packages/**/*.integration.test.ts",
      "apps/**/*.unit.test.ts",
      "apps/**/*.integration.test.ts",
    ],
    exclude: ["**/*.e2e.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
