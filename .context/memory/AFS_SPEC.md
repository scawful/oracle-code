# Agentic File System (AFS) Specification

Adapted from `hafs` for `codewizard`.

## Philosophy
"Everything is Context." The file system is the shared brain between the User and the Agent Swarm.

## Directory Structure
The `.context/` directory is the root of the Agentic File System.

- **`/memory`** (Policy: `read_only`)
  - **Purpose:** Long-term memory, documentation, specifications, architectural decisions.
  - **Content:** Docs that define *what* the project is and *how* it should be built.
  - **Agent Action:** Agents verify these files before planning.

- **`/knowledge`** (Policy: `read_only`)
  - **Purpose:** Read-only references, logs, disassembly, third-party docs.
  - **Content:** Immutable reference material.

- **`/tools`** (Policy: `executable`)
  - **Purpose:** Scripts and executables available to agents.
  - **Content:** Automation scripts, maintenance tools.

- **`/scratchpad`** (Policy: `writable`)
  - **Purpose:** Transient working memory, planning documents, reasoning traces.
  - **Content:** `plan.md`, `current_task.md`, debug logs.
  - **Agent Action:** Agents write plans here before executing code changes.

- **`/history`** (Policy: `read_only`)
  - **Purpose:** Archived context from previous sessions.

## Context Strategy
1. **Mount:** Bring relevant files into focus.
2. **Read-Plan-Verify:** Check `.context/memory` first. Write plans to `.context/scratchpad`. Verify against specs before editing code.
3. **Update:** Keep context alive. If a decision changes, update `/memory`.

## Policies
- **`read_only`**: Agents must NOT modify.
- **`writable`**: Agents are encouraged to create and modify.
- **`executable`**: Agents can run these.
