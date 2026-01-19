/**
 * Conversation Analyzer
 *
 * A system for running predefined scenarios through the bot,
 * evaluating outcomes, and analyzing conversations against
 * documented best practices using AI.
 */

// Types
export type {
  ScenarioCategory,
  ExpectedToolCall,
  StepExpectations,
  ScenarioStep,
  ScenarioSetup,
  SuccessCriteria,
  ScenarioDefinition,
  ExpectationResult,
  StepResult,
  ScenarioResult,
  CategoryScores,
  FindingCategory,
  FindingSeverity,
  AnalysisFinding,
  AnalysisResult,
  FullResult,
  ListScenariosInput,
  ListScenariosOutput,
  RunScenarioInput,
  RunScenarioOutput,
  RunCategoryInput,
  RunCategoryOutput,
} from "./types";

// Schemas (for validation)
export {
  scenarioCategorySchema,
  expectedToolCallSchema,
  stepExpectationsSchema,
  scenarioStepSchema,
  scenarioSetupSchema,
  successCriteriaSchema,
  scenarioDefinitionSchema,
  expectationResultSchema,
  stepResultSchema,
  scenarioResultSchema,
  categoryScoresSchema,
  findingCategorySchema,
  findingSeveritySchema,
  analysiseFindingSchema,
  analysisResultSchema,
  fullResultSchema,
  listScenariosInputSchema,
  listScenariosOutputSchema,
  runScenarioInputSchema,
  runScenarioOutputSchema,
  runCategoryInputSchema,
  runCategoryOutputSchema,
} from "./types";

// Scenario runner
export { ScenarioRunner } from "./runner";

// AI evaluator
export { ConversationEvaluator } from "./evaluator";

// Best practices
export { loadBestPractices } from "./best-practices";

// Scenario registry
export { scenarioRegistry, getScenario, listScenarios } from "./scenarios";
