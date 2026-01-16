# oRPC API Contracts

Use oRPC for all browser-to-worker requests. It gives you typed inputs/outputs and a single place to enforce shapes and behavior.

## Core concepts
- Contracts live in `@pestcall/core` schemas and exported types. See [`packages/core/src/customers/schemas.ts`](../packages/core/src/customers/schemas.ts) and [`packages/core/src/index.ts`](../packages/core/src/index.ts).
- The web client is a typed oRPC client in [`apps/web/src/lib/orpc.ts`](../apps/web/src/lib/orpc.ts). It binds contracts to `rpcClient` methods.
- The worker routes implement the same contracts and return typed payloads. See [`apps/worker/src/routes/customers.ts`](../apps/worker/src/routes/customers.ts).

## Usage
Use the contracts directly instead of ad-hoc shapes. This keeps the UI and API aligned and removes duplicate typing.

```typescript
import type { CustomerCacheListOutput } from "@pestcall/core";
import { useQuery } from "@tanstack/react-query";

import { rpcClient } from "../../lib/orpc";

const customersQuery = useQuery<CustomerCacheListOutput>({
  queryKey: ["customer-portal", "customers"],
  queryFn: () => rpcClient.customers.list({ limit: 50 }),
});
```

## Guidelines
- Prefer `rpcClient` calls over manual `fetch`.
- Import types from `@pestcall/core` for React Query generics and local state.
- Keep contract changes in `packages/core` and update both worker routes and UI together.
