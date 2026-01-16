import type { Logger } from "../logger";
import type { ModelAdapter } from "./types";

export const createHybridModelAdapter = (
  workersAdapter: ModelAdapter,
  openrouterAdapter: ModelAdapter,
  logger: Logger,
): ModelAdapter => {
  return {
    name: "hybrid",
    modelId: `workers-ai:${workersAdapter.modelId ?? "default"}|openrouter:${
      openrouterAdapter.modelId ?? "default"
    }`,
    generate: workersAdapter.generate,
    route: workersAdapter.route,
    selectOption: workersAdapter.selectOption,
    status: workersAdapter.status,
    respondStream: async function* (input) {
      if (openrouterAdapter.respondStream) {
        try {
          for await (const token of openrouterAdapter.respondStream(input)) {
            yield token;
          }
          return;
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : "unknown",
              openrouterModelId: openrouterAdapter.modelId ?? null,
              workersModelId: workersAdapter.modelId ?? null,
            },
            "agent.respond.stream.fallback",
          );
        }
      }
      const text = await workersAdapter.respond(input);
      if (text) {
        yield text;
      }
    },
    respond: async (input) => {
      try {
        return await openrouterAdapter.respond(input);
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : "unknown",
            openrouterModelId: openrouterAdapter.modelId ?? null,
            workersModelId: workersAdapter.modelId ?? null,
          },
          "agent.respond.fallback",
        );
        return await workersAdapter.respond(input);
      }
    },
  };
};
