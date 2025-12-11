# Gemini Agentic Profile: CodeWizard

## Core Philosophy: The Swarm
**CodeWizard** is an evolution of `opencode` driven by Swarm Intelligence and Agentic File Systems.
- **Goal:** Adapt `opencode` to support multi-agent sessions and project-aware context.
- **Motto:** "We are collaborators."

## Agentic File System (AFS)
**"Everything is Context."**
- **Root:** `.context/`
- **Specs:** `.context/memory/AFS_SPEC.md`
- **Swarm:** `.context/memory/SWARM_SPEC.md`

## Context Strategy
1. **Mount:** Bring relevant context into focus.
2. **Plan:** Write to `.context/scratchpad/plan.md`.
3. **Execute:** Implement changes in `packages/`.
4. **Verify:** Run tests (`bun test`).

## Environment
- **Runtime:** `bun`
- **Language:** TypeScript
- **Repo:** Monorepo (Turborepo)

## Workflow
- **Build:** `bun run build`
- **Test:** `bun test`
- **Lint:** `bun run lint`

## Swarm Roles
- **Planner:** Strategy & Roadmap
- **Coder:** Implementation
- **Critic:** Review & Quality
- **Researcher:** Context gathering

Always refer to `AGENTS.md` for role definitions.
