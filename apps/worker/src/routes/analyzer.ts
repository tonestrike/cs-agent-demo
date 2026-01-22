import { ORPCError } from "@orpc/server";

import { ConversationEvaluator } from "../analyzer/evaluator";
import { ScenarioRunner } from "../analyzer/runner";
import {
  getScenario,
  getScenariosByCategory,
  listScenarios,
} from "../analyzer/scenarios";
import type {
  AnalysisResult,
  FullResult,
  ScenarioCategory,
} from "../analyzer/types";
import { authedProcedure } from "../middleware/auth";
import {
  evaluateInputSchema,
  evaluateOutputSchema,
  listScenariosInputSchema,
  listScenariosOutputSchema,
  runCategoryInputSchema,
  runCategoryOutputSchema,
  runScenarioInputSchema,
  runScenarioOutputSchema,
} from "../schemas/analyzer";

/**
 * Analyzer routes for running conversation scenarios and AI analysis
 */
export const analyzerProcedures = {
  /**
   * Evaluate a scenario result using AI analysis.
   * This endpoint allows CLI/local mode to call for AI analysis after running scenarios.
   */
  evaluate: authedProcedure
    .input(evaluateInputSchema)
    .output(evaluateOutputSchema)
    .handler(async ({ input, context }) => {
      const logger = context.deps.logger.child({
        route: "analyzer.evaluate",
      });
      logger.info(
        { scenarioId: input.scenario.id },
        "Starting AI evaluation of scenario result",
      );

      if (!context.env.AI) {
        logger.error("AI binding not available");
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "AI binding not available for evaluation",
        });
      }

      const evaluator = new ConversationEvaluator({
        ai: context.env.AI,
        verbose: false,
        logger,
        anthropicApiKey: context.env.ANTHROPIC_API_KEY,
        anthropicBaseUrl: context.env.ANTHROPIC_BASE_URL,
      });

      const analysis = await evaluator.analyze(input.scenario, input.result);

      logger.info(
        {
          scenarioId: input.scenario.id,
          overallScore: analysis.overallScore,
          findings: analysis.findings.length,
        },
        "AI evaluation complete",
      );

      return analysis;
    }),

  /**
   * List available scenarios
   */
  listScenarios: authedProcedure
    .input(listScenariosInputSchema)
    .output(listScenariosOutputSchema)
    .handler(async ({ input, context }) => {
      const logger = context.deps.logger.child({
        route: "analyzer.listScenarios",
      });
      logger.info({ category: input.category }, "Listing scenarios");

      const scenarios = listScenarios({
        category: input.category,
      });

      logger.info({ count: scenarios.length }, "Found scenarios");
      return { scenarios };
    }),

  /**
   * Run a single scenario with optional AI analysis
   */
  runScenario: authedProcedure
    .input(runScenarioInputSchema)
    .output(runScenarioOutputSchema)
    .handler(async ({ input, context }) => {
      const logger = context.deps.logger.child({
        route: "analyzer.runScenario",
      });
      logger.info({ scenarioId: input.scenarioId }, "Starting scenario run");

      const scenario = getScenario(input.scenarioId);

      if (!scenario) {
        logger.warn({ scenarioId: input.scenarioId }, "Scenario not found");
        throw new ORPCError("NOT_FOUND", {
          message: `Scenario not found: ${input.scenarioId}`,
        });
      }

      // Determine base URL - use provided or default to remote
      const baseUrl =
        input.baseUrl ?? "https://pestcall-worker.tonyvantur.workers.dev";
      logger.info(
        { baseUrl, scenarioName: scenario.name, steps: scenario.steps.length },
        "Running scenario",
      );

      // Create runner
      const runner = new ScenarioRunner({
        baseUrl,
        authToken: context.env.DEMO_AUTH_TOKEN,
        verbose: false,
        logger,
      });

      // Run the scenario
      const execution = await runner.runScenario(scenario);

      logger.info(
        {
          scenarioId: scenario.id,
          passed: execution.passed,
          passedSteps: execution.passedSteps,
          totalSteps: execution.totalSteps,
          durationMs: execution.totalDurationMs,
        },
        "Scenario execution complete",
      );

      // Optionally run AI analysis
      let analysis: AnalysisResult | undefined;
      if (input.includeAnalysis !== false && context.env.AI) {
        logger.info({ scenarioId: scenario.id }, "Starting AI analysis");

        const evaluator = new ConversationEvaluator({
          ai: context.env.AI,
          verbose: false,
          logger,
          anthropicApiKey: context.env.ANTHROPIC_API_KEY,
          anthropicBaseUrl: context.env.ANTHROPIC_BASE_URL,
        });

        analysis = await evaluator.analyze(scenario, execution);

        logger.info(
          {
            scenarioId: scenario.id,
            overallScore: analysis.overallScore,
            findings: analysis.findings.length,
          },
          "AI analysis complete",
        );
      }

      logger.info(
        { scenarioId: scenario.id, passed: execution.passed },
        "Scenario run finished",
      );

      return {
        execution,
        analysis,
      };
    }),

  /**
   * Run all scenarios in a category
   */
  runCategory: authedProcedure
    .input(runCategoryInputSchema)
    .output(runCategoryOutputSchema)
    .handler(async ({ input, context }) => {
      const logger = context.deps.logger.child({
        route: "analyzer.runCategory",
      });
      logger.info({ category: input.category }, "Starting category run");

      const scenarios = getScenariosByCategory(
        input.category as ScenarioCategory,
      );

      if (scenarios.length === 0) {
        logger.warn(
          { category: input.category },
          "No scenarios found in category",
        );
        throw new ORPCError("NOT_FOUND", {
          message: `No scenarios found in category: ${input.category}`,
        });
      }

      // Determine base URL - use provided or default to remote
      const baseUrl =
        input.baseUrl ?? "https://pestcall-worker.tonyvantur.workers.dev";
      logger.info(
        { baseUrl, category: input.category, scenarioCount: scenarios.length },
        "Running category scenarios",
      );

      // Create runner and evaluator
      const runner = new ScenarioRunner({
        baseUrl,
        authToken: context.env.DEMO_AUTH_TOKEN,
        verbose: false,
        logger,
      });

      let evaluator: ConversationEvaluator | undefined;
      if (input.includeAnalysis !== false && context.env.AI) {
        evaluator = new ConversationEvaluator({
          ai: context.env.AI,
          verbose: false,
          logger,
          anthropicApiKey: context.env.ANTHROPIC_API_KEY,
          anthropicBaseUrl: context.env.ANTHROPIC_BASE_URL,
        });
      }

      // Run all scenarios
      const results: FullResult[] = [];
      let totalScore = 0;
      let scoreCount = 0;

      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        if (!scenario) continue;

        logger.info(
          { scenarioId: scenario.id, index: i + 1, total: scenarios.length },
          "Starting scenario",
        );

        const execution = await runner.runScenario(scenario);

        logger.info(
          {
            scenarioId: scenario.id,
            passed: execution.passed,
            passedSteps: execution.passedSteps,
            totalSteps: execution.totalSteps,
          },
          "Scenario execution complete",
        );

        let analysis: AnalysisResult | undefined;
        if (evaluator) {
          logger.info({ scenarioId: scenario.id }, "Running AI analysis");
          analysis = await evaluator.analyze(scenario, execution);
          totalScore += analysis.overallScore;
          scoreCount += 1;
          logger.info(
            { scenarioId: scenario.id, overallScore: analysis.overallScore },
            "AI analysis complete",
          );
        }

        results.push({
          execution,
          analysis,
        });
      }

      const passed = results.filter((r) => r.execution.passed).length;
      const failed = results.length - passed;
      const averageScore =
        scoreCount > 0 ? Math.round(totalScore / scoreCount) : undefined;

      logger.info(
        {
          category: input.category,
          totalScenarios: results.length,
          passed,
          failed,
          averageScore,
        },
        "Category run complete",
      );

      return {
        results,
        summary: {
          totalScenarios: results.length,
          passed,
          failed,
          averageScore,
        },
      };
    }),
};
