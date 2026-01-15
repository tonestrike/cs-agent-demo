import type {
  AgentPromptConfig,
  AgentPromptConfigRecord,
  AgentPromptConfigUpdate,
} from "@pestcall/core";

type AgentConfigRow = {
  id: string;
  tone: string;
  greeting: string;
  off_topic_message?: string;
  scope_message?: string;
  company_name: string;
  persona_summary: string;
  tool_guidance?: string;
  tool_guidance_json?: string;
  model_id?: string;
  updated_at: string;
};

const CONFIG_ID = "default";
const CACHE_TTL_MS = 30_000;

let cachedConfig: AgentPromptConfigRecord | null = null;
let cachedAt = 0;

const parseToolGuidance = (
  row: AgentConfigRow,
): AgentPromptConfigRecord["toolGuidance"] | undefined => {
  if (row.tool_guidance_json) {
    try {
      const parsed = JSON.parse(row.tool_guidance_json) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as AgentPromptConfigRecord["toolGuidance"];
      }
    } catch {
      return undefined;
    }
  }
  if (row.tool_guidance) {
    return {
      getNextAppointment: row.tool_guidance,
      getOpenInvoices: row.tool_guidance,
      rescheduleAppointment: row.tool_guidance,
      escalate: row.tool_guidance,
    };
  }
  return undefined;
};

const mapRow = (row: AgentConfigRow): Partial<AgentPromptConfigRecord> => ({
  tone: row.tone as AgentPromptConfig["tone"],
  greeting: row.greeting,
  scopeMessage: row.scope_message ?? row.off_topic_message,
  companyName: row.company_name,
  personaSummary: row.persona_summary,
  toolGuidance: parseToolGuidance(row),
  modelId: row.model_id ?? "@cf/meta/llama-3.1-8b-instruct",
  updatedAt: row.updated_at,
});

const isCacheFresh = () => cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS;

export const createAgentConfigRepository = (db: D1Database) => {
  return {
    async get(defaults: AgentPromptConfig): Promise<AgentPromptConfigRecord> {
      if (isCacheFresh()) {
        return cachedConfig as AgentPromptConfigRecord;
      }

      const row = await db
        .prepare("SELECT * FROM agent_prompt_config WHERE id = ?")
        .bind(CONFIG_ID)
        .first<AgentConfigRow>();

      const config = row
        ? ({ ...defaults, ...mapRow(row) } as AgentPromptConfigRecord)
        : { ...defaults };

      cachedConfig = config;
      cachedAt = Date.now();

      return config;
    },
    async update(
      defaults: AgentPromptConfig,
      input: AgentPromptConfigUpdate,
    ): Promise<AgentPromptConfigRecord> {
      const current = await this.get(defaults);
      const updatedAt = new Date().toISOString();
      const toolGuidance = input.toolGuidance
        ? { ...current.toolGuidance, ...input.toolGuidance }
        : current.toolGuidance;
      const merged: AgentPromptConfigRecord = {
        ...current,
        ...input,
        toolGuidance,
        updatedAt,
      };

      await db
        .prepare(
          "INSERT INTO agent_prompt_config (id, tone, greeting, off_topic_message, scope_message, company_name, persona_summary, tool_guidance, tool_guidance_json, model_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tone = excluded.tone, greeting = excluded.greeting, off_topic_message = excluded.off_topic_message, scope_message = excluded.scope_message, company_name = excluded.company_name, persona_summary = excluded.persona_summary, tool_guidance = excluded.tool_guidance, tool_guidance_json = excluded.tool_guidance_json, model_id = excluded.model_id, updated_at = excluded.updated_at",
        )
        .bind(
          CONFIG_ID,
          merged.tone,
          merged.greeting,
          merged.scopeMessage,
          merged.scopeMessage,
          merged.companyName,
          merged.personaSummary,
          merged.toolGuidance.getNextAppointment,
          JSON.stringify(merged.toolGuidance),
          merged.modelId ?? "@cf/meta/llama-3.1-8b-instruct",
          updatedAt,
        )
        .run();

      cachedConfig = merged;
      cachedAt = Date.now();

      return merged;
    },
  };
};
