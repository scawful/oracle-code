# Scientific Rigor Review (Oracle Code)

This document compares the current oracle-code fork against the cited research papers. It is a factual alignment check, not an implementation spec.

## Sources

1. **“Mind Your Tone: Investigating How Prompt Politeness Affects LLM Accuracy”** (arXiv:2510.04950)  
   - Study on politeness/rudeness variants and multiple‑choice accuracy.
2. **“Everything is Context: Agentic File System Abstraction for Context Engineering”** (arXiv:2512.05470)  
   - Proposes a governed file‑system abstraction and a context pipeline.
3. **“Quantifying Human–AI Synergy”** (NeurIPS submission PDF)  
   - Bayesian IRT model for human–AI collaboration; ToM as a driver of κ (collaborative ability).
4. **“Towards a Science of Scaling Agent Systems”** (arXiv:2512.08296)  
   - Empirical coordination metrics and baselines for multi‑agent systems (efficiency, overhead, error amplification, redundancy, message density).

### Local source availability (2025‑12‑12)

- I couldn’t find a `~/Code/research` folder in this workspace. The AFS paper text exists in `~/Code/docs/chat_logs/` and in the `hafs` repo.
- The other papers were not found locally. Alignment notes for Synergy / Scaling / Tone are based on repository comments and prior summaries, and should be re‑verified once you point me at local copies or allow network access.

## Corrections vs the previous AI‑generated version

- **Metrics misattribution**: The prior review attributed coordination baselines (e.g., **17.2× vs 4.4× error amplification**, SAS baseline **0.466**, message‑density thresholds) to the Synergy paper. These values are from **Scaling Agent Systems (2512.08296)**, not from Synergy.
- **Pipeline naming**: *Everything is Context* names a “Constructor, Loader, Evaluator” trio in the abstract, but later defines the operative pipeline as **Constructor → Updater → Evaluator**. The previous version didn’t flag this naming shift.
- **ToM/IRT over‑correction**: The previous review stated ToM updating and fitted models were absent. The code does include experimental ToM belief/perspective/fluctuation utilities and a point‑estimate IRT fit; they’re just heuristic / not yet Bayesian‑validated.

## Executive summary

Oracle‑code is structurally aligned with the research framing (AFS, ToM scaffolding, coordination/IRT metrics), but does not yet meet full scientific‑rigor requirements:

- **AFS**: strong architectural match; heuristic prioritizer/evaluator modules exist but are not wired into the live context pipeline, and there is no closed semantic evaluation loop.
- **ToM**: provides belief/common‑ground schemas and experimental updating/perspective/fluctuation tools, but they are heuristic and not integrated into runtime coordination.
- **Metrics**: implements scaling‑paper heuristics and logs outcomes with a 2PL IRT point‑estimate fit; lacks Bayesian posteriors/intervals and formal validation.
- **Prompt politeness**: not directly implemented; no controlled experiments around tone.

## Module‑by‑module alignment

### 1. AFS (Agentic File System)

**Paper alignment (2512.05470):**

- The paper’s core idea—persistent, governed file‑system namespaces for context artefacts—maps cleanly onto `.context/{memory, knowledge, scratchpad, tools, history}`.
- Governance via access control and action discoverability matches oracle‑code’s policy enforcement.

**Gaps vs paper:**

- **Constructor prioritization/selection**: oracle‑code has `ContextPrioritizer` heuristics (`packages/oracle-code/src/afs/prioritizer.ts`) but they are not yet invoked by the live constructor; selection is still mostly implicit.
- **Updater/streaming**: paper stresses incremental refresh into bounded token windows; oracle‑code still does batch summarization/refresh.
- **Evaluator loop**: oracle‑code has a heuristic `ContextEvaluator` module (`packages/oracle-code/src/afs/evaluator.ts`) but it is not run automatically post‑output, so there is no feedback loop into selection.
- **Persistent cross‑session repository**: context persists per session, but there’s no first‑class cross‑session audit/registry UI.

### 2. Theory of Mind (ToM)

**Paper alignment (Synergy PDF; unverified locally):**

- Synergy frames ToM as enabling better collaboration ability (κ) and highlights within‑user ToM fluctuations influencing response quality.

**Current oracle‑code behavior:**

- `ToM` module defines BeliefState / CommonGround / divergence detection for representation.
- It also includes experimental utilities for:
  - evidence‑driven belief updating (`updateBelief`, `updateBeliefsFromEvidence`),
  - perspective‑taking models (`PerspectiveModel`, `inferPerspective`, gap/misalignment helpers),
  - heuristic fluctuation tracking over a session (`createFluctuationTracker`, markers‑based scores).
- These mechanisms are explicitly labeled heuristic and are not wired into orchestration or IRT fitting yet.

**Gaps vs paper:**

- No empirical κ/θ inference tied to ToM signals; fluctuation scores are not validated against outcomes.
- Perspective models are not automatically maintained per‑agent during sessions.

Net: ToM is an experimental scaffold, not yet a scientifically grounded mechanism.

### 3. Metrics / Agent Scaling

**Paper alignment (2512.08296; unverified locally):**

- The Scaling paper defines coordination efficiency, overhead, error amplification, redundancy, message density and reports empirical baselines (e.g., **17.2× vs 4.4× error amplification**).

**Current oracle‑code behavior:**

- Computes scaling‑paper‑inspired heuristics (coordination efficiency, error amplification, message density) and shows published baselines as references.
- Records outcomes for tasks, archived sessions, and multi‑tool chains (`TaskOutcomeWatcher`) with heuristic error lists.
- Fits a 2PL IRT model via gradient descent point estimates (`IRT.fitModel`) and uses it in metrics UI for predicted success.

**Gaps vs paper:**

- IRT fitting is MAP‑ish point estimation; no Bayesian posterior/credible intervals or uncertainty reporting yet.
- No held‑out validation/calibration loop.
- Overhead/redundancy measurements remain simplified coefficients, not trace‑based estimates.

Net: Metrics are paper‑informed and partially modeled, but not yet scientifically validated.

### 4. Prompt politeness

**Paper alignment (2510.04950; unverified locally):**

- The paper reports a small accuracy edge for rude vs polite prompts on multiple‑choice tasks.

**Oracle‑code status:**

- No module or config varies prompt politeness or measures its effect; tone is user/provider‑driven.

## Recommendations

### If the goal is scientific rigor

1. **Outcome logging is already in place**; next step is to add validation splits and uncertainty reporting.
2. Add Bayesian / interval estimation around IRT and coordination models (likely offline fitting).
3. Wire ToM updating/perspective/fluctuation into orchestration and κ inference, then validate against outcomes.
4. Integrate ContextPrioritizer + ContextEvaluator into a Constructor → Updater → Evaluator feedback loop.

### If the goal is practical product utility

Keep current heuristics, but:

- Label scaling baselines and error/ToM scores as heuristic/reference.
- Avoid implying any embedded baseline was measured in oracle‑code.
- Treat ToM/IRT features as experimental until validation exists.
