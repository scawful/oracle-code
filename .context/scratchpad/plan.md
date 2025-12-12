# Upstream Parity Plan (opencode → oracle-code)

## Goals
- Keep oracle-code feature-compatible with upstream opencode.
- Preserve oracle-only features (AFS, swarm roles, panes/which-key, ToM, metrics).
- Minimize long-lived divergence in shared areas.

## One-time setup
1. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/sst/opencode.git
   git fetch upstream --tags
   ```
2. Create tracking branches:
   ```bash
   git branch upstream-main upstream/main
   git branch parity-work main
   ```
3. Ensure main is green before syncing:
   ```bash
   bun install
   bun test
   bun run typecheck
   ```

## Baseline audit (do once per major sync)
1. Compare history and diffs:
   ```bash
   git log --oneline upstream/main..main
   git log --oneline main..upstream/main
   git range-diff upstream/main...main
   git diff --name-only upstream/main...main
   ```
2. Build a parity matrix (human-maintained long-term doc):
   - For each local feature/commit cluster, record:
     - Area (`cli`, `server`, `tui`, `docs`, `sdk`, etc.)
     - Upstream overlap? (`yes/no`)
     - Status: `keep`, `upstreamed`, `superseded`, `needs-refactor`
   - Store in `.context/scratchpad/upstream-parity.md` so it stays with HAFS.
   - Start by bucketing your ~123 local commits into a few themes (e.g., panes/which‑key, AFS, metrics/ToM, UI/theme, docs) and link each bucket to the commits/files it touches.
2.5. Create an “oracle‑only inventory” alongside the matrix:
   - List features that must not regress during merges (AFS layout, swarm roles, panes/which‑key, ToM panels, metrics/IRT, task outcome watcher, branding).
   - Note which upstream areas they hook into.
3. Identify conflict hotspots:
   - Files with high churn on both sides.
   - Large AI-generated edits that can be simplified.
4. Pick a merge approach per hotspot:
   - Rebase local stacks on top of upstream when clean.
   - Keep oracle features behind small hooks/flags when upstream churn is high.

## Ongoing sync cadence
- Weekly (or per upstream release):
  1. `git fetch upstream`
  2. Create a fresh branch for the sync: `git checkout -b parity/$(date +%Y-%m-%d)`
  3. Merge upstream: `git merge upstream/main`
  4. Resolve conflicts, then run:
     ```bash
     bun test
     bun run typecheck
     bun run lint
     ```
  5. Update parity matrix with new upstream features or removals.
  6. When green, merge the parity branch back to `main`.

## Compatibility guidelines
- Avoid renaming public flags, config keys, or on-disk paths unless upstream does.
- Prefer additive changes and feature flags over rewrites.
- Keep upstream APIs intact; layer oracle-only behavior via:
  - new `ocode` commands
  - optional config blocks
  - thin wrappers instead of replacing core logic.
- When editing shared modules, keep diffs small and isolated.

## Tooling / automation (recommended)
- CI job that runs `bun test` and `bun run typecheck` on `main`.
- Optional nightly parity report:
  - `git fetch upstream`
  - `git range-diff upstream/main...main`
  - post summary to a PR or issue.
- Small script (e.g., `script/parity.ts`) to:
  - list divergent commits since last sync
  - highlight conflicting files.

## Near-term tasks (next 2–3 syncs)
1. Run baseline audit and create `specs/upstream-parity.md`.
2. Review AI-slop candidates:
   - docs mismatches fixed
   - scan panes/which-key placeholders and dead code.
3. Do an upstream merge dry run on a branch and document conflicts.
4. Decide a naming policy:
   - keep `opencode` identifiers where required for compatibility
   - present Oracle Code branding in user-facing docs.
