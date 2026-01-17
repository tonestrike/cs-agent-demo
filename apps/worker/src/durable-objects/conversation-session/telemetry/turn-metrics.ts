/**
 * Turn metrics tracking for conversation sessions
 */

export type TurnMetrics = {
  callSessionId: string;
  startedAt: number;
  firstTokenAt: number | null;
  firstStatusAt: number | null;
};

export type TurnTimings = {
  verificationMs?: number;
  workflowSelectionMs?: number;
  toolFlowMs?: number;
  agentMessageMs?: number;
  totalMs?: number;
  modelAdapterMs?: number;
  customerContextMs?: number;
  recentMessagesMs?: number;
  modelGenerateMs?: number;
  preWorkMs?: number;
};

export type TurnDecision = {
  decisionType: string;
  toolName?: string | null;
  argKeys?: string[];
  acknowledgementLength?: number;
  finalLength?: number;
};

export type ModelCall = {
  kind: "generate" | "respond" | "status";
  provider: string;
  modelId: string | null;
};

export type ToolCall = {
  toolName: string;
  argKeys: string[];
};

/**
 * State managed by the turn metrics tracker
 */
export type TurnMetricsState = {
  metrics: TurnMetrics | null;
  timings: TurnTimings | null;
  decision: TurnDecision | null;
  modelCalls: ModelCall[];
  toolCalls: ToolCall[];
  statusTexts: string[];
};

/**
 * Create a turn metrics tracker
 */
export function createTurnMetricsTracker() {
  let state: TurnMetricsState = {
    metrics: null,
    timings: null,
    decision: null,
    modelCalls: [],
    toolCalls: [],
    statusTexts: [],
  };

  /**
   * Start tracking a new turn
   */
  function startTurn(callSessionId: string): void {
    state = {
      metrics: {
        callSessionId,
        startedAt: Date.now(),
        firstTokenAt: null,
        firstStatusAt: null,
      },
      timings: {},
      decision: null,
      modelCalls: [],
      toolCalls: [],
      statusTexts: [],
    };
  }

  /**
   * End the current turn tracking
   */
  function endTurn(): void {
    if (state.metrics && state.timings) {
      state.timings.totalMs = Date.now() - state.metrics.startedAt;
    }
    state.metrics = null;
  }

  /**
   * Record the first token emission time
   */
  function recordFirstToken(): void {
    if (!state.metrics || state.metrics.firstTokenAt !== null) {
      return;
    }
    state.metrics.firstTokenAt = Date.now();
  }

  /**
   * Record the first status emission time
   */
  function recordFirstStatus(): void {
    if (!state.metrics || state.metrics.firstStatusAt !== null) {
      return;
    }
    state.metrics.firstStatusAt = Date.now();
  }

  /**
   * Record a model call
   */
  function recordModelCall(
    kind: "generate" | "respond" | "status",
    model: { name: string; modelId?: string | null },
  ): void {
    state.modelCalls.push({
      kind,
      provider: model.name,
      modelId: model.modelId ?? null,
    });
  }

  /**
   * Record a tool call
   */
  function recordToolCall(toolName: string, argKeys: string[]): void {
    state.toolCalls.push({ toolName, argKeys });
  }

  /**
   * Record a status text
   */
  function recordStatusText(text: string): void {
    state.statusTexts.push(text);
  }

  /**
   * Set the turn decision
   */
  function setDecision(decision: TurnDecision): void {
    state.decision = decision;
  }

  /**
   * Set a timing value
   */
  function setTiming<K extends keyof TurnTimings>(
    key: K,
    value: TurnTimings[K],
  ): void {
    if (!state.timings) {
      state.timings = {};
    }
    state.timings[key] = value;
  }

  /**
   * Check if first token has been recorded
   */
  function hasFirstToken(): boolean {
    return state.metrics?.firstTokenAt !== null;
  }

  /**
   * Get the current metrics state
   */
  function getMetrics(): TurnMetrics | null {
    return state.metrics;
  }

  /**
   * Get the current timings state
   */
  function getTimings(): TurnTimings | null {
    return state.timings;
  }

  /**
   * Build the turn metadata for recording
   */
  function buildTurnMeta(
    callSessionId: string,
    turnId: number | null,
    streamId: number,
    messageId: string | null,
  ): Record<string, unknown> {
    const metrics = state.metrics;
    const startedAt = metrics?.startedAt ?? Date.now();
    const firstTokenMs =
      !metrics || metrics.firstTokenAt === null
        ? null
        : metrics.firstTokenAt - startedAt;
    const firstStatusMs =
      !metrics || metrics.firstStatusAt === null
        ? null
        : metrics.firstStatusAt - startedAt;

    return {
      callSessionId,
      turnId,
      streamId,
      messageId,
      modelCalls: [...state.modelCalls],
      decision: state.decision,
      toolCalls: [...state.toolCalls],
      statusTexts: [...state.statusTexts],
      timings: state.timings ? { ...state.timings } : null,
      latency: {
        firstTokenMs,
        firstStatusMs,
      },
    };
  }

  return {
    startTurn,
    endTurn,
    recordFirstToken,
    recordFirstStatus,
    recordModelCall,
    recordToolCall,
    recordStatusText,
    setDecision,
    setTiming,
    hasFirstToken,
    getMetrics,
    getTimings,
    buildTurnMeta,
    getState: () => state,
  };
}

export type TurnMetricsTracker = ReturnType<typeof createTurnMetricsTracker>;
