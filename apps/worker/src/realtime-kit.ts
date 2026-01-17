import type { CustomerCache } from "@pestcall/core";

import type { Env } from "./env";
import type { Logger } from "./logger";

export type RealtimeKitTokenPayload = {
  authToken: string;
  participantId: string;
  meetingId: string;
  presetName?: string | null;
  expiresAt?: string | null;
};

type RealtimeKitParticipantInput = {
  displayName: string;
  customParticipantId: string;
};

type RealtimeKitConfig = {
  accountId: string;
  appId: string;
  meetingId: string;
  apiToken: string;
  presetName?: string | null;
  baseUrl: string;
};

const HARDCODED_API_TOKEN = "d8e165d3-6d87-483f-bc5a-55ff3a5bcaae";
const HARDCODED_MEETING_ID = "bbb58ddd-1416-4812-aceb-7e078e61c78b";

const hashToken = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const ensureRealtimeKitConfig = (
  env: Env,
  overrides?: { meetingId?: string },
): RealtimeKitConfig => {
  const accountId = env.REALTIMEKIT_ACCOUNT_ID?.trim();
  const appId = env.REALTIMEKIT_APP_ID?.trim();
  const meetingId =
    overrides?.meetingId?.trim() ??
    env.REALTIMEKIT_MEETING_ID?.trim() ??
    HARDCODED_MEETING_ID;
  const apiToken = env.REALTIMEKIT_API_TOKEN?.trim() ?? HARDCODED_API_TOKEN;
  const baseUrl =
    env.REALTIMEKIT_API_BASE_URL?.trim() ?? "https://api.cloudflare.com";
  if (!accountId || !appId || !meetingId || !apiToken) {
    throw new Error("RealtimeKit configuration missing");
  }
  return {
    accountId,
    appId,
    meetingId,
    apiToken,
    presetName: env.REALTIMEKIT_PRESET_NAME?.trim() ?? "default",
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

export const getRealtimeKitConfigSummary = (env: Env) => {
  const accountId = env.REALTIMEKIT_ACCOUNT_ID?.trim() ?? null;
  const appId = env.REALTIMEKIT_APP_ID?.trim() ?? null;
  const meetingId = env.REALTIMEKIT_MEETING_ID?.trim() ?? HARDCODED_MEETING_ID;
  const apiToken = env.REALTIMEKIT_API_TOKEN?.trim() ?? HARDCODED_API_TOKEN;
  const baseUrl =
    env.REALTIMEKIT_API_BASE_URL?.trim() ?? "https://api.cloudflare.com";
  return {
    accountId,
    appId,
    meetingId,
    presetName: env.REALTIMEKIT_PRESET_NAME?.trim() ?? "default",
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiTokenLength: apiToken.length,
    apiTokenFingerprint: hashToken(apiToken),
  };
};

const sanitizeRealtimeKitPayload = (
  payload: {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    message?: string;
    result?: Record<string, unknown>;
  } | null,
) => {
  if (!payload) {
    return null;
  }
  const result = payload.result
    ? Object.fromEntries(
        Object.entries(payload.result).map(([key, value]) => {
          if (key === "token" || key === "authToken" || key === "auth_token") {
            return [key, "[redacted]"];
          }
          return [key, value];
        }),
      )
    : undefined;
  return { ...payload, result };
};

const parseRealtimeKitResponse = async (
  response: Response,
  config: RealtimeKitConfig,
  logger: Logger,
  context: { action: string; url: string },
): Promise<RealtimeKitTokenPayload> => {
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    message?: string;
    result?: Record<string, unknown>;
  } | null;
  logger.info(
    {
      action: context.action,
      url: context.url,
      status: response.status,
      ok: response.ok,
      payload: sanitizeRealtimeKitPayload(payload),
    },
    "realtimekit.response",
  );
  if (!response.ok || !payload?.success) {
    const errorMessage =
      payload?.errors?.[0]?.message ??
      payload?.message ??
      response.statusText ??
      "RealtimeKit error";
    const extra =
      payload?.errors && payload.errors.length > 1
        ? payload.errors
            .map((entry) => entry.message)
            .filter(Boolean)
            .join("; ")
        : null;
    const errorDetail = extra ? `${errorMessage} (${extra})` : errorMessage;
    throw new Error(errorDetail);
  }
  const result =
    payload.result ??
    (payload as { data?: Record<string, unknown> }).data ??
    {};
  const participantId =
    (result as { participant_id?: string }).participant_id ??
    (result as { participantId?: string }).participantId ??
    (result as { id?: string }).id ??
    null;
  const authToken =
    (result as { token?: string }).token ??
    (result as { authToken?: string }).authToken ??
    (result as { auth_token?: string }).auth_token ??
    null;
  if (!participantId) {
    throw new Error("RealtimeKit missing participant id");
  }
  if (!authToken) {
    throw new Error("RealtimeKit missing auth token");
  }
  logger.info(
    {
      action: context.action,
      participantId,
      meetingId:
        (result as { meeting_id?: string }).meeting_id ??
        (result as { meetingId?: string }).meetingId ??
        config.meetingId,
      expiresAt:
        (result as { expires_at?: string }).expires_at ??
        (result as { expiresAt?: string }).expiresAt ??
        null,
    },
    "realtimekit.response.success",
  );
  return {
    authToken,
    participantId,
    meetingId:
      (result as { meeting_id?: string }).meeting_id ??
      (result as { meetingId?: string }).meetingId ??
      config.meetingId,
    presetName:
      (result as { preset_name?: string }).preset_name ??
      (result as { presetName?: string }).presetName ??
      config.presetName,
    expiresAt:
      (result as { expires_at?: string }).expires_at ??
      (result as { expiresAt?: string }).expiresAt ??
      null,
  };
};

const realtimeKitHeaders = (config: RealtimeKitConfig) => ({
  Authorization: `Bearer ${config.apiToken}`,
  "Content-Type": "application/json",
});

export const addRealtimeKitParticipant = async (
  env: Env,
  customer: CustomerCache,
  logger: Logger,
  options?: { meetingId?: string },
): Promise<RealtimeKitTokenPayload> => {
  const config = ensureRealtimeKitConfig(env, {
    meetingId: options?.meetingId,
  });
  const url = `${config.baseUrl}/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings/${config.meetingId}/participants`;
  const presetName = config.presetName;
  const body = {
    name: customer.displayName,
    custom_participant_id: customer.id,
    presetName,
    preset_name: presetName,
  };
  logger.info(
    {
      action: "add_participant",
      url,
      accountId: config.accountId,
      appId: config.appId,
      meetingId: config.meetingId,
      presetName: config.presetName ?? null,
      customParticipantId: customer.id,
    },
    "realtimekit.request",
  );
  const response = await fetch(url, {
    method: "POST",
    headers: realtimeKitHeaders(config),
    body: JSON.stringify(body),
  });
  return parseRealtimeKitResponse(response, config, logger, {
    action: "add_participant",
    url,
  });
};

export const addRealtimeKitGuestParticipant = async (
  env: Env,
  input: RealtimeKitParticipantInput,
  logger: Logger,
  options?: { meetingId?: string },
): Promise<RealtimeKitTokenPayload> => {
  const config = ensureRealtimeKitConfig(env, {
    meetingId: options?.meetingId,
  });
  const url = `${config.baseUrl}/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings/${config.meetingId}/participants`;
  const presetName = config.presetName;
  const body = {
    name: input.displayName,
    custom_participant_id: input.customParticipantId,
    presetName,
    preset_name: presetName,
  };
  logger.info(
    {
      action: "add_guest_participant",
      url,
      accountId: config.accountId,
      appId: config.appId,
      meetingId: config.meetingId,
      presetName: config.presetName ?? null,
      customParticipantId: input.customParticipantId,
    },
    "realtimekit.request",
  );
  const response = await fetch(url, {
    method: "POST",
    headers: realtimeKitHeaders(config),
    body: JSON.stringify(body),
  });
  return parseRealtimeKitResponse(response, config, logger, {
    action: "add_guest_participant",
    url,
  });
};

export const refreshRealtimeKitToken = async (
  env: Env,
  participantId: string,
  logger: Logger,
  options?: { meetingId?: string },
): Promise<RealtimeKitTokenPayload> => {
  const config = ensureRealtimeKitConfig(env, {
    meetingId: options?.meetingId,
  });
  const url = `${config.baseUrl}/client/v4/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings/${config.meetingId}/participants/${encodeURIComponent(
    participantId,
  )}/token/refresh`;
  logger.info(
    {
      action: "refresh_token",
      url,
      accountId: config.accountId,
      appId: config.appId,
      meetingId: config.meetingId,
      participantId,
    },
    "realtimekit.request",
  );
  const response = await fetch(url, {
    method: "POST",
    headers: realtimeKitHeaders(config),
  });
  return parseRealtimeKitResponse(response, config, logger, {
    action: "refresh_token",
    url,
  });
};
