# Oracle Code

Fork of [OpenCode](https://github.com/sst/opencode) with agentic filesystem, context tracking, and multi-agent swarm features.

## Quick Start

```bash
bun install
./ocode
```

## CLI

```bash
ocode              # Launch TUI
ocode run          # Headless mode
ocode --help       # All commands
```

## Features

- **Agentic File System (AFS)** - Context-aware filesystem operations
- **Theory of Mind (ToM)** - Intent tracking via `.context/` directory
- **Agent Swarm** - Specialized agents: `@general`, `@planner`, `@coder`, `@critic`

## Configuration

`.oracle-code/oracle-code.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["STYLE_GUIDE.md"],
  "provider": { "anthropic": {} }
}
```

## Structure

```
packages/
  oracle-code/   # Core CLI
  sdk/           # TypeScript SDK
  plugin/        # Plugin system
  script/        # Build scripts
  util/          # Shared utilities
```

## Docs

- [AGENTS.md](./AGENTS.md) - Agent swarm
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Dev guide
- [.context/memory/AFS_SPEC.md](./.context/memory/AFS_SPEC.md) - AFS spec
- [.context/memory/AGENTS_SPEC.md](./.context/memory/AGENTS_SPEC.md) - Swarm spec

## License

MIT
