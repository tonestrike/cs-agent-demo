import { apiBaseUrl, demoAuthToken } from "./env";

type RpcResponse<T> = {
  json: T;
  meta: unknown[];
};

export const callRpc = async <T>(
  path: string,
  input?: Record<string, unknown>,
) => {
  const url = `${apiBaseUrl}/rpc/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(demoAuthToken ? { "x-demo-auth": demoAuthToken } : {}),
    },
    body: JSON.stringify({
      json: input ?? {},
      meta: [],
    }),
  });

  const data = (await response.json()) as RpcResponse<T>;
  if (!response.ok) {
    const message =
      typeof data.json === "object" && data.json
        ? JSON.stringify(data.json)
        : "Request failed";
    throw new Error(message);
  }

  return data.json;
};
