/**
 * Fallback message builder with diagnostic context
 *
 * When the tool model fails to produce a valid response, we emit a fallback
 * that includes diagnostic information to help debug why intent wasn't understood.
 */

/** Diagnostic context for fallback messages */
export type FallbackDiagnostics = {
  /** Why we're falling back */
  reason:
    | "empty_final_text"
    | "invalid_tool_decision"
    | "adapter_parse_error"
    | "unknown";
  /** The user's original message */
  userMessage: string;
  /** Recent conversation history (truncated) */
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Model context string sent to the model */
  modelContext: string | null;
  /** Provider name (openrouter, workers-ai, etc.) */
  provider: string;
  /** Specific model ID if known */
  modelId: string | null;
  /** Raw decision type from model (if any) */
  rawDecisionType?: string | null;
  /** Raw text from model (if any) */
  rawText?: string | null;
};

const USER_FACING_FALLBACK =
  "I could not interpret the request. Can you rephrase? I can also connect you with a person.";

/**
 * Build a fallback response with embedded diagnostics.
 *
 * The diagnostics are JSON-encoded in a hidden section that doesn't
 * affect the conversational flow but can be inspected in logs/debug views.
 */
export function buildFallbackWithDiagnostics(
  diagnostics: FallbackDiagnostics,
): string {
  // Truncate messages for readability
  const truncatedMessages = diagnostics.recentMessages.slice(-5).map((m) => ({
    role: m.role,
    content: m.content.length > 100 ? `${m.content.slice(0, 100)}...` : m.content,
  }));

  const debugPayload = {
    reason: diagnostics.reason,
    userMessage: diagnostics.userMessage,
    messageHistory: truncatedMessages,
    context: diagnostics.modelContext
      ? diagnostics.modelContext.slice(0, 500)
      : null,
    provider: diagnostics.provider,
    modelId: diagnostics.modelId,
    rawDecisionType: diagnostics.rawDecisionType,
    rawText: diagnostics.rawText?.slice(0, 200),
  };

  // Embed diagnostics as a JSON block after the user-facing message
  // This appears in the response text and can be parsed out for debugging
  const diagnosticsBlock = `\n\n---DEBUG---\n${JSON.stringify(debugPayload, null, 2)}\n---/DEBUG---`;

  return `${USER_FACING_FALLBACK}${diagnosticsBlock}`;
}

/**
 * Extract diagnostics from a fallback message (for testing/inspection).
 */
export function extractDiagnosticsFromFallback(
  fallbackText: string,
): FallbackDiagnostics | null {
  const match = fallbackText.match(/---DEBUG---\n([\s\S]*?)\n---\/DEBUG---/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]) as FallbackDiagnostics;
  } catch {
    return null;
  }
}

/**
 * Check if a message contains the interpret fallback.
 */
export function isInterpretFallback(text: string): boolean {
  return text.includes("I could not interpret the request");
}

/** Analysis result from debug summary */
export type DebugAnalysis = {
  /** One-line summary of what went wrong */
  summary: string;
  /** Severity level */
  severity: "low" | "medium" | "high";
  /** Detected issues */
  issues: string[];
  /** Suggested actions to investigate */
  suggestions: string[];
  /** Key facts extracted from diagnostics */
  facts: Record<string, string>;
};

/**
 * Analyze diagnostics and generate a human-readable debug summary.
 *
 * This takes raw diagnostics and produces actionable insights about
 * what went wrong and how to fix it.
 */
export function analyzeDebugDiagnostics(
  diagnostics: FallbackDiagnostics,
): DebugAnalysis {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const facts: Record<string, string> = {};

  // Extract key facts
  facts["Trigger"] = diagnostics.reason.replace(/_/g, " ");
  facts["Provider"] = diagnostics.provider;
  facts["Model"] = diagnostics.modelId ?? "unknown";
  facts["User message"] = diagnostics.userMessage || "(empty)";
  facts["Message count"] = String(diagnostics.recentMessages.length);

  // Analyze the user message for clear intent
  const userMsg = diagnostics.userMessage.toLowerCase();
  const hasRescheduleIntent = /reschedule|move|change.*(time|date|appointment)/.test(userMsg);
  const hasCancelIntent = /cancel|remove|delete/.test(userMsg);
  const hasScheduleIntent = /schedule|book|set up|make.*(appointment)/.test(userMsg);
  const hasBillingIntent = /bill|payment|invoice|pay|charge|balance/.test(userMsg);
  const hasGreeting = /^(hi|hello|hey|good morning|good afternoon)\b/i.test(userMsg);
  const hasQuestion = userMsg.includes("?");

  const detectedIntent = hasRescheduleIntent
    ? "reschedule"
    : hasCancelIntent
      ? "cancel"
      : hasScheduleIntent
        ? "schedule"
        : hasBillingIntent
          ? "billing"
          : hasGreeting
            ? "greeting"
            : hasQuestion
              ? "question"
              : null;

  if (detectedIntent) {
    facts["Detected intent"] = detectedIntent;
  }

  // Issue detection based on reason
  switch (diagnostics.reason) {
    case "empty_final_text":
      issues.push("Model returned 'final' decision with no text");
      if (detectedIntent && detectedIntent !== "greeting") {
        issues.push(
          `Clear "${detectedIntent}" intent detected but model chose final instead of tool`,
        );
        suggestions.push(
          `Check if "${detectedIntent}" tools are available and properly described`,
        );
        suggestions.push("Model may need stronger prompting to use tools for this intent");
      }
      break;

    case "invalid_tool_decision":
      issues.push("Model returned malformed tool call");
      suggestions.push("Check model response format matches expected schema");
      suggestions.push("May need to adjust tool_choice parameter or model temperature");
      break;

    case "adapter_parse_error":
      issues.push("Failed to parse model response");
      suggestions.push("Check adapter logs for raw response");
      suggestions.push("Model may be returning unexpected format");
      break;

    case "unknown":
      issues.push("Unknown failure reason");
      suggestions.push("Check conversation-session logs for more context");
      break;
  }

  // Analyze message history patterns
  const history = diagnostics.recentMessages;
  const assistantMsgs = history.filter((m) => m.role === "assistant");
  const userMsgs = history.filter((m) => m.role === "user");

  if (assistantMsgs.length > userMsgs.length + 1) {
    issues.push("More assistant messages than user messages (possible status message pollution)");
    suggestions.push("Check if status/system messages are leaking into tool model history");
  }

  // Check for repeated assistant messages (could indicate loop)
  const lastAssistantMsgs = assistantMsgs.slice(-3).map((m) => m.content);
  const uniqueLastMsgs = new Set(lastAssistantMsgs);
  if (lastAssistantMsgs.length >= 2 && uniqueLastMsgs.size === 1) {
    issues.push("Assistant repeating same message (possible loop)");
    suggestions.push("Check for infinite loop in conversation handling");
  }

  // Check context issues
  if (!diagnostics.modelContext) {
    issues.push("No model context provided");
    suggestions.push("Verify buildModelContext is generating context");
  } else if (diagnostics.modelContext.length < 50) {
    issues.push("Model context suspiciously short");
    suggestions.push("Check if verification state and cached data are being included");
  }

  // Check if raw text gives clues
  if (diagnostics.rawText) {
    facts["Raw output"] = diagnostics.rawText.slice(0, 100);
    if (diagnostics.rawText.includes("I cannot") || diagnostics.rawText.includes("I'm unable")) {
      issues.push("Model refused the request");
      suggestions.push("Check if request triggered safety filters");
    }
  }

  // Determine severity
  let severity: "low" | "medium" | "high" = "low";
  if (detectedIntent && detectedIntent !== "greeting" && detectedIntent !== "question") {
    severity = "high"; // Clear actionable intent was missed
  } else if (issues.length > 2) {
    severity = "medium";
  }

  // Generate summary
  let summary: string;
  if (detectedIntent && diagnostics.reason === "empty_final_text") {
    summary = `Model returned empty final despite clear "${detectedIntent}" intent`;
  } else if (diagnostics.reason === "empty_final_text") {
    summary = "Model returned empty final (no clear intent detected)";
  } else if (diagnostics.reason === "invalid_tool_decision") {
    summary = "Model returned malformed tool call";
  } else if (diagnostics.reason === "adapter_parse_error") {
    summary = "Failed to parse model response";
  } else {
    summary = `Fallback triggered: ${diagnostics.reason}`;
  }

  // Add default suggestions if none
  if (suggestions.length === 0) {
    suggestions.push("Review model prompt and tool definitions");
    suggestions.push("Check recent model changes or provider issues");
  }

  return { summary, severity, issues, suggestions, facts };
}

/**
 * Format analysis as a human-readable string for logging/display.
 */
export function formatDebugAnalysis(analysis: DebugAnalysis): string {
  const lines: string[] = [];

  // Header with severity
  const severityEmoji = analysis.severity === "high" ? "🔴" : analysis.severity === "medium" ? "🟡" : "🟢";
  lines.push(`${severityEmoji} ${analysis.summary.toUpperCase()}`);
  lines.push("");

  // Facts
  lines.push("📋 Facts:");
  for (const [key, value] of Object.entries(analysis.facts)) {
    lines.push(`   ${key}: ${value}`);
  }
  lines.push("");

  // Issues
  if (analysis.issues.length > 0) {
    lines.push("⚠️  Issues detected:");
    for (const issue of analysis.issues) {
      lines.push(`   • ${issue}`);
    }
    lines.push("");
  }

  // Suggestions
  if (analysis.suggestions.length > 0) {
    lines.push("💡 Suggestions:");
    for (const suggestion of analysis.suggestions) {
      lines.push(`   → ${suggestion}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a complete debug summary from a fallback message.
 *
 * This is the main entry point - extracts diagnostics and generates analysis.
 */
export function generateDebugSummary(fallbackText: string): string | null {
  const diagnostics = extractDiagnosticsFromFallback(fallbackText);
  if (!diagnostics) {
    return null;
  }
  const analysis = analyzeDebugDiagnostics(diagnostics);
  return formatDebugAnalysis(analysis);
}
