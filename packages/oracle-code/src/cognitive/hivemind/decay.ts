/**
 * Hivemind Decay System
 *
 * Manages the decay of hivemind entries over time. Entries lose strength
 * based on configurable decay rates, and can be nominated for council
 * promotion to golden (permanent) status before expiring.
 *
 * Decay formula:
 *   effectiveStrength = confidence * (1 - decayRate)^daysSinceAccess
 *   expires when effectiveStrength < 0.1
 */

import z from "zod"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { HivemindStore } from "./store"
import {
  HivemindEntry,
  HivemindScope,
  DecayResult,
  DecayConfig,
  HivemindCategory,
  categoryToArrayKey,
} from "./types"

export namespace HivemindDecay {
  // =============
  // Constants
  // =============

  const DECAY_CHECK_INTERVAL = 3600000 // 1 hour
  const MIN_EFFECTIVE_STRENGTH = 0.1 // Below this, entry expires
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  // =============
  // Bus Events
  // =============

  export const Event = {
    DecayChecked: BusEvent.define(
      "hivemind.decay.checked",
      z.object({
        expired: z.number(),
        warned: z.number(),
      })
    ),
    EntryExpired: BusEvent.define(
      "hivemind.decay.entry_expired",
      z.object({
        entryId: z.string(),
        category: HivemindCategory,
      })
    ),
    EntryDecaying: BusEvent.define(
      "hivemind.decay.entry_decaying",
      z.object({
        entryId: z.string(),
        daysUntilExpiry: z.number(),
      })
    ),
    CouncilNominated: BusEvent.define(
      "hivemind.decay.council_nominated",
      z.object({
        entryId: z.string(),
        reason: z.string(),
      })
    ),
  } as const

  // =============
  // Timer
  // =============

  let decayTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Start the decay check timer
   */
  export function scheduleDecayCheck(intervalMs?: number): void {
    if (decayTimer) {
      clearInterval(decayTimer)
    }

    const interval = intervalMs || DECAY_CHECK_INTERVAL
    decayTimer = setInterval(async () => {
      try {
        await processDecay()
      } catch (error) {
        console.error("Decay check failed:", error)
      }
    }, interval)
  }

  /**
   * Stop the decay check timer
   */
  export function stopDecayCheck(): void {
    if (decayTimer) {
      clearInterval(decayTimer)
      decayTimer = null
    }
  }

  // =============
  // Decay Calculation
  // =============

  /**
   * Calculate the decay result for a single entry
   */
  export function checkDecay(entry: HivemindEntry, config: DecayConfig): DecayResult {
    // Golden and preference entries don't decay
    if (entry.status === "golden" && config.goldenExempt) {
      return {
        entry,
        daysUntilExpiry: Infinity,
        effectiveStrength: entry.confidence,
        shouldWarn: false,
        shouldExpire: false,
        eligibleForCouncil: false,
      }
    }

    if (entry.category === "preference" && config.preferencesExempt) {
      return {
        entry,
        daysUntilExpiry: Infinity,
        effectiveStrength: entry.confidence,
        shouldWarn: false,
        shouldExpire: false,
        eligibleForCouncil: false,
      }
    }

    // Knowledge entries don't decay by default
    if (entry.category === "knowledge" && config.defaultRates.knowledge === 0) {
      return {
        entry,
        daysUntilExpiry: Infinity,
        effectiveStrength: entry.confidence,
        shouldWarn: false,
        shouldExpire: false,
        eligibleForCouncil: false,
      }
    }

    const now = Date.now()
    const lastAccessed = new Date(entry.decay.lastAccessed).getTime()
    const daysSinceAccess = (now - lastAccessed) / MS_PER_DAY

    // Get decay rate from entry or config
    const decayRate = entry.decay.decayRate || config.defaultRates[entry.category] || 0.1

    // Calculate effective strength
    const effectiveStrength = entry.confidence * Math.pow(1 - decayRate, daysSinceAccess)

    // Calculate days until expiry
    // Solve: confidence * (1 - decayRate)^days = MIN_EFFECTIVE_STRENGTH
    // days = log(MIN_EFFECTIVE_STRENGTH / confidence) / log(1 - decayRate)
    let daysUntilExpiry = Infinity
    if (decayRate > 0 && decayRate < 1 && entry.confidence > MIN_EFFECTIVE_STRENGTH) {
      daysUntilExpiry = Math.max(
        0,
        Math.log(MIN_EFFECTIVE_STRENGTH / entry.confidence) / Math.log(1 - decayRate) - daysSinceAccess
      )
    }

    const shouldExpire = effectiveStrength < MIN_EFFECTIVE_STRENGTH
    const shouldWarn = daysUntilExpiry <= config.warningThresholdDays && daysUntilExpiry > 0

    return {
      entry,
      daysUntilExpiry: Math.round(daysUntilExpiry * 10) / 10, // Round to 1 decimal
      effectiveStrength: Math.round(effectiveStrength * 100) / 100,
      shouldWarn,
      shouldExpire,
      eligibleForCouncil: shouldWarn && entry.status !== "golden" && entry.status !== "contested",
    }
  }

  /**
   * Process decay for all entries in a scope
   */
  export async function processDecay(
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<{ expired: HivemindEntry[]; warned: HivemindEntry[] }> {
    const expired: HivemindEntry[] = []
    const warned: HivemindEntry[] = []

    const scopes: HivemindScope[] = scope ? [scope] : ["project", "global"]

    for (const s of scopes) {
      try {
        const state = await HivemindStore.getState(contextRoot, s)
        const config = DecayConfig.parse(state.manifest.decay)

        for (const arrayKey of Object.values(categoryToArrayKey)) {
          for (const entry of state[arrayKey]) {
            const result = checkDecay(entry, config)

            if (result.shouldExpire) {
              // Remove expired entry
              await HivemindStore.removeEntry(entry.id, contextRoot)
              expired.push(entry)
              Bus.publish(Event.EntryExpired, {
                entryId: entry.id,
                category: entry.category,
              })
            } else if (result.shouldWarn && entry.status !== "decaying") {
              // Mark as decaying
              await HivemindStore.updateEntry(
                entry.id,
                { status: "decaying" },
                contextRoot
              )
              warned.push(entry)
              Bus.publish(Event.EntryDecaying, {
                entryId: entry.id,
                daysUntilExpiry: result.daysUntilExpiry,
              })
            }
          }
        }

        // Update manifest with last check time
        await HivemindStore.updateManifestConfig(
          {
            decay: {
              ...config,
              // lastCheck is not in the schema, we'll track it via lastSync
            },
          },
          contextRoot,
          s
        )
      } catch {
        // Scope not available
      }
    }

    Bus.publish(Event.DecayChecked, {
      expired: expired.length,
      warned: warned.length,
    })

    return { expired, warned }
  }

  /**
   * Get all entries that are currently decaying (warning state)
   */
  export async function getDecayWarnings(
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry[]> {
    return HivemindStore.getEntriesByStatus("decaying", contextRoot, scope)
  }

  /**
   * Get decay results for all entries
   */
  export async function getAllDecayResults(
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<DecayResult[]> {
    const results: DecayResult[] = []
    const scopes: HivemindScope[] = scope ? [scope] : ["project", "global"]

    for (const s of scopes) {
      try {
        const state = await HivemindStore.getState(contextRoot, s)
        const config = DecayConfig.parse(state.manifest.decay)

        for (const arrayKey of Object.values(categoryToArrayKey)) {
          for (const entry of state[arrayKey]) {
            results.push(checkDecay(entry, config))
          }
        }
      } catch {
        // Scope not available
      }
    }

    // Sort by days until expiry (most urgent first)
    return results.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }

  /**
   * Nominate a decaying entry for council promotion to golden
   */
  export async function nominateForCouncil(
    entryId: string,
    reason: string,
    contextRoot?: string
  ): Promise<string | null> {
    const entry = await HivemindStore.getEntry(entryId, contextRoot)
    if (!entry) return null

    // Check if eligible
    const state = await HivemindStore.getState(contextRoot, entry.scope)
    const config = DecayConfig.parse(state.manifest.decay)
    const result = checkDecay(entry, config)

    if (!result.eligibleForCouncil) {
      return null
    }

    // Mark as contested
    await HivemindStore.updateEntry(
      entryId,
      {
        status: "contested",
        contested: {
          reason,
          councilSessionId: undefined, // Will be filled when council starts
        },
      },
      contextRoot
    )

    Bus.publish(Event.CouncilNominated, { entryId, reason })

    // Return the entry ID - caller should create council session
    return entryId
  }

  /**
   * Update decay rate for a specific category
   */
  export async function updateDecayRate(
    category: HivemindCategory,
    rate: number,
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<void> {
    const state = await HivemindStore.getState(contextRoot, scope)
    const config = { ...state.manifest.decay }

    config.defaultRates = {
      ...config.defaultRates,
      [category]: rate,
    }

    await HivemindStore.updateManifestConfig({ decay: config }, contextRoot, scope)
  }

  /**
   * Update warning threshold (days before expiry to start warning)
   */
  export async function updateWarningThreshold(
    days: number,
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<void> {
    const state = await HivemindStore.getState(contextRoot, scope)
    const config = { ...state.manifest.decay }

    config.warningThresholdDays = days

    await HivemindStore.updateManifestConfig({ decay: config }, contextRoot, scope)
  }

  /**
   * Refresh an entry's decay timer (extends life by resetting lastAccessed)
   */
  export async function refreshEntry(entryId: string, contextRoot?: string): Promise<boolean> {
    const entry = await HivemindStore.getEntry(entryId, contextRoot)
    if (!entry) return false

    await HivemindStore.accessEntry(entryId, contextRoot)

    // If it was decaying, reset to active
    if (entry.status === "decaying") {
      await HivemindStore.updateEntry(entryId, { status: "active" }, contextRoot)
    }

    return true
  }
}

// DecayConfig is already exported from ./types
