/**
 * State management for ConversationSession v2
 *
 * Handles persistence of session state to durable object storage.
 * State is generic - domain-specific data lives in `domainState`.
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import { type Logger, type SessionState, initialSessionState } from "./types";

/** Storage key for session state */
const STATE_KEY = "session_state";

/**
 * State manager for a conversation session.
 *
 * Provides:
 * - Load/save session state
 * - Atomic updates to domain state
 * - Event buffer management
 */
export class StateManager {
  private state: SessionState;
  private durableState: DurableObjectState;
  private logger: Logger;
  private dirty = false;

  constructor(durableState: DurableObjectState, logger: Logger) {
    this.durableState = durableState;
    this.logger = logger;
    this.state = initialSessionState();
  }

  /**
   * Load state from durable object storage.
   * Call this in the session's constructor or fetch handler.
   */
  async load(): Promise<SessionState> {
    try {
      const stored =
        await this.durableState.storage.get<SessionState>(STATE_KEY);
      if (stored) {
        this.state = stored;
        this.logger.debug({ hasState: true }, "state.loaded");
      } else {
        this.state = initialSessionState();
        this.logger.debug({ hasState: false }, "state.initialized");
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "state.load_failed",
      );
      this.state = initialSessionState();
    }
    return this.state;
  }

  /**
   * Get current state (synchronous - use after load()).
   */
  get(): SessionState {
    return this.state;
  }

  /**
   * Update session metadata (phone, callSessionId, etc.).
   */
  async updateMeta(
    updates: Partial<Omit<SessionState, "domainState">>,
  ): Promise<void> {
    this.state = {
      ...this.state,
      ...updates,
      lastActivityAt: Date.now(),
    };
    await this.save();
  }

  /**
   * Update domain-specific state.
   * This is the primary way tools modify state.
   */
  async updateDomain(updates: Record<string, unknown>): Promise<void> {
    this.state = {
      ...this.state,
      domainState: {
        ...this.state.domainState,
        ...updates,
      },
      lastActivityAt: Date.now(),
    };
    await this.save();
  }

  /**
   * Get a value from domain state.
   */
  getDomain<T>(key: string): T | undefined {
    return this.state.domainState[key] as T | undefined;
  }

  /**
   * Set a single domain value.
   */
  async setDomain(key: string, value: unknown): Promise<void> {
    await this.updateDomain({ [key]: value });
  }

  /**
   * Delete a domain value.
   */
  async deleteDomain(key: string): Promise<void> {
    const { [key]: _, ...rest } = this.state.domainState;
    this.state = {
      ...this.state,
      domainState: rest,
      lastActivityAt: Date.now(),
    };
    await this.save();
  }

  /**
   * Clear all domain state.
   */
  async clearDomain(): Promise<void> {
    this.state = {
      ...this.state,
      domainState: {},
      lastActivityAt: Date.now(),
    };
    await this.save();
  }

  /**
   * Reset to initial state.
   */
  async reset(): Promise<void> {
    this.state = initialSessionState();
    await this.save();
    this.logger.info({}, "state.reset");
  }

  /**
   * Save state to durable object storage.
   */
  private async save(): Promise<void> {
    try {
      await this.durableState.storage.put(STATE_KEY, this.state);
      this.dirty = false;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "state.save_failed",
      );
      throw error;
    }
  }

  /**
   * Mark state as dirty (for batched saves).
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Check if state needs saving.
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Flush any pending changes.
   */
  async flush(): Promise<void> {
    if (this.dirty) {
      await this.save();
    }
  }
}

/**
 * Create a state manager.
 *
 * Usage:
 * ```ts
 * const stateManager = createStateManager(durableState, logger);
 * await stateManager.load();
 * const state = stateManager.get();
 * ```
 */
export function createStateManager(
  durableState: DurableObjectState,
  logger: Logger,
): StateManager {
  return new StateManager(durableState, logger);
}
