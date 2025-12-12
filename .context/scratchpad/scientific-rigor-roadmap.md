# Proposed Scientific Rigor Roadmap

Derived from `.context/knowledge/scientific-rigor-review.md`. This is an engineering plan, not a claim of current rigor.

Paper‑fidelity note: during this pass only the AFS paper text was available locally; numeric/method claims attributed to Synergy / Scaling / Tone should be treated as provisional until you provide local copies or allow network re‑verification.

## Scope

Improve the **scientific fidelity** of oracle‑code’s AFS / ToM / Metrics by:
- collecting real outcome data,
- fitting models grounded in the papers,
- integrating evaluator feedback loops,
- and removing AI‑slop / misattributed assumptions.

Non‑goals (for now):
- Publishing a peer‑review‑ready replication.
- Replacing upstream opencode product features.

## Current state (ground truth)

Based on the code today:
- **AFS** already has heuristic `ContextPrioritizer` and `ContextEvaluator` modules in `packages/oracle-code/src/afs/`, but they are not clearly wired into the live context pipeline.
- **ToM** in `packages/oracle-code/src/tom/index.ts` includes experimental belief updating, perspective models, and fluctuation scoring, but they are not yet integrated into runtime coordination or empirically validated.
- **Metrics** in `packages/oracle-code/src/metrics/` already includes:
  - `irt.ts` (point‑estimate IRT via gradient descent),
  - `tracking.ts` (outcome persistence + refit trigger),
  - `errors.ts` (heuristic error detectors),
  - `index.ts` (coordination metrics w/ paper baselines).
- Phase 0 cleanup removed local-path references and over-claimed “Bayesian” comments; unit tests now cover IRT, contradiction detection, and context prioritization.
- **Spec mismatch**: resolved. `TaskTracking` now writes to `.context/scratchpad/metrics` and migrates legacy data from `history/metrics` on read.

## Phase 0 — Audit & de‑slop (prerequisite)

1. **Scrub hallucinated / local‑path docs**
   - Remove absolute file references and speculative claims in:
     - `packages/oracle-code/src/metrics/*.ts`
     - `packages/oracle-code/src/afs/*.ts`
     - `packages/oracle-code/src/tom/index.ts`
   - Replace with short, accurate module summaries and paper citations.

2. **Paper‑fidelity review**
   - Re‑read the papers’ method sections and map each implemented formula to a source.
   - Flag any “nice‑sounding” constants or equations without a citation.

3. **Unit tests for existing stats/heuristics**
   - `IRT.logistic`, `IRT.pSuccess`, `IRT.fitModel` stability on synthetic data.
   - `ErrorDetection.detectContradictions` sanity cases.
   - `ContextPrioritizer.calculatePriority` deterministic scoring.

Deliverable: PR that makes the current code honest and test‑backed.

## Phase 1 — Outcome instrumentation (data first)

1. **Define “task outcome” precisely**
   - Current implementation treats three kinds of “tasks”:
     - Each completed `task` tool (subagent job) → taskID = tool callID.
     - Each archived session not spawned by a `task` tool → taskID = `session:<sessionID>`.
     - Each completed multi‑tool chain inside an assistant message (≥2 non‑`task` tools) → taskID = `chain:<messageID>`.
   - Success signal is user‑confirmed via a dialog when each unit completes.

2. **Fix AFS policy vs storage location**
   - Option A (recommended): store mutable metrics in a new writable path, e.g. `.context/scratchpad/metrics/` or `.context/state/metrics/`.
   - Keep `history/` immutable except for archival snapshots.
   - Update `TaskTracking` accordingly.

3. **Wire recording into runtime**
   - Implemented:
     - `ocode metrics record|fit|export` CLI for manual control.
     - TUI `TaskOutcomeWatcher` that prompts on completed tasks/sessions/chains and records outcomes automatically.
     - Outcomes now include real `ErrorDetection` lists (stored alongside `errorCount`).

Deliverable: real outcomes accumulating automatically with no manual steps.

## Phase 2 — Make Metrics scientifically grounded

1. **Clarify the inference goal**
   - Today `IRT.fitModel` is MAP‑ish gradient descent (point estimates).
   - Decide the target:
     - **Short‑term rigor**: MAP + **Laplace/bootstrapped intervals**.
     - **Long‑term rigor**: full Bayesian posterior (VI/MCMC) run offline.

2. **Upgrade IRT fitting**
   - Add convergence diagnostics, regularization justification, and parameter identifiability checks.
   - Compute uncertainty (credible/CI) from:
     - Hessian approximation, or
     - bootstrap resampling.
   - Store intervals in the model JSON (already shaped for it).

3. **Validate against held‑out outcomes**
   - Split outcomes into train/validation.
   - Report log‑likelihood and calibration in a simple CLI report.

4. **Finish Scaling‑paper metrics**
   - Add real overhead and redundancy measurements, not constants.
   - Make baselines **display‑only** references, never used as “measured in oracle‑code.”

Deliverable: metrics screen showing fitted θ/κ/β/γ with uncertainty and validation stats.

## Phase 3 — Dynamic ToM (from scaffolding → mechanism)

1. **Belief updating**
   - Add an explicit belief update function that:
     - merges new evidence,
     - updates confidence,
     - timestamps deltas.

2. **Perspective‑taking models**
   - Introduce per‑agent “model of other agents” objects:
     - what A thinks B knows,
     - confidence in that model.

3. **ToM fluctuation tracking**
   - Log lightweight per‑turn ToM signals (conversation markers, repair, confirmation).
   - Store per session in writable context.

4. **Connect ToM → Metrics**
   - Use fluctuation scores as priors or covariates for κ updates.
   - Surface divergence/resolution impact on coordination efficiency.

Deliverable: ToM panel reflects evolving beliefs + perspective models and feeds κ.

## Phase 4 — Close the AFS context loop

1. **Integrate `ContextPrioritizer` into context construction**
   - Make selection explicit and token‑budget aware.
   - Replace 4‑chars/token heuristic with provider tokenizer when feasible.

2. **Run `ContextEvaluator` post‑output**
   - Validate outputs against memory/knowledge.
   - Produce utilization + contradiction reports.

3. **Safe memory promotion**
   - Don’t auto‑write `.context/memory/`.
   - Instead write promotion candidates to `.context/scratchpad/promotions.md` for human review.

4. **Feedback loop**
   - Feed utilization/relevance scores back into prioritizer (`previousUtilization`).

Deliverable: measurable context quality loop (Constructor → Updater → Evaluator → Constructor).

## Phase 5 — UX + docs

1. **Expose model status**
   - Show “data count / last fitted / confidence” in metrics UI.

2. **Add a docs page**
   - Explain what is heuristic vs fitted vs experimental.
   - Link to the rigor review and papers.

Deliverable: users understand what the system is *actually* doing.

## Risks / open decisions

- Success labels can be noisy without user confirmation.
- Bayesian fitting in TS may be too slow online → likely needs offline fitting tooling.
- Writing to `history/` conflicts with AFS read‑only semantics unless we redefine that directory’s role.

## Suggested execution order

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5.
