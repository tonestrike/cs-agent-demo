import type { Ai, AiModels } from "@cloudflare/workers-types";
import { z } from "zod";

import type { Logger } from "../logger";
import { loadBestPractices } from "./best-practices";
import type {
  AnalysisFinding,
  AnalysisResult,
  ScenarioDefinition,
  ScenarioResult,
  StepResult,
} from "./types";

/**
 * Configuration for the conversation evaluator
 */
export type EvaluatorConfig = {
  /** Workers AI binding */
  ai: Ai;
  /** Model to use for analysis (default: llama-3.3-70b) */
  model?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Logger instance */
  logger?: Logger;
};

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Schema for the AI analysis response
 */
const aiAnalysisResponseSchema = z.object({
  overallScore: z.number().min(0).max(100),
  categoryScores: z.object({
    accuracy: z.number().min(0).max(100),
    naturalness: z.number().min(0).max(100),
    efficiency: z.number().min(0).max(100),
    bestPractices: z.number().min(0).max(100),
  }),
  findings: z.array(
    z.object({
      category: z.enum(["strength", "improvement", "violation"]),
      severity: z.enum(["low", "medium", "high"]).optional(),
      stepIndex: z.number().optional(),
      description: z.string(),
      bestPracticeRef: z.string().optional(),
    }),
  ),
  summary: z.string(),
  recommendations: z.array(z.string()),
});

/**
 * JSON schema for structured output
 */
const analysisJsonSchema = {
  type: "object",
  properties: {
    overallScore: { type: "number" },
    categoryScores: {
      type: "object",
      properties: {
        accuracy: { type: "number" },
        naturalness: { type: "number" },
        efficiency: { type: "number" },
        bestPractices: { type: "number" },
      },
      required: ["accuracy", "naturalness", "efficiency", "bestPractices"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["strength", "improvement", "violation"],
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          stepIndex: { type: "integer" },
          description: { type: "string" },
          bestPracticeRef: { type: "string" },
        },
        required: ["category", "description"],
      },
    },
    summary: { type: "string" },
    recommendations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "overallScore",
    "categoryScores",
    "findings",
    "summary",
    "recommendations",
  ],
};

/**
 * ConversationEvaluator - Uses AI to analyze conversation quality
 */
export class ConversationEvaluator {
  private ai: Ai;
  private model: string;
  private verbose: boolean;
  private bestPractices: string;
  private logger?: Logger;

  constructor(config: EvaluatorConfig) {
    this.ai = config.ai;
    this.model = config.model ?? DEFAULT_MODEL;
    this.verbose = config.verbose ?? false;
    this.bestPractices = loadBestPractices();
    this.logger = config.logger;
  }

  private log(
    level: "info" | "debug" | "warn" | "error",
    data: Record<string, unknown>,
    message: string,
  ) {
    if (this.logger) {
      this.logger[level](data, message);
    } else if (this.verbose) {
      console.log(`[${level.toUpperCase()}] ${message}`, JSON.stringify(data));
    }
  }

  /**
   * Analyze a completed scenario
   */
  async analyze(
    scenario: ScenarioDefinition,
    result: ScenarioResult,
  ): Promise<AnalysisResult> {
    this.log(
      "info",
      { scenarioId: scenario.id, model: this.model },
      "Starting AI analysis",
    );

    const transcript = this.formatTranscript(result.stepResults);
    const prompt = this.buildAnalysisPrompt(scenario, transcript, result);

    this.log("debug", { promptLength: prompt.length }, "Analysis prompt built");

    try {
      this.log("info", { scenarioId: scenario.id }, "Calling Workers AI");

      const response = await this.ai.run(this.model as keyof AiModels, {
        messages: [
          {
            role: "system",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: analysisJsonSchema,
        },
        max_new_tokens: 2048,
        max_tokens: 2048,
        temperature: 0.3, // Lower temperature for more consistent analysis
      });

      this.log(
        "debug",
        { scenarioId: scenario.id },
        "Workers AI response received",
      );

      const parsed = this.parseResponse(response);

      this.log(
        "info",
        {
          scenarioId: scenario.id,
          overallScore: parsed.overallScore,
          findingsCount: parsed.findings.length,
          accuracy: parsed.categoryScores.accuracy,
          naturalness: parsed.categoryScores.naturalness,
          efficiency: parsed.categoryScores.efficiency,
          bestPractices: parsed.categoryScores.bestPractices,
        },
        "AI analysis complete",
      );

      return parsed;
    } catch (error) {
      // Return a fallback analysis if AI fails
      this.log(
        "error",
        { scenarioId: scenario.id, error: String(error) },
        "AI analysis failed, using fallback",
      );
      return this.generateFallbackAnalysis(result);
    }
  }

  /**
   * Format the conversation transcript for analysis
   */
  private formatTranscript(stepResults: StepResult[]): string {
    const lines: string[] = [];

    for (const step of stepResults) {
      lines.push(`[Step ${step.stepIndex + 1}]`);
      lines.push(`Customer: ${step.userMessage}`);
      lines.push(`Bot: ${step.botResponse}`);

      if (step.toolCalls.length > 0) {
        lines.push(
          `Tools used: ${step.toolCalls.map((tc) => tc.name).join(", ")}`,
        );
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Build the analysis prompt
   */
  private buildAnalysisPrompt(
    scenario: ScenarioDefinition,
    transcript: string,
    result: ScenarioResult,
  ): string {
    const expectationSummary = result.stepResults
      .map((step, i) => {
        const passCount = step.expectationResults.filter(
          (r) => r.passed,
        ).length;
        const totalCount = step.expectationResults.length;
        return `Step ${i + 1}: ${passCount}/${totalCount} expectations passed`;
      })
      .join("\n");

    const lines: string[] = [
      "You are an expert conversation analyst evaluating a customer service bot.",
      "",
      "## Scenario Information",
      `- ID: ${scenario.id}`,
      `- Name: ${scenario.name}`,
      `- Description: ${scenario.description}`,
      `- Category: ${scenario.category}`,
      "",
      "## Best Practices Reference",
      this.bestPractices,
      "",
      "## Conversation Transcript",
      transcript,
      "",
      "## Execution Results",
      `- Overall Pass: ${result.passed ? "Yes" : "No"}`,
      `- Steps Passed: ${result.passedSteps}/${result.totalSteps}`,
      `- Duration: ${result.totalDurationMs}ms`,
      "",
      "## Expectation Results",
      expectationSummary,
      "",
      "## Your Task",
      "Analyze this conversation and provide a STRICT evaluation. Be harsh - excellence is rare.",
      "",
      "SCORING RULES:",
      "- 90-100: RARE. Reserved for near-perfect, genuinely natural conversations indistinguishable from skilled human agents.",
      "- 75-89: Good but with minor issues. Professional but slightly stiff or with small inefficiencies.",
      "- 60-74: Acceptable but noticeable problems. Some robotic phrasing or unnecessary turns.",
      "- 40-59: Poor. Multiple anti-patterns or failed steps.",
      "- 20-39: Failing. Critical issues like failing to greet or understand basic inputs.",
      "- 0-19: Complete failure. Bot unable to function properly.",
      "",
      "CRITICAL DEDUCTIONS:",
      "- 'I'm not sure how to respond to that' to valid input = score below 30",
      "- Failing to greet customer warmly = score below 50",
      "- Robotic phrases like 'Hello [Name]!' = score below 80",
      "- Redundant tool calls = deduct 20 points",
      "- Tool leakage (mentioning tool names) = deduct 25 points",
      "",
      "CATEGORIES:",
      "1. **Accuracy (0-100)**: Correct understanding and tool usage. Tool failures cap at 60.",
      "2. **Naturalness (0-100)**: Human-like warmth. 'I'm not sure' caps at 20. Robotic phrasing caps at 75.",
      "3. **Efficiency (0-100)**: Minimum necessary turns. Redundant calls cap at 70.",
      "4. **Best Practices (0-100)**: Principles followed, anti-patterns avoided. High-severity violations cap at 60.",
      "",
      "For each finding, reference specific best practice IDs (P1-P6 for principles, A1-A7 for anti-patterns).",
      "",
      "Return your analysis as JSON matching this schema:",
      "{",
      '  "overallScore": number (0-100, weighted average),',
      '  "categoryScores": {',
      '    "accuracy": number,',
      '    "naturalness": number,',
      '    "efficiency": number,',
      '    "bestPractices": number',
      "  },",
      '  "findings": [',
      "    {",
      '      "category": "strength" | "improvement" | "violation",',
      '      "severity": "low" | "medium" | "high" (for improvements/violations),',
      '      "stepIndex": number (optional, 0-based),',
      '      "description": "Clear description of the finding",',
      '      "bestPracticeRef": "P1" | "A2" | etc. (optional)',
      "    }",
      "  ],",
      '  "summary": "One paragraph summary of the overall conversation quality",',
      '  "recommendations": ["Specific actionable recommendations for improvement"]',
      "}",
    ];

    return lines.join("\n");
  }

  /**
   * Parse the AI response
   */
  private parseResponse(response: unknown): AnalysisResult {
    // Handle different response formats from Workers AI
    let content: unknown;

    if (response && typeof response === "object" && "response" in response) {
      const respValue = (response as { response: unknown }).response;
      if (typeof respValue === "string") {
        try {
          content = JSON.parse(respValue);
        } catch {
          throw new Error(
            `Failed to parse JSON response: ${respValue.slice(0, 200)}`,
          );
        }
      } else {
        content = respValue;
      }
    } else if (
      response &&
      typeof response === "object" &&
      "choices" in response
    ) {
      const choices = (
        response as { choices: Array<{ message?: { content?: unknown } }> }
      ).choices;
      const message = choices[0]?.message;
      if (message?.content && typeof message.content === "string") {
        try {
          content = JSON.parse(message.content);
        } catch {
          throw new Error(
            `Failed to parse JSON response: ${message.content.slice(0, 200)}`,
          );
        }
      }
    }

    if (!content) {
      throw new Error("Empty response from AI");
    }

    const validated = aiAnalysisResponseSchema.safeParse(content);
    if (!validated.success) {
      throw new Error(`Invalid response schema: ${validated.error.message}`);
    }

    return validated.data;
  }

  /**
   * Generate a fallback analysis when AI fails
   */
  private generateFallbackAnalysis(result: ScenarioResult): AnalysisResult {
    const passRate = result.passedSteps / result.totalSteps;
    const baseScore = Math.round(passRate * 100);

    const findings: AnalysisFinding[] = [];

    // Add findings based on step results
    for (const step of result.stepResults) {
      if (!step.passed) {
        const failedExpectations = step.expectationResults.filter(
          (r) => !r.passed,
        );
        for (const exp of failedExpectations) {
          findings.push({
            category: "violation",
            severity: "medium",
            stepIndex: step.stepIndex,
            description: `${exp.type}: ${exp.expected}`,
          });
        }
      }
    }

    if (result.passed) {
      findings.push({
        category: "strength",
        description: "All scenario expectations were met successfully.",
      });
    }

    return {
      overallScore: baseScore,
      categoryScores: {
        accuracy: baseScore,
        naturalness: baseScore,
        efficiency: baseScore,
        bestPractices: baseScore,
      },
      findings,
      summary: result.passed
        ? `The scenario completed successfully with ${result.passedSteps}/${result.totalSteps} steps passing. AI analysis was not available for detailed evaluation.`
        : `The scenario failed with ${result.passedSteps}/${result.totalSteps} steps passing. AI analysis was not available for detailed evaluation.`,
      recommendations: result.passed
        ? []
        : [
            "Review the failed steps and their expectations for specific issues.",
          ],
    };
  }
}
