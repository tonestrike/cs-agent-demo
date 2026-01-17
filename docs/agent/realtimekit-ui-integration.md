# RealtimeKit UI integration notes

## Purpose

Document how we wired the RealtimeKit UI web components, why we chose the
current approach, and the package's guidance that affects our implementation.

## Decisions and rationale

- Keep classic and realtime chat completely isolated so state does not leak
  between tabs. See
  [`apps/web/src/app/customer/components/classic-chat-view.tsx`](../../apps/web/src/app/customer/components/classic-chat-view.tsx)
  and
  [`apps/web/src/app/customer/components/realtime-chat-view.tsx`](../../apps/web/src/app/customer/components/realtime-chat-view.tsx).
- Use the RealtimeKit UI web components instead of the React wrapper because
  we need direct control over the meeting object property and can keep the
  integration minimal. See
  [`apps/web/src/app/customer/components/realtime-kit-chat.tsx`](../../apps/web/src/app/customer/components/realtime-kit-chat.tsx).
- Use the package-provided JSX types to avoid drift from upstream component
  props and event types. See
  [`apps/web/src/types/rtk-chat.d.ts`](../../apps/web/src/types/rtk-chat.d.ts).

## How it works (high level)

- Backend issues RealtimeKit auth tokens (guest participants) and returns
  meeting credentials. See
  [`apps/worker/src/realtime-kit.ts`](../../apps/worker/src/realtime-kit.ts) and
  [`apps/worker/src/durable-objects/conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts).
- Frontend initializes a meeting client with that auth token, then sets the
  `meeting` property on the RealtimeKit web components. See
  [`apps/web/src/app/customer/components/realtime-kit-chat.tsx`](../../apps/web/src/app/customer/components/realtime-kit-chat.tsx).
- The realtime tab has its own lifecycle, controls, and optional voice
  playback. See
  [`apps/web/src/app/customer/components/realtime-chat-view.tsx`](../../apps/web/src/app/customer/components/realtime-chat-view.tsx).
- Web components must be registered via `defineCustomElements` before use. See
  [`apps/web/src/app/providers.tsx`](../../apps/web/src/app/providers.tsx).

## Package guidance (what it says to do)

The RealtimeKit UI README expects:

1. Create a meeting instance via `RealtimeKitClient.init({ authToken, ... })`.
2. Assign that meeting instance to the component via a property
   (`element.meeting = meeting`).

Reference:
[`node_modules/@cloudflare/realtimekit-ui/README.md`](../../node_modules/@cloudflare/realtimekit-ui/README.md).

## What not to do

- Do not pass the `meeting` object as a JSX attribute in React. React serializes
  it to a string (`[object Object]`) and the component cannot initialize.
  Always set the property via a ref. See
  [`apps/web/src/app/customer/components/realtime-kit-chat.tsx`](../../apps/web/src/app/customer/components/realtime-kit-chat.tsx).
- Do not omit chat/participants modules when calling `RealtimeKit.init`. The
  UI `rtk-chat` component expects `meeting.chat` and `meeting.participants`
  to exist.
- Do not share hook state or message history between classic and realtime
  views. The tabs must be behaviorally independent. See
  [`apps/web/src/app/customer/page.tsx`](../../apps/web/src/app/customer/page.tsx).
- Do not treat RealtimeKit UI as "just HTML". It depends on the meeting object
  to be a real client instance from `@cloudflare/realtimekit`, not a plain
  JSON payload.

## Typing notes

The RealtimeKit UI package ships its own Stencil-generated component typings.
We import those types into JSX so `ref`, props, and events stay aligned with
upstream changes. See
[`apps/web/src/types/rtk-chat.d.ts`](../../apps/web/src/types/rtk-chat.d.ts).

## Related references

- RealtimeKit UI package types:
  [`node_modules/@cloudflare/realtimekit-ui/dist/types/components.d.ts`](../../node_modules/@cloudflare/realtimekit-ui/dist/types/components.d.ts)
- RealtimeKit web components loader:
  [`node_modules/@cloudflare/realtimekit-ui/loader/index.d.ts`](../../node_modules/@cloudflare/realtimekit-ui/loader/index.d.ts)
