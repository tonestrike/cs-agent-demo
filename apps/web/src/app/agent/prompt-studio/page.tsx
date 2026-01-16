"use client";

import {
  type AgentPromptConfigRecord,
  agentPromptConfigRecordSchema,
  appointmentByIdInputSchema,
  appointmentInputSchema,
  appointmentSchema,
  availableSlotSchema,
  availableSlotsInputSchema,
  createAppointmentInputSchema,
  customerMatchSchema,
  escalateInputSchema,
  escalateResultSchema,
  invoiceSchema,
  invoicesInputSchema,
  listUpcomingAppointmentsInputSchema,
  lookupCustomerByEmailInputSchema,
  lookupCustomerByNameAndZipInputSchema,
  lookupCustomerInputSchema,
  rescheduleInputSchema,
  servicePolicyInputSchema,
  servicePolicyResultSchema,
  verifyAccountInputSchema,
  verifyAccountResultSchema,
} from "@pestcall/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Badge, Button, Card } from "../../../components/ui";
import { rpcClient } from "../../../lib/orpc";
import { WORKERS_AI_MODELS } from "../../../lib/workers-ai-models";

const schemaToSummary = (
  schema: z.ZodTypeAny,
): string | Record<string, unknown> => {
  if (schema instanceof z.ZodOptional) {
    return { optional: true, schema: schemaToSummary(schema._def.innerType) };
  }
  if (schema instanceof z.ZodNullable) {
    return { nullable: true, schema: schemaToSummary(schema._def.innerType) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: schemaToSummary(schema._def.type) };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as z.ZodRawShape;
    return Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [
        key,
        schemaToSummary(value),
      ]),
    );
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "enum", values: schema._def.values };
  }
  if (schema instanceof z.ZodUnion) {
    return {
      type: "union",
      options: schema._def.options.map(schemaToSummary),
    };
  }
  if (schema instanceof z.ZodString) {
    return "string";
  }
  if (schema instanceof z.ZodNumber) {
    return "number";
  }
  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }
  return "unknown";
};

const TOOL_SCHEMA_CONTEXT = [
  {
    tool: "crm.lookupCustomerByPhone",
    input: lookupCustomerInputSchema,
    output: z.array(customerMatchSchema),
  },
  {
    tool: "crm.lookupCustomerByNameAndZip",
    input: lookupCustomerByNameAndZipInputSchema,
    output: z.array(customerMatchSchema),
  },
  {
    tool: "crm.lookupCustomerByEmail",
    input: lookupCustomerByEmailInputSchema,
    output: z.array(customerMatchSchema),
  },
  {
    tool: "crm.verifyAccount",
    input: verifyAccountInputSchema,
    output: verifyAccountResultSchema,
  },
  {
    tool: "crm.getNextAppointment",
    input: appointmentInputSchema,
    output: appointmentSchema.nullable(),
  },
  {
    tool: "crm.listUpcomingAppointments",
    input: listUpcomingAppointmentsInputSchema,
    output: z.array(appointmentSchema),
  },
  {
    tool: "crm.getAppointmentById",
    input: appointmentByIdInputSchema,
    output: appointmentSchema.nullable(),
  },
  {
    tool: "crm.getOpenInvoices",
    input: invoicesInputSchema,
    output: z.array(invoiceSchema),
  },
  {
    tool: "crm.getAvailableSlots",
    input: availableSlotsInputSchema,
    output: z.array(availableSlotSchema),
  },
  {
    tool: "crm.rescheduleAppointment",
    input: rescheduleInputSchema,
    output: z.object({
      ok: z.boolean(),
      appointment: appointmentSchema.optional(),
    }),
  },
  {
    tool: "crm.createAppointment",
    input: createAppointmentInputSchema,
    output: z.object({
      ok: z.boolean(),
      appointmentId: z.string().optional(),
    }),
  },
  {
    tool: "crm.getServicePolicy",
    input: servicePolicyInputSchema,
    output: servicePolicyResultSchema,
  },
  {
    tool: "crm.escalate",
    input: escalateInputSchema,
    output: escalateResultSchema,
  },
];

export default function PromptStudioPage() {
  const [configDraft, setConfigDraft] =
    useState<AgentPromptConfigRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");
  const queryClient = useQueryClient();
  const modelOptions = configDraft?.modelId
    ? Array.from(new Set([configDraft.modelId, ...WORKERS_AI_MODELS]))
    : [...WORKERS_AI_MODELS];

  const agentConfigQuery = useQuery({
    queryKey: ["agent-config"],
    queryFn: () => rpcClient.agentConfig.get(),
  });

  useEffect(() => {
    if (!configDraft && agentConfigQuery.data) {
      setConfigDraft(agentConfigQuery.data);
      const payload = {
        config: agentPromptConfigRecordSchema.parse(agentConfigQuery.data),
        tools: TOOL_SCHEMA_CONTEXT.map((tool) => ({
          tool: tool.tool,
          input: schemaToSummary(tool.input),
          output: schemaToSummary(tool.output),
        })),
      };
      setJsonDraft(JSON.stringify(payload, null, 2));
    }
  }, [agentConfigQuery.data, configDraft]);

  const updateConfig = useMutation({
    mutationFn: (input: AgentPromptConfigRecord) => {
      const { updatedAt, ...payload } = input;
      return rpcClient.agentConfig.update(payload);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["agent-config"], data);
      setConfigDraft(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  const handleConfigChange = (
    field: keyof AgentPromptConfigRecord,
    value: string,
  ) => {
    setConfigDraft((prev: AgentPromptConfigRecord | null) =>
      prev ? { ...prev, [field]: value } : prev,
    );
  };

  const handleToolGuidanceChange = (
    field: keyof AgentPromptConfigRecord["toolGuidance"],
    value: string,
  ) => {
    setConfigDraft((prev: AgentPromptConfigRecord | null) =>
      prev
        ? {
            ...prev,
            toolGuidance: {
              ...prev.toolGuidance,
              [field]: value,
            },
          }
        : prev,
    );
  };

  const applyJsonConfig = () => {
    if (!jsonDraft.trim()) {
      setJsonError("Paste JSON to apply.");
      return;
    }
    try {
      const parsed = JSON.parse(jsonDraft) as unknown;
      const candidate =
        parsed && typeof parsed === "object" && "config" in parsed
          ? (parsed as { config?: unknown }).config
          : parsed;
      const validation = agentPromptConfigRecordSchema.safeParse(candidate);
      if (!validation.success) {
        setJsonError("Invalid config JSON. Check required fields.");
        return;
      }
      setJsonError("");
      setConfigDraft(validation.data);
    } catch {
      setJsonError("Invalid JSON. Fix formatting and try again.");
    }
  };

  const copyPromptConfig = async () => {
    if (!configDraft) {
      return;
    }
    const payload = {
      config: agentPromptConfigRecordSchema.parse(configDraft),
      tools: TOOL_SCHEMA_CONTEXT.map((tool) => ({
        tool: tool.tool,
        input: schemaToSummary(tool.input),
        output: schemaToSummary(tool.output),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Badge className="w-fit">Prompt Studio</Badge>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
            Shape the <span className="accent-text">PestCall</span> voice.
          </h1>
          <p className="max-w-3xl text-ink/70">
            Adjust tone, scope, and tool guidance in real time. Changes take
            effect immediately without a deployment.
          </p>
        </header>

        <Card className="flex flex-col gap-5 animate-rise">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Prompt Controls</h2>
              <p className="text-xs uppercase tracking-wide text-ink/50">
                Live edits, no deploys
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyPromptConfig}
                className="text-xs font-semibold uppercase tracking-wide text-ink/50 hover:text-ink"
              >
                {copied ? "Copied" : "Copy Config + Schemas"}
              </button>
              <Button
                className="bg-ink hover:bg-slate"
                disabled={!configDraft || updateConfig.isPending}
                onClick={() => {
                  if (configDraft) {
                    updateConfig.mutate(configDraft);
                  }
                }}
              >
                {updateConfig.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
              Update by JSON
              <textarea
                className="min-h-[140px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                placeholder='Paste JSON config or {"config": {...}}'
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="bg-slate hover:bg-ink"
                type="button"
                onClick={applyJsonConfig}
              >
                Apply JSON
              </Button>
              {jsonError ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-clay">
                  {jsonError}
                </p>
              ) : null}
            </div>
          </div>
          {saved ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Saved
            </p>
          ) : null}
          {configDraft ? (
            <div className="space-y-4 text-sm">
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Tone
                <select
                  className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.tone}
                  onChange={(event) =>
                    handleConfigChange("tone", event.target.value)
                  }
                >
                  <option value="warm">Warm</option>
                  <option value="neutral">Neutral</option>
                  <option value="direct">Direct</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Company Name
                <input
                  className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.companyName}
                  onChange={(event) =>
                    handleConfigChange("companyName", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Greeting
                <textarea
                  className="min-h-[80px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.greeting}
                  onChange={(event) =>
                    handleConfigChange("greeting", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Scope Message
                <textarea
                  className="min-h-[80px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.scopeMessage}
                  onChange={(event) =>
                    handleConfigChange("scopeMessage", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Persona Summary
                <textarea
                  className="min-h-[120px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.personaSummary}
                  onChange={(event) =>
                    handleConfigChange("personaSummary", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Tool Guidance: Next Appointment
                <textarea
                  className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.toolGuidance.getNextAppointment}
                  onChange={(event) =>
                    handleToolGuidanceChange(
                      "getNextAppointment",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Tool Guidance: Open Invoices
                <textarea
                  className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.toolGuidance.getOpenInvoices}
                  onChange={(event) =>
                    handleToolGuidanceChange(
                      "getOpenInvoices",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Tool Guidance: Reschedule
                <textarea
                  className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.toolGuidance.rescheduleAppointment}
                  onChange={(event) =>
                    handleToolGuidanceChange(
                      "rescheduleAppointment",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Tool Guidance: Escalation
                <textarea
                  className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.toolGuidance.escalate}
                  onChange={(event) =>
                    handleToolGuidanceChange("escalate", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                Model ID
                <select
                  className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                  value={configDraft.modelId}
                  onChange={(event) =>
                    handleConfigChange("modelId", event.target.value)
                  }
                >
                  {modelOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="text-sm text-ink/60">Loading prompt config...</p>
          )}
        </Card>
      </div>
    </main>
  );
}
