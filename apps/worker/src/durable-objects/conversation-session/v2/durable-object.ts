/**
 * Durable Object wrapper for ConversationSession v2
 *
 * This class can be exported from the worker and used as a Durable Object.
 * It wraps the v2 session and handles the DO lifecycle.
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import {
  type AgentPromptConfig,
  agentPromptConfigSchema,
} from "@pestcall/core";
import { createDependencies } from "../../../context";
import type { Env } from "../../../env";
import { createSession } from "./factory";
import type { ConversationSessionV2 } from "./session";

/**
 * Default agent configuration using schema defaults.
 */
const defaultAgentConfig: AgentPromptConfig = agentPromptConfigSchema.parse({});

/**
 * ConversationSessionV2DO - Durable Object wrapper
 *
 * This is the class that gets exported and instantiated by Cloudflare.
 * It creates a v2 session internally and delegates all requests to it.
 *
 * Usage in wrangler.toml:
 * ```toml
 * [[durable_objects.bindings]]
 * name = "CONVERSATION_SESSION_V2"
 * class_name = "ConversationSessionV2DO"
 * ```
 *
 * Usage in worker:
 * ```ts
 * export { ConversationSessionV2DO } from "./durable-objects/conversation-session/v2";
 * ```
 */
export class ConversationSessionV2DO {
  private state: DurableObjectState;
  private env: Env;
  private session: ConversationSessionV2 | null = null;
  private initPromise: Promise<ConversationSessionV2> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Initialize the session lazily on first request.
   */
  private async ensureSession(): Promise<ConversationSessionV2> {
    if (this.session) {
      return this.session;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  /**
   * Initialize the v2 session with all dependencies.
   */
  private async initialize(): Promise<ConversationSessionV2> {
    // Create dependencies (includes logger)
    const deps = createDependencies(this.env);

    // Get agent config (with fallback to defaults)
    let agentConfig: AgentPromptConfig;
    try {
      agentConfig = await deps.agentConfig.get(defaultAgentConfig);
    } catch {
      agentConfig = defaultAgentConfig;
    }

    // Create the v2 session
    this.session = createSession({
      durableState: this.state,
      ai: this.env.AI,
      logger: deps.logger,
      deps,
      agentConfig,
      streamId: 1,
      env: this.env as unknown as Record<string, unknown>,
    });

    return this.session;
  }

  /**
   * Handle incoming requests.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const session = await this.ensureSession();
      return session.fetch(request);
    } catch (error) {
      console.error("ConversationSessionV2DO error:", error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}
