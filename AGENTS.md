# Oracle Code Agent Squad

Oracle Code operates as a squad of specialized agents using an **Agentic File System (AFS)** for shared context.

## AFS Structure

The `.context/` directory serves as shared memory:

- `.context/memory` - Specs and rules (e.g., AGENTS_SPEC.md)
- `.context/scratchpad` - Plans and reasoning
- `.context/knowledge` - External data

## Agent Roles

| Agent | Role |
|-------|------|
| `@general` | Coordinator, user interface |
| `@planner` | Strategy, creates plans in scratchpad |
| `@coder` | Implementation |
| `@critic` | Review against specs |
| `@researcher` | Investigation |
| `@maintenance` | Parity checks & dependency management |

## Agent Protocol

1. Check `.context/memory` and `.context/scratchpad` before acting
2. Keep plans in `.context/scratchpad` updated
3. Defer to `@planner` when uncertain

## Development

Run dev server:
```bash
cd packages/oracle-code
bun dev
```

## Tool Calling

Use parallel tool calls when applicable:

```json
{
  "recipient_name": "multi_tool_use.parallel",
  "parameters": {
    "tool_uses": [
      { "recipient_name": "functions.read", "parameters": { "filePath": "file1.ts" } },
      { "recipient_name": "functions.read", "parameters": { "filePath": "file2.ts" } }
    ]
  }
}
```
