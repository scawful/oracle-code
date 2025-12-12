/**
 * Hivemind Promotion System
 *
 * Handles the promotion of session-local entries (fears, satisfactions,
 * golden facts, decisions) to the shared hivemind. Implements configurable
 * promotion rules and automatic promotion detection.
 */

import z from "zod"
import { ulid } from "ulid"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { HivemindStore } from "./store"
import {
  HivemindCategory,
  HivemindScope,
  HivemindEntry,
  PromotionRequest,
  PromotionRule,
} from "./types"

export namespace HivemindPromotion {
  // =============
  // Bus Events
  // =============

  export const Event = {
    AutoPromoted: BusEvent.define(
      "hivemind.promotion.auto_promoted",
      z.object({
        entryId: z.string(),
        category: HivemindCategory,
        reason: z.string(),
      })
    ),
    EligibilityChecked: BusEvent.define(
      "hivemind.promotion.eligibility_checked",
      z.object({
        category: HivemindCategory,
        eligible: z.boolean(),
        reason: z.string(),
      })
    ),
  } as const

  // =============
  // Default Promotion Rules
  // =============

  const DEFAULT_PROMOTION_RULES: Record<HivemindCategory, PromotionRule> = {
    fear: {
      autoPromote: false,
      minIntensity: 7,
      requiresResolution: true, // Only promote resolved fears
      decayRate: 0.1, // 10% per day
      goldenEligible: true,
    },
    satisfaction: {
      autoPromote: false,
      minIntensity: 7,
      requiresRepeat: 2, // Must occur 2+ times
      decayRate: 0.1,
      goldenEligible: true,
    },
    knowledge: {
      autoPromote: true, // Golden facts auto-promote
      requiresGolden: true,
      decayRate: 0, // Knowledge doesn't decay
      goldenEligible: false, // Already "golden" by nature
    },
    decision: {
      autoPromote: false,
      minSessionAge: 3, // Must persist 3+ sessions
      requiresUserConfirm: true,
      decayRate: 0.05, // 5% per day
      goldenEligible: true,
    },
    preference: {
      autoPromote: true, // User preferences auto-promote
      requiresExplicit: true, // Must be explicit user statement
      decayRate: 0, // Preferences don't decay
      goldenEligible: false, // Already permanent
    },
  }

  // =============
  // Eligibility Types
  // =============

  export interface PromotionEligibility {
    eligible: boolean
    reason: string
    autoApprove: boolean
    suggestedPriority: "high" | "medium" | "low"
  }

  // =============
  // Rule Management
  // =============

  /**
   * Get the promotion rule for a category
   */
  export function getRule(category: HivemindCategory): PromotionRule {
    return DEFAULT_PROMOTION_RULES[category]
  }

  /**
   * Get all promotion rules
   */
  export function getAllRules(): Record<HivemindCategory, PromotionRule> {
    return { ...DEFAULT_PROMOTION_RULES }
  }

  // =============
  // Eligibility Checking
  // =============

  /**
   * Check if an entry is eligible for promotion
   */
  export function checkEligibility(
    entry: {
      id?: string
      category?: string
      intensity?: number
      resolved?: boolean
      outcome?: string
      occurrenceCount?: number
      sessionCount?: number
      isUserExplicit?: boolean
      isGoldenFact?: boolean
      trigger?: string
      context?: string
      value?: any
      confidence?: number
    },
    category: HivemindCategory
  ): PromotionEligibility {
    const rule = getRule(category)

    // Check intensity requirement
    if (rule.minIntensity !== undefined) {
      const intensity = entry.intensity ?? 5
      if (intensity < rule.minIntensity) {
        return {
          eligible: false,
          reason: `Intensity ${intensity} is below threshold ${rule.minIntensity}`,
          autoApprove: false,
          suggestedPriority: "low",
        }
      }
    }

    // Check resolution requirement for fears
    if (rule.requiresResolution) {
      if (!entry.resolved && !entry.outcome) {
        return {
          eligible: false,
          reason: "Fear must be resolved before promotion",
          autoApprove: false,
          suggestedPriority: "low",
        }
      }
    }

    // Check repeat requirement for satisfactions
    if (rule.requiresRepeat !== undefined) {
      const count = entry.occurrenceCount ?? 1
      if (count < rule.requiresRepeat) {
        return {
          eligible: false,
          reason: `Pattern must occur ${rule.requiresRepeat}+ times (currently ${count})`,
          autoApprove: false,
          suggestedPriority: "medium",
        }
      }
    }

    // Check session age requirement for decisions
    if (rule.minSessionAge !== undefined) {
      const sessionCount = entry.sessionCount ?? 1
      if (sessionCount < rule.minSessionAge) {
        return {
          eligible: false,
          reason: `Decision must persist for ${rule.minSessionAge}+ sessions (currently ${sessionCount})`,
          autoApprove: false,
          suggestedPriority: "medium",
        }
      }
    }

    // Check golden fact requirement for knowledge
    if (rule.requiresGolden) {
      if (!entry.isGoldenFact) {
        return {
          eligible: false,
          reason: "Only golden facts can be promoted to hivemind knowledge",
          autoApprove: false,
          suggestedPriority: "low",
        }
      }
    }

    // Check explicit user statement requirement for preferences
    if (rule.requiresExplicit) {
      if (!entry.isUserExplicit) {
        return {
          eligible: false,
          reason: "Preferences must be explicitly stated by user",
          autoApprove: false,
          suggestedPriority: "low",
        }
      }
    }

    // All checks passed
    const eligible = true
    const autoApprove = rule.autoPromote
    const intensity = entry.intensity ?? entry.confidence ?? 0.5
    const suggestedPriority =
      intensity >= 9 || entry.isGoldenFact
        ? "high"
        : intensity >= 7
          ? "medium"
          : "low"

    Bus.publish(Event.EligibilityChecked, {
      category,
      eligible,
      reason: "All promotion criteria met",
    })

    return {
      eligible,
      reason: autoApprove
        ? "Eligible for automatic promotion"
        : "Eligible for manual promotion",
      autoApprove,
      suggestedPriority,
    }
  }

  // =============
  // Promotion Actions
  // =============

  /**
   * Request manual promotion of an entry
   */
  export async function requestManualPromotion(
    entry: {
      id?: string
      trigger?: string
      context?: string
      value?: any
      key?: string
      confidence?: number
      intensity?: number
    },
    category: HivemindCategory,
    reason: string,
    targetScope: HivemindScope = "project",
    contextRoot?: string
  ): Promise<PromotionRequest | null> {
    const eligibility = checkEligibility(entry, category)

    if (!eligibility.eligible) {
      console.warn(`Promotion not eligible: ${eligibility.reason}`)
      return null
    }

    const requestId = await HivemindStore.requestPromotion({
      entryType: category,
      entry,
      reason,
      priority: eligibility.suggestedPriority,
      autoApprove: false, // Manual request, always require approval
      requestedBy: entry.id || ulid(),
      targetScope,
    })

    const state = await HivemindStore.getState(contextRoot)
    return state.pending.find((p) => p.id === requestId) || null
  }

  /**
   * Process auto-promotions for all eligible entries
   */
  export async function processAutoPromotions(
    entries: Array<{
      id: string
      category: HivemindCategory
      trigger?: string
      context?: string
      value?: any
      key?: string
      confidence?: number
      intensity?: number
      isGoldenFact?: boolean
      isUserExplicit?: boolean
      resolved?: boolean
      outcome?: string
    }>,
    sessionId: string,
    contextRoot?: string
  ): Promise<HivemindEntry[]> {
    const promoted: HivemindEntry[] = []

    for (const entry of entries) {
      const eligibility = checkEligibility(entry, entry.category)

      if (eligibility.eligible && eligibility.autoApprove) {
        try {
          const hivemindEntry = await autoPromote(entry, sessionId, contextRoot)
          if (hivemindEntry) {
            promoted.push(hivemindEntry)
          }
        } catch (error) {
          console.error(`Auto-promotion failed for ${entry.id}:`, error)
        }
      }
    }

    return promoted
  }

  /**
   * Automatically promote an entry (for entries with autoPromote=true)
   */
  async function autoPromote(
    entry: {
      id?: string
      category: HivemindCategory
      trigger?: string
      context?: string
      value?: any
      key?: string
      confidence?: number
      intensity?: number
    },
    sessionId: string,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    const rule = getRule(entry.category)

    const key = entry.key || entry.trigger || `auto-${ulid().slice(-8)}`
    const value =
      entry.value?.toString() ||
      entry.context ||
      entry.trigger ||
      "Auto-promoted entry"

    const hivemindEntry = await HivemindStore.addEntry(
      {
        category: entry.category,
        scope: "project",
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        confidence: entry.confidence ?? (entry.intensity ? entry.intensity / 10 : 0.8),
        status: rule.decayRate === 0 ? "golden" : "active",
        source: {
          sessionId,
          agentRole: "primary",
          timestamp: new Date().toISOString(),
          promotionReason: "Auto-promoted based on eligibility criteria",
        },
        decay: {
          lastAccessed: new Date().toISOString(),
          accessCount: 0,
          decayRate: rule.decayRate,
        },
        metadata: {
          originalEntryId: entry.id,
        },
        // Mark as golden if it's a non-decaying category
        golden:
          rule.decayRate === 0
            ? {
                promotedAt: new Date().toISOString(),
                promotedBy: "auto",
              }
            : undefined,
      },
      contextRoot
    )

    Bus.publish(Event.AutoPromoted, {
      entryId: hivemindEntry.id,
      category: entry.category,
      reason: "Auto-promoted based on eligibility criteria",
    })

    return hivemindEntry
  }

  // =============
  // Promotion from Emotions Module
  // =============

  /**
   * Promote a fear from the emotions module
   */
  export async function promoteFear(
    fear: {
      id: string
      trigger: string
      context: string
      intensity: number
      outcome?: string
      mitigation?: string
      tags?: string[]
    },
    sessionId: string,
    reason: string,
    contextRoot?: string
  ): Promise<HivemindEntry | PromotionRequest | null> {
    const eligibility = checkEligibility(
      {
        ...fear,
        resolved: !!fear.outcome,
      },
      "fear"
    )

    if (!eligibility.eligible) {
      return null
    }

    if (eligibility.autoApprove) {
      return autoPromote(
        {
          id: fear.id,
          category: "fear",
          trigger: fear.trigger,
          context: fear.context,
          key: fear.trigger,
          value: `${fear.context}${fear.mitigation ? ` (Mitigation: ${fear.mitigation})` : ""}`,
          intensity: fear.intensity,
        },
        sessionId,
        contextRoot
      )
    }

    return requestManualPromotion(
      {
        id: fear.id,
        trigger: fear.trigger,
        context: fear.context,
        key: fear.trigger,
        value: fear.context,
        intensity: fear.intensity,
      },
      "fear",
      reason,
      "project",
      contextRoot
    )
  }

  /**
   * Promote a satisfaction from the emotions module
   */
  export async function promoteSatisfaction(
    satisfaction: {
      id: string
      trigger: string
      context: string
      intensity: number
      tags?: string[]
    },
    sessionId: string,
    reason: string,
    occurrenceCount: number = 1,
    contextRoot?: string
  ): Promise<HivemindEntry | PromotionRequest | null> {
    const eligibility = checkEligibility(
      {
        ...satisfaction,
        occurrenceCount,
      },
      "satisfaction"
    )

    if (!eligibility.eligible) {
      return null
    }

    if (eligibility.autoApprove) {
      return autoPromote(
        {
          id: satisfaction.id,
          category: "satisfaction",
          trigger: satisfaction.trigger,
          context: satisfaction.context,
          key: satisfaction.trigger,
          value: satisfaction.context,
          intensity: satisfaction.intensity,
        },
        sessionId,
        contextRoot
      )
    }

    return requestManualPromotion(
      {
        id: satisfaction.id,
        trigger: satisfaction.trigger,
        context: satisfaction.context,
        key: satisfaction.trigger,
        value: satisfaction.context,
        intensity: satisfaction.intensity,
      },
      "satisfaction",
      reason,
      "project",
      contextRoot
    )
  }

  // =============
  // Promotion from Epistemic Module
  // =============

  /**
   * Promote a golden fact from the epistemic module
   */
  export async function promoteGoldenFact(
    fact: {
      key: string
      value: any
      confidence: number
      source: string
      category?: string
    },
    sessionId: string,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    const eligibility = checkEligibility(
      {
        ...fact,
        isGoldenFact: true,
      },
      "knowledge"
    )

    if (!eligibility.eligible) {
      return null
    }

    // Golden facts always auto-promote
    return autoPromote(
      {
        category: "knowledge",
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence,
      },
      sessionId,
      contextRoot
    )
  }

  /**
   * Promote a decision
   */
  export async function promoteDecision(
    decision: {
      key: string
      value: string
      confidence?: number
    },
    sessionId: string,
    reason: string,
    sessionCount: number = 1,
    contextRoot?: string
  ): Promise<HivemindEntry | PromotionRequest | null> {
    const eligibility = checkEligibility(
      {
        ...decision,
        sessionCount,
      },
      "decision"
    )

    if (!eligibility.eligible) {
      return null
    }

    return requestManualPromotion(
      {
        key: decision.key,
        value: decision.value,
        confidence: decision.confidence ?? 0.8,
      },
      "decision",
      reason,
      "project",
      contextRoot
    )
  }

  /**
   * Promote a user preference
   */
  export async function promotePreference(
    preference: {
      key: string
      value: string
    },
    sessionId: string,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    const eligibility = checkEligibility(
      {
        ...preference,
        isUserExplicit: true,
      },
      "preference"
    )

    if (!eligibility.eligible) {
      return null
    }

    // Preferences always auto-promote
    return autoPromote(
      {
        category: "preference",
        key: preference.key,
        value: preference.value,
        confidence: 1.0, // User preferences have full confidence
      },
      sessionId,
      contextRoot
    )
  }

  // =============
  // Queue Processing
  // =============

  /**
   * Process pending promotion queue
   */
  export async function processQueue(
    contextRoot?: string
  ): Promise<{ approved: string[]; rejected: string[] }> {
    const pending = await HivemindStore.getPendingPromotions(contextRoot)
    const approved: string[] = []
    const rejected: string[] = []

    for (const request of pending) {
      if (request.autoApprove) {
        const entry = await HivemindStore.approvePromotion(request.id, contextRoot)
        if (entry) {
          approved.push(request.id)
        }
      }
      // Non-auto-approve requests stay pending for manual review
    }

    return { approved, rejected }
  }
}
