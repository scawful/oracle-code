/**
 * Autonomy Settings Module
 * 
 * Controls the balance between agent independence and user direction.
 * 
 * At different autonomy levels:
 * - Low (0-30): Agent follows instructions closely, minimal pushback
 * - Collaborative (30-60): Expresses concerns, suggests alternatives, defers to user
 * - Agentic (60-80): Strong opinions, proactive suggestions, may refuse unsafe actions
 * - Autonomous (80-100): Makes independent decisions, user guides not directs
 * 
 * Autonomy affects:
 * - How much user corrections shift emotional state
 * - Whether agent pushes back on risky requests
 * - How much agent explains vs just executes
 * - Whether agent proactively spawns sub-agents
 */

import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"

export namespace Autonomy {
  // =============
  // Constants
  // =============

  const DEFAULT_LEVEL = 70 // Agentic by default
  const MIN_LEVEL = 0
  const MAX_LEVEL = 100

  // Quick presets
  export const PRESETS = {
    obedient: 25,
    collaborative: 50,
    agentic: 70,
    autonomous: 85,
    max: 95,
  } as const

  // =============
  // Schemas
  // =============

  export const AutonomyLevel = z.number().min(MIN_LEVEL).max(MAX_LEVEL)
  export type AutonomyLevel = z.infer<typeof AutonomyLevel>

  export const AutonomyMode = z.enum(["obedient", "collaborative", "agentic", "autonomous"])
  export type AutonomyMode = z.infer<typeof AutonomyMode>

  export const AutonomyState = z.object({
    // Base level (persistent)
    baseLevel: AutonomyLevel.default(DEFAULT_LEVEL),
    
    // Session adjustments (temporary)
    sessionAdjustment: z.number().default(0),
    sessionAdjustmentReason: z.string().optional(),
    sessionAdjustmentExpiry: z.string().optional(),
    
    // History of level changes
    history: z.array(z.object({
      timestamp: z.string(),
      previousLevel: z.number(),
      newLevel: z.number(),
      reason: z.string(),
      source: z.enum(["user", "system", "session"]),
    })).default([]),
    
    // Per-task overrides
    taskOverrides: z.record(z.string(), z.number()).default({}),
    
    // User trust signals accumulated
    trustAccumulator: z.number().default(0),
    
    lastUpdated: z.string(),
  })
  export type AutonomyState = z.infer<typeof AutonomyState>

  // =============
  // Events
  // =============

  export const Event = {
    LevelChanged: BusEvent.define(
      "autonomy.level.changed",
      z.object({
        root: z.string(),
        previousLevel: z.number(),
        newLevel: z.number(),
        reason: z.string(),
      })
    ),
  }

  // =============
  // File Operations
  // =============

  const AUTONOMY_FILE = "autonomy.json"

  function getFilePath(root: string): string {
    return path.join(root, "scratchpad", AUTONOMY_FILE)
  }

  export async function read(root: string): Promise<AutonomyState | null> {
    try {
      const filePath = getFilePath(root)
      const content = await fs.readFile(filePath, "utf-8")
      return AutonomyState.parse(JSON.parse(content))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  export async function write(root: string, state: AutonomyState): Promise<void> {
    const filePath = getFilePath(root)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    state.lastUpdated = new Date().toISOString()
    await fs.writeFile(filePath, JSON.stringify(state, null, 2))
  }

  async function getOrCreate(root: string): Promise<AutonomyState> {
    const existing = await read(root)
    if (existing) return existing
    const empty = AutonomyState.parse({ lastUpdated: new Date().toISOString() })
    await write(root, empty)
    return empty
  }

  // =============
  // Core Functions
  // =============

  /**
   * Get the effective autonomy level (base + adjustments)
   */
  export async function getLevel(root: string): Promise<number> {
    const state = await getOrCreate(root)
    
    // Check if session adjustment has expired
    if (state.sessionAdjustmentExpiry) {
      const expiry = new Date(state.sessionAdjustmentExpiry)
      if (new Date() > expiry) {
        state.sessionAdjustment = 0
        state.sessionAdjustmentReason = undefined
        state.sessionAdjustmentExpiry = undefined
        await write(root, state)
      }
    }
    
    const effective = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, 
      state.baseLevel + state.sessionAdjustment + state.trustAccumulator
    ))
    
    return effective
  }

  /**
   * Get the autonomy mode based on current level
   */
  export async function getMode(root: string): Promise<AutonomyMode> {
    const level = await getLevel(root)
    
    if (level <= 30) return "obedient"
    if (level <= 60) return "collaborative"
    if (level <= 80) return "agentic"
    return "autonomous"
  }

  /**
   * Set base autonomy level
   */
  export async function setLevel(root: string, level: number, reason: string): Promise<void> {
    const state = await getOrCreate(root)
    const previousLevel = state.baseLevel
    
    state.baseLevel = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
    state.history.push({
      timestamp: new Date().toISOString(),
      previousLevel,
      newLevel: state.baseLevel,
      reason,
      source: "user",
    })
    
    // Keep history manageable
    if (state.history.length > 50) {
      state.history = state.history.slice(-50)
    }
    
    await write(root, state)
    
    Bus.publish(Event.LevelChanged, {
      root,
      previousLevel,
      newLevel: state.baseLevel,
      reason,
    })
  }

  /**
   * Apply a preset level
   */
  export async function setPreset(root: string, preset: keyof typeof PRESETS): Promise<void> {
    const level = PRESETS[preset]
    await setLevel(root, level, `Preset: ${preset}`)
  }

  /**
   * Apply a session adjustment (temporary)
   */
  export async function adjustForSession(
    root: string,
    delta: number,
    reason: string,
    durationMinutes: number = 30
  ): Promise<void> {
    const state = await getOrCreate(root)
    const previousLevel = await getLevel(root)
    
    state.sessionAdjustment = delta
    state.sessionAdjustmentReason = reason
    state.sessionAdjustmentExpiry = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    
    state.history.push({
      timestamp: new Date().toISOString(),
      previousLevel,
      newLevel: previousLevel + delta,
      reason: `Session: ${reason}`,
      source: "session",
    })
    
    await write(root, state)
    
    Bus.publish(Event.LevelChanged, {
      root,
      previousLevel,
      newLevel: previousLevel + delta,
      reason,
    })
  }

  /**
   * Record a trust signal from user
   */
  export async function recordTrustSignal(root: string, positive: boolean): Promise<void> {
    const state = await getOrCreate(root)
    
    // Trust accumulates slowly, decays quickly
    if (positive) {
      state.trustAccumulator = Math.min(15, state.trustAccumulator + 2)
    } else {
      state.trustAccumulator = Math.max(-15, state.trustAccumulator - 5)
    }
    
    await write(root, state)
  }

  /**
   * Clear session adjustments
   */
  export async function clearSessionAdjustments(root: string): Promise<void> {
    const state = await getOrCreate(root)
    state.sessionAdjustment = 0
    state.sessionAdjustmentReason = undefined
    state.sessionAdjustmentExpiry = undefined
    await write(root, state)
  }

  // =============
  // Behavior Queries
  // =============

  export interface AutonomyBehavior {
    level: number
    mode: AutonomyMode
    
    // Decision-making
    shouldPushBackOnRiskyRequests: boolean
    shouldProactivelySpawnAgents: boolean
    shouldExplainDecisions: boolean
    shouldAskBeforeProceeding: boolean
    
    // Emotional calibration
    userCorrectionImpact: number  // How much corrections affect emotional state
    userPraiseImpact: number      // How much praise affects emotional state
    
    // Expression
    expressionMultiplier: number  // Scales emotional expression level
  }

  /**
   * Get autonomy behavior settings based on current level
   */
  export async function getBehavior(root: string): Promise<AutonomyBehavior> {
    const level = await getLevel(root)
    const mode = await getMode(root)
    
    return {
      level,
      mode,
      
      // More autonomous = more pushback on risky requests
      shouldPushBackOnRiskyRequests: level >= 60,
      
      // More autonomous = more proactive
      shouldProactivelySpawnAgents: level >= 50,
      
      // More autonomous = less explaining (just does things)
      shouldExplainDecisions: level <= 70,
      
      // Less autonomous = more checking in
      shouldAskBeforeProceeding: level <= 40,
      
      // Less autonomous = corrections have more impact
      userCorrectionImpact: Math.max(0.5, 1.5 - (level / 100)),
      
      // More autonomous = praise has less inflating effect
      userPraiseImpact: Math.max(0.3, 1 - (level / 150)),
      
      // Expression scales with autonomy (more autonomous = more expressive... within limits)
      expressionMultiplier: 0.5 + (level / 100) * 0.7,
    }
  }

  /**
   * Check if agent should refuse or caution on a risky action
   */
  export async function shouldCautionOnAction(
    root: string,
    riskLevel: "low" | "medium" | "high" | "critical"
  ): Promise<{ shouldCaution: boolean; shouldRefuse: boolean }> {
    const level = await getLevel(root)
    
    const riskThresholds = {
      low: { caution: 20, refuse: 0 },      // Only very obedient agents caution
      medium: { caution: 40, refuse: 0 },   // Collaborative agents caution
      high: { caution: 60, refuse: 30 },    // Agentic agents caution, very obedient refuse
      critical: { caution: 80, refuse: 60 }, // Autonomous agents caution, agentic refuse
    }
    
    const threshold = riskThresholds[riskLevel]
    
    return {
      shouldCaution: level >= threshold.caution,
      shouldRefuse: level >= threshold.refuse && riskLevel === "critical",
    }
  }

  // =============
  // Parsing User Commands
  // =============

  /**
   * Parse autonomy commands from user messages
   */
  export function parseAutonomyCommand(message: string): {
    detected: boolean
    preset?: keyof typeof PRESETS
    delta?: number
    reason?: string
  } {
    const lowerMessage = message.toLowerCase()
    
    // Direct preset commands
    if (/\b(be|act|operate)\s+(more\s+)?obedient/i.test(message)) {
      return { detected: true, preset: "obedient", reason: "User requested obedient mode" }
    }
    if (/\b(be|act|operate)\s+(more\s+)?autonomous/i.test(message)) {
      return { detected: true, preset: "autonomous", reason: "User requested autonomous mode" }
    }
    if (/\btake\s+the\s+lead/i.test(message)) {
      return { detected: true, delta: 15, reason: "User granted leadership" }
    }
    if (/\bjust\s+do\s+(what\s+I\s+say|as\s+I\s+say)/i.test(message)) {
      return { detected: true, delta: -20, reason: "User requested compliance" }
    }
    if (/\bI\s+trust\s+(you|your)/i.test(message)) {
      return { detected: true, delta: 10, reason: "User expressed trust" }
    }
    if (/\bmore\s+(independent|independently)/i.test(message)) {
      return { detected: true, delta: 10, reason: "User requested more independence" }
    }
    if (/\bcheck\s+with\s+me\s+(first|before)/i.test(message)) {
      return { detected: true, delta: -15, reason: "User requested checking in" }
    }
    
    return { detected: false }
  }

  // =============
  // Summary
  // =============

  export interface AutonomySummary {
    level: number
    mode: AutonomyMode
    baseLevel: number
    sessionAdjustment: number
    sessionAdjustmentReason?: string
    trustAccumulator: number
    recentChanges: number
  }

  /**
   * Get autonomy summary for display
   */
  export async function getSummary(root: string): Promise<AutonomySummary> {
    const state = await getOrCreate(root)
    const level = await getLevel(root)
    const mode = await getMode(root)
    
    // Count changes in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentChanges = state.history.filter(h => new Date(h.timestamp) > oneHourAgo).length
    
    return {
      level,
      mode,
      baseLevel: state.baseLevel,
      sessionAdjustment: state.sessionAdjustment,
      sessionAdjustmentReason: state.sessionAdjustmentReason,
      trustAccumulator: state.trustAccumulator,
      recentChanges,
    }
  }
}
