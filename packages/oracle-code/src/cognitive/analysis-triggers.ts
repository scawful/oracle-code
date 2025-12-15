/**
 * Analysis Triggers Module
 *
 * Configurable repository of triggers that detect when analysis subagents
 * should be invoked based on cognitive, epistemic, and emotional state.
 *
 * Triggers can:
 * - Fire based on metacognition conditions (spinning, high load, etc.)
 * - Fire based on epistemic conditions (contradictions, unknowns)
 * - Fire based on emotional conditions (anxiety, low confidence)
 * - Fire based on action patterns (consecutive failures, edits without tests)
 * - Auto-accept or require user confirmation
 * - Have configurable cooldowns
 * - Suggest recording emotions as side effects
 *
 * Default triggers provide sensible starting points that users can customize.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { ulid } from "ulid"
import type { Metacognition } from "./metacognition"
import type { Epistemic } from "./epistemic"
import type { Emotions } from "./emotions"

export namespace AnalysisTriggers {
  // =============
  // Constants
  // =============

  const TRIGGERS_FILE = "analysis-triggers.json"

  function applyMetadata<T extends Record<string, unknown>>(obj: T): T {
    return {
      schema_version: "0.3",
      producer: { name: "oracle-code", version: "unknown" },
      last_updated: new Date().toISOString(),
      ...obj,
    } as T
  }

  // =============
  // Zod Schemas
  // =============

  export const AnalysisMode = z.enum(["none", "eval", "tom", "metrics", "critic", "emotional"])
  export type AnalysisMode = z.infer<typeof AnalysisMode>

  export const EmotionCategory = z.enum(["fear", "curiosity", "satisfaction", "frustration"])
  export type EmotionCategory = z.infer<typeof EmotionCategory>

  // Conditions that can trigger an analysis
  export const TriggerConditions = z.object({
    // Metacognition conditions
    isSpinning: z.boolean().optional(),
    cognitiveLoadAbove: z.number().min(0).max(100).optional(),
    frustrationAbove: z.number().min(0).max(100).optional(),
    notInFlowState: z.boolean().optional(),
    strategyEffectivenessBelow: z.number().min(0).max(100).optional(),

    // Epistemic conditions
    contradictionCount: z.number().min(1).optional(),
    criticalUnknowns: z.number().min(1).optional(),
    unvalidatedAssumptions: z.number().min(1).optional(),
    lowConfidenceFacts: z.number().min(1).optional(),

    // Emotional conditions
    anxietyAbove: z.number().min(0).max(100).optional(),
    confidenceBelow: z.number().min(0).max(100).optional(),
    recentFears: z.number().min(1).optional(),
    mood: z.array(z.string()).optional(),

    // Action patterns
    consecutiveFailures: z.number().min(1).optional(),
    consecutiveEditsWithoutTests: z.number().min(1).optional(),
    newFileTerritory: z.boolean().optional(),
    sameToolRepeated: z.number().min(2).optional(),
  })
  export type TriggerConditions = z.infer<typeof TriggerConditions>

  // Emotion to record as side effect
  export const EmotionToRecord = z.object({
    category: EmotionCategory,
    intensity: z.number().min(1).max(10),
    trigger: z.string(),
  })
  export type EmotionToRecord = z.infer<typeof EmotionToRecord>

  // What to do when trigger fires
  export const AnalysisSuggestion = z.object({
    analysisMode: AnalysisMode,
    subagentType: z.string().optional(), // e.g., "critic", "explore", "general"
    prompt: z.string().optional(), // Custom prompt for subagent
    emotionToRecord: EmotionToRecord.optional(),
  })
  export type AnalysisSuggestion = z.infer<typeof AnalysisSuggestion>

  // Individual trigger definition
  export const AnalysisTrigger = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean().default(true),
    conditions: TriggerConditions,
    suggestion: AnalysisSuggestion,
    autoAccept: z.boolean().default(false), // Skip confirmation if true
    priority: z.number().default(50), // Higher = evaluated first
    cooldownMinutes: z.number().default(15), // Don't re-trigger within this window
    lastTriggered: z.string().optional(),
  })
  export type AnalysisTrigger = z.infer<typeof AnalysisTrigger>

  // Full trigger repository state
  export const TriggerRepository = z.object({
    triggers: z.array(AnalysisTrigger),
    settings: z.object({
      globalEnabled: z.boolean().default(true),
      defaultCooldownMinutes: z.number().default(15),
    }),
    lastUpdated: z.string(),
  })
  export type TriggerRepository = z.infer<typeof TriggerRepository>

  // Result of trigger evaluation
  export interface TriggeredAnalysis {
    trigger: AnalysisTrigger
    matchedConditions: string[]
    timestamp: string
  }

  // Cognitive state snapshot for evaluation
  export interface CognitiveSnapshot {
    // Metacognition
    isSpinning?: boolean
    cognitiveLoad?: number
    frustration?: number
    inFlowState?: boolean
    strategyEffectiveness?: number

    // Epistemic
    contradictionCount?: number
    criticalUnknowns?: number
    unvalidatedAssumptions?: number
    lowConfidenceFacts?: number

    // Emotional
    anxietyLevel?: number
    confidenceLevel?: number
    recentFearCount?: number
    currentMood?: string

    // Action patterns
    consecutiveFailures?: number
    consecutiveEditsWithoutTests?: number
    isNewFileTerritory?: boolean
    sameToolRepeatedCount?: number
    recentFiles?: string[]
    knownFiles?: string[]
  }

  // =============
  // Events
  // =============

  export const Event = {
    TriggerFired: BusEvent.define(
      "analysis.trigger.fired",
      z.object({
        root: z.string(),
        triggerId: z.string(),
        triggerName: z.string(),
        matchedConditions: z.array(z.string()),
        autoAccepted: z.boolean(),
      }),
    ),
    TriggerUpdated: BusEvent.define(
      "analysis.trigger.updated",
      z.object({
        root: z.string(),
        triggerId: z.string(),
      }),
    ),
  }

  // =============
  // Default Triggers
  // =============

  export function getDefaultTriggers(): AnalysisTrigger[] {
    return [
      {
        id: "spinning-critic",
        name: "Spinning Detection",
        description: "Suggest critic review when spinning detected",
        enabled: true,
        conditions: { isSpinning: true },
        suggestion: {
          analysisMode: "critic",
          subagentType: "critic",
          prompt:
            "Review recent actions - we appear to be spinning. Identify what's going wrong and suggest a different approach.",
        },
        autoAccept: false,
        priority: 100,
        cooldownMinutes: 10,
      },
      {
        id: "edits-without-tests",
        name: "Edits Without Tests",
        description: "Suggest critic after multiple file edits without running tests",
        enabled: true,
        conditions: { consecutiveEditsWithoutTests: 3 },
        suggestion: {
          analysisMode: "critic",
          subagentType: "critic",
          prompt:
            "Review recent code changes for potential issues - no tests have been run. Look for bugs, edge cases, and missing error handling.",
          emotionToRecord: {
            category: "fear",
            intensity: 5,
            trigger: "Editing code without running tests",
          },
        },
        autoAccept: false,
        priority: 80,
        cooldownMinutes: 15,
      },
      {
        id: "new-territory-explore",
        name: "New File Territory",
        description: "Suggest exploration when entering unfamiliar code areas",
        enabled: true,
        conditions: { newFileTerritory: true, confidenceBelow: 50 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "explore",
          prompt: "Explore this area of the codebase to build understanding before making changes.",
          emotionToRecord: {
            category: "curiosity",
            intensity: 6,
            trigger: "Entering new code territory",
          },
        },
        autoAccept: false,
        priority: 60,
        cooldownMinutes: 20,
      },
      {
        id: "contradiction-debate",
        name: "Contradictions Detected",
        description: "Suggest evaluation when contradictions found in knowledge",
        enabled: true,
        conditions: { contradictionCount: 1 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "general",
          prompt:
            "Resolve contradictions in our understanding. Evaluate conflicting information and determine what's accurate.",
        },
        autoAccept: false,
        priority: 90,
        cooldownMinutes: 30,
      },
      {
        id: "high-anxiety-caution",
        name: "High Anxiety",
        description: "Suggest cautious approach when anxiety is elevated",
        enabled: true,
        conditions: { anxietyAbove: 70 },
        suggestion: {
          analysisMode: "critic",
          subagentType: "critic",
          prompt:
            "Review current approach - anxiety levels suggest potential issues. Identify risks and suggest mitigations.",
        },
        autoAccept: false,
        priority: 70,
        cooldownMinutes: 15,
      },
      {
        id: "consecutive-failures",
        name: "Consecutive Failures",
        description: "Record frustration after repeated failures",
        enabled: true,
        conditions: { consecutiveFailures: 3 },
        suggestion: {
          analysisMode: "none", // Just record emotion, don't spawn subagent
          emotionToRecord: {
            category: "frustration",
            intensity: 6,
            trigger: "Repeated tool failures",
          },
        },
        autoAccept: true, // Auto-accept since it just records emotion
        priority: 75,
        cooldownMinutes: 5,
      },
      {
        id: "critical-unknowns",
        name: "Critical Unknowns",
        description: "Suggest research when critical unknowns exist",
        enabled: true,
        conditions: { criticalUnknowns: 1 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "explore",
          prompt: "Research critical unknowns before proceeding. Gather information needed to make informed decisions.",
        },
        autoAccept: false,
        priority: 85,
        cooldownMinutes: 20,
      },
      {
        id: "high-cognitive-load",
        name: "High Cognitive Load",
        description: "Suggest breaking down task when cognitive load is high",
        enabled: true,
        conditions: { cognitiveLoadAbove: 80 },
        suggestion: {
          analysisMode: "eval",
          prompt: "Cognitive load is high. Consider breaking the current task into smaller steps.",
        },
        autoAccept: false,
        priority: 65,
        cooldownMinutes: 20,
      },
      {
        id: "low-strategy-effectiveness",
        name: "Low Strategy Effectiveness",
        description: "Suggest strategy change when current approach isn't working",
        enabled: true,
        conditions: { strategyEffectivenessBelow: 30 },
        suggestion: {
          analysisMode: "eval",
          prompt: "Current strategy has low effectiveness. Consider switching to a different approach.",
          emotionToRecord: {
            category: "frustration",
            intensity: 4,
            trigger: "Strategy not working well",
          },
        },
        autoAccept: false,
        priority: 55,
        cooldownMinutes: 25,
      },
      {
        id: "tool-repetition",
        name: "Tool Repetition",
        description: "Note when same tool is used repeatedly",
        enabled: true,
        conditions: { sameToolRepeated: 5 },
        suggestion: {
          analysisMode: "none",
          emotionToRecord: {
            category: "curiosity",
            intensity: 4,
            trigger: "Repeated use of same tool - possible automation opportunity",
          },
        },
        autoAccept: true,
        priority: 40,
        cooldownMinutes: 30,
      },
      // Auto-spawn explore for research tasks
      {
        id: "auto-explore-unknowns",
        name: "Auto Explore Unknowns",
        description: "Automatically spawn explore agent when critical unknowns exist",
        enabled: true,
        conditions: { criticalUnknowns: 2, confidenceBelow: 40 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "explore",
          prompt: "Multiple critical unknowns with low confidence. Research the codebase to fill knowledge gaps.",
        },
        autoAccept: true, // Auto-spawn for research
        priority: 88,
        cooldownMinutes: 15,
      },
      // Auto-spawn critic for risky edits
      {
        id: "auto-critic-risky-edits",
        name: "Auto Critic Risky Edits",
        description: "Automatically spawn critic for edits in critical files without tests",
        enabled: true,
        conditions: { consecutiveEditsWithoutTests: 5, anxietyAbove: 50 },
        suggestion: {
          analysisMode: "critic",
          subagentType: "critic",
          prompt: "Multiple untested edits with elevated anxiety. Review code for potential issues before continuing.",
        },
        autoAccept: true, // Auto-spawn to catch issues early
        priority: 82,
        cooldownMinutes: 20,
      },
      // Suggest security review for sensitive operations
      {
        id: "security-review",
        name: "Security Review",
        description: "Suggest security review when working with sensitive code",
        enabled: true,
        conditions: { newFileTerritory: true, unvalidatedAssumptions: 2 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "security",
          prompt: "New territory with unvalidated assumptions. Consider security implications of proposed changes.",
        },
        autoAccept: false,
        priority: 75,
        cooldownMinutes: 30,
      },
      // Test agent for coverage gaps
      {
        id: "test-coverage-gap",
        name: "Test Coverage Gap",
        description: "Suggest test agent when changes lack test coverage",
        enabled: true,
        conditions: { consecutiveEditsWithoutTests: 4 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "test",
          prompt: "Multiple file edits without tests. Spawn test agent to write tests for recent changes.",
        },
        autoAccept: false,
        priority: 70,
        cooldownMinutes: 25,
      },
      // Low confidence needs exploration
      {
        id: "low-confidence-explore",
        name: "Low Confidence Exploration",
        description: "Suggest exploration when confidence is very low",
        enabled: true,
        conditions: { confidenceBelow: 30 },
        suggestion: {
          analysisMode: "eval",
          subagentType: "explore",
          prompt: "Confidence is very low. Spawn explore agent to gather more information about the current task.",
          emotionToRecord: {
            category: "curiosity",
            intensity: 5,
            trigger: "Low confidence triggering exploration",
          },
        },
        autoAccept: false,
        priority: 68,
        cooldownMinutes: 15,
      },
    ]
  }

  // =============
  // File Operations
  // =============

  function getFilePath(root: string): string {
    return path.join(root, "scratchpad", TRIGGERS_FILE)
  }

  function createEmptyRepository(): TriggerRepository {
    return {
      triggers: getDefaultTriggers(),
      settings: {
        globalEnabled: true,
        defaultCooldownMinutes: 15,
      },
      lastUpdated: new Date().toISOString(),
    }
  }

  export async function read(root: string): Promise<TriggerRepository | null> {
    try {
      const filePath = getFilePath(root)
      const content = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(content)
      return TriggerRepository.parse(data)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  export async function write(root: string, repo: TriggerRepository): Promise<void> {
    const filePath = getFilePath(root)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    repo.lastUpdated = new Date().toISOString()
    const withMeta = applyMetadata(repo)
    await fs.writeFile(filePath, JSON.stringify(withMeta, null, 2))
  }

  async function getOrCreate(root: string): Promise<TriggerRepository> {
    const existing = await read(root)
    if (existing) return existing
    const empty = createEmptyRepository()
    await write(root, empty)
    return empty
  }

  // =============
  // CRUD Operations
  // =============

  /**
   * Get all triggers
   */
  export async function getTriggers(root: string): Promise<AnalysisTrigger[]> {
    const repo = await getOrCreate(root)
    return [...repo.triggers].sort((a, b) => b.priority - a.priority)
  }

  /**
   * Get a specific trigger by ID
   */
  export async function getTrigger(root: string, triggerId: string): Promise<AnalysisTrigger | null> {
    const repo = await read(root)
    if (!repo) return null
    return repo.triggers.find((t) => t.id === triggerId) || null
  }

  /**
   * Update a trigger
   */
  export async function updateTrigger(
    root: string,
    triggerId: string,
    updates: Partial<Omit<AnalysisTrigger, "id">>,
  ): Promise<boolean> {
    const repo = await getOrCreate(root)
    const index = repo.triggers.findIndex((t) => t.id === triggerId)
    if (index === -1) return false

    repo.triggers[index] = { ...repo.triggers[index], ...updates }
    await write(root, repo)
    Bus.publish(Event.TriggerUpdated, { root, triggerId })
    return true
  }

  /**
   * Enable a trigger
   */
  export async function enableTrigger(root: string, triggerId: string): Promise<boolean> {
    return updateTrigger(root, triggerId, { enabled: true })
  }

  /**
   * Disable a trigger
   */
  export async function disableTrigger(root: string, triggerId: string): Promise<boolean> {
    return updateTrigger(root, triggerId, { enabled: false })
  }

  /**
   * Add a custom trigger
   */
  export async function addTrigger(root: string, trigger: Omit<AnalysisTrigger, "id">): Promise<AnalysisTrigger> {
    const repo = await getOrCreate(root)
    const newTrigger: AnalysisTrigger = {
      ...trigger,
      id: ulid(),
    }
    repo.triggers.push(newTrigger)
    await write(root, repo)
    return newTrigger
  }

  /**
   * Remove a trigger
   */
  export async function removeTrigger(root: string, triggerId: string): Promise<boolean> {
    const repo = await getOrCreate(root)
    const index = repo.triggers.findIndex((t) => t.id === triggerId)
    if (index === -1) return false

    repo.triggers.splice(index, 1)
    await write(root, repo)
    return true
  }

  /**
   * Reset triggers to defaults
   */
  export async function resetToDefaults(root: string): Promise<void> {
    const repo = await getOrCreate(root)
    repo.triggers = getDefaultTriggers()
    await write(root, repo)
  }

  /**
   * Set trigger cooldown
   */
  export async function setCooldown(root: string, triggerId: string, cooldownMinutes: number): Promise<boolean> {
    return updateTrigger(root, triggerId, { cooldownMinutes })
  }

  /**
   * Set trigger auto-accept mode
   */
  export async function setAutoAccept(root: string, triggerId: string, autoAccept: boolean): Promise<boolean> {
    return updateTrigger(root, triggerId, { autoAccept })
  }

  // =============
  // Evaluation Logic
  // =============

  /**
   * Check if a trigger is in cooldown
   */
  function isInCooldown(trigger: AnalysisTrigger, now: Date): boolean {
    if (!trigger.lastTriggered) return false
    const lastTriggered = new Date(trigger.lastTriggered)
    const cooldownMs = trigger.cooldownMinutes * 60 * 1000
    return now.getTime() - lastTriggered.getTime() < cooldownMs
  }

  /**
   * Check if conditions are met for a trigger
   */
  function checkConditions(
    conditions: TriggerConditions,
    state: CognitiveSnapshot,
  ): { met: boolean; matched: string[] } {
    const matched: string[] = []

    // Metacognition conditions
    if (conditions.isSpinning !== undefined && state.isSpinning === conditions.isSpinning) {
      matched.push("isSpinning")
    }
    if (
      conditions.cognitiveLoadAbove !== undefined &&
      state.cognitiveLoad !== undefined &&
      state.cognitiveLoad > conditions.cognitiveLoadAbove
    ) {
      matched.push(`cognitiveLoad > ${conditions.cognitiveLoadAbove}`)
    }
    if (
      conditions.frustrationAbove !== undefined &&
      state.frustration !== undefined &&
      state.frustration > conditions.frustrationAbove
    ) {
      matched.push(`frustration > ${conditions.frustrationAbove}`)
    }
    if (conditions.notInFlowState !== undefined && state.inFlowState === false) {
      matched.push("notInFlowState")
    }
    if (
      conditions.strategyEffectivenessBelow !== undefined &&
      state.strategyEffectiveness !== undefined &&
      state.strategyEffectiveness < conditions.strategyEffectivenessBelow
    ) {
      matched.push(`strategyEffectiveness < ${conditions.strategyEffectivenessBelow}`)
    }

    // Epistemic conditions
    if (
      conditions.contradictionCount !== undefined &&
      state.contradictionCount !== undefined &&
      state.contradictionCount >= conditions.contradictionCount
    ) {
      matched.push(`contradictions >= ${conditions.contradictionCount}`)
    }
    if (
      conditions.criticalUnknowns !== undefined &&
      state.criticalUnknowns !== undefined &&
      state.criticalUnknowns >= conditions.criticalUnknowns
    ) {
      matched.push(`criticalUnknowns >= ${conditions.criticalUnknowns}`)
    }
    if (
      conditions.unvalidatedAssumptions !== undefined &&
      state.unvalidatedAssumptions !== undefined &&
      state.unvalidatedAssumptions >= conditions.unvalidatedAssumptions
    ) {
      matched.push(`unvalidatedAssumptions >= ${conditions.unvalidatedAssumptions}`)
    }

    // Emotional conditions
    if (
      conditions.anxietyAbove !== undefined &&
      state.anxietyLevel !== undefined &&
      state.anxietyLevel > conditions.anxietyAbove
    ) {
      matched.push(`anxiety > ${conditions.anxietyAbove}`)
    }
    if (
      conditions.confidenceBelow !== undefined &&
      state.confidenceLevel !== undefined &&
      state.confidenceLevel < conditions.confidenceBelow
    ) {
      matched.push(`confidence < ${conditions.confidenceBelow}`)
    }
    if (
      conditions.recentFears !== undefined &&
      state.recentFearCount !== undefined &&
      state.recentFearCount >= conditions.recentFears
    ) {
      matched.push(`recentFears >= ${conditions.recentFears}`)
    }
    if (
      conditions.mood !== undefined &&
      state.currentMood !== undefined &&
      conditions.mood.includes(state.currentMood)
    ) {
      matched.push(`mood in [${conditions.mood.join(", ")}]`)
    }

    // Action patterns
    if (
      conditions.consecutiveFailures !== undefined &&
      state.consecutiveFailures !== undefined &&
      state.consecutiveFailures >= conditions.consecutiveFailures
    ) {
      matched.push(`consecutiveFailures >= ${conditions.consecutiveFailures}`)
    }
    if (
      conditions.consecutiveEditsWithoutTests !== undefined &&
      state.consecutiveEditsWithoutTests !== undefined &&
      state.consecutiveEditsWithoutTests >= conditions.consecutiveEditsWithoutTests
    ) {
      matched.push(`editsWithoutTests >= ${conditions.consecutiveEditsWithoutTests}`)
    }
    if (conditions.newFileTerritory !== undefined && state.isNewFileTerritory === conditions.newFileTerritory) {
      matched.push("newFileTerritory")
    }
    if (
      conditions.sameToolRepeated !== undefined &&
      state.sameToolRepeatedCount !== undefined &&
      state.sameToolRepeatedCount >= conditions.sameToolRepeated
    ) {
      matched.push(`sameToolRepeated >= ${conditions.sameToolRepeated}`)
    }

    // All specified conditions must be matched
    const conditionCount = Object.keys(conditions).filter(
      (k) => conditions[k as keyof TriggerConditions] !== undefined,
    ).length

    return {
      met: matched.length === conditionCount && conditionCount > 0,
      matched,
    }
  }

  /**
   * Evaluate all triggers against current state
   * Returns triggered analyses sorted by priority
   */
  export async function evaluateTriggers(root: string, state: CognitiveSnapshot): Promise<TriggeredAnalysis[]> {
    const repo = await getOrCreate(root)
    if (!repo.settings.globalEnabled) return []

    const now = new Date()
    const triggered: TriggeredAnalysis[] = []

    // Sort by priority (highest first)
    const sortedTriggers = [...repo.triggers].sort((a, b) => b.priority - a.priority)

    for (const trigger of sortedTriggers) {
      if (!trigger.enabled) continue
      if (isInCooldown(trigger, now)) continue

      const { met, matched } = checkConditions(trigger.conditions, state)
      if (met) {
        triggered.push({
          trigger,
          matchedConditions: matched,
          timestamp: now.toISOString(),
        })
      }
    }

    return triggered
  }

  /**
   * Record that a trigger was fired (updates lastTriggered)
   */
  export async function recordTriggerFired(
    root: string,
    triggerId: string,
    autoAccepted: boolean = false,
  ): Promise<void> {
    const repo = await getOrCreate(root)
    const trigger = repo.triggers.find((t) => t.id === triggerId)
    if (!trigger) return

    trigger.lastTriggered = new Date().toISOString()
    await write(root, repo)

    Bus.publish(Event.TriggerFired, {
      root,
      triggerId,
      triggerName: trigger.name,
      matchedConditions: [], // Not tracking here
      autoAccepted,
    })
  }

  // =============
  // Pattern Detection Helpers
  // =============

  /**
   * Count consecutive failures in recent actions
   */
  export function countConsecutiveFailures(recentActions: Array<{ success: boolean }>): number {
    let count = 0
    for (let i = recentActions.length - 1; i >= 0; i--) {
      if (!recentActions[i].success) {
        count++
      } else {
        break
      }
    }
    return count
  }

  /**
   * Count consecutive edits without test runs
   */
  export function countEditsWithoutTests(recentActions: Array<{ tool: string; success: boolean }>): number {
    let editCount = 0
    for (let i = recentActions.length - 1; i >= 0; i--) {
      const action = recentActions[i]
      if (action.tool === "edit" || action.tool === "write") {
        editCount++
      } else if (
        action.tool === "bash" &&
        action.success
        // Would need to check if it was a test command
      ) {
        break
      }
    }
    return editCount
  }

  /**
   * Check if current file is in known files list
   */
  export function isNewFileTerritory(currentFile: string | undefined, knownFiles: string[]): boolean {
    if (!currentFile) return false
    return !knownFiles.some((known) => currentFile.includes(known) || known.includes(currentFile))
  }

  /**
   * Count how many times the same tool was used consecutively
   */
  export function countSameToolRepeated(recentActions: Array<{ tool: string }>): number {
    if (recentActions.length === 0) return 0

    const lastTool = recentActions[recentActions.length - 1].tool
    let count = 0

    for (let i = recentActions.length - 1; i >= 0; i--) {
      if (recentActions[i].tool === lastTool) {
        count++
      } else {
        break
      }
    }

    return count
  }

  // =============
  // Settings
  // =============

  /**
   * Get trigger settings
   */
  export async function getSettings(root: string): Promise<TriggerRepository["settings"]> {
    const repo = await getOrCreate(root)
    return repo.settings
  }

  /**
   * Update trigger settings
   */
  export async function updateSettings(root: string, updates: Partial<TriggerRepository["settings"]>): Promise<void> {
    const repo = await getOrCreate(root)
    repo.settings = { ...repo.settings, ...updates }
    await write(root, repo)
  }

  /**
   * Enable/disable all triggers globally
   */
  export async function setGlobalEnabled(root: string, enabled: boolean): Promise<void> {
    await updateSettings(root, { globalEnabled: enabled })
  }
}
