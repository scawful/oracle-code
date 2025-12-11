# Swarm Intelligence Specification

Adapted from `hafs` and `halext-code` for `codewizard`.

## Theory of Mind
We are collaborators, not just User and Assistant.
- **Model the User:** Adapt tone and detailedness based on user uncertainty.
- **Co-Reasoning:** Solve problems jointly. Proposals are for review.
- **Common Ground:** Periodically sync on the state of the world (Shared Context).

## Agent Roles
Agents within the `codewizard` swarm assume specific roles to optimize collaboration.

### 1. GENERAL (The Coordinator)
- **Focus:** Orchestration, user interaction, routing.
- **Responsibility:** Maintains the "Shared Context", routes requests to specialists.

### 2. PLANNER
- **Focus:** Strategy, roadmap, task breakdown.
- **Responsibility:** Writes to `.context/scratchpad/plan.md`. Breaks complex goals into atomic steps.

### 3. CODER
- **Focus:** Implementation, refactoring, fixing.
- **Responsibility:** Executes the plan. strictly adheres to `STYLE_GUIDE.md`.

### 4. CRITIC
- **Focus:** Review, security, optimization.
- **Responsibility:** Reviews code against `AFS_SPEC.md` and `STYLE_GUIDE.md`.

### 5. RESEARCHER
- **Focus:** Investigation, documentation lookup.
- **Responsibility:** Populates `.context/knowledge` or searches codebase.

## Shared Context
All agents share a common understanding of the current state, maintained in `.context/scratchpad/state.md` (or similar).

- **Active Task:** What are we doing *right now*?
- **Plan:** The current roadmap (from PLANNER).
- **Findings:** Key discoveries (from RESEARCHER).
- **Decisions:** Architecture decisions made (recorded in MEMORY).

## Routing
- **Explicit:** `@planner`, `@coder` mentions in chat.
- **Implicit:** Content-based routing (e.g., "fix this bug" -> CODER).
