import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "e2e",
    include: ["**/*.e2e.node.test.ts"],
    environment: "node",
  },
});
