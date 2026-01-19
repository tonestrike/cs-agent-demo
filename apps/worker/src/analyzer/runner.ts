import { setTimeout as delay } from "node:timers/promises";

import type { Logger } from "../logger";
import type {
  ExpectationResult,
  ScenarioDefinition,
  ScenarioResult,
  StepExpectations,
  StepResult,
} from "./types";

/**
 * Configuration for the scenario runner
 */
export type RunnerConfig = {
  /** Base URL of the worker to test against */
  baseUrl: string;
  /** Auth token for authenticated requests */
  authToken?: string;
  /** Delay between messages (ms) */
  messageDelay?: number;
  /** Max attempts when waiting for state */
  maxWaitAttempts?: number;
  /** Delay between wait attempts (ms) */
  waitDelayMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Logger instance */
  logger?: Logger;
};

const defaultConfig: Partial<RunnerConfig> = {
  messageDelay: 500,
  maxWaitAttempts: 30,
  waitDelayMs: 500,
  verbose: false,
};

type RpcResponse<T> = { json: T; meta: unknown[] };

type MessageResponse = {
  response: string;
  streamed: boolean;
  messageId: string;
  turnId: number;
};

type DebugResponse = {
  sessionState: {
    domainState: Record<string, unknown>;
  };
  eventBuffer: Array<{
    id: number;
    type: string;
    text?: string;
    data?: unknown;
    at: string;
  }>;
};

/**
 * Scenario runner - executes scenarios against the conversation API
 */
export class ScenarioRunner {
  private config: Required<Omit<RunnerConfig, "authToken" | "logger">> & {
    authToken?: string;
    logger?: Logger;
  };

  constructor(config: RunnerConfig) {
    this.config = {
      ...defaultConfig,
      ...config,
    } as Required<Omit<RunnerConfig, "authToken" | "logger">> & {
      authToken?: string;
      logger?: Logger;
    };
  }

  private log(
    level: "info" | "debug" | "warn" | "error",
    data: Record<string, unknown>,
    message: string,
  ) {
    if (this.config.logger) {
      this.config.logger[level](data, message);
    } else if (this.config.verbose) {
      console.log(`[${level.toUpperCase()}] ${message}`, JSON.stringify(data));
    }
  }

  /**
   * Run a complete scenario
   */
  async runScenario(scenario: ScenarioDefinition): Promise<ScenarioResult> {
    const conversationId = `analyzer-${scenario.id}-${crypto.randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    this.log(
      "info",
      { scenarioId: scenario.id, conversationId },
      "Starting scenario execution",
    );

    const stepResults: StepResult[] = [];
    let overallError: string | undefined;

    try {
      // Setup: seed data if needed
      // Always seed customer for verification to work, optionally seed appointment
      const needsCustomer =
        scenario.setup.seedCustomer !== false &&
        (scenario.setup.seedAppointment || scenario.setup.seedCustomer);
      const needsAppointment = scenario.setup.seedAppointment;

      if (needsCustomer) {
        this.log("info", { scenarioId: scenario.id }, "Seeding customer data");
        await this.seedCustomer(scenario);
        this.log("info", { scenarioId: scenario.id }, "Customer data seeded");
      }

      if (needsAppointment) {
        this.log(
          "info",
          { scenarioId: scenario.id },
          "Seeding appointment data",
        );
        await this.seedAppointment(scenario);
        this.log(
          "info",
          { scenarioId: scenario.id },
          "Appointment data seeded",
        );
      }

      // Execute each step
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (!step) continue; // TypeScript guard
        const stepStartTime = Date.now();

        this.log(
          "info",
          {
            scenarioId: scenario.id,
            stepIndex: i + 1,
            totalSteps: scenario.steps.length,
            userMessage: step.userMessage.slice(0, 50),
          },
          "Executing step",
        );

        try {
          // Send the message
          this.log(
            "debug",
            { conversationId, message: step.userMessage.slice(0, 50) },
            "Sending message",
          );
          const response = await this.sendMessage(conversationId, {
            text: step.userMessage,
            phone: scenario.setup.phone,
          });
          this.log(
            "debug",
            { conversationId, responseLength: response.response.length },
            "Message sent, got response",
          );

          // Wait a bit for state to settle
          await delay(this.config.messageDelay);

          // Get the debug state
          this.log("debug", { conversationId }, "Fetching debug state");
          const debug = await this.getDebugState(conversationId);

          // Extract tool calls from events
          const toolCalls = this.extractToolCalls(debug.eventBuffer ?? []);
          if (toolCalls.length > 0) {
            this.log(
              "info",
              { stepIndex: i + 1, toolCalls: toolCalls.map((tc) => tc.name) },
              "Tool calls observed",
            );
          }

          // Check expectations
          const expectationResults = this.checkExpectations(
            step.expectations,
            response.response,
            toolCalls,
            debug.sessionState.domainState,
          );

          const passed = expectationResults.every((r) => r.passed);
          const failedExpectations = expectationResults.filter(
            (r) => !r.passed,
          );

          stepResults.push({
            stepIndex: i,
            userMessage: step.userMessage,
            botResponse: response.response,
            toolCalls,
            stateSnapshot: debug.sessionState.domainState,
            expectationResults,
            passed,
            durationMs: Date.now() - stepStartTime,
          });

          this.log(
            passed ? "info" : "warn",
            {
              scenarioId: scenario.id,
              stepIndex: i + 1,
              passed,
              passedExpectations: expectationResults.filter((r) => r.passed)
                .length,
              failedExpectations: failedExpectations.length,
              durationMs: Date.now() - stepStartTime,
            },
            passed ? "Step passed" : "Step failed",
          );

          if (!passed && failedExpectations.length > 0) {
            for (const failed of failedExpectations) {
              this.log(
                "warn",
                {
                  stepIndex: i + 1,
                  type: failed.type,
                  expected: failed.expected,
                  actual: failed.actual,
                },
                "Expectation failed",
              );
            }
          }
        } catch (error) {
          this.log(
            "error",
            { scenarioId: scenario.id, stepIndex: i + 1, error: String(error) },
            "Step execution error",
          );

          stepResults.push({
            stepIndex: i,
            userMessage: step.userMessage,
            botResponse: "",
            toolCalls: [],
            stateSnapshot: {},
            expectationResults: [],
            passed: false,
            durationMs: Date.now() - stepStartTime,
            error: String(error),
          });
        }
      }
    } catch (error) {
      this.log(
        "error",
        { scenarioId: scenario.id, error: String(error) },
        "Scenario execution error",
      );
      overallError = String(error);
    }

    const completedAt = new Date().toISOString();
    const passedSteps = stepResults.filter((r) => r.passed).length;

    // Check success criteria
    const meetsMinSteps =
      scenario.successCriteria.minPassingSteps === undefined ||
      passedSteps >= scenario.successCriteria.minPassingSteps;

    const meetsFinalState =
      !scenario.successCriteria.finalState ||
      this.checkFinalState(
        stepResults[stepResults.length - 1]?.stateSnapshot ?? {},
        scenario.successCriteria.finalState,
      );

    const passed =
      !overallError &&
      passedSteps === scenario.steps.length &&
      meetsMinSteps &&
      meetsFinalState;

    this.log(
      "info",
      {
        scenarioId: scenario.id,
        conversationId,
        passed,
        passedSteps,
        totalSteps: scenario.steps.length,
        totalDurationMs: Date.now() - startTime,
      },
      "Scenario execution finished",
    );

    return {
      scenarioId: scenario.id,
      conversationId,
      stepResults,
      passed,
      passedSteps,
      totalSteps: scenario.steps.length,
      totalDurationMs: Date.now() - startTime,
      error: overallError,
      startedAt,
      completedAt,
    };
  }

  /**
   * Send a message to the conversation
   */
  private async sendMessage(
    conversationId: string,
    input: { text: string; phone?: string },
  ): Promise<MessageResponse> {
    const response = await fetch(
      new URL(
        `/api/conversations/${conversationId}/message`,
        this.config.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.authToken
            ? { "x-demo-auth": this.config.authToken }
            : {}),
        },
        body: JSON.stringify({
          phoneNumber: input.phone,
          callSessionId: conversationId,
          text: input.text,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Message request failed ${response.status}: ${text}`);
    }

    return (await response.json()) as MessageResponse;
  }

  /**
   * Get debug state for a conversation
   */
  private async getDebugState(conversationId: string): Promise<DebugResponse> {
    const response = await fetch(
      new URL(
        `/api/conversations/${conversationId}/debug`,
        this.config.baseUrl,
      ),
      {
        method: "GET",
        headers: {
          ...(this.config.authToken
            ? { "x-demo-auth": this.config.authToken }
            : {}),
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Debug request failed ${response.status}: ${text}`);
    }

    return (await response.json()) as DebugResponse;
  }

  /**
   * Call an RPC endpoint
   */
  private async callRpc<T>(
    path: string,
    input?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(new URL(`/rpc/${path}`, this.config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.authToken
          ? { "x-demo-auth": this.config.authToken }
          : {}),
      },
      body: JSON.stringify({
        json: input ?? {},
        meta: [],
      }),
    });

    const data = (await response.json()) as RpcResponse<T>;
    if (!response.ok) {
      throw new Error(
        JSON.stringify({ path, status: response.status, body: data.json }),
      );
    }
    return data.json;
  }

  /**
   * Seed customer data for verification
   */
  private async seedCustomer(scenario: ScenarioDefinition): Promise<void> {
    const customerId = scenario.setup.customerId ?? `cust_${scenario.id}`;

    try {
      await this.callRpc("admin/createCustomer", {
        id: customerId,
        displayName: `Test Customer ${scenario.id}`,
        phoneE164: scenario.setup.phone,
        zipCode: scenario.setup.zip,
        addressSummary: "123 Test Street",
      });
    } catch {
      // Customer may already exist
    }
  }

  /**
   * Seed appointment data for scenarios that need appointments
   */
  private async seedAppointment(scenario: ScenarioDefinition): Promise<void> {
    const customerId = scenario.setup.customerId ?? `cust_${scenario.id}`;
    const appointmentId = scenario.setup.appointmentId ?? `appt_${scenario.id}`;
    const nowDate = new Date();
    const date = nowDate.toISOString().slice(0, 10);

    try {
      await this.callRpc("admin/createAppointment", {
        id: appointmentId,
        customerId,
        phoneE164: scenario.setup.phone,
        addressSummary: "123 Test Street",
        date,
        timeWindow: "10:00-12:00",
        status: "scheduled",
      });
    } catch {
      // Appointment may already exist
    }
  }

  /**
   * Extract tool calls from events
   */
  private extractToolCalls(
    events: DebugResponse["eventBuffer"],
  ): Array<{ name: string; args: Record<string, unknown> }> {
    return events
      .filter((e) => e.type === "tool_call")
      .map((e) => {
        const data = e.data as
          | { toolName?: string; args?: Record<string, unknown> }
          | undefined;
        return {
          name: data?.toolName ?? "unknown",
          args: data?.args ?? {},
        };
      });
  }

  /**
   * Check expectations against actual results
   */
  private checkExpectations(
    expectations: StepExpectations,
    response: string,
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    state: Record<string, unknown>,
  ): ExpectationResult[] {
    const results: ExpectationResult[] = [];

    // Check tool call expectations
    if (expectations.toolCalls) {
      for (const expected of expectations.toolCalls) {
        const matching = toolCalls.find((tc) => tc.name === expected.name);

        if (!matching) {
          results.push({
            type: "toolCall",
            passed: false,
            expected: `Tool "${expected.name}" to be called`,
            actual: `Tools called: ${toolCalls.map((tc) => tc.name).join(", ") || "none"}`,
          });
          continue;
        }

        // Check args if specified
        if (expected.argsContain) {
          const argsMismatch: string[] = [];
          for (const [key, value] of Object.entries(expected.argsContain)) {
            if (matching.args[key] !== value) {
              argsMismatch.push(
                `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(matching.args[key])}`,
              );
            }
          }

          results.push({
            type: "toolCall",
            passed: argsMismatch.length === 0,
            expected: `Tool "${expected.name}" with args containing ${JSON.stringify(expected.argsContain)}`,
            actual:
              argsMismatch.length === 0
                ? "Matched"
                : `Mismatches: ${argsMismatch.join("; ")}`,
          });
        } else {
          results.push({
            type: "toolCall",
            passed: true,
            expected: `Tool "${expected.name}" to be called`,
            actual: "Called",
          });
        }
      }
    }

    // Check state change expectations
    if (expectations.stateChanges) {
      for (const [path, expectedValue] of Object.entries(
        expectations.stateChanges,
      )) {
        const actualValue = this.getNestedValue(state, path);
        const matches = this.valuesMatch(actualValue, expectedValue);

        results.push({
          type: "stateChange",
          passed: matches,
          expected: `State "${path}" = ${JSON.stringify(expectedValue)}`,
          actual: `${JSON.stringify(actualValue)}`,
        });
      }
    }

    // Check response patterns
    if (expectations.responsePatterns) {
      for (const pattern of expectations.responsePatterns) {
        const regex = new RegExp(pattern, "i");
        const matches = regex.test(response);

        results.push({
          type: "responsePattern",
          passed: matches,
          expected: `Response to match pattern "${pattern}"`,
          actual: matches
            ? "Matched"
            : `Response: "${response.slice(0, 200)}..."`,
        });
      }
    }

    // Check response exclusions
    if (expectations.responseExcludes) {
      for (const pattern of expectations.responseExcludes) {
        const regex = new RegExp(pattern, "i");
        const matches = regex.test(response);

        results.push({
          type: "responseExclude",
          passed: !matches,
          expected: `Response to NOT match pattern "${pattern}"`,
          actual: !matches
            ? "Did not match (good)"
            : `Matched (bad): "${response.slice(0, 200)}..."`,
        });
      }
    }

    return results;
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Check if two values match (deep comparison for objects)
   */
  private valuesMatch(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (typeof actual !== typeof expected) return false;
    if (actual === null || expected === null) return actual === expected;

    if (typeof actual === "object" && typeof expected === "object") {
      // For partial matching, check that all expected keys match
      const expectedObj = expected as Record<string, unknown>;
      const actualObj = actual as Record<string, unknown>;

      for (const key of Object.keys(expectedObj)) {
        if (!this.valuesMatch(actualObj[key], expectedObj[key])) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Check if final state matches success criteria
   */
  private checkFinalState(
    actualState: Record<string, unknown>,
    expectedState: Record<string, unknown>,
  ): boolean {
    for (const [path, expectedValue] of Object.entries(expectedState)) {
      const actualValue = this.getNestedValue(actualState, path);
      if (!this.valuesMatch(actualValue, expectedValue)) {
        return false;
      }
    }
    return true;
  }
}
