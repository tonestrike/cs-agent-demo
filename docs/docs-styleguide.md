# Documentation Styleguide

Write precisely the right context. No more, no less.

## Principles

1. **Concise**: Minimum words needed
2. **Readable**: Clear language, scannable lists
3. **Contextual**: Explain "why" and "how it fits", not obvious details

## Links

Use relative markdown links. Always.

```markdown
✅ [repository pattern](../apps/worker/src/repositories/)
✅ [ticket types](../packages/core/src/tickets/types.ts)
✅ [Database Guidelines](./database.md)

❌ https://github.com/...
❌ /Users/you/project/...
```

Link to code when explaining concepts:

```markdown
Tickets use a state machine. See [`status.ts`](../packages/core/src/tickets/status.ts).
```

## Structure

```markdown
# Title
Brief description.

## Quick Start
Fastest path (if needed).

## Core Concepts
Main ideas, concisely.

## Examples
Real code examples.
```

## Style

- Active voice: "Repository fetches tickets"
- Present tense: "API returns JSON"
- Second person: "Call `getTicket()` to fetch"
- No hedging: "Use repositories" not "should probably use"

## Code Examples

Use real code from the codebase. Show only relevant parts.

```typescript
// ✅ Focused
const ticket = await getTicket(c, { id });
if (!ticket) {
  return c.json({ error: 'Ticket not found' }, 404);
}

// ❌ Too much boilerplate
import { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
// ... 20 more imports
```

## Formatting

- Sentence case headings: `## Database queries`
- One H1 per doc
- Don't skip heading levels
- Use `-` for lists
- Always specify code block language: ` ```typescript `
- Inline code for paths: `apps/worker/wrangler.toml`

## What to Document

**Do:**
- Architecture decisions (why this pattern)
- Non-obvious behaviors (edge cases, gotchas)
- Setup steps
- Integration points

**Don't:**
- Obvious code
- Implementation details clear from code
- Every function

## Examples

✅ **Good:**
```markdown
# Ticket Status Transitions

Valid transitions:
- `new` → `in_progress` → `resolved`
- `new` → `cancelled`
- `resolved` → `reopened` → `in_progress`

Invalid transitions throw. See [`validateTransition()`](../packages/core/src/tickets/status.ts#L15).
```

❌ **Bad:**
```markdown
# Ticket Status Transitions

The ticket status transition system is very important. It allows tickets 
to move through different states. We implemented a robust state machine 
pattern that ensures data integrity and prevents invalid state changes.

The validateTransition function takes two parameters...
(50 more lines of filler)
```

## Maintenance

- Update docs when behavior changes
- Delete docs for removed features
- Keep examples synced with code

**When in doubt: write less, link more, show examples.**
