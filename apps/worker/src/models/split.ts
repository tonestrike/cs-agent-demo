import type { Logger } from "../logger";
import type { ModelAdapter } from "./types";

export const createSplitModelAdapter = (
  interpreter: ModelAdapter,
  narrator: ModelAdapter,
  logger: Logger,
): ModelAdapter => {
  return {
    name: "split",
    modelId: `interpreter:${interpreter.modelId ?? "default"}|narrator:${
      narrator.modelId ?? "default"
    }`,
    generate: interpreter.generate,
    route: interpreter.route,
    selectOption: interpreter.selectOption,
    status: interpreter.status,
    respondStream: async function* (input) {
      if (narrator.respondStream) {
        try {
          for await (const token of narrator.respondStream(input)) {
            yield token;
          }
          return;
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : "unknown",
              narratorModelId: narrator.modelId ?? null,
              interpreterModelId: interpreter.modelId ?? null,
            },
            "agent.respond.stream.fallback",
          );
        }
      }
      const text = await narrator.respond(input);
      if (text) {
        yield text;
      }
    },
    respond: async (input) => {
      try {
        return await narrator.respond(input);
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : "unknown",
            narratorModelId: narrator.modelId ?? null,
            interpreterModelId: interpreter.modelId ?? null,
          },
          "agent.respond.fallback",
        );
        return await interpreter.respond(input);
      }
    },
  };
};
