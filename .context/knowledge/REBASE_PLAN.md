# Rebase / Porting Plan: oracle-code fork → upstream `sst/opencode`

## Current State
- Remote `upstream` added: `https://github.com/sst/opencode`
- Divergence (`git rev-list --left-right --count upstream/dev...dev`):  
  - Ahead: ~244 commits (fork features)  
  - Behind: ~28 commits (upstream changes)
- Working branch: `dev` (tracking origin/dev), clean.
- Stashes (local data):  
  - `stash@{0}`: "context manifest" (.context/hivemind/manifest.json)  
  - `stash@{1}`: "local context changes" (.context/*)
- `.context/` and `hivemind/` are ignored (.gitignore).
- Attempted cherry-pick onto `feature/afs-cognitive` (from upstream/dev) aborted due to heavy conflicts (session/index.tsx divergence).

## Key Fork Features to Preserve
- TUI panes/sidebars: dual sidebars, pane persistence (sidebars, floating, history, maximized), subagent tabs, buffer list.
- Cognitive stack: emotions extensions, hivemind tools, autonomy/grounding/inference/historical-memory/project-config, emotion triggers.
- TUI views fixes: messages/plan/todo type fixes and new cognitive/hivemind/state/orchestration views.
- Agent/tooling: hivemind manage tool.
- Ignore local context/hivemind data.

## Recommended Port Strategy (Manual, Low-Risk)
1) Base branch: `feature/afs-cognitive` from `upstream/dev` (already created, empty).
2) Re-implement in small batches (no bulk cherry-pick):
   - Batch 1: Pane context + sidebar persistence (panes.tsx, related hooks; ensure serialize/deserialize include sidebars/floating/history/maximized).
   - Batch 2: TUI session/sidebar wiring (session/index.tsx/sidebar.tsx, which-key bindings, subagent tabs, buffer list).
   - Batch 3: New views/components (cognitive/hivemind/state/orchestration/home) and contexts (messages/buffer).
   - Batch 4: Cognitive modules (emotions, triggers, autonomy, grounding, inference, historical-memory, project-config, hivemind store updates).
   - Batch 5: Tooling (hivemind-manage).
3) After each batch: `bun turbo typecheck` (or at least `packages/oracle-code` typecheck) and commit.
4) Push `feature/afs-cognitive` to origin; keep `dev` as the active fork branch until the port is stable.

## Conflicts to Expect
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` structure changed upstream; port changes manually.
- `package.json` / `bun.lock` drift; minimize lockfile churn—defer lockfile update until the end or align with upstream’s tooling.
- UI components/layout in desktop/web/docs may have diverged; avoid touching unless needed.

## Notes
- Upstream has many branches; target `upstream/dev` only.
- Keep local data in stashes; apply after code port if needed.
- If the manual port is too heavy, alternative is a merge of `upstream/dev` into `dev` with conflict resolution, but that is higher risk/time.
