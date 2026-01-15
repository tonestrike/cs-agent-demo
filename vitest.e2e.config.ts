import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "e2e",
    include: ["apps/worker/src/**/*.e2e.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
  },
});
