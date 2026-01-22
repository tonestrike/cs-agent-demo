/**
 * Voice Agent Durable Object
 *
 * Uses Cloudflare's @cloudflare/realtime-agents SDK to provide
 * natural AI voice via WebRTC. This wraps the existing ConversationSessionV2
 * logic to enable voice-based interactions.
 *
 * Architecture:
 * User Speech (WebRTC) → RealtimeKitTransport → STT → TextProcessor → TTS → RealtimeKitTransport → User
 *
 * The TextProcessor bridges to the existing ConversationSessionV2 for
 * all business logic, tools, and workflows.
 */

import {
  DeepgramSTT,
  ElevenLabsTTS,
  RealtimeAgent,
  RealtimeKitTransport,
} from "@cloudflare/realtime-agents";
import {
  type AgentPromptConfig,
  agentPromptConfigSchema,
} from "@pestcall/core";
import { createDependencies } from "../../context";
import type { Env } from "../../env";
import { createSession } from "../conversation-session/v2/factory";
import type { ConversationSessionV2 } from "../conversation-session/v2/session";
import { ConversationTextProcessor } from "./text-processor";

/**
 * Default agent configuration using schema defaults.
 */
const defaultAgentConfig: AgentPromptConfig = agentPromptConfigSchema.parse({});

/**
 * VoiceAgentDO - Durable Object for voice-based AI interactions
 *
 * Extends RealtimeAgent from @cloudflare/realtime-agents to provide:
 * - WebRTC audio transport via RealtimeKit
 * - Speech-to-text via Deepgram (through AI Gateway)
 * - Text-to-speech via ElevenLabs (through AI Gateway)
 * - Full conversation logic via ConversationSessionV2
 *
 * Usage in wrangler.toml:
 * ```toml
 * [[durable_objects.bindings]]
 * name = "VOICE_AGENT"
 * class_name = "VoiceAgentDO"
 * ```
 */
export class VoiceAgentDO extends RealtimeAgent<Env> {
  private session: ConversationSessionV2 | null = null;
  private textProcessor: ConversationTextProcessor | null = null;
  private transport: RealtimeKitTransport | null = null;

  /**
   * Initialize the voice agent pipeline.
   *
   * Called when a voice session starts. Sets up the full pipeline:
   * Transport → STT → TextProcessor → TTS → Transport
   *
   * @param agentId - Unique identifier for this agent instance
   * @param meetingId - RealtimeKit meeting ID
   * @param authToken - RealtimeKit auth token for joining the meeting
   * @param workerUrl - URL of this worker for internal pipeline callbacks
   * @param accountId - Cloudflare account ID
   * @param apiToken - Cloudflare API token for AI Gateway
   * @param options - Additional options like phone number and call session ID
   */
  async init(
    agentId: string,
    meetingId: string,
    authToken: string,
    workerUrl: string,
    accountId: string,
    apiToken: string,
    options?: {
      phoneNumber?: string;
      callSessionId?: string;
    },
  ): Promise<{ voiceEnabled: boolean }> {
    // Create dependencies for the conversation session
    const deps = createDependencies(this.env);

    // Get agent configuration
    let agentConfig: AgentPromptConfig;
    try {
      agentConfig = await deps.agentConfig.get(defaultAgentConfig);
    } catch {
      agentConfig = defaultAgentConfig;
    }

    // Create the conversation session
    this.session = createSession({
      durableState: this.ctx,
      ai: this.env.AI,
      logger: deps.logger,
      deps,
      agentConfig,
      streamId: 1,
      env: this.env,
    });

    // Create the text processor that bridges to the session
    this.textProcessor = new ConversationTextProcessor(
      this.session,
      deps.logger,
      {
        phoneNumber: options?.phoneNumber,
        callSessionId: options?.callSessionId,
      },
    );

    // Create the RealtimeKit transport
    this.transport = new RealtimeKitTransport(meetingId, authToken);

    // Check for API keys - gracefully degrade if missing
    const deepgramKey = this.env.DEEPGRAM_API_KEY;
    const elevenLabsKey = this.env.ELEVENLABS_API_KEY;

    if (!deepgramKey || !elevenLabsKey) {
      deps.logger.warn(
        {
          hasDeepgram: Boolean(deepgramKey),
          hasElevenLabs: Boolean(elevenLabsKey),
        },
        "voice_agent.degraded_mode",
      );
      // Gracefully degrade - voice features disabled but session continues
      // The text-based conversation will still work via WebSocket
      // Frontend will fall back to browser TTS
      return { voiceEnabled: false };
    }

    // Initialize the pipeline
    // Flow: Transport → STT → TextProcessor → TTS → Transport
    await this.initPipeline(
      [
        this.transport,
        new DeepgramSTT(deepgramKey),
        this.textProcessor,
        new ElevenLabsTTS(elevenLabsKey),
        this.transport,
      ],
      agentId,
      workerUrl,
      accountId,
      apiToken,
    );

    const { meeting } = this.transport;

    // Register meeting event handlers
    meeting.participants.joined.on("participantJoined", (participant) => {
      deps.logger.info(
        { participantName: participant.name },
        "voice_agent.participant_joined",
      );
    });

    meeting.participants.joined.on("participantLeft", (participant) => {
      deps.logger.info(
        { participantName: participant.name },
        "voice_agent.participant_left",
      );
    });

    // Join the meeting
    await meeting.join();

    deps.logger.info({ agentId, meetingId }, "voice_agent.initialized");
    return { voiceEnabled: true };
  }

  /**
   * Deinitialize the voice agent.
   *
   * Called when the voice session ends. Cleans up all resources.
   */
  async deinit(): Promise<void> {
    // Clean up the pipeline
    await this.deinitPipeline();

    // Clear references
    this.session = null;
    this.textProcessor = null;
    this.transport = null;
  }

  /**
   * Handle barge-in (user interruption).
   *
   * Called when the user starts speaking while the agent is talking.
   * Stops the current TTS output and prepares for new input.
   */
  async handleBargeIn(): Promise<void> {
    // The RealtimeAgent base class handles audio interruption automatically
    // We just need to notify the session if needed
    if (this.session) {
      // Session has internal barge-in handling
      // This is called by the transport when interruption is detected
    }
  }
}
