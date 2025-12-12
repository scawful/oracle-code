# Contributing

Common contributions:

- Bug fixes
- LSP / formatter support
- LLM performance improvements
- New provider support
- Environment-specific fixes
- Documentation

UI/core features require design review. Check issues labeled [`help wanted`](https://github.com/scawful/oracle-code/issues?q=label%3Ahelp-wanted), [`good first issue`](https://github.com/scawful/oracle-code/issues?q=label%3A%22good%20first%20issue%22), [`bug`](https://github.com/scawful/oracle-code/issues?q=label%3Abug), or [`perf`](https://github.com/scawful/oracle-code/issues?q=label%3Aperf).

## Setup

Requirements: Bun 1.3+

```bash
bun install
bun dev
```

## Structure

- `packages/oracle-code` - Core logic & server
- `packages/oracle-code/src/cli/cmd/tui/` - TUI (SolidJS + [opentui](https://github.com/sst/opentui))
- `packages/plugin` - `@oracle-code/plugin`

After editing `packages/oracle-code/src/server/server.ts`, regenerate SDK:
```bash
./packages/sdk/js/script/build.ts
```

## Debugging

Run with inspector:
```bash
bun run --inspect=ws://localhost:6499/ dev
```

Or set `export BUN_OPTIONS=--inspect=ws://localhost:6499/`

**Caveats:**
- `*.tsx` breakpoints don't map correctly (use `debugger;` statements)
- For server breakpoints with TUI running, use `bun dev spawn`

VSCode configs: [.vscode/settings.example.json](.vscode/settings.example.json), [.vscode/launch.example.json](.vscode/launch.example.json)

## Pull Requests

- Keep PRs small and focused
- Link relevant issues
- Explain the fix
- Skip verbose AI-generated descriptions
- Check for existing similar functionality before adding new code

## Style

- Single functions unless reuse is clear
- Avoid unnecessary destructuring
- Avoid `else` statements
- Prefer `.catch()` over try/catch
- Precise types, avoid `any`
- Prefer `const`, avoid `let`
- Concise naming
- Use Bun APIs (`Bun.file()`, etc.)

See [STYLE_GUIDE.md](./STYLE_GUIDE.md)

## Feature Requests

Open an issue first. Wait for approval before implementing.
