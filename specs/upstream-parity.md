# Upstream Parity Matrix

Living document for tracking oracle-code vs upstream opencode.

## Last Sync
- Upstream ref: `upstream/main` @ `<commit>`
- Oracle ref: `main` @ `<commit>`
- Date: `<yyyy-mm-dd>`

## Local Features / Divergence

| Feature | Area | Local commits / PRs | Upstream overlap | Status | Notes |
|--------|------|----------------------|------------------|--------|-------|
| AFS (`.context/`) | cli/server | `<hashes>` | no | keep | Core oracle feature |
| Swarm roles + ToM panels | tui | `<hashes>` | no | keep | Uses `.context/memory/*` specs |
| Panes + which-key | tui | `<hashes>` | no | in-progress | See `.context/scratchpad/PANES_ROADMAP.md` |
| … | … | … | … | … | … |

## Upstream Features Not Yet Adopted

- `<feature>` — impact, files touched, local plan.
- …

## Conflict Hotspots

- `<path>` — why it conflicts, chosen strategy.
- …

## Decisions / Notes

- Naming policy:
  - Keep `opencode` identifiers where required for compatibility.
  - Use Oracle Code branding in user-facing surfaces.
- Merge strategy: prefer periodic merges from upstream into `main`, resolve conflicts, update this matrix.

