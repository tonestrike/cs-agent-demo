# Rulesync Configuration

This directory contains the source configuration files for [rulesync](https://github.com/dyoshikawa/rulesync), which automatically generates AI coding tool configuration files for Claude Code, Codex CLI, Cursor, and GitHub Copilot.

## Structure

```
.rulesync/
├── rules/           # Rule files that define project guidelines
│   └── overview.md  # Main project overview and conventions
├── commands/        # Custom commands for AI tools
│   └── review-pr.md
├── subagents/       # Subagent definitions
│   └── planner.md
├── mcp.json         # MCP (Model Context Protocol) server configuration
└── .aiignore        # Files to ignore in AI context
```

## Usage

### Generating Configuration Files

After cloning the repo or pulling changes to `.rulesync/`, generate your local tool-specific configurations:

```bash
bun run sync:rules
# or
npx rulesync generate
```

This will create/update:
- `.claude/CLAUDE.md` - Claude Code rules
- `.cursor/rules/overview.mdc` - Cursor rules
- `.github/copilot-instructions.md` - GitHub Copilot rules
- `AGENTS.md` - Codex CLI rules
- `.mcp.json` - MCP server configuration for Claude Code
- `.vscode/mcp.json` - MCP server configuration for Cursor
- Various ignore files and command/subagent configurations

All generated files are automatically added to `.gitignore` and should NOT be committed.

### Configuration

The `rulesync.jsonc` file in the project root controls:
- Which tools to target
- Which features to generate (rules, ignore, mcp, commands, subagents)
- Generation options

### Editing Rules

1. Edit files in `.rulesync/rules/`, `.rulesync/commands/`, or `.rulesync/subagents/`
2. Run `npx rulesync generate`
3. The changes will be reflected in all configured AI tools

### Adding New Rules

Create new `.md` files in the appropriate directory:

**For general rules:**
```bash
# Create a new rule file
touch .rulesync/rules/database-guidelines.md
```

Add frontmatter and content:
```markdown
---
root: false
targets: ["*"]
description: "Database access patterns and conventions"
globs: ["apps/worker/src/repositories/**/*", "apps/worker/src/db/**/*"]
---

# Database Guidelines

...your content here...
```

**For commands:**
```bash
touch .rulesync/commands/your-command.md
```

**For subagents:**
```bash
touch .rulesync/subagents/your-subagent.md
```

### MCP Servers

Edit `.rulesync/mcp.json` to add or configure MCP servers. Currently configured:
- **serena**: Code analysis and semantic search
- **context7**: Library documentation search

## Current Configuration

**Targets:** Claude Code, Codex CLI, Cursor, GitHub Copilot

**Features:** 
- Rules (project guidelines and conventions)
- Ignore files (what to exclude from AI context)
- MCP servers (external tools integration)
- Commands (custom AI commands)
- Subagents (specialized AI agents)

## Documentation

For more information about rulesync:
- [GitHub Repository](https://github.com/dyoshikawa/rulesync)
- [NPM Package](https://www.npmjs.com/package/rulesync)

## Workflow

### For Team Members (using the rules)
1. **After cloning**: Run `bun run sync:rules` to generate your local AI tool configs
2. **After pulling**: If `.rulesync/` changed, run `bun run sync:rules` to update your local configs

### For Rule Authors (updating the rules)
1. **Make changes** to `.rulesync/**` files or `rulesync.jsonc`
2. **Test locally**: Run `bun run sync:rules` to verify your changes
3. **Commit and push**: Commit the `.rulesync/` files and `rulesync.jsonc`
4. **Team syncs**: Other developers run `bun run sync:rules` after pulling

**Important**: Only commit files in `.rulesync/` and `rulesync.jsonc`. Generated files (`.claude/`, `.cursor/`, etc.) are git-ignored.
