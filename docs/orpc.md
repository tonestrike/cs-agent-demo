# oRPC API Contracts

Use oRPC for all browser-to-worker requests. It gives you typed inputs/outputs and a single place to enforce shapes and behavior.

## Core concepts
- Contracts live in `@pestcall/core` schemas and exported types. See [`packages/core/src/customers/schemas.ts`](../packages/core/src/customers/schemas.ts) and [`packages/core/src/index.ts`](../packages/core/src/index.ts).
- The web client is a typed oRPC client in [`apps/web/src/lib/orpc.ts`](../apps/web/src/lib/orpc.ts). It binds contracts to `rpcClient` methods and exposes React Query helpers via `orpc`.
- The worker routes implement the same contracts and return typed payloads. See [`apps/worker/src/routes/customers.ts`](../apps/worker/src/routes/customers.ts).

## Usage
Use the contracts directly instead of ad-hoc shapes. This keeps the UI and API aligned and removes duplicate typing.

```typescript
import { useQuery } from "@tanstack/react-query";

import { orpc } from "../../lib/orpc";

const customersQuery = useQuery(
  orpc.customers.list.queryOptions({
    input: { limit: 50 },
  }),
);
```

## Guidelines
- Prefer `rpcClient` calls over manual `fetch`.
- Prefer `orpc` helpers like `queryOptions`, `infiniteOptions`, and `mutationOptions` to align query keys and input typing automatically.
- Import types from `@pestcall/core` for local state or derived data.
- Keep contract changes in `packages/core` and update both worker routes and UI together.
