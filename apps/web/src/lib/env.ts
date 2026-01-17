const normalizeBaseUrl = (value: string | undefined) => {
  if (!value) {
    return "";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

export const apiBaseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL,
);

export const demoAuthToken = process.env.NEXT_PUBLIC_DEMO_AUTH_TOKEN ?? "";
export const realtimeKitApiKey =
  process.env.NEXT_PUBLIC_REALTIMEKIT_API_KEY ?? "";
export const realtimeKitRegion =
  process.env.NEXT_PUBLIC_REALTIMEKIT_REGION ?? "us-east-1";
