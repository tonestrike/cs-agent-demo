import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersProject({
  test: {
    name: "workers",
    include: [
      "apps/worker/src/**/*.test.ts",
      "!apps/worker/src/**/*.node.test.ts",
    ],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./apps/worker/wrangler.toml",
        },
        miniflare: {
          modules: true,
        },
      },
    },
  },
});
