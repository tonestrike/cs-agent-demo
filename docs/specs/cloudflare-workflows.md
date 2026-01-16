# Cloudflare workflows alignment
Define how PestCall uses Cloudflare Workflows for long-running, multi-step agent flows while keeping inputs/outputs validated, streaming fast, and AI calls routed through the AI Gateway.

## Purpose
PestCall is an AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API. See [`README.md`](../../README.md).

## Goals
- Use Cloudflare Workflows for deterministic, multi-step flows (verification, reschedule, cancel, approvals).
- Validate workflow inputs and outputs with Zod schemas.
- Stream user-facing responses over the existing agent transport.
- Route all model calls through Cloudflare AI Gateway.
- Keep workflow code small, with business logic in use-cases and repositories.

## Non-goals
- Rewriting the existing agent loop or model adapters.
- Introducing new UI flows outside the agent and customer dashboards.

## Current state
- Workflow state is stored on the call summary as `summary.workflowState`. See [`agent.ts`](../../apps/worker/src/use-cases/agent.ts).
- The agent uses Workflows for verification, reschedule, and cancel flows.
- Streaming responses are handled by the agent transport. See [`pestcall.ts`](../../apps/worker/src/agents/pestcall.ts).
- AI Gateway support already exists in the model adapters. See [`workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts) and [`openrouter.ts`](../../apps/worker/src/models/openrouter.ts).

## Workflow fit
Workflows should own long-running or human-in-the-loop sequences that benefit from:
- Step-level idempotency.
- Explicit wait points for user confirmation.
- Progress visibility across turns.

Target workflows:
- Verification: lookup by phone -> wait for ZIP -> verify -> escalate after 2 attempts.
- Appointment reschedule: select appointment -> fetch slots -> select slot -> confirm.
- Appointment cancel: select appointment -> confirm -> cancel.
- Escalation approvals: wait for supervisor approval before creating an internal ticket.

## Verification workflow (required start)
Verification is required at the start of every conversation. It uses the phone number from the call and asks for the 5-digit ZIP code.

### Trigger
The agent starts a workflow instance when identity is not verified.

### Inputs
Validated with Zod before triggering:
- `callSessionId` (string)
- `phoneE164` (string)
- `intent` (`verify`)

### Steps
1) `lookup customer by phone`
   - `step.do()` to fetch matching accounts by phone.
2) `await zip`
   - `step.waitForEvent()` for a 5-digit ZIP code.
   - Allow two attempts, then escalate.
3) `verify account`
   - `step.do()` to check ZIP match.
4) `escalate`
   - `step.do()` to create a CRM escalation after failed attempts.

### Outputs
Validated with Zod:
- `status` (`verified` | `escalated` | `needs_followup`)
- `customerId`
- `message`

### Event type
Verification waits for:
- `verify_zip`

## Reschedule workflow
Reschedule orchestration lives in Cloudflare Workflows and replaces inline state handling.

### Trigger
The agent starts a workflow instance when the user requests a reschedule and identity is verified.

### Inputs
Validated with Zod before triggering:
- `callSessionId` (string)
- `customerId` (string)
- `intent` (`reschedule`)
- `message` (latest user message)
- `contextSummary` (short agent summary, optional)

### Steps
Use workflow steps to ensure idempotency and reliable retries:
1) `select appointment`
   - `step.do()` to fetch upcoming appointments.
   - If one appointment exists, auto-select and continue.
   - Otherwise `step.waitForEvent()` for appointment selection.
2) `fetch slots`
   - `step.do()` to fetch available slots for the selected appointment.
3) `select slot`
   - If one slot exists, auto-select and continue.
   - Otherwise `step.waitForEvent()` for slot selection.
4) `confirm reschedule`
   - `step.waitForEvent()` for user confirmation.
5) `apply reschedule`
   - `step.do()` to call the reschedule use-case.

### Outputs
Validated with Zod:
- `status` (`rescheduled` | `cancelled` | `needs_followup`)
- `appointmentId`
- `slotId`
- `message` (agent-facing, short)

### State and observability
- Persist the workflow id and step name in the call summary so the UI can show progress.
- Log `workflow.start`, `workflow.step`, and `workflow.complete` with `callSessionId`.

### Event types
Reschedule waits for these event types (sent via workflow instance `sendEvent`):
- `select_appointment`
- `select_slot`
- `confirm_reschedule`

## Cancel workflow
Cancel uses a confirmation step before calling the CRM cancellation endpoint.

### Trigger
The agent starts a workflow instance when a verified caller asks to cancel.

### Inputs
Validated with Zod before triggering:
- `callSessionId` (string)
- `customerId` (string)
- `intent` (`cancel`)
- `message` (latest user message)

### Steps
1) `select appointment`
   - `step.do()` to fetch upcoming appointments.
   - If one appointment exists, auto-select and continue.
   - Otherwise `step.waitForEvent()` for appointment selection.
2) `confirm cancellation`
   - `step.waitForEvent()` for user confirmation.
3) `cancel appointment`
   - `step.do()` to call the cancel use-case.
   - Escalate if cancellation fails.

### Outputs
Validated with Zod:
- `status` (`cancelled` | `needs_followup` | `escalated`)
- `appointmentId`
- `message`

### Event types
Cancel waits for:
- `cancel_select_appointment`
- `cancel_confirm`

## API surface (oRPC)
These RPC endpoints start and drive workflows:
- `workflows/verify/start`
- `workflows/verify/sendZip`
- `workflows/reschedule/start`
- `workflows/reschedule/selectAppointment`
- `workflows/reschedule/selectSlot`
- `workflows/reschedule/confirm`
- `workflows/cancel/start`
- `workflows/cancel/selectAppointment`
- `workflows/cancel/confirm`

Request/response schemas live in [`workflows/schemas.ts`](../../packages/core/src/workflows/schemas.ts).

Example: start workflow
```json
{
  "callSessionId": "call_123",
  "customerId": "cust_001",
  "intent": "reschedule",
  "message": "Please move my appointment.",
  "contextSummary": "Verified customer requesting reschedule."
}
```

Response:
```json
{
  "instanceId": "a1b2c3d4"
}
```

Example: send appointment selection
```json
{
  "instanceId": "a1b2c3d4",
  "payload": { "appointmentId": "appt_001" }
}
```

## Workflow contract
Define workflow input/output schemas in a shared location so both the Worker and web client can validate.
- New schemas live in `packages/core/src/workflows/` or `apps/worker/src/workflows/schemas.ts`.
- Input schema covers caller identity, call session id, and workflow intent.
- Output schema captures the final user-facing message and any ticket/appointment ids.

Example input shape:
- `callSessionId`
- `customerId`
- `intent` (`reschedule` | `cancel` | `approval`)
- `context` (latest message, optional context summary)

## Step design
Use Cloudflare workflow steps to make each unit of work explicit:
- `step.do()` for each repository/use-case call (idempotent).
- `step.waitForEvent()` for user confirmations (selection or approval).
- `step.sleep()` for retry backoff when upstreams are unavailable.

Keep steps thin; call existing use-cases and repositories rather than duplicating logic.

## Streaming and user experience
Workflows do not stream text directly. The agent transport should:
- Emit a short "working" response immediately.
- Stream model responses when a step completes.
- Surface workflow progress via call summary fields so the UI can render state.

This keeps latency low while preserving deterministic workflows.

## AI Gateway usage
All model calls (including workflow-specific prompt chains) must go through the AI Gateway:
- Use the existing model adapters and gateway env config in [`apps/worker/wrangler.toml`](../../apps/worker/wrangler.toml).
- Avoid direct outbound calls to model APIs in workflow steps.

## Validation rules
- Use Zod schemas for workflow inputs and step outputs.
- Reject invalid inputs early, before triggering a workflow.
- Require structured model responses (JSON mode or tool schemas) inside workflow steps.

## Observability
- Log workflow start/step/end with `callSessionId` and workflow id.
- Persist workflow state in the call summary for UI visibility.
- Record the final workflow result for auditability.

## Docs alignment
Use Cloudflare Workflows capabilities directly:
- Durable steps with retries via `step.do()`.
- External input and approvals via `step.waitForEvent()`.
- Long waits via `step.sleep()`/`step.sleepUntil()` if scheduling is needed.
- Lifecycle control through workflow instance management.

## References (Cloudflare)
Keep these as source-of-truth docs while implementing reschedule:
- Workflows overview: https://developers.cloudflare.com/workflows/
- Workers API (Workflows): https://developers.cloudflare.com/workflows/build/workers-api/
- Events and parameters: https://developers.cloudflare.com/workflows/build/events-and-parameters/
- Sleeping and retrying: https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/
- Trigger workflows: https://developers.cloudflare.com/workflows/build/trigger-workflows/
- Agents run workflows: https://developers.cloudflare.com/agents/api-reference/run-workflows/
- Human-in-the-loop: https://developers.cloudflare.com/agents/concepts/human-in-the-loop/
- AI Gateway usage: https://developers.cloudflare.com/ai-gateway/usage/
- Workers AI JSON mode: https://developers.cloudflare.com/workers-ai/features/json-mode/

## Open questions
- Which workflows are highest priority after reschedule/cancel?
- Do you want workflow status exposed in a new endpoint or only via call summary?
- Which Cloudflare Workflows docs should we align to explicitly (if any)?
