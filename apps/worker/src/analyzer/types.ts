import { z } from "zod";

// ============================================================================
// Scenario Definition Types
// ============================================================================

/**
 * Categories of scenarios that can be run
 */
export const scenarioCategorySchema = z.enum([
  "verification",
  "reschedule",
  "cancel",
  "billing",
  "escalation",
]);
export type ScenarioCategory = z.infer<typeof scenarioCategorySchema>;

/**
 * Expected tool call in a scenario step
 */
export const expectedToolCallSchema = z.object({
  name: z.string(),
  argsContain: z.record(z.unknown()).optional(),
});
export type ExpectedToolCall = z.infer<typeof expectedToolCallSchema>;

/**
 * Expectations for a scenario step outcome
 */
export const stepExpectationsSchema = z.object({
  /** Expected tool calls during this step */
  toolCalls: z.array(expectedToolCallSchema).optional(),
  /** Expected state changes after this step */
  stateChanges: z.record(z.unknown()).optional(),
  /** Patterns the response should contain */
  responsePatterns: z.array(z.string()).optional(),
  /** Patterns the response should NOT contain */
  responseExcludes: z.array(z.string()).optional(),
});
export type StepExpectations = z.infer<typeof stepExpectationsSchema>;

/**
 * A single step in a scenario
 */
export const scenarioStepSchema = z.object({
  /** User message to send */
  userMessage: z.string(),
  /** Expected outcomes for this step */
  expectations: stepExpectationsSchema,
});
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;

/**
 * Setup configuration for a scenario
 */
export const scenarioSetupSchema = z.object({
  /** Phone number to use for the conversation */
  phone: z.string(),
  /** ZIP code for verification */
  zip: z.string(),
  /** Whether to seed a customer before running (defaults to true if seedAppointment is true) */
  seedCustomer: z.boolean().optional(),
  /** Whether to seed an appointment before running */
  seedAppointment: z.boolean().optional(),
  /** Customer ID to use (for seeding) */
  customerId: z.string().optional(),
  /** Appointment ID to use (for seeding) */
  appointmentId: z.string().optional(),
});
export type ScenarioSetup = z.infer<typeof scenarioSetupSchema>;

/**
 * Success criteria for a scenario
 */
export const successCriteriaSchema = z.object({
  /** Expected final state values */
  finalState: z.record(z.unknown()).optional(),
  /** Minimum number of steps that must pass */
  minPassingSteps: z.number().optional(),
});
export type SuccessCriteria = z.infer<typeof successCriteriaSchema>;

/**
 * Complete scenario definition
 */
export const scenarioDefinitionSchema = z.object({
  /** Unique scenario identifier */
  id: z.string(),
  /** Human-readable name */
  name: z.string(),
  /** Description of what the scenario tests */
  description: z.string(),
  /** Scenario category */
  category: scenarioCategorySchema,
  /** Setup configuration */
  setup: scenarioSetupSchema,
  /** Steps to execute */
  steps: z.array(scenarioStepSchema),
  /** Success criteria */
  successCriteria: successCriteriaSchema,
});
export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * Result of checking a single expectation
 */
export const expectationResultSchema = z.object({
  /** Type of expectation checked */
  type: z.enum([
    "toolCall",
    "stateChange",
    "responsePattern",
    "responseExclude",
  ]),
  /** Whether the expectation passed */
  passed: z.boolean(),
  /** Description of what was expected */
  expected: z.string(),
  /** What was actually observed */
  actual: z.string().optional(),
  /** Additional context */
  details: z.string().optional(),
});
export type ExpectationResult = z.infer<typeof expectationResultSchema>;

/**
 * Result of executing a single step
 */
export const stepResultSchema = z.object({
  /** Step index (0-based) */
  stepIndex: z.number(),
  /** User message sent */
  userMessage: z.string(),
  /** Bot response received */
  botResponse: z.string(),
  /** Tool calls that occurred */
  toolCalls: z.array(
    z.object({
      name: z.string(),
      args: z.record(z.unknown()),
    }),
  ),
  /** State after this step */
  stateSnapshot: z.record(z.unknown()),
  /** Expectation check results */
  expectationResults: z.array(expectationResultSchema),
  /** Whether all expectations passed */
  passed: z.boolean(),
  /** Duration in milliseconds */
  durationMs: z.number(),
  /** Error if step failed to execute */
  error: z.string().optional(),
});
export type StepResult = z.infer<typeof stepResultSchema>;

/**
 * Result of running a complete scenario
 */
export const scenarioResultSchema = z.object({
  /** Scenario that was run */
  scenarioId: z.string(),
  /** Conversation ID used */
  conversationId: z.string(),
  /** Results for each step */
  stepResults: z.array(stepResultSchema),
  /** Whether the scenario passed overall */
  passed: z.boolean(),
  /** Number of steps that passed */
  passedSteps: z.number(),
  /** Total number of steps */
  totalSteps: z.number(),
  /** Total duration in milliseconds */
  totalDurationMs: z.number(),
  /** Error if scenario failed to complete */
  error: z.string().optional(),
  /** Timestamp when the scenario started */
  startedAt: z.string(),
  /** Timestamp when the scenario completed */
  completedAt: z.string(),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Category scores from AI analysis
 */
export const categoryScoresSchema = z.object({
  /** Did the bot do what it should? (0-100) */
  accuracy: z.number().min(0).max(100),
  /** Was the conversation natural? (0-100) */
  naturalness: z.number().min(0).max(100),
  /** Were minimum steps used? (0-100) */
  efficiency: z.number().min(0).max(100),
  /** Were best practices followed? (0-100) */
  bestPractices: z.number().min(0).max(100),
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;

/**
 * Finding category from AI analysis
 */
export const findingCategorySchema = z.enum([
  "strength",
  "improvement",
  "violation",
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

/**
 * Severity level for findings
 */
export const findingSeveritySchema = z.enum(["low", "medium", "high"]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

/**
 * Individual finding from AI analysis
 */
export const analysiseFindingSchema = z.object({
  /** Category of finding */
  category: findingCategorySchema,
  /** Severity (for improvements/violations) */
  severity: findingSeveritySchema.optional(),
  /** Step index this finding relates to */
  stepIndex: z.number().optional(),
  /** Description of the finding */
  description: z.string(),
  /** Reference to best practice (e.g., "P1", "A2") */
  bestPracticeRef: z.string().optional(),
});
export type AnalysisFinding = z.infer<typeof analysiseFindingSchema>;

/**
 * Complete AI analysis result
 */
export const analysisResultSchema = z.object({
  /** Overall score (0-100) */
  overallScore: z.number().min(0).max(100),
  /** Scores by category */
  categoryScores: categoryScoresSchema,
  /** Detailed findings */
  findings: z.array(analysiseFindingSchema),
  /** Summary of the analysis */
  summary: z.string(),
  /** Recommendations for improvement */
  recommendations: z.array(z.string()),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// ============================================================================
// Combined Result Types
// ============================================================================

/**
 * Complete result with scenario execution and AI analysis
 */
export const fullResultSchema = z.object({
  /** Scenario execution result */
  execution: scenarioResultSchema,
  /** AI analysis result (if enabled) */
  analysis: analysisResultSchema.optional(),
});
export type FullResult = z.infer<typeof fullResultSchema>;

// ============================================================================
// API Input/Output Schemas
// ============================================================================

export const listScenariosInputSchema = z.object({
  category: scenarioCategorySchema.optional(),
});
export type ListScenariosInput = z.infer<typeof listScenariosInputSchema>;

export const listScenariosOutputSchema = z.object({
  scenarios: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: scenarioCategorySchema,
      stepCount: z.number(),
    }),
  ),
});
export type ListScenariosOutput = z.infer<typeof listScenariosOutputSchema>;

export const runScenarioInputSchema = z.object({
  scenarioId: z.string(),
  /** Whether to include AI analysis */
  includeAnalysis: z.boolean().optional().default(true),
  /** Base URL to run against (defaults to same worker) */
  baseUrl: z.string().optional(),
});
export type RunScenarioInput = z.infer<typeof runScenarioInputSchema>;

export const runScenarioOutputSchema = fullResultSchema;
export type RunScenarioOutput = z.infer<typeof runScenarioOutputSchema>;

export const runCategoryInputSchema = z.object({
  category: scenarioCategorySchema,
  /** Whether to include AI analysis */
  includeAnalysis: z.boolean().optional().default(true),
  /** Base URL to run against (defaults to same worker) */
  baseUrl: z.string().optional(),
});
export type RunCategoryInput = z.infer<typeof runCategoryInputSchema>;

export const runCategoryOutputSchema = z.object({
  results: z.array(fullResultSchema),
  summary: z.object({
    totalScenarios: z.number(),
    passed: z.number(),
    failed: z.number(),
    averageScore: z.number().optional(),
  }),
});
export type RunCategoryOutput = z.infer<typeof runCategoryOutputSchema>;

/**
 * Input for evaluating a completed scenario result
 */
export const evaluateInputSchema = z.object({
  /** Scenario definition */
  scenario: scenarioDefinitionSchema,
  /** Scenario execution result */
  result: scenarioResultSchema,
});
export type EvaluateInput = z.infer<typeof evaluateInputSchema>;

/**
 * Output of AI evaluation
 */
export const evaluateOutputSchema = analysisResultSchema;
export type EvaluateOutput = z.infer<typeof evaluateOutputSchema>;
