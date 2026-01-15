import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersProject({
  test: {
    name: "workers",
    include: ["apps/worker/src/**/*.worker.test.ts"],
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
