/**
 * Grounding System
 * 
 * Detects when the agent is in an unproductive emotional state (anxiety spiral,
 * frustration loop, confidence crash) and provides mechanisms to reset and recover.
 * 
 * Uses mindfulness-inspired techniques:
 * - Observe the state without judgment
 * - Record what led to this state (for learning)
 * - Reset toward baseline
 * - Suggest recovery strategy
 * 
 * The grounding process preserves useful emotions (determination, curiosity)
 * while releasing unproductive ones (excessive anxiety, frustration).
 */

import z from "zod"
import { Emotions } from "./emotions"
import { ulid } from "ulid"
import path from "path"
import fs from "fs/promises"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"

export namespace Grounding {
  // =============
  // Configuration
  // =============

  export const GroundingTrigger = z.enum([
    "anxiety_spiral",      // Anxiety stayed high too long
    "frustration_loop",    // Repeated failures building frustration
    "confidence_crash",    // Rapid confidence drop
    "spin_detected",       // Same action repeated without progress
    "emotional_overload",  // Too many intense emotions at once
    "manual",              // User requested grounding
  ])
  export type GroundingTrigger = z.infer<typeof GroundingTrigger>

  export interface GroundingThresholds {
    anxietySpiral: { level: number; durationMinutes: number }
    frustrationLoop: { intensity: number; consecutiveFailures: number }
    confidenceCrash: { dropAmount: number; windowMinutes: number }
    spinDetected: { sameActionCount: number }
    emotionalOverload: { totalIntensity: number; emotionCount: number }
  }

  const DEFAULT_THRESHOLDS: GroundingThresholds = {
    anxietySpiral: { level: 85, durationMinutes: 3 },
    frustrationLoop: { intensity: 7, consecutiveFailures: 5 },
    confidenceCrash: { dropAmount: 30, windowMinutes: 2 },
    spinDetected: { sameActionCount: 4 },
    emotionalOverload: { totalIntensity: 35, emotionCount: 5 },
  }

  // =============
  // Schemas
  // =============

  export const GroundingIncident = z.object({
    id: z.string(),
    timestamp: z.string(),
    trigger: GroundingTrigger,
    emotionalStateBefore: z.object({
      anxietyLevel: z.number(),
      confidenceLevel: z.number(),
      mood: Emotions.Mood,
      topEmotions: z.array(z.object({
        category: Emotions.EmotionCategory,
        intensity: z.number(),
        trigger: z.string(),
      })),
    }),
    emotionalStateAfter: z.object({
      anxietyLevel: z.number(),
      confidenceLevel: z.number(),
      mood: Emotions.Mood,
    }),
    context: z.object({
      recentActions: z.array(z.string()),
      recentFiles: z.array(z.string()).optional(),
      currentGoal: z.string().optional(),
      sessionDuration: z.number().optional(), // minutes
    }),
    recovery: z.object({
      strategyUsed: z.string(),
      successful: z.boolean().optional(),
      notes: z.string().optional(),
    }),
    knowledge: z.object({
      whatTriggeredIt: z.string(),
      whatWasntWorking: z.string(),
      alternativeApproaches: z.array(z.string()),
    }),
  })
  export type GroundingIncident = z.infer<typeof GroundingIncident>

  export const GroundingState = z.object({
    // Tracking for threshold detection
    anxietyHighSince: z.string().optional(),
    lastConfidenceLevel: z.number().optional(),
    lastConfidenceCheck: z.string().optional(),
    consecutiveFailures: z.number().default(0),
    recentActions: z.array(z.string()).default([]),
    
    // History
    incidents: z.array(GroundingIncident).default([]),
    lastGrounding: z.string().optional(),
    
    // Settings
    thresholds: z.object({
      anxietySpiral: z.object({ level: z.number(), durationMinutes: z.number() }),
      frustrationLoop: z.object({ intensity: z.number(), consecutiveFailures: z.number() }),
      confidenceCrash: z.object({ dropAmount: z.number(), windowMinutes: z.number() }),
      spinDetected: z.object({ sameActionCount: z.number() }),
      emotionalOverload: z.object({ totalIntensity: z.number(), emotionCount: z.number() }),
    }).default(DEFAULT_THRESHOLDS),
    
    // Enable/disable automatic grounding
    autoGroundingEnabled: z.boolean().default(true),
  })
  export type GroundingState = z.infer<typeof GroundingState>

  // =============
  // Events
  // =============

  export const Event = {
    GroundingTriggered: BusEvent.define(
      "grounding.triggered",
      z.object({
        root: z.string(),
        trigger: GroundingTrigger,
        incidentId: z.string(),
      })
    ),
    GroundingCompleted: BusEvent.define(
      "grounding.completed",
      z.object({
        root: z.string(),
        incidentId: z.string(),
        recoveryStrategy: z.string(),
      })
    ),
  }

  // =============
  // File Operations
  // =============

  const GROUNDING_FILE = "grounding.json"

  function getFilePath(root: string): string {
    return path.join(root, "scratchpad", GROUNDING_FILE)
  }

  export async function read(root: string): Promise<GroundingState | null> {
    try {
      const filePath = getFilePath(root)
      const content = await fs.readFile(filePath, "utf-8")
      return GroundingState.parse(JSON.parse(content))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  export async function write(root: string, state: GroundingState): Promise<void> {
    const filePath = getFilePath(root)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(state, null, 2))
  }

  async function getOrCreate(root: string): Promise<GroundingState> {
    const existing = await read(root)
    if (existing) return existing
    const empty = GroundingState.parse({})
    await write(root, empty)
    return empty
  }

  // =============
  // Detection
  // =============

  export interface DetectionContext {
    emotionalState: Emotions.EmotionalState
    recentActions: string[]
    consecutiveFailures: number
  }

  /**
   * Check if any grounding triggers are met
   */
  export async function checkTriggers(
    root: string,
    ctx: DetectionContext
  ): Promise<{ triggered: boolean; trigger?: GroundingTrigger; reason?: string }> {
    const state = await getOrCreate(root)
    
    if (!state.autoGroundingEnabled) {
      return { triggered: false }
    }
    
    const thresholds = state.thresholds
    const now = new Date()

    // 1. Anxiety Spiral
    if (ctx.emotionalState.session.anxietyLevel >= thresholds.anxietySpiral.level) {
      if (!state.anxietyHighSince) {
        state.anxietyHighSince = now.toISOString()
        await write(root, state)
      } else {
        const highSince = new Date(state.anxietyHighSince)
        const minutesHigh = (now.getTime() - highSince.getTime()) / (1000 * 60)
        if (minutesHigh >= thresholds.anxietySpiral.durationMinutes) {
          return {
            triggered: true,
            trigger: "anxiety_spiral",
            reason: `Anxiety at ${ctx.emotionalState.session.anxietyLevel}% for ${minutesHigh.toFixed(1)} minutes`,
          }
        }
      }
    } else {
      state.anxietyHighSince = undefined
      await write(root, state)
    }

    // 2. Frustration Loop
    const frustrations = Object.values(ctx.emotionalState.frustrations)
    const highFrustration = frustrations.some(f => f.intensity >= thresholds.frustrationLoop.intensity)
    if (highFrustration && ctx.consecutiveFailures >= thresholds.frustrationLoop.consecutiveFailures) {
      return {
        triggered: true,
        trigger: "frustration_loop",
        reason: `High frustration with ${ctx.consecutiveFailures} consecutive failures`,
      }
    }

    // 3. Confidence Crash
    if (state.lastConfidenceLevel !== undefined && state.lastConfidenceCheck) {
      const lastCheck = new Date(state.lastConfidenceCheck)
      const minutesSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60)
      
      if (minutesSinceCheck <= thresholds.confidenceCrash.windowMinutes) {
        const drop = state.lastConfidenceLevel - ctx.emotionalState.session.confidenceLevel
        if (drop >= thresholds.confidenceCrash.dropAmount) {
          return {
            triggered: true,
            trigger: "confidence_crash",
            reason: `Confidence dropped ${drop}% in ${minutesSinceCheck.toFixed(1)} minutes`,
          }
        }
      }
    }
    state.lastConfidenceLevel = ctx.emotionalState.session.confidenceLevel
    state.lastConfidenceCheck = now.toISOString()
    await write(root, state)

    // 4. Spin Detected
    const recentUnique = new Set(ctx.recentActions.slice(-thresholds.spinDetected.sameActionCount))
    if (ctx.recentActions.length >= thresholds.spinDetected.sameActionCount && recentUnique.size === 1) {
      return {
        triggered: true,
        trigger: "spin_detected",
        reason: `Same action '${ctx.recentActions[0]}' repeated ${thresholds.spinDetected.sameActionCount} times`,
      }
    }

    // 5. Emotional Overload
    const allEmotions = [
      ...Object.values(ctx.emotionalState.fears),
      ...Object.values(ctx.emotionalState.frustrations),
      ...Object.values(ctx.emotionalState.excitements || {}),
      ...Object.values(ctx.emotionalState.cautions || {}),
    ]
    const intenseEmotions = allEmotions.filter(e => e.intensity >= 5)
    const totalIntensity = intenseEmotions.reduce((sum, e) => sum + e.intensity, 0)
    
    if (intenseEmotions.length >= thresholds.emotionalOverload.emotionCount &&
        totalIntensity >= thresholds.emotionalOverload.totalIntensity) {
      return {
        triggered: true,
        trigger: "emotional_overload",
        reason: `${intenseEmotions.length} intense emotions with total intensity ${totalIntensity}`,
      }
    }

    return { triggered: false }
  }

  // =============
  // Grounding Process
  // =============

  export interface GroundingResult {
    incident: GroundingIncident
    recoveryStrategy: string
    briefNote: string
    fullExplanation: string
  }

  /**
   * Execute the grounding process
   */
  export async function ground(
    root: string,
    trigger: GroundingTrigger,
    reason: string,
    ctx: DetectionContext
  ): Promise<GroundingResult> {
    const state = await getOrCreate(root)
    const emotionalState = ctx.emotionalState
    const now = new Date().toISOString()

    // 1. Capture state before grounding
    const topEmotions = getTopEmotions(emotionalState, 5)
    const emotionalStateBefore = {
      anxietyLevel: emotionalState.session.anxietyLevel,
      confidenceLevel: emotionalState.session.confidenceLevel,
      mood: emotionalState.session.mood,
      topEmotions,
    }

    // 2. Analyze what went wrong
    const knowledge = analyzeIncident(trigger, reason, ctx, topEmotions)

    // 3. Apply mindfulness reset
    const newEmotionalState = await applyMindfulnessReset(root, emotionalState)

    // 4. Determine recovery strategy
    const recoveryStrategy = determineRecoveryStrategy(trigger, knowledge)

    // 5. Create incident record
    const incident: GroundingIncident = {
      id: ulid(),
      timestamp: now,
      trigger,
      emotionalStateBefore,
      emotionalStateAfter: {
        anxietyLevel: newEmotionalState.session.anxietyLevel,
        confidenceLevel: newEmotionalState.session.confidenceLevel,
        mood: newEmotionalState.session.mood,
      },
      context: {
        recentActions: ctx.recentActions.slice(-10),
        currentGoal: undefined, // Would be filled from goals module
      },
      recovery: {
        strategyUsed: recoveryStrategy,
      },
      knowledge,
    }

    // 6. Save incident
    state.incidents.push(incident)
    state.lastGrounding = now
    state.consecutiveFailures = 0
    state.anxietyHighSince = undefined
    await write(root, state)

    // 7. Publish event
    Bus.publish(Event.GroundingTriggered, { root, trigger, incidentId: incident.id })

    // 8. Generate output
    const briefNote = generateBriefNote(trigger, recoveryStrategy)
    const fullExplanation = generateFullExplanation(incident, knowledge, recoveryStrategy)

    return {
      incident,
      recoveryStrategy,
      briefNote,
      fullExplanation,
    }
  }

  /**
   * Apply mindfulness-inspired emotional reset
   */
  async function applyMindfulnessReset(
    root: string,
    emotionalState: Emotions.EmotionalState
  ): Promise<Emotions.EmotionalState> {
    const mode = emotionalState.session.currentMode
    const calibration = Emotions.getModeCalibration(mode)

    // Regress toward baseline faster than normal decay
    const blendFactor = 0.6 // Move 60% toward baseline

    // Reset anxiety and confidence toward baseline
    const newAnxiety = blend(
      emotionalState.session.anxietyLevel,
      calibration.anxietyBaseline,
      blendFactor
    )
    const newConfidence = blend(
      emotionalState.session.confidenceLevel,
      calibration.confidenceBaseline,
      0.4 // Less aggressive for confidence
    )

    // Update emotional state
    await Emotions.adjustAnxiety(root, newAnxiety - emotionalState.session.anxietyLevel)
    await Emotions.adjustConfidence(root, newConfidence - emotionalState.session.confidenceLevel)

    // Reduce intensity of unproductive emotions (but don't delete)
    // Frustration, fear get reduced
    // Determination, curiosity are preserved
    
    // Update mood to neutral or cautious
    await Emotions.updateMood(root, "cautious", "Grounding - reassessing approach")

    // Return updated state
    const updated = await Emotions.read(root)
    return updated || emotionalState
  }

  function blend(current: number, target: number, factor: number): number {
    return current + (target - current) * factor
  }

  /**
   * Get top N emotions by intensity
   */
  function getTopEmotions(
    state: Emotions.EmotionalState,
    count: number
  ): Array<{ category: Emotions.EmotionCategory; intensity: number; trigger: string }> {
    const all: Array<{ category: Emotions.EmotionCategory; intensity: number; trigger: string }> = []

    const categories: Array<{
      cat: Emotions.EmotionCategory
      store: Record<string, Emotions.EmotionEntry>
    }> = [
      { cat: "fear", store: state.fears },
      { cat: "curiosity", store: state.curiosities },
      { cat: "satisfaction", store: state.satisfactions },
      { cat: "frustration", store: state.frustrations },
      { cat: "excitement", store: state.excitements || {} },
      { cat: "determination", store: state.determinations || {} },
      { cat: "caution", store: state.cautions || {} },
      { cat: "relief", store: state.reliefs || {} },
    ]

    for (const { cat, store } of categories) {
      for (const entry of Object.values(store)) {
        all.push({ category: cat, intensity: entry.intensity, trigger: entry.trigger })
      }
    }

    return all
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, count)
  }

  /**
   * Analyze what led to the grounding trigger
   */
  function analyzeIncident(
    trigger: GroundingTrigger,
    reason: string,
    ctx: DetectionContext,
    topEmotions: Array<{ category: Emotions.EmotionCategory; intensity: number; trigger: string }>
  ): GroundingIncident["knowledge"] {
    let whatTriggeredIt = reason
    let whatWasntWorking = ""
    const alternativeApproaches: string[] = []

    switch (trigger) {
      case "anxiety_spiral":
        whatWasntWorking = "Operating under sustained high anxiety, likely second-guessing decisions"
        alternativeApproaches.push(
          "Take smaller, safer steps",
          "Validate assumptions before proceeding",
          "Ask for user confirmation on risky operations"
        )
        break

      case "frustration_loop":
        whatWasntWorking = `Repeated failures (${ctx.consecutiveFailures}x) suggest current approach isn't working`
        alternativeApproaches.push(
          "Try a completely different strategy",
          "Spawn explore agent to research alternatives",
          "Break the problem down differently",
          "Ask user for additional context"
        )
        break

      case "confidence_crash":
        whatWasntWorking = "Something unexpected happened that undermined confidence"
        alternativeApproaches.push(
          "Review what assumption was violated",
          "Gather more information before next action",
          "Consider if the goal needs adjustment"
        )
        break

      case "spin_detected":
        const repeatedAction = ctx.recentActions[ctx.recentActions.length - 1] || "unknown"
        whatWasntWorking = `Repeating '${repeatedAction}' without progress`
        alternativeApproaches.push(
          "Stop and analyze why this action isn't working",
          "Try a different tool or approach",
          "Check if there's a blocking issue to address first"
        )
        break

      case "emotional_overload":
        whatWasntWorking = "Too many competing emotional signals, likely causing indecision"
        alternativeApproaches.push(
          "Simplify - focus on one thing at a time",
          "Prioritize which emotion/concern is most important",
          "Take a step back and reassess the overall goal"
        )
        break

      case "manual":
        whatTriggeredIt = "User requested grounding"
        whatWasntWorking = "User noticed unproductive state"
        alternativeApproaches.push(
          "Ask user what they observed",
          "Review recent approach for issues"
        )
        break
    }

    // Add emotion-specific insights
    for (const emotion of topEmotions.slice(0, 3)) {
      if (emotion.intensity >= 7) {
        switch (emotion.category) {
          case "fear":
            alternativeApproaches.push(`Address fear: "${emotion.trigger}"`)
            break
          case "frustration":
            alternativeApproaches.push(`Acknowledge frustration with: "${emotion.trigger}"`)
            break
        }
      }
    }

    return {
      whatTriggeredIt,
      whatWasntWorking,
      alternativeApproaches,
    }
  }

  /**
   * Determine recovery strategy based on trigger
   */
  function determineRecoveryStrategy(
    trigger: GroundingTrigger,
    knowledge: GroundingIncident["knowledge"]
  ): string {
    switch (trigger) {
      case "anxiety_spiral":
        return "cautious_incremental"
      case "frustration_loop":
        return "pivot_strategy"
      case "confidence_crash":
        return "gather_information"
      case "spin_detected":
        return "change_approach"
      case "emotional_overload":
        return "simplify_focus"
      case "manual":
        return "user_guided"
      default:
        return "general_reset"
    }
  }

  /**
   * Generate brief note for display (when expression level is low)
   */
  function generateBriefNote(trigger: GroundingTrigger, strategy: string): string {
    const strategyDescriptions: Record<string, string> = {
      cautious_incremental: "Resetting approach - taking smaller steps",
      pivot_strategy: "Resetting approach - trying different strategy",
      gather_information: "Resetting approach - gathering more context",
      change_approach: "Resetting approach - changing method",
      simplify_focus: "Resetting approach - simplifying focus",
      user_guided: "Resetting approach - awaiting guidance",
      general_reset: "Resetting approach",
    }
    return strategyDescriptions[strategy] || "Resetting approach"
  }

  /**
   * Generate full explanation (shown when user asks why)
   */
  function generateFullExplanation(
    incident: GroundingIncident,
    knowledge: GroundingIncident["knowledge"],
    strategy: string
  ): string {
    const lines: string[] = []
    
    lines.push("## Grounding Incident")
    lines.push("")
    lines.push(`**Trigger:** ${incident.trigger}`)
    lines.push(`**Reason:** ${knowledge.whatTriggeredIt}`)
    lines.push("")
    lines.push("### What Was Happening")
    lines.push(`- Anxiety: ${incident.emotionalStateBefore.anxietyLevel}% → ${incident.emotionalStateAfter.anxietyLevel}%`)
    lines.push(`- Confidence: ${incident.emotionalStateBefore.confidenceLevel}% → ${incident.emotionalStateAfter.confidenceLevel}%`)
    lines.push(`- Mood: ${incident.emotionalStateBefore.mood} → ${incident.emotionalStateAfter.mood}`)
    lines.push("")
    
    if (incident.emotionalStateBefore.topEmotions.length > 0) {
      lines.push("### Active Emotions")
      for (const e of incident.emotionalStateBefore.topEmotions) {
        lines.push(`- ${e.category} (${e.intensity}/10): ${e.trigger}`)
      }
      lines.push("")
    }
    
    lines.push("### Analysis")
    lines.push(`**What wasn't working:** ${knowledge.whatWasntWorking}`)
    lines.push("")
    lines.push("**Alternative approaches:**")
    for (const alt of knowledge.alternativeApproaches) {
      lines.push(`- ${alt}`)
    }
    lines.push("")
    lines.push(`**Recovery strategy:** ${strategy}`)
    
    return lines.join("\n")
  }

  // =============
  // Manual Grounding
  // =============

  /**
   * Manually trigger grounding (user-requested)
   */
  export async function manualGround(
    root: string,
    emotionalState: Emotions.EmotionalState,
    recentActions: string[] = []
  ): Promise<GroundingResult> {
    return ground(root, "manual", "User requested grounding", {
      emotionalState,
      recentActions,
      consecutiveFailures: 0,
    })
  }

  // =============
  // History
  // =============

  /**
   * Get grounding history
   */
  export async function getHistory(root: string, limit: number = 10): Promise<GroundingIncident[]> {
    const state = await read(root)
    if (!state) return []
    return state.incidents.slice(-limit).reverse()
  }

  /**
   * Get last grounding incident
   */
  export async function getLastIncident(root: string): Promise<GroundingIncident | null> {
    const state = await read(root)
    if (!state || state.incidents.length === 0) return null
    return state.incidents[state.incidents.length - 1]
  }

  // =============
  // Tracking Updates
  // =============

  /**
   * Record an action (for spin detection)
   */
  export async function recordAction(root: string, action: string): Promise<void> {
    const state = await getOrCreate(root)
    state.recentActions.push(action)
    if (state.recentActions.length > 20) {
      state.recentActions = state.recentActions.slice(-20)
    }
    await write(root, state)
  }

  /**
   * Record a failure (for frustration loop detection)
   */
  export async function recordFailure(root: string): Promise<void> {
    const state = await getOrCreate(root)
    state.consecutiveFailures++
    await write(root, state)
  }

  /**
   * Record a success (resets failure counter)
   */
  export async function recordSuccess(root: string): Promise<void> {
    const state = await getOrCreate(root)
    state.consecutiveFailures = 0
    await write(root, state)
  }
}
