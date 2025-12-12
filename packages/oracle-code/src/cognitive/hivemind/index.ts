/**
 * Hivemind Module
 *
 * Cross-session and cross-project shared learning system with decay,
 * and golden entry promotion.
 *
 * Key components:
 * - HivemindStore: Core storage and CRUD operations
 * - HivemindDecay: Entry decay management and golden promotion
 * - Types: All Zod schemas and TypeScript types
 *
 * Usage:
 *   import { Hivemind } from '@/cognitive/hivemind'
 *
 *   // Get current state
 *   const state = await Hivemind.getState()
 *
 *   // Add an entry
 *   const entry = await Hivemind.addEntry({
 *     category: "fear",
 *     scope: "project",
 *     key: "test_flakiness",
 *     value: "Tests sometimes fail due to timing issues",
 *     confidence: 0.8,
 *     status: "active",
 *     source: { sessionId: "...", agentRole: "primary", timestamp: "...", promotionReason: "..." },
 *     decay: { lastAccessed: "...", accessCount: 0, decayRate: 0.1 },
 *   })
 *
 *   // Search entries
 *   const results = await Hivemind.search("test")
 *
 *   // Check decay status
 *   const decayResults = await Hivemind.Decay.getAllDecayResults()
 */

// Re-export all types
export * from "./types"

// Re-export store operations
export { HivemindStore } from "./store"

// Re-export decay operations
export { HivemindDecay } from "./decay"

// Re-export council/debate/audit operations
export { HivemindCouncil } from "./council"
export { HivemindDebate } from "./debate"
export { HivemindAudit } from "./audit"

// =============
// Convenience namespace that combines all modules
// =============

import { HivemindStore } from "./store"
import { HivemindDecay } from "./decay"
import { HivemindCouncil } from "./council"
import { HivemindDebate } from "./debate"
import { HivemindAudit } from "./audit"
import type {
  HivemindState,
  HivemindEntry,
  HivemindManifest,
  HivemindCategory,
  HivemindScope,
  EntryStatus,
  PromotionRequest,
  CouncilSession,
  DecayResult,
  CouncilConfig,
  DecayConfig,
} from "./types"

export namespace Hivemind {
  // =============
  // Store delegates
  // =============

  export const getState = HivemindStore.getState
  export const getCombinedState = HivemindStore.getCombinedState
  export const getEntry = HivemindStore.getEntry
  export const getEntriesByCategory = HivemindStore.getEntriesByCategory
  export const getEntriesByStatus = HivemindStore.getEntriesByStatus
  export const search = HivemindStore.search
  export const getManifest = HivemindStore.getManifest

  export const addEntry = HivemindStore.addEntry
  export const updateEntry = HivemindStore.updateEntry
  export const removeEntry = HivemindStore.removeEntry
  export const accessEntry = HivemindStore.accessEntry
  export const promoteToGolden = HivemindStore.promoteToGolden

  export const isGlobalEnabled = HivemindStore.isGlobalEnabled
  export const enableGlobal = HivemindStore.enableGlobal
  export const disableGlobal = HivemindStore.disableGlobal

  export const requestPromotion = HivemindStore.requestPromotion
  export const approvePromotion = HivemindStore.approvePromotion
  export const rejectPromotion = HivemindStore.rejectPromotion
  export const getPendingPromotions = HivemindStore.getPendingPromotions

  export const saveCouncilSession = HivemindStore.saveCouncilSession
  export const getActiveCouncils = HivemindStore.getActiveCouncils

  export const sync = HivemindStore.sync
  export const updateManifestConfig = HivemindStore.updateManifestConfig
  export const getProjectRoot = HivemindStore.getProjectRoot
  export const getGlobalRoot = HivemindStore.getGlobalRoot

  // =============
  // Decay delegates
  // =============

  export const Decay = {
    checkDecay: HivemindDecay.checkDecay,
    processDecay: HivemindDecay.processDecay,
    getDecayWarnings: HivemindDecay.getDecayWarnings,
    getAllDecayResults: HivemindDecay.getAllDecayResults,
    nominateForCouncil: HivemindDecay.nominateForCouncil,
    updateDecayRate: HivemindDecay.updateDecayRate,
    updateWarningThreshold: HivemindDecay.updateWarningThreshold,
    refreshEntry: HivemindDecay.refreshEntry,
    scheduleDecayCheck: HivemindDecay.scheduleDecayCheck,
    stopDecayCheck: HivemindDecay.stopDecayCheck,
    Event: HivemindDecay.Event,
  }

  // =============
  // Event exports
  // =============

  export const Event = {
    ...HivemindStore.Event,
    ...HivemindDecay.Event,
    ...HivemindCouncil.Event,
    ...HivemindDebate.Event,
    ...HivemindAudit.Event,
  }

  // =============
  // Council delegates
  // =============

  export const Council = HivemindCouncil

  // =============
  // Debate delegates
  // =============

  export const Debate = HivemindDebate

  // =============
  // Audit delegates
  // =============

  export const Audit = HivemindAudit

  // =============
  // Convenience methods
  // =============

  /**
   * Initialize the hivemind system
   * - Ensures directories exist
   * - Starts decay timer
   */
  export async function init(contextRoot?: string): Promise<void> {
    // Ensure project hivemind directory exists
    await getState(contextRoot, "project")

    // Start decay timer
    Decay.scheduleDecayCheck()
  }

  /**
   * Shutdown the hivemind system
   */
  export function shutdown(): void {
    Decay.stopDecayCheck()
  }

  /**
   * Get summary for display
   */
  export async function getSummary(contextRoot?: string): Promise<{
    project: {
      total: number
      golden: number
      decaying: number
      contested: number
      pending: number
      councils: number
    }
    global: {
      enabled: boolean
      total: number
    } | null
  }> {
    const projectState = await getState(contextRoot, "project")
    const projectManifest = projectState.manifest

    const projectSummary = {
      total: projectManifest.stats.totalEntries,
      golden: projectManifest.stats.goldenCount,
      decaying: projectManifest.stats.decayingCount,
      contested: projectManifest.stats.contestedCount,
      pending: projectState.pending.filter((p) => p.status === "pending").length,
      councils: projectState.councils.filter(
        (c) => c.status === "voting" || c.status === "debating"
      ).length,
    }

    let globalSummary: { enabled: boolean; total: number } | null = null

    if (projectManifest.globalEnabled) {
      try {
        const globalState = await getState(undefined, "global")
        globalSummary = {
          enabled: true,
          total: globalState.manifest.stats.totalEntries,
        }
      } catch {
        globalSummary = { enabled: true, total: 0 }
      }
    }

    return { project: projectSummary, global: globalSummary }
  }

  /**
   * Get entries relevant for system prompt injection
   */
  export async function getPromptEntries(
    contextRoot?: string,
    options?: {
      maxFears?: number
      maxSatisfactions?: number
      maxKnowledge?: number
      maxDecisions?: number
      includeGlobal?: boolean
    }
  ): Promise<{
    fears: HivemindEntry[]
    satisfactions: HivemindEntry[]
    knowledge: HivemindEntry[]
    decisions: HivemindEntry[]
    preferences: HivemindEntry[]
  }> {
    const {
      maxFears = 5,
      maxSatisfactions = 5,
      maxKnowledge = 10,
      maxDecisions = 10,
      includeGlobal = true,
    } = options || {}

    const scope = includeGlobal ? undefined : "project"

    // Get entries sorted by confidence (golden first, then by confidence)
    const sortByRelevance = (entries: HivemindEntry[]): HivemindEntry[] => {
      return entries.sort((a, b) => {
        // Golden entries first
        if (a.status === "golden" && b.status !== "golden") return -1
        if (b.status === "golden" && a.status !== "golden") return 1
        // Then by confidence
        return b.confidence - a.confidence
      })
    }

    const [fears, satisfactions, knowledge, decisions, preferences] = await Promise.all([
      getEntriesByCategory("fear", contextRoot, scope).then((e) =>
        sortByRelevance(e).slice(0, maxFears)
      ),
      getEntriesByCategory("satisfaction", contextRoot, scope).then((e) =>
        sortByRelevance(e).slice(0, maxSatisfactions)
      ),
      getEntriesByCategory("knowledge", contextRoot, scope).then((e) =>
        sortByRelevance(e).slice(0, maxKnowledge)
      ),
      getEntriesByCategory("decision", contextRoot, scope).then((e) =>
        sortByRelevance(e).slice(0, maxDecisions)
      ),
      getEntriesByCategory("preference", contextRoot, scope),
    ])

    // Mark entries as accessed
    const allEntries = [...fears, ...satisfactions, ...knowledge, ...decisions, ...preferences]
    await Promise.all(allEntries.map((e) => accessEntry(e.id, contextRoot)))

    return { fears, satisfactions, knowledge, decisions, preferences }
  }
}
