/**
 * Analysis Triggers - Automatic invocation of analysis modes.
 *
 * Implements the trigger system per PROTOCOL_SPEC.md Section 5.3.
 */

import { Log } from "@/util/log"
import type {
  AnalysisMode,
  AnalysisGateMode,
  TriggerConditionType,
  TriggerPriority,
} from "./types"

const log = Log.create({ service: "analysis.triggers" })

/**
 * Trigger condition definition.
 */
export interface TriggerCondition {
  type: TriggerConditionType
  metric?: string
  threshold?: number
  pattern?: string
  count?: number
  withinMs?: number
}

/**
 * Trigger action definition.
 */
export interface TriggerAction {
  mode: AnalysisMode
  agent?: string
  autoAccept?: boolean
  priority: TriggerPriority
}

/**
 * Analysis trigger definition.
 */
export interface AnalysisTrigger {
  id: string
  name: string
  description: string

  condition: TriggerCondition
  action: TriggerAction

  cooldownMs?: number
  maxTriggersPerSession?: number

  // State
  enabled: boolean
  triggerCount: number
  lastTriggered?: string
}

/**
 * Record of a trigger firing.
 */
export interface TriggerEvent {
  triggerId: string
  timestamp: string
  metrics: Record<string, unknown>
  actionTaken: string
  accepted: boolean
}

/**
 * Default triggers from PROTOCOL_SPEC.md Section 5.3.
 */
const DEFAULT_TRIGGERS: AnalysisTrigger[] = [
  {
    id: "spinning-critic",
    name: "Spinning Detection",
    description: "Activate critic when agent is spinning",
    condition: {
      type: "pattern",
      metric: "progress_status",
      pattern: "spinning",
    },
    action: {
      mode: "critic",
      priority: "high",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "edits-without-tests",
    name: "Edits Without Tests",
    description: "Evaluate when edits made without tests",
    condition: {
      type: "threshold",
      metric: "edit_count",
      threshold: 3,
    },
    action: {
      mode: "eval",
      priority: "medium",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "high-anxiety-caution",
    name: "High Anxiety Caution",
    description: "Activate emotional analysis when anxiety is high",
    condition: {
      type: "threshold",
      metric: "anxiety_level",
      threshold: 0.7,
    },
    action: {
      mode: "emotional",
      priority: "high",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "consecutive-failures",
    name: "Consecutive Failures",
    description: "Analyze metrics after consecutive failures",
    condition: {
      type: "count",
      metric: "failures",
      count: 3,
      withinMs: 300000, // 5 minutes
    },
    action: {
      mode: "metrics",
      priority: "high",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "high-cognitive-load",
    name: "High Cognitive Load",
    description: "Emotional analysis when cognitive load is high",
    condition: {
      type: "threshold",
      metric: "cognitive_load",
      threshold: 0.8,
    },
    action: {
      mode: "emotional",
      priority: "medium",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "tool-repetition",
    name: "Tool Repetition",
    description: "Critic when same tool called repeatedly",
    condition: {
      type: "count",
      metric: "same_tool_calls",
      count: 5,
      withinMs: 60000, // 1 minute
    },
    action: {
      mode: "critic",
      priority: "low",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "baseline-too-high",
    name: "Baseline Too High",
    description: "Warn when multi-agent used but baseline is high",
    condition: {
      type: "threshold",
      metric: "baseline_accuracy",
      threshold: 0.45,
    },
    action: {
      mode: "metrics",
      priority: "medium",
    },
    enabled: true,
    triggerCount: 0,
  },
  {
    id: "error-amplification-warning",
    name: "Error Amplification Warning",
    description: "Alert on high error amplification",
    condition: {
      type: "threshold",
      metric: "error_amplification",
      threshold: 10,
    },
    action: {
      mode: "metrics",
      priority: "high",
    },
    enabled: true,
    triggerCount: 0,
  },
]

/**
 * Manages analysis triggers and their evaluation.
 */
export class TriggerManager {
  private gateMode: AnalysisGateMode
  private confirmationCallback?: (trigger: AnalysisTrigger) => Promise<boolean>
  private triggers: Map<string, AnalysisTrigger> = new Map()
  private eventHistory: TriggerEvent[] = []
  private eventCounters: Map<string, number[]> = new Map()

  constructor(options?: {
    gateMode?: AnalysisGateMode
    confirmationCallback?: (trigger: AnalysisTrigger) => Promise<boolean>
  }) {
    this.gateMode = options?.gateMode ?? "confirm-all"
    this.confirmationCallback = options?.confirmationCallback

    // Load default triggers
    for (const trigger of DEFAULT_TRIGGERS) {
      this.triggers.set(trigger.id, { ...trigger })
    }
  }

  /**
   * Register a trigger.
   */
  registerTrigger(trigger: AnalysisTrigger): void {
    this.triggers.set(trigger.id, { ...trigger })
  }

  /**
   * Unregister a trigger.
   */
  unregisterTrigger(triggerId: string): boolean {
    return this.triggers.delete(triggerId)
  }

  /**
   * Enable a trigger.
   */
  enableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      trigger.enabled = true
    }
  }

  /**
   * Disable a trigger.
   */
  disableTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      trigger.enabled = false
    }
  }

  /**
   * Record an event for count-based triggers.
   */
  recordEvent(metric: string, value: unknown = 1): void {
    const now = Date.now()

    if (!this.eventCounters.has(metric)) {
      this.eventCounters.set(metric, [])
    }

    const events = this.eventCounters.get(metric)!
    events.push(now)

    // Cleanup old events (older than 10 minutes)
    const cutoff = now - 600000
    this.eventCounters.set(
      metric,
      events.filter((t) => t > cutoff)
    )
  }

  /**
   * Check if trigger is in cooldown period.
   */
  private checkCooldown(trigger: AnalysisTrigger): boolean {
    if (!trigger.cooldownMs || trigger.cooldownMs <= 0) {
      return true
    }

    if (!trigger.lastTriggered) {
      return true
    }

    const last = new Date(trigger.lastTriggered).getTime()
    const now = Date.now()
    return now - last >= trigger.cooldownMs
  }

  /**
   * Check if trigger has exceeded max per session.
   */
  private checkMaxTriggers(trigger: AnalysisTrigger): boolean {
    if (!trigger.maxTriggersPerSession) {
      return true
    }
    return trigger.triggerCount < trigger.maxTriggersPerSession
  }

  /**
   * Evaluate a trigger condition.
   */
  private evaluateCondition(
    condition: TriggerCondition,
    metrics: Record<string, unknown>
  ): boolean {
    switch (condition.type) {
      case "threshold": {
        if (!condition.metric || condition.threshold === undefined) {
          return false
        }
        const value = metrics[condition.metric]
        try {
          return Number(value) >= condition.threshold
        } catch {
          return false
        }
      }

      case "pattern": {
        if (!condition.metric || !condition.pattern) {
          return false
        }
        const value = String(metrics[condition.metric] ?? "")
        try {
          return new RegExp(condition.pattern).test(value)
        } catch {
          return false
        }
      }

      case "count": {
        if (!condition.metric || !condition.count) {
          return false
        }
        let events = this.eventCounters.get(condition.metric) ?? []

        // Filter by time window if specified
        if (condition.withinMs) {
          const cutoff = Date.now() - condition.withinMs
          events = events.filter((t) => t > cutoff)
        }

        return events.length >= condition.count
      }

      case "time": {
        // Time-based triggers would be handled by a scheduler
        return false
      }

      default:
        return false
    }
  }

  /**
   * Evaluate all triggers against current metrics.
   */
  async evaluate(
    metrics: Record<string, unknown>
  ): Promise<Array<{ trigger: AnalysisTrigger; accepted: boolean }>> {
    const results: Array<{ trigger: AnalysisTrigger; accepted: boolean }> = []

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) {
        continue
      }

      if (!this.checkCooldown(trigger)) {
        continue
      }

      if (!this.checkMaxTriggers(trigger)) {
        continue
      }

      if (!this.evaluateCondition(trigger.condition, metrics)) {
        continue
      }

      // Trigger condition met - check gate mode
      const accepted = await this.handleGate(trigger)

      // Update trigger state
      trigger.triggerCount++
      trigger.lastTriggered = new Date().toISOString()

      // Record event
      const event: TriggerEvent = {
        triggerId: trigger.id,
        timestamp: trigger.lastTriggered,
        metrics,
        actionTaken: trigger.action.mode,
        accepted,
      }
      this.eventHistory.push(event)

      log.info("Trigger fired", {
        triggerId: trigger.id,
        accepted,
        mode: trigger.action.mode,
      })

      results.push({ trigger, accepted })
    }

    return results
  }

  /**
   * Handle gating logic for a fired trigger.
   */
  private async handleGate(trigger: AnalysisTrigger): Promise<boolean> {
    if (this.gateMode === "auto-deny") {
      return false
    }

    if (this.gateMode === "auto-accept") {
      return true
    }

    if (trigger.action.autoAccept) {
      return true
    }

    if (this.gateMode === "confirm-all") {
      if (this.confirmationCallback) {
        return this.confirmationCallback(trigger)
      }
      // No callback - default to deny for safety
      return false
    }

    if (this.gateMode === "selective") {
      // Check per-trigger auto_accept setting
      return trigger.action.autoAccept ?? false
    }

    return false
  }

  /**
   * Get recent trigger events.
   */
  getRecentEvents(limit: number = 20): TriggerEvent[] {
    return this.eventHistory.slice(-limit)
  }

  /**
   * Reset per-session state.
   */
  resetSession(): void {
    for (const trigger of this.triggers.values()) {
      trigger.triggerCount = 0
    }
    this.eventCounters.clear()
    this.eventHistory = []
  }

  /**
   * Get all registered triggers.
   */
  getTriggers(): AnalysisTrigger[] {
    return Array.from(this.triggers.values())
  }
}

/**
 * Singleton trigger manager instance.
 */
let globalTriggerManager: TriggerManager | null = null

/**
 * Get or create the global trigger manager.
 */
export function getTriggerManager(options?: {
  gateMode?: AnalysisGateMode
  confirmationCallback?: (trigger: AnalysisTrigger) => Promise<boolean>
}): TriggerManager {
  if (!globalTriggerManager) {
    globalTriggerManager = new TriggerManager(options)
  }
  return globalTriggerManager
}

/**
 * Reset the global trigger manager.
 */
export function resetTriggerManager(): void {
  globalTriggerManager = null
}
