import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.node.test.ts"],
    environment: "node",
  },
});
