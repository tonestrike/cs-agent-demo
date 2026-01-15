CREATE TABLE IF NOT EXISTS agent_prompt_config (
  id TEXT PRIMARY KEY,
  tone TEXT NOT NULL,
  greeting TEXT NOT NULL,
  off_topic_message TEXT NOT NULL,
  company_name TEXT NOT NULL,
  persona_summary TEXT NOT NULL,
  tool_guidance TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
