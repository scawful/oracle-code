/**
 * Emotional Valence Module
 *
 * Tracks the agent's emotional state across sessions with decay over time.
 * Emotions influence decision-making, strategy selection, and analysis triggers.
 *
 * Categories:
 * - Fears: Things that went wrong before (slow decay, persistent)
 * - Curiosities: Things worth exploring (faster decay)
 * - Satisfactions: Approaches that worked well (moderate decay)
 * - Frustrations: Recurring friction points (moderate decay)
 *
 * Session state includes mood, anxiety, and confidence levels that reset
 * at session start but can be influenced by emotions and tool outcomes.
 *
 * Cross-references: Emotions can reference related emotions (e.g., fear → satisfaction
 * when the feared outcome was successfully avoided), making patterns easily searchable.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { ulid } from "ulid"

export namespace Emotions {
  // =============
  // Constants
  // =============

  const EMOTIONS_FILE = "emotions.json"
  const MEMORY_EMOTIONS_FILE = "emotions.json"

  // Default decay rates per hour (lower = slower decay)
  const DEFAULT_DECAY_RATES = {
    fear: 0.02, // Fears decay very slowly
    curiosity: 0.1, // Curiosities decay faster
    satisfaction: 0.05, // Satisfactions decay moderately
    frustration: 0.08, // Frustrations decay moderately
  }

  // Default prune thresholds (remove when intensity drops below)
  const DEFAULT_PRUNE_THRESHOLDS = {
    fear: 1, // Keep fears longer
    curiosity: 2,
    satisfaction: 1,
    frustration: 2,
  }

  // =============
  // Zod Schemas
  // =============

  export const EmotionCategory = z.enum(["fear", "curiosity", "satisfaction", "frustration"])
  export type EmotionCategory = z.infer<typeof EmotionCategory>

  export const Mood = z.enum([
    "positive",
    "neutral",
    "negative",
    "anxious",
    "confident",
    "frustrated",
    "curious",
  ])
  export type Mood = z.infer<typeof Mood>

  // Individual emotion entry
  export const EmotionEntry = z.object({
    id: z.string(),
    category: EmotionCategory,
    trigger: z.string(), // What caused this emotion
    context: z.string(), // Situational context
    intensity: z.number().min(1).max(10), // 1-10 scale, heuristic + user adjustable
    outcome: z.string().optional(), // What happened after
    mitigation: z.string().optional(), // How to address (for fears/frustrations)
    timestamp: z.string(),
    sessionId: z.string().optional(),
    relatedFiles: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),

    // Decay tracking
    lastAccessed: z.string(),
    accessCount: z.number().default(0),
    decayRate: z.number().min(0).max(1),

    // Cross-reference for fear→satisfaction tracking
    relatedEmotionIds: z.array(z.string()).optional(),
  })
  export type EmotionEntry = z.infer<typeof EmotionEntry>

  // Mood history entry
  export const MoodHistoryEntry = z.object({
    mood: Mood,
    timestamp: z.string(),
    trigger: z.string().optional(),
  })
  export type MoodHistoryEntry = z.infer<typeof MoodHistoryEntry>

  // Session-scoped emotional context (resets at session start)
  export const SessionEmotions = z.object({
    mood: Mood.default("neutral"),
    anxietyLevel: z.number().min(0).max(100).default(30),
    confidenceLevel: z.number().min(0).max(100).default(50),
    recentEmotions: z.array(z.string()).default([]), // IDs of recent emotions this session
    moodHistory: z.array(MoodHistoryEntry).default([]),
  })
  export type SessionEmotions = z.infer<typeof SessionEmotions>

  // Settings schema
  export const EmotionalSettings = z.object({
    enableAutoDetection: z.boolean().default(true),
    anxietyThreshold: z.number().min(0).max(100).default(70), // When to suggest caution
    confidenceThreshold: z.number().min(0).max(100).default(60), // When to allow autonomy
    maxPerCategory: z.number().default(50),

    // Decay rates per hour
    decayRates: z
      .object({
        fear: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.fear),
        curiosity: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.curiosity),
        satisfaction: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.satisfaction),
        frustration: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.frustration),
      })
      .default(DEFAULT_DECAY_RATES),

    // Prune thresholds
    pruneThresholds: z
      .object({
        fear: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.fear),
        curiosity: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.curiosity),
        satisfaction: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.satisfaction),
        frustration: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.frustration),
      })
      .default(DEFAULT_PRUNE_THRESHOLDS),

    // Max mood history entries
    maxMoodHistory: z.number().default(50),
  })
  export type EmotionalSettings = z.infer<typeof EmotionalSettings>

  // Full emotional state
  export const EmotionalState = z.object({
    session: SessionEmotions,
    fears: z.record(z.string(), EmotionEntry).default({}),
    curiosities: z.record(z.string(), EmotionEntry).default({}),
    satisfactions: z.record(z.string(), EmotionEntry).default({}),
    frustrations: z.record(z.string(), EmotionEntry).default({}),
    settings: EmotionalSettings,
    lastUpdated: z.string(),
    lastDecayCheck: z.string(),
  })
  export type EmotionalState = z.infer<typeof EmotionalState>

  // Summary for UI/prompts
  export interface EmotionalSummary {
    mood: Mood
    anxietyLevel: number
    confidenceLevel: number
    fearCount: number
    curiosityCount: number
    satisfactionCount: number
    frustrationCount: number
    recentEmotionCount: number
    isAnxious: boolean
    isConfident: boolean
    hasData: boolean
  }

  // Emotion suggestion from detection heuristics
  export interface EmotionSuggestion {
    category: EmotionCategory
    trigger: string
    context: string
    intensity: number
    tags?: string[]
    relatedFiles?: string[]
  }

  // =============
  // Events
  // =============

  export const Event = {
    Updated: BusEvent.define(
      "emotions.updated",
      z.object({
        root: z.string(),
        category: EmotionCategory.optional(),
        emotionId: z.string().optional(),
      })
    ),
    MoodChanged: BusEvent.define(
      "emotions.mood.changed",
      z.object({
        root: z.string(),
        previousMood: Mood,
        newMood: Mood,
        trigger: z.string().optional(),
      })
    ),
    ThresholdCrossed: BusEvent.define(
      "emotions.threshold.crossed",
      z.object({
        root: z.string(),
        metric: z.enum(["anxiety", "confidence"]),
        direction: z.enum(["above", "below"]),
        value: z.number(),
        threshold: z.number(),
      })
    ),
  }

  // =============
  // File Operations
  // =============

  function getScratchpadPath(root: string): string {
    return path.join(root, "scratchpad", EMOTIONS_FILE)
  }

  function getMemoryPath(root: string): string {
    return path.join(root, "memory", MEMORY_EMOTIONS_FILE)
  }

  function createEmptyState(): EmotionalState {
    const now = new Date().toISOString()
    return {
      session: SessionEmotions.parse({}),
      fears: {},
      curiosities: {},
      satisfactions: {},
      frustrations: {},
      settings: EmotionalSettings.parse({}),
      lastUpdated: now,
      lastDecayCheck: now,
    }
  }

  export async function read(root: string): Promise<EmotionalState | null> {
    try {
      const filePath = getScratchpadPath(root)
      const content = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(content)
      return EmotionalState.parse(data)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  export async function write(root: string, state: EmotionalState): Promise<void> {
    const filePath = getScratchpadPath(root)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    state.lastUpdated = new Date().toISOString()
    await fs.writeFile(filePath, JSON.stringify(state, null, 2))
    Bus.publish(Event.Updated, { root })
  }

  async function getOrCreate(root: string): Promise<EmotionalState> {
    const existing = await read(root)
    if (existing) return existing
    const empty = createEmptyState()
    await write(root, empty)
    return empty
  }

  // =============
  // Category Helpers
  // =============

  function getCategoryStore(
    state: EmotionalState,
    category: EmotionCategory
  ): Record<string, EmotionEntry> {
    switch (category) {
      case "fear":
        return state.fears
      case "curiosity":
        return state.curiosities
      case "satisfaction":
        return state.satisfactions
      case "frustration":
        return state.frustrations
    }
  }

  function setCategoryStore(
    state: EmotionalState,
    category: EmotionCategory,
    store: Record<string, EmotionEntry>
  ): void {
    switch (category) {
      case "fear":
        state.fears = store
        break
      case "curiosity":
        state.curiosities = store
        break
      case "satisfaction":
        state.satisfactions = store
        break
      case "frustration":
        state.frustrations = store
        break
    }
  }

  // =============
  // CRUD Operations
  // =============

  /**
   * Add a new emotion entry
   */
  export async function addEmotion(
    root: string,
    category: EmotionCategory,
    trigger: string,
    context: string,
    intensity: number,
    options: {
      outcome?: string
      mitigation?: string
      sessionId?: string
      relatedFiles?: string[]
      tags?: string[]
      relatedEmotionIds?: string[]
    } = {}
  ): Promise<EmotionEntry> {
    const state = await getOrCreate(root)
    const now = new Date().toISOString()

    const entry: EmotionEntry = {
      id: ulid(),
      category,
      trigger,
      context,
      intensity: Math.max(1, Math.min(10, intensity)),
      outcome: options.outcome,
      mitigation: options.mitigation,
      timestamp: now,
      sessionId: options.sessionId,
      relatedFiles: options.relatedFiles,
      tags: options.tags,
      lastAccessed: now,
      accessCount: 0,
      decayRate: state.settings.decayRates[category],
      relatedEmotionIds: options.relatedEmotionIds,
    }

    const store = getCategoryStore(state, category)

    // Check max per category, remove oldest if exceeded
    const entries = Object.values(store)
    if (entries.length >= state.settings.maxPerCategory) {
      // Sort by lastAccessed, remove oldest
      entries.sort((a, b) => a.lastAccessed.localeCompare(b.lastAccessed))
      const toRemove = entries.slice(0, entries.length - state.settings.maxPerCategory + 1)
      for (const e of toRemove) {
        delete store[e.id]
      }
    }

    store[entry.id] = entry

    // Add to recent emotions for this session
    state.session.recentEmotions.push(entry.id)
    if (state.session.recentEmotions.length > 20) {
      state.session.recentEmotions = state.session.recentEmotions.slice(-20)
    }

    await write(root, state)
    Bus.publish(Event.Updated, { root, category, emotionId: entry.id })

    return entry
  }

  /**
   * Update an emotion's intensity (user override)
   */
  export async function updateEmotionIntensity(
    root: string,
    emotionId: string,
    intensity: number
  ): Promise<boolean> {
    const state = await getOrCreate(root)

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      if (store[emotionId]) {
        store[emotionId].intensity = Math.max(1, Math.min(10, intensity))
        store[emotionId].lastAccessed = new Date().toISOString()
        store[emotionId].accessCount++
        await write(root, state)
        return true
      }
    }

    return false
  }

  /**
   * Remove an emotion
   */
  export async function removeEmotion(root: string, emotionId: string): Promise<boolean> {
    const state = await getOrCreate(root)

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      if (store[emotionId]) {
        delete store[emotionId]
        state.session.recentEmotions = state.session.recentEmotions.filter((id) => id !== emotionId)
        await write(root, state)
        return true
      }
    }

    return false
  }

  /**
   * Get an emotion by ID
   */
  export async function getEmotion(root: string, emotionId: string): Promise<EmotionEntry | null> {
    const state = await read(root)
    if (!state) return null

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      if (store[emotionId]) {
        return store[emotionId]
      }
    }

    return null
  }

  /**
   * Get all emotions by category
   */
  export async function getEmotionsByCategory(
    root: string,
    category: EmotionCategory
  ): Promise<EmotionEntry[]> {
    const state = await read(root)
    if (!state) return []
    return Object.values(getCategoryStore(state, category)).sort(
      (a, b) => b.intensity - a.intensity
    )
  }

  /**
   * Get recent emotions (most recent first)
   */
  export async function getRecentEmotions(root: string, limit: number = 10): Promise<EmotionEntry[]> {
    const state = await read(root)
    if (!state) return []

    const all: EmotionEntry[] = [
      ...Object.values(state.fears),
      ...Object.values(state.curiosities),
      ...Object.values(state.satisfactions),
      ...Object.values(state.frustrations),
    ]

    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  }

  /**
   * Access an emotion (resets decay timer)
   */
  export async function accessEmotion(root: string, emotionId: string): Promise<boolean> {
    const state = await getOrCreate(root)

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      if (store[emotionId]) {
        store[emotionId].lastAccessed = new Date().toISOString()
        store[emotionId].accessCount++
        await write(root, state)
        return true
      }
    }

    return false
  }

  /**
   * Link emotions (e.g., fear → satisfaction when fear was avoided)
   */
  export async function linkEmotions(
    root: string,
    sourceId: string,
    targetId: string
  ): Promise<boolean> {
    const state = await getOrCreate(root)

    let sourceFound = false
    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      if (store[sourceId]) {
        if (!store[sourceId].relatedEmotionIds) {
          store[sourceId].relatedEmotionIds = []
        }
        if (!store[sourceId].relatedEmotionIds.includes(targetId)) {
          store[sourceId].relatedEmotionIds.push(targetId)
        }
        sourceFound = true
        break
      }
    }

    if (sourceFound) {
      await write(root, state)
      return true
    }

    return false
  }

  // =============
  // Session Management
  // =============

  /**
   * Update the current mood
   */
  export async function updateMood(root: string, mood: Mood, trigger?: string): Promise<void> {
    const state = await getOrCreate(root)
    const previousMood = state.session.mood

    if (previousMood !== mood) {
      state.session.mood = mood
      state.session.moodHistory.push({
        mood,
        timestamp: new Date().toISOString(),
        trigger,
      })

      // Trim mood history
      if (state.session.moodHistory.length > state.settings.maxMoodHistory) {
        state.session.moodHistory = state.session.moodHistory.slice(-state.settings.maxMoodHistory)
      }

      await write(root, state)
      Bus.publish(Event.MoodChanged, { root, previousMood, newMood: mood, trigger })
    }
  }

  /**
   * Adjust anxiety level
   */
  export async function adjustAnxiety(root: string, delta: number): Promise<number> {
    const state = await getOrCreate(root)
    const previousLevel = state.session.anxietyLevel
    state.session.anxietyLevel = Math.max(0, Math.min(100, state.session.anxietyLevel + delta))

    // Check threshold crossing
    const threshold = state.settings.anxietyThreshold
    if (previousLevel < threshold && state.session.anxietyLevel >= threshold) {
      Bus.publish(Event.ThresholdCrossed, {
        root,
        metric: "anxiety",
        direction: "above",
        value: state.session.anxietyLevel,
        threshold,
      })
    } else if (previousLevel >= threshold && state.session.anxietyLevel < threshold) {
      Bus.publish(Event.ThresholdCrossed, {
        root,
        metric: "anxiety",
        direction: "below",
        value: state.session.anxietyLevel,
        threshold,
      })
    }

    // Auto-update mood based on anxiety
    if (state.session.anxietyLevel >= 70 && state.session.mood !== "anxious") {
      state.session.mood = "anxious"
      state.session.moodHistory.push({
        mood: "anxious",
        timestamp: new Date().toISOString(),
        trigger: "High anxiety level",
      })
    }

    await write(root, state)
    return state.session.anxietyLevel
  }

  /**
   * Adjust confidence level
   */
  export async function adjustConfidence(root: string, delta: number): Promise<number> {
    const state = await getOrCreate(root)
    const previousLevel = state.session.confidenceLevel
    state.session.confidenceLevel = Math.max(0, Math.min(100, state.session.confidenceLevel + delta))

    // Check threshold crossing
    const threshold = state.settings.confidenceThreshold
    if (previousLevel < threshold && state.session.confidenceLevel >= threshold) {
      Bus.publish(Event.ThresholdCrossed, {
        root,
        metric: "confidence",
        direction: "above",
        value: state.session.confidenceLevel,
        threshold,
      })
    } else if (previousLevel >= threshold && state.session.confidenceLevel < threshold) {
      Bus.publish(Event.ThresholdCrossed, {
        root,
        metric: "confidence",
        direction: "below",
        value: state.session.confidenceLevel,
        threshold,
      })
    }

    // Auto-update mood based on confidence
    if (state.session.confidenceLevel >= 75 && state.session.mood !== "confident") {
      state.session.mood = "confident"
      state.session.moodHistory.push({
        mood: "confident",
        timestamp: new Date().toISOString(),
        trigger: "High confidence level",
      })
    }

    await write(root, state)
    return state.session.confidenceLevel
  }

  /**
   * Reset session emotions (called at session start)
   */
  export async function resetSessionEmotions(root: string): Promise<void> {
    const state = await getOrCreate(root)
    state.session = SessionEmotions.parse({})
    await write(root, state)
  }

  /**
   * Get mood history
   */
  export async function getMoodHistory(root: string): Promise<MoodHistoryEntry[]> {
    const state = await read(root)
    if (!state) return []
    return [...state.session.moodHistory].reverse()
  }

  // =============
  // Decay & Pruning
  // =============

  /**
   * Apply decay to all emotions (call at turn boundaries)
   * Returns count of pruned emotions
   */
  export async function applyDecay(root: string): Promise<{ pruned: number; decayed: number }> {
    const state = await getOrCreate(root)
    const now = new Date()
    const lastCheck = new Date(state.lastDecayCheck)
    const hoursSinceLastCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60)

    if (hoursSinceLastCheck < 0.01) {
      // Less than ~36 seconds, skip
      return { pruned: 0, decayed: 0 }
    }

    let pruned = 0
    let decayed = 0

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      const threshold = state.settings.pruneThresholds[category]

      for (const [id, emotion] of Object.entries(store)) {
        // Calculate decay based on time since last access
        const lastAccess = new Date(emotion.lastAccessed)
        const hoursSinceAccess = (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60)
        const decay = emotion.decayRate * hoursSinceAccess

        if (decay > 0) {
          emotion.intensity = Math.max(0, emotion.intensity - decay)
          decayed++
        }

        // Prune if below threshold
        if (emotion.intensity < threshold) {
          delete store[id]
          pruned++
        }
      }
    }

    state.lastDecayCheck = now.toISOString()
    await write(root, state)

    return { pruned, decayed }
  }

  // =============
  // Detection Heuristics
  // =============

  /**
   * Detect emotion suggestion from tool result
   */
  export function detectEmotionFromToolResult(
    toolName: string,
    success: boolean,
    context: {
      input?: unknown
      output?: string
      duration?: number
      consecutiveFailures?: number
      consecutiveSuccesses?: number
    }
  ): EmotionSuggestion | null {
    // Failure patterns
    if (!success) {
      if ((context.consecutiveFailures || 0) >= 3) {
        return {
          category: "frustration",
          trigger: `Repeated failures with ${toolName}`,
          context: `${context.consecutiveFailures} consecutive failures`,
          intensity: Math.min(8, 4 + (context.consecutiveFailures || 0)),
          tags: ["tool_failure", toolName],
        }
      }
      return null
    }

    // Success patterns
    if ((context.consecutiveSuccesses || 0) >= 5) {
      return {
        category: "satisfaction",
        trigger: `Successful streak with ${toolName}`,
        context: `${context.consecutiveSuccesses} consecutive successes`,
        intensity: Math.min(7, 3 + Math.floor((context.consecutiveSuccesses || 0) / 2)),
        tags: ["tool_success", toolName],
      }
    }

    return null
  }

  /**
   * Detect emotion from action patterns
   */
  export function detectEmotionFromPattern(
    recentActions: Array<{ action: string; success: boolean; timestamp: string }>
  ): EmotionSuggestion | null {
    if (recentActions.length < 3) return null

    // Check for spinning (repeated similar actions)
    const last5 = recentActions.slice(-5)
    const uniqueActions = new Set(last5.map((a) => a.action.split(":")[0]))
    if (uniqueActions.size === 1 && last5.length >= 4) {
      return {
        category: "frustration",
        trigger: "Spinning on same action type",
        context: `Repeated: ${last5[0].action.split(":")[0]}`,
        intensity: 6,
        tags: ["spinning"],
      }
    }

    // Check for exploration (many different actions)
    const last10 = recentActions.slice(-10)
    const uniqueIn10 = new Set(last10.map((a) => a.action.split(":")[0]))
    if (uniqueIn10.size >= 8) {
      return {
        category: "curiosity",
        trigger: "Exploring diverse actions",
        context: `${uniqueIn10.size} different action types in last 10`,
        intensity: 5,
        tags: ["exploration"],
      }
    }

    return null
  }

  // =============
  // Summary & Export
  // =============

  /**
   * Get emotional state summary for UI/prompts
   */
  export function getStatusSummary(state: EmotionalState): EmotionalSummary {
    const fearCount = Object.keys(state.fears).length
    const curiosityCount = Object.keys(state.curiosities).length
    const satisfactionCount = Object.keys(state.satisfactions).length
    const frustrationCount = Object.keys(state.frustrations).length

    return {
      mood: state.session.mood,
      anxietyLevel: state.session.anxietyLevel,
      confidenceLevel: state.session.confidenceLevel,
      fearCount,
      curiosityCount,
      satisfactionCount,
      frustrationCount,
      recentEmotionCount: state.session.recentEmotions.length,
      isAnxious: state.session.anxietyLevel >= state.settings.anxietyThreshold,
      isConfident: state.session.confidenceLevel >= state.settings.confidenceThreshold,
      hasData: fearCount + curiosityCount + satisfactionCount + frustrationCount > 0,
    }
  }

  /**
   * Get emotional context for system prompt
   */
  export function getStateForPrompt(state: EmotionalState): string {
    const summary = getStatusSummary(state)
    const lines: string[] = ["## Emotional State"]

    // Mood emoji mapping
    const moodEmoji: Record<Mood, string> = {
      positive: "😊",
      neutral: "😐",
      negative: "😔",
      anxious: "😰",
      confident: "🎯",
      frustrated: "😤",
      curious: "🤔",
    }

    lines.push(`- Mood: ${moodEmoji[summary.mood]} ${summary.mood}`)
    lines.push(`- Anxiety: ${summary.anxietyLevel}%${summary.isAnxious ? " (HIGH)" : ""}`)
    lines.push(`- Confidence: ${summary.confidenceLevel}%${summary.isConfident ? " (HIGH)" : ""}`)

    if (summary.fearCount > 0) {
      lines.push(`- Active Fears: ${summary.fearCount}`)
      const topFears = Object.values(state.fears)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 3)
      for (const fear of topFears) {
        lines.push(`  - ${fear.trigger} (intensity: ${fear.intensity})`)
      }
    }

    if (summary.frustrationCount > 0) {
      lines.push(`- Frustrations: ${summary.frustrationCount}`)
    }

    if (summary.isAnxious) {
      lines.push("")
      lines.push("NOTE: Anxiety is elevated - consider cautious approach")
    }

    lines.push("")
    lines.push("Use `/emotions` for full emotional state details.")

    return lines.join("\n")
  }

  /**
   * Export emotional state for state.md
   */
  export function exportToStateMarkdown(state: EmotionalState): string {
    const summary = getStatusSummary(state)
    const lines: string[] = ["## Emotional State"]

    const moodEmoji: Record<Mood, string> = {
      positive: "😊",
      neutral: "😐",
      negative: "😔",
      anxious: "😰",
      confident: "🎯",
      frustrated: "😤",
      curious: "🤔",
    }

    lines.push(`- **Mood**: ${moodEmoji[summary.mood]} ${summary.mood}`)
    lines.push(`- **Anxiety**: ${summary.anxietyLevel}%`)
    lines.push(`- **Confidence**: ${summary.confidenceLevel}%`)
    lines.push(
      `- **Emotions**: ${summary.fearCount} fears, ${summary.curiosityCount} curiosities, ${summary.satisfactionCount} satisfactions, ${summary.frustrationCount} frustrations`
    )
    lines.push("")
    lines.push("_See `.context/scratchpad/emotions.json` for full details_")

    return lines.join("\n")
  }

  // =============
  // Settings Management
  // =============

  /**
   * Get current settings
   */
  export async function getSettings(root: string): Promise<EmotionalSettings> {
    const state = await read(root)
    if (!state) return EmotionalSettings.parse({})
    return state.settings
  }

  /**
   * Update settings
   */
  export async function updateSettings(
    root: string,
    updates: Partial<EmotionalSettings>
  ): Promise<void> {
    const state = await getOrCreate(root)
    state.settings = { ...state.settings, ...updates }
    await write(root, state)
  }

  // =============
  // Reset Operations
  // =============

  /**
   * Reset emotions by category or all
   */
  export async function reset(
    root: string,
    category?: EmotionCategory | "all" | "session"
  ): Promise<void> {
    const state = await getOrCreate(root)

    if (category === "session") {
      state.session = SessionEmotions.parse({})
    } else if (category === "all" || !category) {
      state.fears = {}
      state.curiosities = {}
      state.satisfactions = {}
      state.frustrations = {}
      state.session = SessionEmotions.parse({})
    } else {
      setCategoryStore(state, category, {})
    }

    await write(root, state)
  }

  // =============
  // Search & Query
  // =============

  /**
   * Search emotions by trigger text (for cross-referencing)
   */
  export async function searchByTrigger(
    root: string,
    searchText: string
  ): Promise<EmotionEntry[]> {
    const state = await read(root)
    if (!state) return []

    const lowerSearch = searchText.toLowerCase()
    const results: EmotionEntry[] = []

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      for (const emotion of Object.values(store)) {
        if (
          emotion.trigger.toLowerCase().includes(lowerSearch) ||
          emotion.context.toLowerCase().includes(lowerSearch) ||
          emotion.tags?.some((t) => t.toLowerCase().includes(lowerSearch))
        ) {
          results.push(emotion)
        }
      }
    }

    return results.sort((a, b) => b.intensity - a.intensity)
  }

  /**
   * Get emotions related to specific files
   */
  export async function getEmotionsForFiles(
    root: string,
    files: string[]
  ): Promise<EmotionEntry[]> {
    const state = await read(root)
    if (!state) return []

    const results: EmotionEntry[] = []

    for (const category of EmotionCategory.options) {
      const store = getCategoryStore(state, category)
      for (const emotion of Object.values(store)) {
        if (emotion.relatedFiles?.some((f) => files.some((file) => f.includes(file) || file.includes(f)))) {
          results.push(emotion)
        }
      }
    }

    return results.sort((a, b) => b.intensity - a.intensity)
  }
}
