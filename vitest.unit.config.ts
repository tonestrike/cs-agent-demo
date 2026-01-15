import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "unit",
    include: ["**/*.unit.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
  },
});
