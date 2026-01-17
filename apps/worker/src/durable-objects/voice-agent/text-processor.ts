/**
 * Text Processor Component for Voice Agent
 *
 * Bridges the realtime-agents SDK's TextComponent to the existing
 * ConversationSessionV2 logic. Handles speech-to-text transcripts
 * and generates responses via the session.
 */

import { TextComponent } from "@cloudflare/realtime-agents";
import type { ConversationSessionV2 } from "../conversation-session/v2/session";
import type { Logger } from "../conversation-session/v2/types";

/**
 * ConversationTextProcessor extends TextComponent to process
 * voice transcripts through the ConversationSessionV2.
 *
 * The flow:
 * 1. User speaks -> STT transcribes to text
 * 2. onTranscript receives the text
 * 3. Session processes the message and generates a response
 * 4. Response is sent to TTS via the reply callback
 */
export class ConversationTextProcessor extends TextComponent {
  private session: ConversationSessionV2;
  private logger: Logger;
  private phoneNumber?: string;
  private callSessionId?: string;

  constructor(
    session: ConversationSessionV2,
    logger: Logger,
    options?: {
      phoneNumber?: string;
      callSessionId?: string;
    },
  ) {
    super();
    this.session = session;
    this.logger = logger;
    this.phoneNumber = options?.phoneNumber;
    this.callSessionId = options?.callSessionId;
  }

  /**
   * Called when a final transcript is received from STT.
   *
   * @param text - The transcribed text from the user's speech
   * @param reply - Callback to send text to TTS for speaking
   */
  async onTranscript(
    text: string,
    reply: (text: string) => void,
  ): Promise<void> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      this.logger.debug({}, "voice.text_processor.empty_transcript");
      return;
    }

    this.logger.info(
      { textPreview: trimmedText.slice(0, 80) },
      "voice.text_processor.transcript_received",
    );

    try {
      // Process through the existing conversation session
      const result = await this.session.processMessage({
        text: trimmedText,
        phoneNumber: this.phoneNumber,
        callSessionId: this.callSessionId,
      });

      // Send the response to TTS
      if (result.response) {
        this.logger.info(
          { responseLength: result.response.length },
          "voice.text_processor.response_generated",
        );
        reply(result.response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown";
      this.logger.error(
        { error: errorMessage },
        "voice.text_processor.process_error",
      );

      // Provide a fallback response
      reply("I'm sorry, I encountered an issue. Could you please try again?");
    }
  }

  /**
   * Update the phone number for the session.
   */
  setPhoneNumber(phoneNumber: string): void {
    this.phoneNumber = phoneNumber;
  }

  /**
   * Update the call session ID.
   */
  setCallSessionId(callSessionId: string): void {
    this.callSessionId = callSessionId;
  }
}
