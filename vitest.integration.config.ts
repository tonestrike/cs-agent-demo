import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "integration",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
  },
});
