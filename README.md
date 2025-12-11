# Oracle Code

**Oracle Code** is an AI-powered development environment with agentic filesystem capabilities, theory of mind context tracking, and multi-agent swarm collaboration.

A fork of [OpenCode](https://github.com/sst/opencode) with enhanced agent orchestration features.

## Features

- **Agentic File System (AFS)** - Intelligent filesystem operations with context awareness
- **Theory of Mind (ToM)** - Intent tracking and reasoning about user goals
- **Swarm Collaboration** - Multiple specialized agents working in concert
- **Context Memory** - Long-term memory via `.context/` directory

## Quick Start

```bash
# Install dependencies
bun install

# Run Oracle Code
bun run --cwd packages/oracle-code src/index.ts

# Or use the wrapper script
./ocode
```

## CLI

```bash
ocode              # Launch TUI
ocode run          # Run in headless mode
ocode --help       # Show all commands
```

## Agent Swarm

Oracle Code supports multi-agent collaboration:

- **@general** - Coordinator agent
- **@planner** - Strategy and architecture
- **@coder** - Implementation
- **@critic** - Review and quality assurance

## Configuration

Configuration lives in `.oracle-code/oracle-code.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["STYLE_GUIDE.md"],
  "provider": {
    "anthropic": {}
  }
}
```

## Project Structure

```
packages/
  oracle-code/     # Core CLI
  sdk/             # TypeScript SDK
  plugin/          # Plugin system
  script/          # Build scripts
  util/            # Shared utilities
```

## Documentation

- [AGENTS.md](./AGENTS.md) - Agent system documentation
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guide
- [.context/memory/AFS_SPEC.md](./.context/memory/AFS_SPEC.md) - AFS specification
- [.context/memory/SWARM_SPEC.md](./.context/memory/SWARM_SPEC.md) - Swarm specification

## License

MIT
