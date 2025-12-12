# Upstream Parity Matrix (template)

Human‑maintained map of oracle‑code divergence vs upstream opencode.

## Status legend

- `keep` — oracle‑only feature that must remain.
- `upstreamed` — feature now exists upstream; local copy can be dropped.
- `superseded` — upstream replacement is better; migrate and remove local.
- `needs-refactor` — keep, but rework to reduce conflict surface.
- `dropped` — intentionally removed from oracle‑code.

## Buckets

Fill these out by grouping your local commits into themes. For each bucket, add the commits (hashes), key files, and merge notes.

### Panes / Which‑key / TUI

- Local commits:
- Key files/dirs:
- Upstream overlap:
- Hotspots / conflict notes:
- Desired strategy: `keep` / `needs-refactor` / …

### AFS / Swarm / Context

- Local commits:
- Key files/dirs:
- Upstream overlap:
- Hotspots / conflict notes:
- Desired strategy:

### Metrics / ToM / Scientific rigor

- Local commits:
- Key files/dirs:
- Upstream overlap:
- Hotspots / conflict notes:
- Desired strategy:

### CLI / Server / SDK divergences

- Local commits:
- Key files/dirs:
- Upstream overlap:
- Hotspots / conflict notes:
- Desired strategy:

### Docs / Branding / UX polish

- Local commits:
- Key files/dirs:
- Upstream overlap:
- Hotspots / conflict notes:
- Desired strategy:

## Hotspots table

| File/Dir | Why hot (both sides churn) | Strategy (merge/rebase/flag/hook) |
|---|---|---|
|  |  |  |

