---
root: true
targets: ["*"]
description: "CS-Agent project overview and development guidelines for a Cloudflare Workers-based customer success agent"
globs: ["**/*"]
---

# CS-Agent Project Overview

This is a Customer Success (CS) Agent system built with Cloudflare Workers. The project is organized as a monorepo with multiple applications and shared packages.

## Project Structure

- **[apps/worker](../../apps/worker/)**: Main Cloudflare Worker application with Hono.js router
  - Handles API routes for tickets, calls, and CRM operations
  - Uses Cloudflare D1 for database operations
  - Includes [repositories](../../apps/worker/src/repositories/), [use-cases](../../apps/worker/src/use-cases/), and [route handlers](../../apps/worker/src/routes/)
- **apps/web**: Web application (to be developed)
- **[packages/core](../../packages/core/)**: Shared core functionality
  - [CRM schemas](../../packages/core/src/crm/schemas.ts) and types
  - [Ticket management](../../packages/core/src/tickets/) with status transitions
  - Database utilities and migrations

## Technology Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono.js for routing
- **Database**: Cloudflare D1 (SQLite)
- **Language**: TypeScript
- **Package Manager**: Bun
- **Testing**: Vitest
- **Linting**: Biome, oxlint, cspell

## Development Guidelines

### Code Style

- Follow the [styleguide](../../docs/styleguide.md) for detailed implementation patterns
- Use TypeScript for all code with strict type checking
- Use 2-space indentation (tabs in some files)
- Prefer functional programming patterns where appropriate
- Use meaningful variable and function names

### Documentation

- Follow the [documentation styleguide](../../docs/docs-styleguide.md) for all documentation
- Highly readable and highly concise - write precisely the right context
- Use relative markdown links for all references
- Link to relevant code files when explaining concepts
- Focus on "why" and "how it fits together", not obvious details
- Update docs when changing behavior, delete docs for removed features

### Architecture Principles

- **Repository Pattern**: Database access through repository layer
- **Use Cases**: Business logic in dedicated use-case files
- **Dependency Injection**: Pass dependencies through context
- **Error Handling**: Use proper HTTP status codes and error responses
- **Testing**: Write integration tests for routes and unit tests for core logic

### Database

- Migrations are stored in [`apps/worker/migrations/`](../../apps/worker/migrations/)
- Use D1 database through the [repository pattern](../../apps/worker/src/repositories/)
- All database operations should go through repositories
- Use proper SQL parameterization to prevent injection

### API Design

- RESTful endpoints following standard conventions
- JSON request/response bodies
- Proper HTTP status codes
- Authentication via middleware when needed

## Key Conventions

- Feature-based organization within `apps/worker/src/`
- Shared types in `packages/core`
- Route handlers call use-cases, use-cases call repositories
- Mock CRM data available for testing
- Integration tests use real D1 database instances
