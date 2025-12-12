import { z } from "zod"

/**
 * Theory of Mind (ToM) module.
 *
 * Data structures and heuristic utilities for modeling agent beliefs, goals,
 * common ground, and (experimental) perspective-taking.
 *
 * Inspired by:
 * - "Quantifying Human–AI Synergy" (NeurIPS submission) for ToM/κ framing.
 * - "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296) for
 *   coordination context.
 *
 * Dynamic belief updates and fluctuation scoring are heuristic and not yet
 * empirically validated or fully integrated into runtime coordination.
 */
export namespace ToM {
  /**
   * Source of knowledge for tracking how information was acquired
   */
  export type KnowledgeSource = "direct" | "inferred" | "shared"

  /**
   * Status of a goal in an agent's goal stack
   */
  export type GoalStatus = "active" | "completed" | "blocked" | "abandoned"

  /**
   * Synchronization status of common ground between agents
   */
  export type SyncStatus = "synchronized" | "divergent" | "unknown"

  /**
   * A single piece of knowledge with provenance tracking
   */
  export const KnowledgeEntry = z.object({
    /** Unique key for this knowledge item */
    key: z.string(),
    /** The actual knowledge value (can be any JSON-serializable value) */
    value: z.unknown(),
    /** Confidence level (0-1) in this knowledge */
    confidence: z.number().min(0).max(1),
    /** How this knowledge was acquired */
    source: z.enum(["direct", "inferred", "shared"]),
    /** When this knowledge was last updated */
    timestamp: z.number(),
    /** Optional: Which agent shared this (for source="shared") */
    sharedBy: z.string().optional(),
  })
  export type KnowledgeEntry = z.infer<typeof KnowledgeEntry>

  /**
   * A goal in an agent's goal hierarchy
   */
  export const Goal = z.object({
    /** Unique identifier for this goal */
    id: z.string(),
    /** Human-readable description */
    description: z.string(),
    /** Priority level (higher = more important) */
    priority: z.number(),
    /** Current status of the goal */
    status: z.enum(["active", "completed", "blocked", "abandoned"]),
    /** When this goal was created */
    created: z.number(),
    /** When this goal was completed/resolved (if applicable) */
    resolved: z.number().optional(),
    /** Parent goal ID for hierarchical goals */
    parentGoalID: z.string().optional(),
    /** What's blocking this goal (if status="blocked") */
    blockedBy: z.string().optional(),
  })
  export type Goal = z.infer<typeof Goal>

  /**
   * Belief state for a single agent
   * Represents what an agent "knows" and what it's trying to accomplish
   */
  export const BeliefState = z.object({
    /** Agent identifier */
    agentID: z.string(),
    /** Session ID where this belief state exists */
    sessionID: z.string(),
    /** Agent name (e.g., "Plan", "Explore") */
    agentName: z.string(),
    /** Knowledge base */
    knowledge: z.array(KnowledgeEntry),
    /** Goal stack */
    goals: z.array(Goal),
    /** When this belief state was last updated */
    lastUpdated: z.number(),
  })
  export type BeliefState = z.infer<typeof BeliefState>

  /**
   * A fact that's been acknowledged by multiple agents (common ground)
   */
  export const SharedFact = z.object({
    /** Unique key for this fact */
    key: z.string(),
    /** The shared fact value */
    value: z.unknown(),
    /** Which agents have acknowledged this fact */
    acknowledgedBy: z.array(z.string()),
    /** When this fact was established */
    establishedAt: z.number(),
    /** When it was last confirmed */
    lastConfirmed: z.number(),
  })
  export type SharedFact = z.infer<typeof SharedFact>

  /**
   * A divergence in beliefs between agents
   */
  export const BeliefDivergence = z.object({
    /** The key where divergence was detected */
    key: z.string(),
    /** The different values held by different agents */
    values: z.array(
      z.object({
        agentID: z.string(),
        agentName: z.string(),
        value: z.unknown(),
        confidence: z.number(),
      })
    ),
    /** When this divergence was detected */
    detectedAt: z.number(),
    /** Severity assessment */
    severity: z.enum(["low", "medium", "high"]),
  })
  export type BeliefDivergence = z.infer<typeof BeliefDivergence>

  /**
   * Common ground between all active agents
   * Represents shared understanding and detected divergences
   */
  export const CommonGround = z.object({
    /** Facts that all agents agree on */
    sharedFacts: z.array(SharedFact),
    /** Current synchronization status */
    syncStatus: z.enum(["synchronized", "divergent", "unknown"]),
    /** When common ground was last synchronized */
    lastSyncTime: z.number(),
    /** Detected divergences between agents */
    divergences: z.array(BeliefDivergence),
    /** Number of active agents in the common ground */
    agentCount: z.number(),
  })
  export type CommonGround = z.infer<typeof CommonGround>

  /**
   * A sub-intent derived from user request analysis
   */
  export const SubIntent = z.object({
    /** Description of this sub-intent */
    description: z.string(),
    /** Whether this sub-intent has been satisfied */
    satisfied: z.boolean(),
    /** Which agent(s) are working on this */
    assignedTo: z.array(z.string()).optional(),
  })
  export type SubIntent = z.infer<typeof SubIntent>

  /**
   * Model of the user's intent based on conversation analysis
   */
  export const UserIntentModel = z.object({
    /** Primary intent extracted from user request */
    primaryIntent: z.string(),
    /** Confidence in the intent interpretation (0-1) */
    confidence: z.number().min(0).max(1),
    /** Decomposed sub-intents */
    subIntents: z.array(SubIntent),
    /** Explicit constraints from the user */
    constraints: z.array(z.string()),
    /** When this model was created */
    created: z.number(),
    /** When this model was last updated */
    lastUpdated: z.number(),
  })
  export type UserIntentModel = z.infer<typeof UserIntentModel>

  /**
   * Thresholds and constants for ToM reasoning
   */
  export const Thresholds = {
    /** Below this confidence, knowledge is considered uncertain */
    uncertaintyThreshold: 0.5,
    /** Below this confidence, knowledge is considered unreliable */
    unreliableThreshold: 0.3,
    /** Maximum age (ms) before knowledge is considered stale */
    staleKnowledgeAge: 5 * 60 * 1000, // 5 minutes
    /** Minimum confidence required to share knowledge */
    shareConfidenceThreshold: 0.6,
    /** Divergence severity thresholds */
    divergenceSeverity: {
      /** Confidence difference threshold for low severity */
      low: 0.2,
      /** Confidence difference threshold for medium severity */
      medium: 0.4,
      /** Above this is high severity */
      high: 0.6,
    },
  } as const

  /**
   * Create an empty belief state for a new agent
   */
  export function createEmptyBeliefState(agentID: string, sessionID: string, agentName: string): BeliefState {
    return {
      agentID,
      sessionID,
      agentName,
      knowledge: [],
      goals: [],
      lastUpdated: Date.now(),
    }
  }

  /**
   * Create an empty common ground
   */
  export function createEmptyCommonGround(): CommonGround {
    return {
      sharedFacts: [],
      syncStatus: "unknown",
      lastSyncTime: Date.now(),
      divergences: [],
      agentCount: 0,
    }
  }

  /**
   * Create an empty user intent model
   */
  export function createEmptyUserIntent(): UserIntentModel {
    return {
      primaryIntent: "",
      confidence: 0,
      subIntents: [],
      constraints: [],
      created: Date.now(),
      lastUpdated: Date.now(),
    }
  }

  /**
   * Add knowledge to a belief state
   */
  export function addKnowledge(
    state: BeliefState,
    key: string,
    value: unknown,
    confidence: number,
    source: KnowledgeSource,
    sharedBy?: string
  ): BeliefState {
    const existingIndex = state.knowledge.findIndex((k) => k.key === key)
    const entry: KnowledgeEntry = {
      key,
      value,
      confidence,
      source,
      timestamp: Date.now(),
      sharedBy,
    }

    const newKnowledge = [...state.knowledge]
    if (existingIndex >= 0) {
      // Only update if new confidence is higher or source is more authoritative
      const existing = newKnowledge[existingIndex]
      if (
        confidence > existing.confidence ||
        (source === "direct" && existing.source !== "direct")
      ) {
        newKnowledge[existingIndex] = entry
      }
    } else {
      newKnowledge.push(entry)
    }

    return {
      ...state,
      knowledge: newKnowledge,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Add a goal to a belief state
   */
  export function addGoal(
    state: BeliefState,
    description: string,
    priority: number,
    parentGoalID?: string
  ): BeliefState {
    const goal: Goal = {
      id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      description,
      priority,
      status: "active",
      created: Date.now(),
      parentGoalID,
    }

    return {
      ...state,
      goals: [...state.goals, goal],
      lastUpdated: Date.now(),
    }
  }

  /**
   * Update goal status
   */
  export function updateGoalStatus(
    state: BeliefState,
    goalID: string,
    status: GoalStatus,
    blockedBy?: string
  ): BeliefState {
    const newGoals = state.goals.map((g) =>
      g.id === goalID
        ? {
            ...g,
            status,
            resolved: status === "completed" || status === "abandoned" ? Date.now() : undefined,
            blockedBy: status === "blocked" ? blockedBy : undefined,
          }
        : g
    )

    return {
      ...state,
      goals: newGoals,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Detect divergences between belief states
   */
  export function detectDivergences(states: BeliefState[]): BeliefDivergence[] {
    const divergences: BeliefDivergence[] = []
    const allKeys = new Set<string>()

    // Collect all knowledge keys
    for (const state of states) {
      for (const k of state.knowledge) {
        allKeys.add(k.key)
      }
    }

    // Check each key for divergences
    for (const key of allKeys) {
      const entries = states
        .map((s) => {
          const knowledge = s.knowledge.find((k) => k.key === key)
          if (!knowledge) return null
          return {
            agentID: s.agentID,
            agentName: s.agentName,
            value: knowledge.value,
            confidence: knowledge.confidence,
          }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)

      // Check if values differ
      if (entries.length > 1) {
        const firstValue = JSON.stringify(entries[0].value)
        const hasDivergence = entries.some((e) => JSON.stringify(e.value) !== firstValue)

        if (hasDivergence) {
          // Calculate severity based on confidence levels
          const maxConfidence = Math.max(...entries.map((e) => e.confidence))
          const minConfidence = Math.min(...entries.map((e) => e.confidence))
          const confDiff = maxConfidence - minConfidence

          let severity: "low" | "medium" | "high"
          if (confDiff >= Thresholds.divergenceSeverity.high) {
            severity = "high"
          } else if (confDiff >= Thresholds.divergenceSeverity.medium) {
            severity = "medium"
          } else {
            severity = "low"
          }

          divergences.push({
            key,
            values: entries,
            detectedAt: Date.now(),
            severity,
          })
        }
      }
    }

    return divergences
  }

  /**
   * Build common ground from multiple belief states
   */
  export function buildCommonGround(states: BeliefState[]): CommonGround {
    if (states.length === 0) {
      return createEmptyCommonGround()
    }

    const sharedFacts: SharedFact[] = []
    const allKeys = new Set<string>()

    // Collect all knowledge keys
    for (const state of states) {
      for (const k of state.knowledge) {
        allKeys.add(k.key)
      }
    }

    // Find shared facts (knowledge with same value across agents)
    for (const key of allKeys) {
      const entries = states
        .map((s) => ({
          agentID: s.agentID,
          knowledge: s.knowledge.find((k) => k.key === key),
        }))
        .filter((e) => e.knowledge !== undefined)

      if (entries.length > 1) {
        const firstValue = JSON.stringify(entries[0].knowledge!.value)
        const isShared = entries.every((e) => JSON.stringify(e.knowledge!.value) === firstValue)

        if (isShared) {
          sharedFacts.push({
            key,
            value: entries[0].knowledge!.value,
            acknowledgedBy: entries.map((e) => e.agentID),
            establishedAt: Math.min(...entries.map((e) => e.knowledge!.timestamp)),
            lastConfirmed: Math.max(...entries.map((e) => e.knowledge!.timestamp)),
          })
        }
      }
    }

    const divergences = detectDivergences(states)
    const syncStatus: SyncStatus =
      divergences.length === 0 ? "synchronized" : divergences.some((d) => d.severity === "high") ? "divergent" : "divergent"

    return {
      sharedFacts,
      syncStatus,
      lastSyncTime: Date.now(),
      divergences,
      agentCount: states.length,
    }
  }

  /**
   * Get sync status color for UI display
   */
  export function getSyncStatusColor(status: SyncStatus): "success" | "warning" | "error" {
    switch (status) {
      case "synchronized":
        return "success"
      case "divergent":
        return "warning"
      case "unknown":
        return "error"
    }
  }

  /**
   * Get divergence severity color
   */
  export function getDivergenceSeverityColor(severity: "low" | "medium" | "high"): "success" | "warning" | "error" {
    switch (severity) {
      case "low":
        return "success"
      case "medium":
        return "warning"
      case "high":
        return "error"
    }
  }

  // Experimental belief updating utilities. Uses a Bayes-like confidence update
  // to incorporate new evidence; not a full probabilistic ToM engine yet.

  /**
   * Evidence type for belief updates.
   */
  export type EvidenceSource = "observation" | "inference" | "communication" | "contradiction"

  /**
   * Evidence structure for updating beliefs
   */
  export const Evidence = z.object({
    source: z.enum(["observation", "inference", "communication", "contradiction"]),
    strength: z.number().min(0).max(1),
    timestamp: z.number(),
    agentID: z.string().optional(),
    description: z.string().optional(),
  })
  export type Evidence = z.infer<typeof Evidence>

  /**
   * Bayes-like belief update.
   *
   * Applies a simple prior/likelihood update to knowledge confidence and may
   * replace values when evidence increases confidence. This is a heuristic
   * approximation of ToM dynamics.
   */
  export function updateBelief(
    state: BeliefState,
    key: string,
    newValue: unknown,
    evidence: Evidence,
  ): BeliefState {
    const existing = state.knowledge.find((k) => k.key === key)

    if (!existing) {
      // New knowledge, use evidence strength as initial confidence
      const source: KnowledgeSource = evidence.source === "communication" ? "shared" : "direct"
      return addKnowledge(state, key, newValue, evidence.strength, source)
    }

    // Bayesian update: P(H|E) ∝ P(E|H) * P(H)
    const prior = existing.confidence
    const likelihood = evidence.strength

    // Handle contradiction evidence specially
    if (evidence.source === "contradiction") {
      // Contradictory evidence reduces confidence
      const posterior = prior * (1 - likelihood)
      return updateKnowledgeConfidence(state, key, Math.max(0.1, posterior))
    }

    // Standard Bayesian update
    const posterior = (likelihood * prior) / ((likelihood * prior) + ((1 - likelihood) * (1 - prior)))

    // Only update if new confidence represents meaningful change
    const confidenceChange = Math.abs(posterior - prior)
    if (confidenceChange > 0.05) {
      // Determine if we should update value or just confidence
      const valuesMatch = JSON.stringify(existing.value) === JSON.stringify(newValue)

      if (valuesMatch) {
        // Same value, just update confidence
        return updateKnowledgeConfidence(state, key, posterior)
      } else if (posterior > prior) {
        // New value with higher confidence, replace
        return addKnowledge(state, key, newValue, posterior, "inferred")
      } else {
        // New value but lower confidence, keep existing but note the alternative
        // This could be extended to track alternative beliefs
        return updateKnowledgeConfidence(state, key, Math.min(prior, posterior + 0.1))
      }
    }

    return state
  }

  /**
   * Update confidence for an existing knowledge entry
   */
  function updateKnowledgeConfidence(state: BeliefState, key: string, newConfidence: number): BeliefState {
    const newKnowledge = state.knowledge.map((k) =>
      k.key === key
        ? { ...k, confidence: newConfidence, timestamp: Date.now() }
        : k,
    )

    return {
      ...state,
      knowledge: newKnowledge,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Batch update beliefs from multiple evidence sources
   */
  export function updateBeliefsFromEvidence(
    state: BeliefState,
    updates: Array<{ key: string; value: unknown; evidence: Evidence }>,
  ): BeliefState {
    let updatedState = state

    for (const update of updates) {
      updatedState = updateBelief(updatedState, update.key, update.value, update.evidence)
    }

    return updatedState
  }

  // Experimental perspective-taking helpers for modeling what one agent believes
  // another knows. Heuristic and not yet wired into coordination logic.

  /**
   * Model of what one agent believes another agent knows
   */
  export const PerspectiveModel = z.object({
    /** Agent doing the modeling */
    observerID: z.string(),
    /** Agent being modeled */
    targetID: z.string(),
    /** What observer thinks target knows */
    modeledBeliefs: z.array(KnowledgeEntry),
    /** Confidence in this perspective model (0-1) */
    confidence: z.number().min(0).max(1),
    /** When this model was last updated */
    lastUpdated: z.number(),
    /** Gaps: what observer knows but thinks target doesn't */
    knowledgeGaps: z.array(z.string()),
    /** Potential misalignments detected */
    potentialMisalignments: z.array(
      z.object({
        key: z.string(),
        observerValue: z.unknown(),
        modeledTargetValue: z.unknown(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    ),
  })
  export type PerspectiveModel = z.infer<typeof PerspectiveModel>

  /**
   * Model what Agent A believes Agent B knows
   *
   * This is the core perspective-taking function that enables
   * agents to reason about other agents' mental states.
   */
  export function modelPerspective(
    observer: BeliefState,
    target: BeliefState,
    commonGround: CommonGround,
  ): PerspectiveModel {
    const modeledBeliefs: KnowledgeEntry[] = []
    const knowledgeGaps: string[] = []
    const potentialMisalignments: PerspectiveModel["potentialMisalignments"] = []

    // Start with shared facts - high confidence that target knows these
    for (const fact of commonGround.sharedFacts) {
      if (fact.acknowledgedBy.includes(target.agentID)) {
        modeledBeliefs.push({
          key: fact.key,
          value: fact.value,
          confidence: 0.95, // Very high confidence for acknowledged facts
          source: "shared",
          timestamp: fact.lastConfirmed,
        })
      } else {
        // Fact exists but target hasn't acknowledged - lower confidence
        modeledBeliefs.push({
          key: fact.key,
          value: fact.value,
          confidence: 0.5,
          source: "inferred",
          timestamp: fact.establishedAt,
        })
      }
    }

    // Infer from observer's knowledge what target likely knows
    for (const knowledge of observer.knowledge) {
      // Skip if already in modeled beliefs from shared facts
      if (modeledBeliefs.find((b) => b.key === knowledge.key)) {
        // Check for misalignment
        const targetKnowledge = target.knowledge.find((k) => k.key === knowledge.key)
        if (targetKnowledge && JSON.stringify(targetKnowledge.value) !== JSON.stringify(knowledge.value)) {
          potentialMisalignments.push({
            key: knowledge.key,
            observerValue: knowledge.value,
            modeledTargetValue: targetKnowledge.value,
            severity: targetKnowledge.confidence > 0.7 ? "high" : "medium",
          })
        }
        continue
      }

      if (knowledge.source === "shared") {
        // Shared knowledge - target probably knows
        modeledBeliefs.push({
          ...knowledge,
          confidence: knowledge.confidence * 0.8,
          source: "inferred",
        })
      } else if (knowledge.source === "direct") {
        // Direct knowledge - target may not know (knowledge gap)
        knowledgeGaps.push(knowledge.key)

        // Model that target might have partial knowledge
        modeledBeliefs.push({
          ...knowledge,
          confidence: knowledge.confidence * 0.3, // Low confidence
          source: "inferred",
        })
      }
    }

    // Check target's actual knowledge for divergences
    for (const targetKnowledge of target.knowledge) {
      if (!modeledBeliefs.find((b) => b.key === targetKnowledge.key)) {
        // Target knows something observer didn't model
        // This represents observer's incomplete model of target
        modeledBeliefs.push({
          ...targetKnowledge,
          confidence: 0.4, // Medium-low - observer is guessing
          source: "inferred",
        })
      }
    }

    // Calculate overall confidence in perspective model
    const syncConfidence = commonGround.syncStatus === "synchronized" ? 0.9 : 0.6
    const divergenceImpact = commonGround.divergences.length * 0.1
    const overallConfidence = Math.max(0.3, syncConfidence - divergenceImpact)

    return {
      observerID: observer.agentID,
      targetID: target.agentID,
      modeledBeliefs,
      confidence: overallConfidence,
      lastUpdated: Date.now(),
      knowledgeGaps,
      potentialMisalignments,
    }
  }

  /**
   * Check if observer should communicate knowledge to target
   *
   * Based on perspective model, determine what knowledge gaps exist
   * that warrant explicit communication.
   */
  export function identifyCommunicationNeeds(
    perspective: PerspectiveModel,
    observer: BeliefState,
  ): Array<{
    key: string
    value: unknown
    priority: "high" | "medium" | "low"
    reason: string
  }> {
    const needs: ReturnType<typeof identifyCommunicationNeeds> = []

    // High priority: misalignments
    for (const misalignment of perspective.potentialMisalignments) {
      needs.push({
        key: misalignment.key,
        value: observer.knowledge.find((k) => k.key === misalignment.key)?.value,
        priority: misalignment.severity === "high" ? "high" : "medium",
        reason: `Potential belief misalignment detected for "${misalignment.key}"`,
      })
    }

    // Medium priority: knowledge gaps for active goals
    const activeGoals = observer.goals.filter((g) => g.status === "active")
    for (const gap of perspective.knowledgeGaps) {
      const knowledge = observer.knowledge.find((k) => k.key === gap)
      if (!knowledge || knowledge.confidence < Thresholds.shareConfidenceThreshold) continue

      // Check if this knowledge is relevant to any active goal
      const isGoalRelevant = activeGoals.some(
        (g) => g.description.toLowerCase().includes(gap.toLowerCase()),
      )

      needs.push({
        key: gap,
        value: knowledge.value,
        priority: isGoalRelevant ? "high" : "low",
        reason: `Knowledge gap: observer has "${gap}" but target may not`,
      })
    }

    // Sort by priority
    needs.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    return needs
  }

  // Experimental ToM fluctuation tracking. The synergy paper suggests within-user
  // ToM variation matters; these signals are heuristic text markers today.

  /**
   * ToM measurement at a specific turn
   */
  export const ToMMeasurement = z.object({
    turnNumber: z.number(),
    perspectiveTakingScore: z.number().min(0).max(1),
    beliefTrackingAccuracy: z.number().min(0).max(1),
    communicationQuality: z.number().min(0).max(1),
    timestamp: z.number(),
  })
  export type ToMMeasurement = z.infer<typeof ToMMeasurement>

  /**
   * Track ToM fluctuations over a session
   */
  export const ToMFluctuation = z.object({
    sessionID: z.string(),
    measurements: z.array(ToMMeasurement),
    trend: z.enum(["improving", "declining", "stable", "volatile"]),
    averageScore: z.number(),
  })
  export type ToMFluctuation = z.infer<typeof ToMFluctuation>

  /**
   * Measure ToM quality at a specific conversation turn.
   *
   * Uses heuristic text markers inspired by the Synergy paper's qualitative
   * discussion of perspective-taking. These markers are experimental and not
   * validated features.
   */
  export function measureToMAtTurn(
    userPrompt: string,
    agentResponse: string,
    turn: number,
  ): ToMMeasurement {
    let perspectiveTakingScore = 0.5 // Base score
    let beliefTrackingScore = 0.5
    let communicationQuality = 0.5

    // === Perspective-taking markers in user prompt ===

    // Positive markers (user engaging with agent's perspective)
    if (/\b(you|your|you're|you've|you'll)\b/i.test(userPrompt)) {
      perspectiveTakingScore += 0.1
    }
    if (/\b(please|could you|would you|can you)\b/i.test(userPrompt)) {
      perspectiveTakingScore += 0.05
      communicationQuality += 0.05
    }
    if (/\b(I think you|you might|you probably|you seem)\b/i.test(userPrompt)) {
      perspectiveTakingScore += 0.15 // Strong ToM indicator
    }
    if (/\b(understand|understood|see what you mean|makes sense)\b/i.test(userPrompt)) {
      perspectiveTakingScore += 0.1
      beliefTrackingScore += 0.1
    }

    // Confirmation/clarification seeking (shows user tracking agent's beliefs)
    if (/\b(is that right|correct\?|right\?|does that make sense|am I understanding)\b/i.test(userPrompt)) {
      beliefTrackingScore += 0.15
      perspectiveTakingScore += 0.1
    }

    // Challenge/disagree markers (healthy ToM - recognizing different views)
    if (/\b(I disagree|that's not|actually|however|but I think|not quite)\b/i.test(userPrompt)) {
      perspectiveTakingScore += 0.1 // Disagreement shows engagement with agent's view
    }

    // === Communication quality in user prompt ===

    // Question asking (after first turn)
    if (/\?/.test(userPrompt)) {
      communicationQuality += 0.1
    } else if (turn > 1) {
      communicationQuality -= 0.05 // No questions after first turn may indicate disengagement
    }

    // Message length (very short = low engagement)
    if (userPrompt.length < 20) {
      communicationQuality -= 0.1
      perspectiveTakingScore -= 0.05
    } else if (userPrompt.length > 200) {
      communicationQuality += 0.05 // Detailed prompts show engagement
    }

    // === Belief tracking in agent response ===

    // Agent acknowledging user's perspective
    if (/\b(you mentioned|as you said|you're right|good point|I understand)\b/i.test(agentResponse)) {
      beliefTrackingScore += 0.1
    }

    // Agent expressing uncertainty appropriately
    if (/\b(I think|I believe|it seems|might be|could be|likely)\b/i.test(agentResponse)) {
      beliefTrackingScore += 0.05 // Appropriate epistemic humility
    }

    // Agent asking clarifying questions
    if (/\b(could you clarify|what do you mean|can you elaborate|do you want)\b/i.test(agentResponse)) {
      perspectiveTakingScore += 0.1
      communicationQuality += 0.1
    }

    // === Negative markers ===

    // Signs of miscommunication
    if (/\b(confused|unclear|don't understand|what\?|huh\?)\b/i.test(userPrompt)) {
      communicationQuality -= 0.15
      beliefTrackingScore -= 0.1
    }

    // Repetition (may indicate communication breakdown)
    if (/\b(again|already told you|I said|repeat)\b/i.test(userPrompt)) {
      communicationQuality -= 0.1
    }

    // Clamp all scores to [0, 1]
    perspectiveTakingScore = Math.max(0, Math.min(1, perspectiveTakingScore))
    beliefTrackingScore = Math.max(0, Math.min(1, beliefTrackingScore))
    communicationQuality = Math.max(0, Math.min(1, communicationQuality))

    return {
      turnNumber: turn,
      perspectiveTakingScore,
      beliefTrackingAccuracy: beliefTrackingScore,
      communicationQuality,
      timestamp: Date.now(),
    }
  }

  /**
   * Analyze ToM fluctuations over a session
   */
  export function analyzeFluctuations(measurements: ToMMeasurement[]): ToMFluctuation["trend"] {
    if (measurements.length < 3) {
      return "stable"
    }

    // Calculate trend using linear regression slope
    const n = measurements.length
    const avgScores = measurements.map(
      (m) => (m.perspectiveTakingScore + m.beliefTrackingAccuracy + m.communicationQuality) / 3,
    )

    const xMean = (n - 1) / 2
    const yMean = avgScores.reduce((a, b) => a + b, 0) / n

    let numerator = 0
    let denominator = 0
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (avgScores[i] - yMean)
      denominator += (i - xMean) ** 2
    }

    const slope = denominator !== 0 ? numerator / denominator : 0

    // Calculate variance for volatility detection
    const variance = avgScores.reduce((sum, s) => sum + (s - yMean) ** 2, 0) / n
    const isVolatile = variance > 0.04 // High variance threshold

    if (isVolatile && Math.abs(slope) < 0.02) {
      return "volatile"
    } else if (slope > 0.02) {
      return "improving"
    } else if (slope < -0.02) {
      return "declining"
    }
    return "stable"
  }

  /**
   * Create a ToM fluctuation tracker
   */
  export function createFluctuationTracker(sessionID: string): ToMFluctuation {
    return {
      sessionID,
      measurements: [],
      trend: "stable",
      averageScore: 0.5,
    }
  }

  /**
   * Add a measurement to the fluctuation tracker
   */
  export function addMeasurement(
    tracker: ToMFluctuation,
    measurement: ToMMeasurement,
  ): ToMFluctuation {
    const measurements = [...tracker.measurements, measurement]
    const trend = analyzeFluctuations(measurements)

    const avgScore = measurements.reduce(
      (sum, m) => sum + (m.perspectiveTakingScore + m.beliefTrackingAccuracy + m.communicationQuality) / 3,
      0,
    ) / measurements.length

    return {
      ...tracker,
      measurements,
      trend,
      averageScore: avgScore,
    }
  }

  /**
   * Get ToM quality assessment
   */
  export function assessToMQuality(tracker: ToMFluctuation): {
    quality: "excellent" | "good" | "fair" | "poor"
    description: string
    recommendations: string[]
  } {
    const { averageScore, trend, measurements } = tracker

    let quality: "excellent" | "good" | "fair" | "poor"
    if (averageScore >= 0.75) {
      quality = "excellent"
    } else if (averageScore >= 0.6) {
      quality = "good"
    } else if (averageScore >= 0.4) {
      quality = "fair"
    } else {
      quality = "poor"
    }

    const recommendations: string[] = []

    if (trend === "declining") {
      recommendations.push("ToM quality is declining - consider re-establishing shared understanding")
    }
    if (trend === "volatile") {
      recommendations.push("ToM quality is unstable - focus on consistent communication patterns")
    }

    // Check specific deficits
    if (measurements.length > 0) {
      const lastMeasurement = measurements[measurements.length - 1]
      if (lastMeasurement.perspectiveTakingScore < 0.4) {
        recommendations.push("Improve perspective-taking by explicitly referencing user's viewpoint")
      }
      if (lastMeasurement.beliefTrackingAccuracy < 0.4) {
        recommendations.push("Improve belief tracking by acknowledging and building on prior statements")
      }
      if (lastMeasurement.communicationQuality < 0.4) {
        recommendations.push("Improve communication quality by asking clarifying questions")
      }
    }

    const description = `ToM quality is ${quality} with ${trend} trend (avg: ${(averageScore * 100).toFixed(0)}%)`

    return { quality, description, recommendations }
  }
}
