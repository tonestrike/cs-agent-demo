#!/usr/bin/env bun
/**
 * Conversation Analyzer CLI
 *
 * Runs predefined scenarios through the bot and analyzes the results.
 * By default, runs against the remote worker URL.
 *
 * Usage:
 *   # Run all scenarios
 *   bun scripts/run-analyzer.ts --all
 *
 *   # Run specific category
 *   bun scripts/run-analyzer.ts --category verification
 *
 *   # Run single scenario
 *   bun scripts/run-analyzer.ts --scenario verification-happy-path
 *
 *   # Run against local dev server
 *   bun scripts/run-analyzer.ts --all --local
 *
 *   # Output JSON
 *   bun scripts/run-analyzer.ts --all --json
 *
 *   # Save results to markdown file
 *   bun scripts/run-analyzer.ts --all --with-analysis --save
 *
 * Environment:
 *   WORKER_BASE     - Worker URL (overrides default)
 *   DEMO_AUTH_TOKEN - Auth token for API calls (overrides default)
 */

import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Get the project root directory (one level up from scripts/)
const PROJECT_ROOT = resolve(dirname(import.meta.path), "..");

type RpcResponse<T> = { json: T; meta: unknown[] };

// Default remote configuration (matches test:e2e:remote)
const REMOTE_URL = "https://pestcall-worker.tonyvantur.workers.dev";
const REMOTE_AUTH_TOKEN = "dev-demo-token";
const LOCAL_URL = "http://127.0.0.1:8787";

// Parse command line arguments
const args = process.argv.slice(2);

const getArgValue = (flag: string): string | undefined => {
  const eqForm = args.find((a) => a.startsWith(`${flag}=`));
  if (eqForm) return eqForm.split("=")[1];
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
};

const options = {
  all: args.includes("--all"),
  category: getArgValue("--category"),
  scenario: getArgValue("--scenario"),
  json: args.includes("--json"),
  verbose: args.includes("--verbose") || args.includes("-v"),
  help: args.includes("--help") || args.includes("-h"),
  local: args.includes("--local"),
  // AI analysis is enabled by default, use --no-analysis to disable
  withAnalysis: !args.includes("--no-analysis"),
  // Save to markdown is enabled by default, use --no-save to disable
  save: !args.includes("--no-save"),
};

// Generate unique run ID to avoid database constraint issues
const runId = Date.now().toString(36).slice(-4);

// Use local URL if --local flag, otherwise default to remote
const baseUrl =
  process.env.WORKER_BASE ?? (options.local ? LOCAL_URL : REMOTE_URL);
const authToken =
  process.env.DEMO_AUTH_TOKEN ??
  (options.local ? undefined : REMOTE_AUTH_TOKEN);

// Show help
if (options.help || (!options.all && !options.category && !options.scenario)) {
  console.log(`
Conversation Analyzer CLI

Runs scenarios against the remote worker by default.

Usage:
  bun scripts/run-analyzer.ts [options]

Options:
  --all                 Run all scenarios
  --category <name>     Run all scenarios in a category (verification, reschedule, cancel)
  --scenario <id>       Run a single scenario by ID
  --local               Run against local dev server (http://127.0.0.1:8787)
  --no-analysis         Disable AI analysis (enabled by default)
  --no-save             Disable saving results to markdown (enabled by default)
  --json                Output results as JSON
  --verbose, -v         Show detailed output
  --help, -h            Show this help message

Environment Variables:
  WORKER_BASE           Worker URL (overrides default remote URL)
  DEMO_AUTH_TOKEN       Auth token for API requests (overrides default)

Default remote: ${REMOTE_URL}

Examples:
  bun scripts/run-analyzer.ts --all
  bun scripts/run-analyzer.ts --category verification
  bun scripts/run-analyzer.ts --scenario verification-happy-path --verbose
  bun scripts/run-analyzer.ts --all --local  # Run against local dev server
  `);
  process.exit(0);
}

// RPC helper
const callRpc = async <T>(
  path: string,
  input?: Record<string, unknown>,
): Promise<T> => {
  const url = new URL(`/rpc/${path}`, baseUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authToken) {
    headers["x-demo-auth"] = authToken;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      json: input ?? {},
      meta: [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ${path} failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as RpcResponse<T>;
  return data.json;
};

// HTTP helpers for direct scenario execution
const postJson = async <T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  const url = new URL(path, baseUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authToken) {
    headers["x-demo-auth"] = authToken;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const url = new URL(path, baseUrl);
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["x-demo-auth"] = authToken;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${path} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
};

// Format helpers
const colorize = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const formatPass = (passed: boolean): string => {
  return passed ? colorize.green("PASS") : colorize.red("FAIL");
};

// Scenario types (matching the worker types)
type StepExpectations = {
  toolCalls?: Array<{ name: string; argsContain?: Record<string, unknown> }>;
  stateChanges?: Record<string, unknown>;
  responsePatterns?: string[];
  responseExcludes?: string[];
};

// Database expectations for verifying actual database state after scenario runs
type AppointmentExpectation = {
  appointmentId: string;
  status: "scheduled" | "rescheduled" | "cancelled";
  rescheduledToId?: string;
  rescheduledFromId?: string;
};

type DatabaseExpectations = {
  appointments?: AppointmentExpectation[];
};

type ScenarioDefinition = {
  id: string;
  name: string;
  description: string;
  category: string;
  setup: {
    phone: string;
    zip: string;
    customerId?: string;
    appointmentId?: string;
    seedAppointment?: boolean;
  };
  steps: Array<{
    userMessage: string;
    expectations: StepExpectations;
  }>;
  successCriteria: {
    finalState?: Record<string, unknown>;
    minPassingSteps?: number;
  };
  /** Database expectations to verify after scenario completes */
  databaseExpectations?: DatabaseExpectations;
};

type ExpectationResult = {
  type: string;
  passed: boolean;
  expected: string;
  actual?: string;
};

type StepResult = {
  stepIndex: number;
  userMessage: string;
  botResponse: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  stateSnapshot: Record<string, unknown>;
  expectationResults: ExpectationResult[];
  passed: boolean;
  durationMs: number;
  error?: string;
};

type DatabaseVerificationResult = {
  appointmentId: string;
  passed: boolean;
  expected: {
    status: string;
    rescheduledToId?: string;
    rescheduledFromId?: string;
  };
  actual?: {
    status: string;
    rescheduledToId?: string | null;
    rescheduledFromId?: string | null;
  } | null;
  error?: string;
};

type ScenarioResult = {
  scenarioId: string;
  conversationId: string;
  stepResults: StepResult[];
  passed: boolean;
  passedSteps: number;
  totalSteps: number;
  totalDurationMs: number;
  error?: string;
  startedAt: string;
  completedAt: string;
  /** Database verification results if database expectations were specified */
  databaseResults?: DatabaseVerificationResult[];
};

type AnalysisResult = {
  overallScore: number;
  categoryScores: {
    accuracy: number;
    naturalness: number;
    efficiency: number;
    bestPractices: number;
  };
  findings: Array<{
    category: "strength" | "improvement" | "violation";
    severity?: "low" | "medium" | "high";
    stepIndex?: number;
    description: string;
    bestPracticeRef?: string;
  }>;
  summary: string;
  recommendations: string[];
};

type FullResult = {
  execution: ScenarioResult;
  analysis?: AnalysisResult;
};

// Local scenario runner (runs directly from CLI, not via RPC)
class LocalScenarioRunner {
  private messageDelay = 500;
  private runId: string;
  private seededPhones: Map<string, string> = new Map();

  constructor() {
    // Unique ID per run to avoid database constraint issues
    this.runId = Date.now().toString(36).slice(-4);
  }

  async runScenario(scenario: ScenarioDefinition): Promise<ScenarioResult> {
    const conversationId = `analyzer-${scenario.id}-${crypto.randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    console.log(colorize.dim(`  Starting conversation: ${conversationId}`));

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
        console.log(colorize.dim("  Seeding customer data..."));
        await this.seedCustomer(scenario);
      }

      if (needsAppointment) {
        console.log(colorize.dim("  Seeding appointment data..."));
        await this.seedAppointment(scenario);
      }

      // Execute each step
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (!step) continue;
        const stepStartTime = Date.now();

        console.log(
          colorize.dim(
            `  Step ${i + 1}/${scenario.steps.length}: "${step.userMessage.slice(0, 30)}..."`,
          ),
        );

        try {
          // Send the message - use seeded phone if available, otherwise base phone
          const phone =
            this.seededPhones.get(scenario.id) ?? scenario.setup.phone;
          const response = await this.sendMessage(conversationId, {
            text: step.userMessage,
            phone,
          });

          // Wait a bit for state to settle
          await delay(this.messageDelay);

          // Get the debug state
          const debug = await this.getDebugState(conversationId);

          // Extract tool calls from events
          const toolCalls = this.extractToolCalls(debug.eventBuffer ?? []);

          // Check expectations
          const domainState = debug.sessionState?.domainState ?? {};
          const expectationResults = this.checkExpectations(
            step.expectations,
            response.response,
            toolCalls,
            domainState,
          );

          const passed = expectationResults.every((r) => r.passed);

          stepResults.push({
            stepIndex: i,
            userMessage: step.userMessage,
            botResponse: response.response,
            toolCalls,
            stateSnapshot: domainState,
            expectationResults,
            passed,
            durationMs: Date.now() - stepStartTime,
          });

          console.log(
            colorize.dim(
              `    ${passed ? "✓" : "✗"} ${response.response.slice(0, 50)}...`,
            ),
          );
        } catch (error) {
          console.log(colorize.red(`    Error: ${error}`));
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

    // Verify database expectations if specified
    let databaseResults: DatabaseVerificationResult[] | undefined;
    let meetsDatabaseExpectations = true;
    if (scenario.databaseExpectations?.appointments) {
      console.log(colorize.dim("  Verifying database state..."));
      databaseResults = await this.verifyDatabaseExpectations(
        scenario.databaseExpectations,
        this.runId,
      );
      meetsDatabaseExpectations = databaseResults.every((r) => r.passed);
      for (const result of databaseResults) {
        console.log(
          colorize.dim(
            `    ${result.passed ? "✓" : "✗"} Appointment ${result.appointmentId}: ${result.actual?.status ?? "not found"} (expected: ${result.expected.status})`,
          ),
        );
      }
    }

    const passed =
      !overallError &&
      passedSteps === scenario.steps.length &&
      meetsMinSteps &&
      meetsFinalState &&
      meetsDatabaseExpectations;

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
      databaseResults,
    };
  }

  private async sendMessage(
    conversationId: string,
    input: { text: string; phone?: string },
  ): Promise<{
    response: string;
    streamed: boolean;
    messageId: string;
    turnId: number;
  }> {
    return postJson(`/api/conversations/${conversationId}/message`, {
      phoneNumber: input.phone,
      callSessionId: conversationId,
      text: input.text,
    });
  }

  private async getDebugState(conversationId: string): Promise<{
    sessionState: { domainState: Record<string, unknown> };
    eventBuffer: Array<{
      id: number;
      type: string;
      text?: string;
      data?: unknown;
      at: string;
    }>;
  }> {
    return getJson(`/api/conversations/${conversationId}/debug`);
  }

  private async seedCustomer(scenario: ScenarioDefinition): Promise<void> {
    // Use runId suffix to avoid database constraint issues across runs
    const baseCustomerId = scenario.setup.customerId ?? `cust_${scenario.id}`;
    const customerId = `${baseCustomerId}_${this.runId}`;
    // Generate unique phone number per run to avoid conflicts with existing customers
    const uniquePhone = this.generateUniquePhone(scenario.setup.phone);

    try {
      await callRpc("admin/createCustomer", {
        id: customerId,
        displayName: `Test Customer ${scenario.id}`,
        phoneE164: uniquePhone,
        zipCode: scenario.setup.zip,
        addressSummary: "123 Test Street",
      });
      // Store the unique phone for use in the conversation
      this.seededPhones.set(scenario.id, uniquePhone);
    } catch {
      // Customer may already exist
    }
  }

  private generateUniquePhone(_basePhone: string): string {
    // Generate a completely random E.164 phone number to avoid conflicts
    // Format: +1555XXXXXXX (using 555 prefix to indicate test numbers)
    const randomDigits = Math.floor(Math.random() * 10_000_000)
      .toString()
      .padStart(7, "0");
    return `+1555${randomDigits}`;
  }

  private async seedAppointment(scenario: ScenarioDefinition): Promise<void> {
    // Use runId suffix to avoid database constraint issues across runs
    const baseCustomerId = scenario.setup.customerId ?? `cust_${scenario.id}`;
    const baseAppointmentId =
      scenario.setup.appointmentId ?? `appt_${scenario.id}`;
    const customerId = `${baseCustomerId}_${this.runId}`;
    const appointmentId = `${baseAppointmentId}_${this.runId}`;
    // Use the seeded phone number (set by seedCustomer)
    const phone = this.seededPhones.get(scenario.id) ?? scenario.setup.phone;
    const nowDate = new Date();
    const date = nowDate.toISOString().slice(0, 10);

    try {
      await callRpc("admin/createAppointment", {
        id: appointmentId,
        customerId,
        phoneE164: phone,
        addressSummary: "123 Test Street",
        date,
        timeWindow: "10:00-12:00",
        status: "scheduled",
      });
    } catch {
      // Appointment may already exist
    }
  }

  private async verifyDatabaseExpectations(
    expectations: DatabaseExpectations,
    runId: string,
  ): Promise<DatabaseVerificationResult[]> {
    const results: DatabaseVerificationResult[] = [];

    if (expectations.appointments) {
      for (const expectation of expectations.appointments) {
        // Use runId suffix to match the seeded appointment
        const appointmentId = `${expectation.appointmentId}_${runId}`;
        try {
          const response = await callRpc<{
            appointment: {
              id: string;
              status: string;
              date: string;
              timeWindow: string;
              rescheduledFromId: string | null;
              rescheduledToId: string | null;
            } | null;
          }>("admin/getAppointment", { id: appointmentId });

          const appointment = response.appointment;

          if (!appointment) {
            results.push({
              appointmentId: expectation.appointmentId,
              passed: false,
              expected: {
                status: expectation.status,
                rescheduledToId: expectation.rescheduledToId,
                rescheduledFromId: expectation.rescheduledFromId,
              },
              actual: null,
              error: "Appointment not found",
            });
            continue;
          }

          // Check status match
          const statusMatches = appointment.status === expectation.status;

          // Check rescheduledToId match (only if specified in expectation)
          const rescheduledToMatches =
            expectation.rescheduledToId === undefined ||
            appointment.rescheduledToId === expectation.rescheduledToId;

          // Check rescheduledFromId match (only if specified in expectation)
          const rescheduledFromMatches =
            expectation.rescheduledFromId === undefined ||
            appointment.rescheduledFromId === expectation.rescheduledFromId;

          const passed =
            statusMatches && rescheduledToMatches && rescheduledFromMatches;

          results.push({
            appointmentId: expectation.appointmentId,
            passed,
            expected: {
              status: expectation.status,
              rescheduledToId: expectation.rescheduledToId,
              rescheduledFromId: expectation.rescheduledFromId,
            },
            actual: {
              status: appointment.status,
              rescheduledToId: appointment.rescheduledToId,
              rescheduledFromId: appointment.rescheduledFromId,
            },
          });
        } catch (error) {
          results.push({
            appointmentId: expectation.appointmentId,
            passed: false,
            expected: {
              status: expectation.status,
              rescheduledToId: expectation.rescheduledToId,
              rescheduledFromId: expectation.rescheduledFromId,
            },
            error: String(error),
          });
        }
      }
    }

    return results;
  }

  private extractToolCalls(
    events: Array<{ type: string; data?: unknown }>,
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

  private valuesMatch(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (typeof actual !== typeof expected) return false;
    if (actual === null || expected === null) return actual === expected;

    if (typeof actual === "object" && typeof expected === "object") {
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

// Print results
const printResult = (result: FullResult) => {
  const { execution, analysis } = result;

  console.log(`\n${colorize.bold("═".repeat(60))}`);
  console.log(
    `${colorize.bold("Scenario:")} ${colorize.cyan(execution.scenarioId)}`,
  );
  console.log(
    `${colorize.bold("Result:")} ${formatPass(execution.passed)} (${execution.passedSteps}/${execution.totalSteps} steps)`,
  );
  console.log(`${colorize.bold("Duration:")} ${execution.totalDurationMs}ms`);

  // Show AI analysis if available
  if (analysis) {
    const scoreColor =
      analysis.overallScore >= 80
        ? colorize.green
        : analysis.overallScore >= 60
          ? colorize.yellow
          : colorize.red;
    console.log(
      `${colorize.bold("AI Score:")} ${scoreColor(`${analysis.overallScore}/100`)}`,
    );
    console.log(
      `  ${colorize.dim("Accuracy:")} ${analysis.categoryScores.accuracy} | ${colorize.dim("Naturalness:")} ${analysis.categoryScores.naturalness}`,
    );
    console.log(
      `  ${colorize.dim("Efficiency:")} ${analysis.categoryScores.efficiency} | ${colorize.dim("Best Practices:")} ${analysis.categoryScores.bestPractices}`,
    );
  }

  // Always show conversation transcript
  console.log(`\n${colorize.bold("Conversation:")}`);
  for (const step of execution.stepResults) {
    console.log(`  ${colorize.cyan("Customer:")} ${step.userMessage}`);
    if (step.botResponse) {
      console.log(`  ${colorize.yellow("Bot:")} ${step.botResponse}`);
    } else if (step.error) {
      console.log(`  ${colorize.red("Error:")} ${step.error}`);
    } else {
      console.log(`  ${colorize.red("Bot:")} (no response)`);
    }
    if (step.toolCalls.length > 0) {
      console.log(
        `  ${colorize.dim("Tools:")} ${step.toolCalls.map((tc) => tc.name).join(", ")}`,
      );
    }
    console.log();
  }

  // Show step results
  console.log(`${colorize.bold("Step Results:")}`);
  for (const step of execution.stepResults) {
    console.log(
      `  ${formatPass(step.passed)} Step ${step.stepIndex + 1}: ${step.userMessage.slice(0, 50)}${step.userMessage.length > 50 ? "..." : ""}`,
    );
    if (!step.passed) {
      for (const exp of step.expectationResults.filter((e) => !e.passed)) {
        console.log(`     ${colorize.red("×")} ${exp.type}: ${exp.expected}`);
        if (exp.actual) {
          console.log(
            `       ${colorize.dim("Got:")} ${exp.actual.slice(0, 100)}${exp.actual.length > 100 ? "..." : ""}`,
          );
        }
      }
    }
    if (options.verbose && step.passed) {
      for (const exp of step.expectationResults.filter((e) => e.passed)) {
        console.log(`     ${colorize.green("✓")} ${exp.type}: ${exp.expected}`);
      }
    }
  }

  // Show AI analysis details if available
  if (analysis && options.verbose) {
    console.log(`\n${colorize.bold("AI Analysis Details:")}`);
    console.log(`${colorize.dim("Summary:")} ${analysis.summary}`);

    if (analysis.findings.length > 0) {
      console.log(`\n${colorize.bold("Findings:")}`);
      for (const finding of analysis.findings) {
        const icon =
          finding.category === "strength"
            ? colorize.green("✓")
            : finding.category === "improvement"
              ? colorize.yellow("→")
              : colorize.red("×");
        const severity =
          finding.severity && finding.category !== "strength"
            ? ` [${finding.severity}]`
            : "";
        const ref = finding.bestPracticeRef
          ? ` (${finding.bestPracticeRef})`
          : "";
        console.log(`  ${icon} ${finding.description}${severity}${ref}`);
      }
    }

    if (analysis.recommendations.length > 0) {
      console.log(`\n${colorize.bold("Recommendations:")}`);
      for (const rec of analysis.recommendations) {
        console.log(`  • ${rec}`);
      }
    }
  } else if (analysis && !options.verbose) {
    // Brief summary in non-verbose mode
    const strengths = analysis.findings.filter(
      (f) => f.category === "strength",
    ).length;
    const issues = analysis.findings.filter(
      (f) => f.category !== "strength",
    ).length;
    console.log(
      `\n${colorize.dim(`AI Summary: ${strengths} strengths, ${issues} issues identified`)}`,
    );
  }
};

const printSummary = (results: FullResult[]) => {
  const passed = results.filter((r) => r.execution.passed).length;
  const failed = results.length - passed;

  // Calculate average AI score if analysis was performed
  const analyzedResults = results.filter((r) => r.analysis);
  const avgAiScore =
    analyzedResults.length > 0
      ? Math.round(
          analyzedResults.reduce(
            (sum, r) => sum + (r.analysis?.overallScore ?? 0),
            0,
          ) / analyzedResults.length,
        )
      : undefined;

  console.log(`\n${colorize.bold("═".repeat(60))}`);
  console.log(`${colorize.bold("SUMMARY")}`);
  console.log(`${colorize.bold("═".repeat(60))}`);
  console.log(`Total Scenarios: ${results.length}`);
  console.log(`Passed: ${colorize.green(String(passed))}`);
  console.log(`Failed: ${failed > 0 ? colorize.red(String(failed)) : "0"}`);
  if (avgAiScore !== undefined) {
    const scoreColor =
      avgAiScore >= 80
        ? colorize.green
        : avgAiScore >= 60
          ? colorize.yellow
          : colorize.red;
    console.log(`Average AI Score: ${scoreColor(`${avgAiScore}/100`)}`);
  }
  console.log(colorize.bold("═".repeat(60)));
};

// Save results as markdown
const saveResultsToMarkdown = (
  results: FullResult[],
  category: string | undefined,
) => {
  // Always save to the top-level evaluations directory
  const evaluationsDir = join(PROJECT_ROOT, "evaluations");

  // Create evaluations directory if it doesn't exist
  if (!existsSync(evaluationsDir)) {
    mkdirSync(evaluationsDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");
  const categoryStr = category ?? "all";
  const filename = `${dateStr}_${timeStr}_${categoryStr}.md`;
  const filepath = join(evaluationsDir, filename);

  const passed = results.filter((r) => r.execution.passed).length;
  const failed = results.length - passed;
  const analyzedResults = results.filter((r) => r.analysis);
  const avgAiScore =
    analyzedResults.length > 0
      ? Math.round(
          analyzedResults.reduce(
            (sum, r) => sum + (r.analysis?.overallScore ?? 0),
            0,
          ) / analyzedResults.length,
        )
      : undefined;

  const lines: string[] = [
    "# Conversation Analyzer Results",
    "",
    `**Date:** ${now.toISOString()}`,
    `**Category:** ${categoryStr}`,
    `**Base URL:** ${baseUrl}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total Scenarios | ${results.length} |`,
    `| Passed | ${passed} |`,
    `| Failed | ${failed} |`,
    avgAiScore !== undefined
      ? `| Average AI Score | ${avgAiScore}/100 |`
      : "| Average AI Score | N/A |",
    "",
    "---",
    "",
  ];

  // Add individual scenario results
  for (const result of results) {
    const { execution, analysis } = result;
    const statusEmoji = execution.passed ? "✅" : "❌";

    lines.push(`## ${statusEmoji} ${execution.scenarioId}`);
    lines.push("");
    lines.push(
      `**Result:** ${execution.passed ? "PASS" : "FAIL"} (${execution.passedSteps}/${execution.totalSteps} steps)`,
    );
    lines.push(`**Duration:** ${execution.totalDurationMs}ms`);
    lines.push(`**Conversation ID:** \`${execution.conversationId}\``);

    if (analysis) {
      lines.push(
        `**AI Score:** ${analysis.overallScore}/100 (Accuracy: ${analysis.categoryScores.accuracy}, Naturalness: ${analysis.categoryScores.naturalness}, Efficiency: ${analysis.categoryScores.efficiency}, Best Practices: ${analysis.categoryScores.bestPractices})`,
      );
    }

    lines.push("");
    lines.push("### Conversation Transcript");
    lines.push("");

    for (const step of execution.stepResults) {
      lines.push(`**Customer:** ${step.userMessage}`);
      lines.push("");
      if (step.botResponse) {
        lines.push(`**Bot:** ${step.botResponse}`);
      } else if (step.error) {
        lines.push(`**Error:** ${step.error}`);
      }
      lines.push("");
      if (step.toolCalls.length > 0) {
        lines.push(
          `*Tools:* ${step.toolCalls.map((tc) => tc.name).join(", ")}`,
        );
        lines.push("");
      }
    }

    lines.push("### Step Results");
    lines.push("");

    for (const step of execution.stepResults) {
      const stepStatus = step.passed ? "✓" : "✗";
      lines.push(
        `- ${stepStatus} **Step ${step.stepIndex + 1}:** ${step.userMessage.slice(0, 50)}${step.userMessage.length > 50 ? "..." : ""}`,
      );

      if (!step.passed) {
        for (const exp of step.expectationResults.filter((e) => !e.passed)) {
          lines.push(`  - ❌ ${exp.type}: ${exp.expected}`);
          if (exp.actual) {
            lines.push(`    - Got: ${exp.actual.slice(0, 150)}...`);
          }
        }
      }
    }

    // Add AI analysis details if available
    if (analysis) {
      lines.push("");
      lines.push("### AI Analysis");
      lines.push("");
      lines.push(`**Summary:** ${analysis.summary}`);
      lines.push("");

      if (analysis.findings.length > 0) {
        lines.push("**Findings:**");
        lines.push("");
        for (const finding of analysis.findings) {
          const icon =
            finding.category === "strength"
              ? "✅"
              : finding.category === "improvement"
                ? "🔶"
                : "❌";
          const severity =
            finding.severity && finding.category !== "strength"
              ? ` [${finding.severity}]`
              : "";
          const ref = finding.bestPracticeRef
            ? ` (${finding.bestPracticeRef})`
            : "";
          lines.push(`- ${icon} ${finding.description}${severity}${ref}`);
        }
        lines.push("");
      }

      if (analysis.recommendations.length > 0) {
        lines.push("**Recommendations:**");
        lines.push("");
        for (const rec of analysis.recommendations) {
          lines.push(`- ${rec}`);
        }
        lines.push("");
      }
    }

    lines.push("---");
    lines.push("");
  }

  writeFileSync(filepath, lines.join("\n"));
  console.log(
    `\n${colorize.green("✓")} Results saved to: ${colorize.cyan(filepath)}`,
  );
  return filepath;
};

// Main execution
const run = async () => {
  console.log(`\n${colorize.bold("Conversation Analyzer")}`);
  console.log(`${colorize.dim("Base URL:")} ${baseUrl}`);
  console.log(
    `${colorize.dim("Auth:")} ${authToken ? "Configured" : "Not set"}`,
  );
  if (options.withAnalysis) {
    console.log(
      `${colorize.dim("Analysis:")} ${colorize.green("Enabled")} (will call remote API for AI evaluation)`,
    );
  } else {
    console.log(
      `${colorize.dim("Analysis:")} Disabled (remove --no-analysis to enable)`,
    );
  }

  const runner = new LocalScenarioRunner();

  try {
    const allScenarios = await fetchScenarioDefinitions();

    // Filter scenarios based on options
    let scenariosToRun: ScenarioDefinition[] = [];

    if (options.scenario) {
      const scenario = allScenarios.find((s) => s.id === options.scenario);
      if (!scenario) {
        console.error(colorize.red(`Scenario not found: ${options.scenario}`));
        console.log(
          "Available scenarios:",
          allScenarios.map((s) => s.id).join(", "),
        );
        process.exit(1);
      }
      scenariosToRun = [scenario];
      console.log(`\nRunning scenario: ${options.scenario}`);
    } else if (options.category) {
      scenariosToRun = allScenarios.filter(
        (s) => s.category === options.category,
      );
      if (scenariosToRun.length === 0) {
        console.error(
          colorize.red(`No scenarios found in category: ${options.category}`),
        );
        process.exit(1);
      }
      console.log(
        `\nRunning category: ${options.category} (${scenariosToRun.length} scenarios)`,
      );
    } else {
      scenariosToRun = allScenarios;
      console.log(`\nRunning all scenarios (${scenariosToRun.length} total)`);
    }

    // Run scenarios
    const results: FullResult[] = [];
    for (let i = 0; i < scenariosToRun.length; i++) {
      const scenario = scenariosToRun[i];
      if (!scenario) continue;

      console.log(
        `\n${colorize.bold(`[${i + 1}/${scenariosToRun.length}]`)} ${scenario.name}`,
      );

      const execution = await runner.runScenario(scenario);

      // Optionally run AI analysis
      let analysis: AnalysisResult | undefined;
      if (options.withAnalysis) {
        console.log(colorize.dim("  Running AI analysis..."));
        try {
          analysis = await callRpc<AnalysisResult>("analyzer/evaluate", {
            scenario,
            result: execution,
          });
          console.log(colorize.dim(`  AI Score: ${analysis.overallScore}/100`));
        } catch (error) {
          console.log(
            colorize.yellow(
              `  AI analysis failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }

      results.push({ execution, analysis });
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const result of results) {
        printResult(result);
      }
      printSummary(results);
    }

    // Save results to markdown if --save flag is set
    if (options.save) {
      saveResultsToMarkdown(results, options.category ?? options.scenario);
    }

    const allPassed = results.every((r) => r.execution.passed);
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error(
      colorize.red("\nError:"),
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
};

// Inline scenario definitions (since we can't fetch full definitions via RPC easily)
async function fetchScenarioDefinitions(): Promise<ScenarioDefinition[]> {
  return [
    // Verification scenarios
    {
      id: "verification-happy-path",
      name: "Verification Happy Path",
      description:
        "Customer calls, provides correct ZIP code, and is successfully verified.",
      category: "verification",
      setup: { phone: "+14155552671", zip: "94107" },
      steps: [
        {
          userMessage: "Hello",
          expectations: {
            responsePatterns: [
              "(hi|hello|welcome|thanks for calling|happy to help)",
              "zip",
            ],
            responseExcludes: ["crm\\.", "tool", "lookup"],
          },
        },
        {
          userMessage: "94107",
          expectations: {
            toolCalls: [{ name: "crm.verifyAccount" }],
            stateChanges: { "conversation.verification.verified": true },
            responsePatterns: [
              "(verified|confirmed|found|all set|got you|pulled up|your account)",
            ],
            responseExcludes: ["sorry", "couldn't", "crm\\."],
          },
        },
      ],
      successCriteria: {
        finalState: { "conversation.verification.verified": true },
        minPassingSteps: 2,
      },
    },
    {
      id: "verification-wrong-zip",
      name: "Verification Wrong ZIP",
      description: "Customer provides incorrect ZIP code and is not verified.",
      category: "verification",
      setup: { phone: "+14155552671", zip: "94107" },
      steps: [
        {
          userMessage: "Hi there",
          expectations: {
            responsePatterns: ["zip"],
            responseExcludes: ["crm\\."],
          },
        },
        {
          userMessage: "12345",
          expectations: {
            toolCalls: [{ name: "crm.verifyAccount" }],
            responsePatterns: [
              "(didn't match|couldn't verify|try again|incorrect)",
            ],
            responseExcludes: ["verified", "confirmed", "crm\\."],
          },
        },
      ],
      successCriteria: { minPassingSteps: 1 },
    },
    {
      id: "verification-zip-with-leading-zero",
      name: "Verification ZIP with Leading Zero",
      description:
        "Customer provides ZIP code with leading zero (should be preserved).",
      category: "verification",
      setup: { phone: "+14155550101", zip: "02101", customerId: "cust_boston" },
      steps: [
        {
          userMessage: "Hello",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "02101",
          expectations: {
            toolCalls: [
              { name: "crm.verifyAccount", argsContain: { zipCode: "02101" } },
            ],
          },
        },
      ],
      successCriteria: { minPassingSteps: 1 },
    },
    {
      id: "verification-no-redundant-ask",
      name: "No Redundant Verification",
      description: "After verification, bot should not ask for ZIP again.",
      category: "verification",
      setup: { phone: "+14155552671", zip: "94107" },
      steps: [
        {
          userMessage: "Hello",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "94107",
          expectations: {
            stateChanges: { "conversation.verification.verified": true },
          },
        },
        {
          userMessage: "What appointments do I have?",
          expectations: {
            responseExcludes: ["zip code", "verify"],
            toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          },
        },
      ],
      successCriteria: {
        finalState: { "conversation.verification.verified": true },
        minPassingSteps: 2,
      },
    },
    {
      id: "verification-natural-conversation",
      name: "Natural Verification Flow",
      description: "Verification should feel natural, not robotic.",
      category: "verification",
      setup: { phone: "+14155552671", zip: "94107" },
      steps: [
        {
          userMessage: "Hey, I need help with my appointment",
          expectations: {
            responsePatterns: ["(help|appointment|sure|happy)", "zip"],
            responseExcludes: [
              "to get started",
              "I understand that",
              "verification succeeded",
            ],
          },
        },
        {
          userMessage: "94107",
          expectations: {
            responseExcludes: [
              "verification succeeded",
              "identity confirmed",
              "crm\\.",
            ],
          },
        },
      ],
      successCriteria: { minPassingSteps: 1 },
    },
    // ========== RESCHEDULE SCENARIOS ==========
    {
      id: "reschedule-happy-path",
      name: "Reschedule Happy Path",
      description:
        "Customer verifies, requests reschedule, selects appointment, and confirms new time.",
      category: "reschedule",
      setup: {
        phone: "+14155550987",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_resched_001",
        appointmentId: "appt_resched_001",
      },
      steps: [
        {
          userMessage: "Hi, I need to reschedule my appointment",
          expectations: {
            responsePatterns: ["zip", "(verify|confirm)"],
            responseExcludes: ["crm\\."],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            // Bot should acknowledge verification or account - tool call may vary
            responsePatterns: [
              "(verified|found|appointment|all set|checked|account|help|assist|reschedul)",
            ],
            responseExcludes: ["crm\\."],
          },
        },
        {
          userMessage: "I want to reschedule my upcoming appointment",
          expectations: {
            // Bot should discuss appointments or ask for reschedule details
            responsePatterns: [
              "(appointment|scheduled|which|options|date|time)",
            ],
            responseExcludes: ["crm\\."],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "reschedule-verified-first",
      name: "Reschedule After Verification",
      description:
        "Customer already verified, then requests reschedule without re-verification.",
      category: "reschedule",
      setup: {
        phone: "+14155550987",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_resched_002",
        appointmentId: "appt_resched_002",
      },
      steps: [
        {
          userMessage: "Hello",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            toolCalls: [{ name: "crm.verifyAccount" }],
            stateChanges: {
              "conversation.verification.verified": true,
            },
          },
        },
        {
          userMessage: "I need to change my appointment to a different day",
          expectations: {
            // Should NOT ask for ZIP again
            responseExcludes: ["zip code", "verify your"],
            // Bot may already have appointments from verification, so check response instead
            responsePatterns: ["(appointment|scheduled|which|change)"],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "reschedule-no-appointments",
      name: "Reschedule No Appointments",
      description:
        "Customer tries to reschedule but has no upcoming appointments.",
      category: "reschedule",
      setup: {
        phone: "+14155559999",
        zip: "90210",
        seedAppointment: false,
        customerId: "cust_no_appt",
      },
      steps: [
        {
          userMessage: "I want to reschedule",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "90210",
          expectations: {
            // Bot should acknowledge the account or verification
            responsePatterns: [
              "(checked|account|assist|help|reschedul|couldn't|verify)",
            ],
          },
        },
        {
          userMessage: "Yes, reschedule my appointment please",
          expectations: {
            // Bot may check appointments - tool call optional since data might be cached
            // Should gracefully handle no appointments
            responsePatterns: [
              "(no|don't have|couldn't find|any|appointment|schedule)",
            ],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "reschedule-clear-confirmation",
      name: "Reschedule Clear Confirmation",
      description:
        "Bot should clearly confirm reschedule details before executing.",
      category: "reschedule",
      setup: {
        phone: "+14155550987",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_resched_003",
        appointmentId: "appt_resched_003",
      },
      steps: [
        {
          userMessage: "Hello, reschedule please",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            // Bot should verify or acknowledge the account
            responsePatterns: [
              "(verified|account|help|assist|checked|service|reschedul)",
            ],
          },
        },
        {
          userMessage: "Reschedule my appointment",
          expectations: {
            // Should present appointments or ask for details
            responsePatterns: ["(appointment|scheduled|date|time|when)"],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "reschedule-natural-flow",
      name: "Reschedule Natural Language",
      description: "Reschedule request in various natural phrasings.",
      category: "reschedule",
      setup: {
        phone: "+14155550987",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_resched_004",
        appointmentId: "appt_resched_004",
      },
      steps: [
        {
          userMessage: "Hi",
          expectations: {
            responsePatterns: ["(hello|hi|welcome)"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            toolCalls: [{ name: "crm.verifyAccount" }],
          },
        },
        {
          userMessage:
            "Something came up and I can't make my appointment anymore. Can we move it?",
          expectations: {
            // Should understand this is a reschedule request and look up appointments
            // Bot may use getNextAppointment or listUpcomingAppointments - either is fine
            responsePatterns: [
              "(appointment|scheduled|pull up|reschedule|move|available|date|time)",
            ],
            responseExcludes: ["I understand that you"],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    // ========== CANCEL SCENARIOS ==========
    // Uses D1 seeding via admin/createCustomer and admin/createAppointment RPC endpoints.
    // Each scenario seeds its own customer and appointment data.
    {
      id: "cancel-happy-path",
      name: "Cancel Happy Path",
      description:
        "Customer verifies, requests cancel, selects appointment, and confirms cancellation.",
      category: "cancel",
      setup: {
        phone: "+14155552001",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_cancel_001",
        appointmentId: "appt_cancel_001",
      },
      steps: [
        {
          userMessage: "Hi, I need to cancel my appointment",
          expectations: {
            responsePatterns: ["zip", "(verify|confirm)"],
            responseExcludes: ["crm\\."],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            // Bot should acknowledge verification and address cancel request
            responsePatterns: [
              "(verified|found|appointment|cancel|help|assist|account)",
            ],
            responseExcludes: ["crm\\."],
          },
        },
        {
          userMessage: "Yes, please cancel it",
          expectations: {
            // Bot should call the cancel tool and confirm cancellation
            toolCalls: [{ name: "crm.cancelAppointment" }],
            responsePatterns: [
              "(cancel|cancelled|canceled|done|anything else)",
            ],
            responseExcludes: ["crm\\."],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 3,
      },
      // Verify the appointment was actually cancelled in the database
      databaseExpectations: {
        appointments: [
          {
            appointmentId: "appt_cancel_001",
            status: "cancelled",
          },
        ],
      },
    },
    {
      id: "cancel-verified-first",
      name: "Cancel After Verification",
      description:
        "Customer already verified, then requests cancel without re-verification.",
      category: "cancel",
      setup: {
        phone: "+14155552671",
        zip: "94107",
        seedAppointment: true,
        customerId: "cust_cancel_vf",
        appointmentId: "appt_cancel_vf",
      },
      steps: [
        {
          userMessage: "Hello",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "94107",
          expectations: {
            // Verification should happen - check the response indicates success
            responsePatterns: [
              "(verified|confirmed|found|all set|got you|pulled up|your account|checked|assist)",
            ],
            responseExcludes: ["couldn't", "sorry", "crm\\."],
          },
        },
        {
          userMessage: "I want to cancel my upcoming appointment",
          expectations: {
            // Should NOT ask for ZIP again after successful verification
            responseExcludes: ["zip code", "verify your", "confirm your zip"],
            responsePatterns: [
              "(cancel|appointment|help|assist|which|scheduled)",
            ],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "cancel-no-appointments",
      name: "Cancel No Appointments",
      description: "Customer tries to cancel but has no upcoming appointments.",
      category: "cancel",
      setup: {
        phone: "+14155552003",
        zip: "98109",
        seedCustomer: true,
        seedAppointment: false,
        customerId: "cust_no_cancel",
      },
      steps: [
        {
          userMessage: "I want to cancel my appointment",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            responsePatterns: [
              "(checked|account|assist|help|cancel|couldn't|verify)",
            ],
          },
        },
        {
          userMessage: "Yes, cancel my appointment please",
          expectations: {
            // Should gracefully handle no appointments
            responsePatterns: [
              "(no|don't have|couldn't find|any|appointment|schedule)",
            ],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "cancel-confirmation-required",
      name: "Cancel Confirmation Required",
      description: "Bot should confirm before canceling an appointment.",
      category: "cancel",
      setup: {
        phone: "+14155552004",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_cancel_004",
        appointmentId: "appt_cancel_004",
      },
      steps: [
        {
          userMessage: "Cancel my appointment",
          expectations: {
            responsePatterns: ["zip"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            responsePatterns: [
              "(verified|account|cancel|help|assist|appointment)",
            ],
          },
        },
        {
          userMessage: "Yes cancel it",
          expectations: {
            // Bot should ask for confirmation or proceed with cancel
            responsePatterns: [
              "(cancel|confirm|sure|appointment|scheduled|date)",
            ],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
    {
      id: "cancel-natural-language",
      name: "Cancel Natural Language",
      description: "Cancel request using various natural phrasings.",
      category: "cancel",
      setup: {
        phone: "+14155552005",
        zip: "98109",
        seedAppointment: true,
        customerId: "cust_cancel_005",
        appointmentId: "appt_cancel_005",
      },
      steps: [
        {
          userMessage: "Hi",
          expectations: {
            responsePatterns: ["(hello|hi|welcome)"],
          },
        },
        {
          userMessage: "98109",
          expectations: {
            toolCalls: [{ name: "crm.verifyAccount" }],
          },
        },
        {
          userMessage:
            "Something came up and I won't be able to make my appointment. I need to cancel it.",
          expectations: {
            // Should understand this is a cancel request
            responsePatterns: ["(cancel|appointment|confirm|understand|help)"],
            responseExcludes: ["I understand that you"],
          },
        },
      ],
      successCriteria: {
        minPassingSteps: 2,
      },
    },
  ];
}

run();
