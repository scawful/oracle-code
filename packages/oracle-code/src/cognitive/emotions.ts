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
import { ProjectConfig } from "./project-config"

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
    excitement: 0.15, // Excitement fades quickly
    determination: 0.03, // Determination persists
    caution: 0.06, // Caution decays moderately
    relief: 0.12, // Relief fades relatively quickly
  }

  // Default prune thresholds (remove when intensity drops below)
  const DEFAULT_PRUNE_THRESHOLDS = {
    fear: 1, // Keep fears longer
    curiosity: 2,
    satisfaction: 1,
    frustration: 2,
    excitement: 2,
    determination: 1,
    caution: 1,
    relief: 2,
  }

  // Mode-specific emotional calibration
  // Defines baseline levels and sensitivity for each agent mode
  const MODE_CALIBRATION: Record<AgentMode, {
    anxietyBaseline: number
    confidenceBaseline: number
    anxietySensitivity: number  // How much anxiety changes per event
    confidenceSensitivity: number
    anxietyMax: number  // Cap for this mode
    confidenceMax: number
    anxietyDecayRate: number  // Per-minute regression toward baseline
    confidenceDecayRate: number
  }> = {
    build: {
      anxietyBaseline: 35,
      confidenceBaseline: 55,
      anxietySensitivity: 1.0,
      confidenceSensitivity: 1.0,
      anxietyMax: 85,
      confidenceMax: 90,
      anxietyDecayRate: 0.5,
      confidenceDecayRate: 0.3,
    },
    plan: {
      anxietyBaseline: 25,
      confidenceBaseline: 65,
      anxietySensitivity: 0.7,
      confidenceSensitivity: 1.2,
      anxietyMax: 70,
      confidenceMax: 95,
      anxietyDecayRate: 0.8,
      confidenceDecayRate: 0.2,
    },
    docs: {
      anxietyBaseline: 20,
      confidenceBaseline: 60,
      anxietySensitivity: 0.5,
      confidenceSensitivity: 0.8,
      anxietyMax: 60,
      confidenceMax: 85,
      anxietyDecayRate: 1.0,
      confidenceDecayRate: 0.4,
    },
    review: {
      anxietyBaseline: 45,
      confidenceBaseline: 50,
      anxietySensitivity: 1.3,
      confidenceSensitivity: 0.8,
      anxietyMax: 95,
      confidenceMax: 80,
      anxietyDecayRate: 0.3,
      confidenceDecayRate: 0.5,
    },
    security: {
      anxietyBaseline: 55,
      confidenceBaseline: 45,
      anxietySensitivity: 1.5,
      confidenceSensitivity: 0.6,
      anxietyMax: 100,
      confidenceMax: 75,
      anxietyDecayRate: 0.2,
      confidenceDecayRate: 0.4,
    },
    chat: {
      anxietyBaseline: 15,
      confidenceBaseline: 70,
      anxietySensitivity: 0.4,
      confidenceSensitivity: 1.0,
      anxietyMax: 50,
      confidenceMax: 95,
      anxietyDecayRate: 1.5,
      confidenceDecayRate: 0.5,
    },
  }

  // =============
  // Emotion Dynamics (Momentum/Inertia)
  // =============

  // How each emotion responds to changes
  export interface EmotionDynamics {
    riseRate: number      // Multiplier for positive changes (0.5 = slow, 2 = fast)
    fallRate: number      // Multiplier for negative changes
    inertia: number       // Resistance to change (0 = none, 1 = very resistant)
    rekindle: number      // How easily it bounces back after decay (0-1)
    ceiling: number       // Max intensity for this emotion (1-10)
  }

  const EMOTION_DYNAMICS: Record<EmotionCategory, EmotionDynamics> = {
    // Confidence is hard-earned, easily shaken
    satisfaction: { riseRate: 0.8, fallRate: 1.2, inertia: 0.3, rekindle: 0.6, ceiling: 10 },
    
    // Anxiety spikes fast, decays slowly (sticky)
    fear: { riseRate: 1.5, fallRate: 0.5, inertia: 0.6, rekindle: 0.8, ceiling: 10 },
    
    // Excitement is volatile - fast up, fast down, easily rekindled
    excitement: { riseRate: 2.0, fallRate: 1.5, inertia: 0.1, rekindle: 0.9, ceiling: 10 },
    
    // Determination is heavy - slow to start, slow to stop
    determination: { riseRate: 0.6, fallRate: 0.4, inertia: 0.7, rekindle: 0.5, ceiling: 10 },
    
    // Frustration builds and releases at moderate pace
    frustration: { riseRate: 1.0, fallRate: 1.0, inertia: 0.4, rekindle: 0.6, ceiling: 10 },
    
    // Caution engages quickly, releases slowly
    caution: { riseRate: 1.5, fallRate: 0.6, inertia: 0.5, rekindle: 0.7, ceiling: 10 },
    
    // Curiosity is easily triggered, moderately persistent
    curiosity: { riseRate: 1.3, fallRate: 1.0, inertia: 0.2, rekindle: 0.8, ceiling: 10 },
    
    // Relief spikes instantly then fades
    relief: { riseRate: 2.5, fallRate: 1.8, inertia: 0.1, rekindle: 0.3, ceiling: 10 },
  }

  // =============
  // Emotion Interactions (Compound States)
  // =============

  export interface EmotionInteraction {
    id: string
    name: string
    description: string
    trigger: {
      primary: EmotionCategory
      primaryMin: number
      secondary?: EmotionCategory
      secondaryMin?: number
      condition?: "success" | "failure" | "obstacle" | "discovery"
    }
    result: {
      emotion: EmotionCategory | "anxiety" | "confidence"
      delta: number
      narrative: string
    }[]
  }

  const EMOTION_INTERACTIONS: EmotionInteraction[] = [
    {
      id: "determination_wearing_thin",
      name: "Determination Wearing Thin",
      description: "Prolonged determination with repeated failures converts to frustration",
      trigger: { primary: "determination", primaryMin: 5, condition: "failure" },
      result: [
        { emotion: "frustration", delta: 3, narrative: "Resolve wearing thin" },
        { emotion: "determination", delta: -1, narrative: "Losing steam" },
      ],
    },
    {
      id: "fear_mitigated",
      name: "Fear Successfully Mitigated",
      description: "Successfully handling a feared situation brings relief and confidence",
      trigger: { primary: "fear", primaryMin: 4, condition: "success" },
      result: [
        { emotion: "relief", delta: 5, narrative: "Dodged a bullet" },
        { emotion: "fear", delta: -2, narrative: "Less scary now" },
        { emotion: "confidence", delta: 5, narrative: "Handled it well" },
      ],
    },
    {
      id: "anxiety_success_boost",
      name: "Anxious Success",
      description: "Success while anxious provides amplified confidence boost",
      trigger: { primary: "caution", primaryMin: 5, condition: "success" },
      result: [
        { emotion: "confidence", delta: 8, narrative: "That went better than expected" },
        { emotion: "anxiety", delta: -10, narrative: "Worry was unfounded" },
        { emotion: "relief", delta: 3, narrative: "Phew" },
      ],
    },
    {
      id: "curiosity_discovery",
      name: "Curious Discovery",
      description: "Curiosity rewarded with discovery triggers excitement",
      trigger: { primary: "curiosity", primaryMin: 3, condition: "discovery" },
      result: [
        { emotion: "excitement", delta: 4, narrative: "Found something interesting" },
        { emotion: "satisfaction", delta: 3, narrative: "Curiosity satisfied" },
        { emotion: "curiosity", delta: -1, narrative: "Question answered" },
      ],
    },
    {
      id: "excitement_challenged",
      name: "Challenge Accepted",
      description: "Excitement meeting an obstacle transforms into determination",
      trigger: { primary: "excitement", primaryMin: 5, condition: "obstacle" },
      result: [
        { emotion: "determination", delta: 4, narrative: "Challenge accepted" },
        { emotion: "excitement", delta: -2, narrative: "Getting serious" },
      ],
    },
    {
      id: "frustration_breakthrough",
      name: "Frustration Breakthrough",
      description: "Success after frustration brings major relief and satisfaction",
      trigger: { primary: "frustration", primaryMin: 5, condition: "success" },
      result: [
        { emotion: "relief", delta: 6, narrative: "Finally!" },
        { emotion: "satisfaction", delta: 5, narrative: "Perseverance paid off" },
        { emotion: "frustration", delta: -4, narrative: "Frustration released" },
        { emotion: "confidence", delta: 5, narrative: "Got through it" },
      ],
    },
    {
      id: "caution_validated",
      name: "Caution Validated",
      description: "Finding a problem while being cautious reinforces caution and satisfaction",
      trigger: { primary: "caution", primaryMin: 4, condition: "discovery" },
      result: [
        { emotion: "satisfaction", delta: 3, narrative: "Good thing we were careful" },
        { emotion: "caution", delta: 1, narrative: "Caution was warranted" },
      ],
    },
    {
      id: "determination_success",
      name: "Determined Success",
      description: "Success while determined brings strong satisfaction",
      trigger: { primary: "determination", primaryMin: 5, condition: "success" },
      result: [
        { emotion: "satisfaction", delta: 5, narrative: "Hard work paid off" },
        { emotion: "confidence", delta: 4, narrative: "Capable of difficult things" },
      ],
    },
  ]

  /**
   * Evaluate emotion interactions based on current state and condition
   */
  export function evaluateInteractions(
    state: EmotionalState,
    condition: "success" | "failure" | "obstacle" | "discovery"
  ): Array<{ interaction: EmotionInteraction; triggered: boolean }> {
    const results: Array<{ interaction: EmotionInteraction; triggered: boolean }> = []
    
    for (const interaction of EMOTION_INTERACTIONS) {
      const { primary, primaryMin, secondary, secondaryMin, condition: reqCondition } = interaction.trigger
      
      // Check condition match
      if (reqCondition && reqCondition !== condition) {
        results.push({ interaction, triggered: false })
        continue
      }
      
      // Check primary emotion intensity
      const primaryIntensity = getHighestIntensity(state, primary)
      if (primaryIntensity < primaryMin) {
        results.push({ interaction, triggered: false })
        continue
      }
      
      // Check secondary emotion if required
      if (secondary && secondaryMin) {
        const secondaryIntensity = getHighestIntensity(state, secondary)
        if (secondaryIntensity < secondaryMin) {
          results.push({ interaction, triggered: false })
          continue
        }
      }
      
      results.push({ interaction, triggered: true })
    }
    
    return results
  }

  /**
   * Get highest intensity emotion entry for a category
   */
  function getHighestIntensity(state: EmotionalState, category: EmotionCategory): number {
    const store = getCategoryStore(state, category)
    const entries = Object.values(store)
    if (entries.length === 0) return 0
    return Math.max(...entries.map(e => e.intensity))
  }

  /**
   * Apply momentum to an emotion change
   */
  export function applyMomentum(
    category: EmotionCategory,
    currentIntensity: number,
    delta: number
  ): number {
    const dynamics = EMOTION_DYNAMICS[category]
    
    // Apply rise/fall rate based on direction
    const rate = delta > 0 ? dynamics.riseRate : dynamics.fallRate
    const scaledDelta = delta * rate
    
    // Apply inertia (resistance to change)
    const resistedDelta = scaledDelta * (1 - dynamics.inertia)
    
    // Calculate new intensity
    let newIntensity = currentIntensity + resistedDelta
    
    // Apply ceiling
    newIntensity = Math.max(0, Math.min(dynamics.ceiling, newIntensity))
    
    return newIntensity
  }

  /**
   * Get emotion dynamics for a category
   */
  export function getEmotionDynamics(category: EmotionCategory): EmotionDynamics {
    return EMOTION_DYNAMICS[category]
  }

  // =============
  // Zod Schemas
  // =============

  export const EmotionCategory = z.enum([
    "fear",
    "curiosity", 
    "satisfaction",
    "frustration",
    "excitement",    // Positive anticipation for new challenges
    "determination", // Focused resolve on a goal
    "caution",       // Careful attention to potential risks
    "relief",        // After successfully avoiding/resolving a problem
  ])
  export type EmotionCategory = z.infer<typeof EmotionCategory>

  export const Mood = z.enum([
    "positive",
    "neutral",
    "negative",
    "anxious",
    "confident",
    "frustrated",
    "curious",
    "excited",      // Energized and ready for challenges
    "determined",   // Focused and resolute
    "cautious",     // Careful and measured
    "relieved",     // After resolving a difficult situation
  ])
  export type Mood = z.infer<typeof Mood>

  // Agent modes affect emotional calibration
  export const AgentMode = z.enum([
    "build",     // Writing/editing code - moderate anxiety tolerance
    "plan",      // Planning tasks - low anxiety, high confidence needed
    "docs",      // Documentation - calm, neutral baseline
    "review",    // Code review - higher anxiety tolerance (critic mode)
    "security",  // Security audit - heightened caution
    "chat",      // Personal/conversation - low anxiety, warmer tone
  ])
  export type AgentMode = z.infer<typeof AgentMode>

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
    
    // Mode-based calibration
    currentMode: AgentMode.default("build"),
    lastModeChange: z.string().optional(),
    
    // Session decay tracking
    lastAnxietyUpdate: z.string().optional(),
    lastConfidenceUpdate: z.string().optional(),
    sessionStart: z.string().optional(),
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
        excitement: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.excitement),
        determination: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.determination),
        caution: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.caution),
        relief: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.relief),
      })
      .default(DEFAULT_DECAY_RATES),

    // Prune thresholds
    pruneThresholds: z
      .object({
        fear: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.fear),
        curiosity: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.curiosity),
        satisfaction: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.satisfaction),
        frustration: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.frustration),
        excitement: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.excitement),
        determination: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.determination),
        caution: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.caution),
        relief: z.number().min(0).max(10).default(DEFAULT_PRUNE_THRESHOLDS.relief),
      })
      .default(DEFAULT_PRUNE_THRESHOLDS),

    // Max mood history entries
    maxMoodHistory: z.number().default(50),
    
    // Enable session emotion decay (regression toward baseline)
    enableSessionDecay: z.boolean().default(true),
    
    // How often to apply session decay (in minutes)
    sessionDecayInterval: z.number().default(5),
  })
  export type EmotionalSettings = z.infer<typeof EmotionalSettings>

  // Full emotional state
  export const EmotionalState = z.object({
    session: SessionEmotions,
    fears: z.record(z.string(), EmotionEntry).default({}),
    curiosities: z.record(z.string(), EmotionEntry).default({}),
    satisfactions: z.record(z.string(), EmotionEntry).default({}),
    frustrations: z.record(z.string(), EmotionEntry).default({}),
    excitements: z.record(z.string(), EmotionEntry).default({}),
    determinations: z.record(z.string(), EmotionEntry).default({}),
    cautions: z.record(z.string(), EmotionEntry).default({}),
    reliefs: z.record(z.string(), EmotionEntry).default({}),
    settings: EmotionalSettings,
    lastUpdated: z.string(),
    lastDecayCheck: z.string(),
    lastSessionDecay: z.string().optional(),
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
    excitementCount: number
    determinationCount: number
    cautionCount: number
    reliefCount: number
    recentEmotionCount: number
    isAnxious: boolean
    isConfident: boolean
    hasData: boolean
    currentMode: AgentMode
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
      session: SessionEmotions.parse({ sessionStart: now }),
      fears: {},
      curiosities: {},
      satisfactions: {},
      frustrations: {},
      excitements: {},
      determinations: {},
      cautions: {},
      reliefs: {},
      settings: EmotionalSettings.parse({}),
      lastUpdated: now,
      lastDecayCheck: now,
      lastSessionDecay: now,
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
      case "excitement":
        return state.excitements
      case "determination":
        return state.determinations
      case "caution":
        return state.cautions
      case "relief":
        return state.reliefs
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
      case "excitement":
        state.excitements = store
        break
      case "determination":
        state.determinations = store
        break
      case "caution":
        state.cautions = store
        break
      case "relief":
        state.reliefs = store
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
      ...Object.values(state.excitements || {}),
      ...Object.values(state.determinations || {}),
      ...Object.values(state.cautions || {}),
      ...Object.values(state.reliefs || {}),
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
   * Adjust anxiety level with mode-aware calibration
   * Delta is scaled by the current mode's sensitivity
   */
  export async function adjustAnxiety(root: string, delta: number): Promise<number> {
    const state = await getOrCreate(root)
    const previousLevel = state.session.anxietyLevel
    const mode = state.session.currentMode
    const calibration = MODE_CALIBRATION[mode]
    
    // Scale delta by mode sensitivity
    const scaledDelta = delta * calibration.anxietySensitivity
    
    // Apply the change, capped by mode's max
    const newLevel = Math.max(0, Math.min(calibration.anxietyMax, state.session.anxietyLevel + scaledDelta))
    state.session.anxietyLevel = newLevel
    state.session.lastAnxietyUpdate = new Date().toISOString()

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
   * Adjust confidence level with mode-aware calibration
   * Delta is scaled by the current mode's sensitivity
   */
  export async function adjustConfidence(root: string, delta: number): Promise<number> {
    const state = await getOrCreate(root)
    const previousLevel = state.session.confidenceLevel
    const mode = state.session.currentMode
    const calibration = MODE_CALIBRATION[mode]
    
    // Scale delta by mode sensitivity
    const scaledDelta = delta * calibration.confidenceSensitivity
    
    // Apply the change, capped by mode's max
    const newLevel = Math.max(0, Math.min(calibration.confidenceMax, state.session.confidenceLevel + scaledDelta))
    state.session.confidenceLevel = newLevel
    state.session.lastConfidenceUpdate = new Date().toISOString()

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
   * Uses project config for baseline calibration if available
   */
  export async function resetSessionEmotions(root: string, mode?: AgentMode): Promise<void> {
    const state = await getOrCreate(root)
    const now = new Date().toISOString()
    
    // Get project config for default mode
    const projectConfig = await getProjectConfig(root)
    const targetMode = mode || projectConfig?.defaultMode || "build"
    
    // Get merged calibration with project overrides
    const calibration = await getMergedModeCalibration(root, targetMode)
    
    state.session = SessionEmotions.parse({
      currentMode: targetMode,
      anxietyLevel: calibration.anxietyBaseline,
      confidenceLevel: calibration.confidenceBaseline,
      sessionStart: now,
      lastAnxietyUpdate: now,
      lastConfidenceUpdate: now,
    })
    state.lastSessionDecay = now
    
    // Apply initial emotions from project config
    if (projectConfig?.initialEmotions) {
      for (const initial of projectConfig.initialEmotions) {
        await addEmotion(
          root,
          initial.category,
          initial.trigger,
          initial.context,
          initial.intensity,
          { tags: ["project_initial"] }
        )
      }
    }
    
    await write(root, state)
  }

  /**
   * Change the current agent mode - recalibrates emotional baselines
   * Uses project config for mode-specific calibration if available
   */
  export async function setAgentMode(root: string, mode: AgentMode): Promise<void> {
    const state = await getOrCreate(root)
    const previousMode = state.session.currentMode
    
    if (previousMode === mode) return
    
    // Get merged calibration with project overrides
    const calibration = await getMergedModeCalibration(root, mode)
    const now = new Date().toISOString()
    
    // Smoothly transition toward new baseline (don't jump abruptly)
    const anxietyDiff = calibration.anxietyBaseline - state.session.anxietyLevel
    const confidenceDiff = calibration.confidenceBaseline - state.session.confidenceLevel
    
    // Move 50% toward the new baseline on mode change
    state.session.anxietyLevel += anxietyDiff * 0.5
    state.session.confidenceLevel += confidenceDiff * 0.5
    
    // Cap to new mode's limits
    state.session.anxietyLevel = Math.min(state.session.anxietyLevel, calibration.anxietyMax)
    state.session.confidenceLevel = Math.min(state.session.confidenceLevel, calibration.confidenceMax)
    
    state.session.currentMode = mode
    state.session.lastModeChange = now
    
    // Update mood if appropriate for the new mode
    if (mode === "review" || mode === "security") {
      if (state.session.mood === "confident") {
        await updateMood(root, "cautious", `Entering ${mode} mode`)
      }
    } else if (mode === "chat") {
      if (state.session.mood === "anxious") {
        await updateMood(root, "neutral", `Entering ${mode} mode`)
      }
    }
    
    await write(root, state)
  }

  /**
   * Get current agent mode
   */
  export async function getAgentMode(root: string): Promise<AgentMode> {
    const state = await read(root)
    return state?.session.currentMode || "build"
  }

  /**
   * Apply session decay - regress anxiety/confidence toward baseline
   * Call this periodically (e.g., every few minutes or at turn boundaries)
   */
  export async function applySessionDecay(root: string): Promise<{
    anxietyDecayed: number
    confidenceDecayed: number
  }> {
    const state = await getOrCreate(root)
    
    if (!state.settings.enableSessionDecay) {
      return { anxietyDecayed: 0, confidenceDecayed: 0 }
    }
    
    const now = new Date()
    const lastDecay = state.lastSessionDecay ? new Date(state.lastSessionDecay) : now
    const minutesSinceLastDecay = (now.getTime() - lastDecay.getTime()) / (1000 * 60)
    
    if (minutesSinceLastDecay < state.settings.sessionDecayInterval) {
      return { anxietyDecayed: 0, confidenceDecayed: 0 }
    }
    
    const mode = state.session.currentMode
    const calibration = MODE_CALIBRATION[mode]
    
    const previousAnxiety = state.session.anxietyLevel
    const previousConfidence = state.session.confidenceLevel
    
    // Calculate regression toward baseline
    // The further from baseline, the more it decays
    const anxietyDiff = state.session.anxietyLevel - calibration.anxietyBaseline
    const confidenceDiff = state.session.confidenceLevel - calibration.confidenceBaseline
    
    // Apply proportional decay (per minute)
    const anxietyDecay = anxietyDiff * calibration.anxietyDecayRate * minutesSinceLastDecay * 0.1
    const confidenceDecay = confidenceDiff * calibration.confidenceDecayRate * minutesSinceLastDecay * 0.1
    
    state.session.anxietyLevel -= anxietyDecay
    state.session.confidenceLevel -= confidenceDecay
    
    // Clamp to valid range
    state.session.anxietyLevel = Math.max(0, Math.min(calibration.anxietyMax, state.session.anxietyLevel))
    state.session.confidenceLevel = Math.max(0, Math.min(calibration.confidenceMax, state.session.confidenceLevel))
    
    state.lastSessionDecay = now.toISOString()
    
    await write(root, state)
    
    return {
      anxietyDecayed: previousAnxiety - state.session.anxietyLevel,
      confidenceDecayed: previousConfidence - state.session.confidenceLevel,
    }
  }

  /**
   * Get mood history
   */
  export async function getMoodHistory(root: string): Promise<MoodHistoryEntry[]> {
    const state = await read(root)
    if (!state) return []
    return [...state.session.moodHistory].reverse()
  }

  /**
   * Get the mode calibration for a specific mode
   */
  export function getModeCalibration(mode: AgentMode) {
    return MODE_CALIBRATION[mode]
  }

  // Project config cache (per-root)
  let cachedProjectConfig: ProjectConfig.ProjectEmotionalConfig | null = null
  let cachedProjectConfigRoot: string | null = null

  /**
   * Get project config for a root, with caching
   */
  export async function getProjectConfig(root: string): Promise<ProjectConfig.ProjectEmotionalConfig | null> {
    if (cachedProjectConfigRoot === root && cachedProjectConfig !== null) {
      return cachedProjectConfig
    }

    cachedProjectConfig = await ProjectConfig.getConfigForRoot(root)
    cachedProjectConfigRoot = root
    return cachedProjectConfig
  }

  /**
   * Clear project config cache (call when switching projects)
   */
  export function clearProjectConfigCache(): void {
    cachedProjectConfig = null
    cachedProjectConfigRoot = null
  }

  /**
   * Get merged mode calibration with project overrides
   */
  export async function getMergedModeCalibration(
    root: string,
    mode: AgentMode
  ): Promise<typeof MODE_CALIBRATION["build"] & { expressionLevel?: ProjectConfig.ExpressionLevel }> {
    const projectConfig = await getProjectConfig(root)
    const defaultCalibration = MODE_CALIBRATION[mode]

    return ProjectConfig.getMergedModeCalibration(mode, projectConfig, defaultCalibration)
  }

  /**
   * Get expression level for current mode and project
   */
  export async function getExpressionLevel(
    root: string,
    mode?: AgentMode
  ): Promise<ProjectConfig.ExpressionLevel> {
    const projectConfig = await getProjectConfig(root)
    const currentMode = mode || (await getAgentMode(root))
    return ProjectConfig.getExpressionLevel(currentMode, projectConfig)
  }

  /**
   * Get path-specific emotions for a file path
   */
  export async function getPathEmotions(
    root: string,
    filePath: string
  ): Promise<ProjectConfig.PathEmotionTrigger[]> {
    const projectConfig = await getProjectConfig(root)
    return ProjectConfig.getPathEmotions(filePath, projectConfig)
  }

  /**
   * Apply path-specific emotions when accessing a file
   */
  export async function applyPathEmotions(
    root: string,
    filePath: string,
    sessionId?: string
  ): Promise<EmotionEntry[]> {
    const triggers = await getPathEmotions(root, filePath)
    const addedEmotions: EmotionEntry[] = []

    for (const trigger of triggers) {
      if (trigger.mode === "boost") {
        // Check if we already have this emotion, boost it
        const existing = await getEmotionsByCategory(root, trigger.emotion)
        const matching = existing.find(e => e.trigger.includes(trigger.description))

        if (matching) {
          // Boost existing emotion
          const newIntensity = Math.min(10, matching.intensity + trigger.intensity * 0.5)
          await updateEmotionIntensity(root, matching.id, newIntensity)
        } else {
          // Add new emotion
          const entry = await addEmotion(
            root,
            trigger.emotion,
            trigger.description,
            `Path: ${filePath}`,
            trigger.intensity,
            { sessionId, relatedFiles: [filePath] }
          )
          addedEmotions.push(entry)
        }
      } else {
        // Set mode - replace any existing emotion of this type for this path
        const existing = await getEmotionsByCategory(root, trigger.emotion)
        const matching = existing.find(e => e.relatedFiles?.includes(filePath))

        if (matching) {
          await updateEmotionIntensity(root, matching.id, trigger.intensity)
        } else {
          const entry = await addEmotion(
            root,
            trigger.emotion,
            trigger.description,
            `Path: ${filePath}`,
            trigger.intensity,
            { sessionId, relatedFiles: [filePath] }
          )
          addedEmotions.push(entry)
        }
      }
    }

    return addedEmotions
  }

  // =============
  // Decay & Pruning
  // =============

  /**
   * Apply decay to all emotions (call at turn boundaries)
   * Uses project config for decay multipliers if available
   * Returns count of pruned emotions
   */
  export async function applyDecay(root: string): Promise<{ pruned: number; decayed: number }> {
    const state = await getOrCreate(root)
    const projectConfig = await getProjectConfig(root)
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
      
      // Get project-specific decay multiplier
      const decayMultiplier = ProjectConfig.getDecayMultiplier(category, projectConfig)
      // Get project-specific emotion ceiling
      const ceiling = ProjectConfig.getEmotionCeiling(category, projectConfig)

      for (const [id, emotion] of Object.entries(store)) {
        // Apply ceiling from project config
        if (emotion.intensity > ceiling) {
          emotion.intensity = ceiling
        }
        
        // Calculate decay based on time since last access, with project multiplier
        const lastAccess = new Date(emotion.lastAccessed)
        const hoursSinceAccess = (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60)
        const decay = emotion.decayRate * hoursSinceAccess * decayMultiplier

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
    const excitementCount = Object.keys(state.excitements || {}).length
    const determinationCount = Object.keys(state.determinations || {}).length
    const cautionCount = Object.keys(state.cautions || {}).length
    const reliefCount = Object.keys(state.reliefs || {}).length

    const totalEmotions = fearCount + curiosityCount + satisfactionCount + frustrationCount +
      excitementCount + determinationCount + cautionCount + reliefCount

    return {
      mood: state.session.mood,
      anxietyLevel: Math.round(state.session.anxietyLevel),
      confidenceLevel: Math.round(state.session.confidenceLevel),
      fearCount,
      curiosityCount,
      satisfactionCount,
      frustrationCount,
      excitementCount,
      determinationCount,
      cautionCount,
      reliefCount,
      recentEmotionCount: state.session.recentEmotions.length,
      isAnxious: state.session.anxietyLevel >= state.settings.anxietyThreshold,
      isConfident: state.session.confidenceLevel >= state.settings.confidenceThreshold,
      hasData: totalEmotions > 0,
      currentMode: state.session.currentMode,
    }
  }

  // Shared mood emoji mapping for all functions
  const MOOD_EMOJI: Record<Mood, string> = {
    positive: "😊",
    neutral: "😐",
    negative: "😔",
    anxious: "😰",
    confident: "🎯",
    frustrated: "😤",
    curious: "🤔",
    excited: "✨",
    determined: "💪",
    cautious: "🔍",
    relieved: "😌",
  }

  /**
   * Get emotional context for system prompt
   */
  export function getStateForPrompt(state: EmotionalState): string {
    const summary = getStatusSummary(state)
    const lines: string[] = ["## Emotional State"]

    lines.push(`- Mode: ${summary.currentMode}`)
    lines.push(`- Mood: ${MOOD_EMOJI[summary.mood]} ${summary.mood}`)
    lines.push(`- Anxiety: ${summary.anxietyLevel}%${summary.isAnxious ? " (HIGH)" : ""}`)
    lines.push(`- Confidence: ${summary.confidenceLevel}%${summary.isConfident ? " (HIGH)" : ""}`)

    if (summary.fearCount > 0) {
      lines.push(`- Active Fears: ${summary.fearCount}`)
      const topFears = Object.values(state.fears)
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 3)
      for (const fear of topFears) {
        lines.push(`  - ${fear.trigger} (intensity: ${Math.round(fear.intensity)})`)
      }
    }

    if (summary.frustrationCount > 0) {
      lines.push(`- Frustrations: ${summary.frustrationCount}`)
    }

    if (summary.determinationCount > 0) {
      lines.push(`- Determination: ${summary.determinationCount}`)
    }

    if (summary.excitementCount > 0) {
      lines.push(`- Excitement: ${summary.excitementCount}`)
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

    lines.push(`- **Mode**: ${summary.currentMode}`)
    lines.push(`- **Mood**: ${MOOD_EMOJI[summary.mood]} ${summary.mood}`)
    lines.push(`- **Anxiety**: ${summary.anxietyLevel}%`)
    lines.push(`- **Confidence**: ${summary.confidenceLevel}%`)
    
    const emotionParts = []
    if (summary.fearCount > 0) emotionParts.push(`${summary.fearCount} fears`)
    if (summary.curiosityCount > 0) emotionParts.push(`${summary.curiosityCount} curiosities`)
    if (summary.satisfactionCount > 0) emotionParts.push(`${summary.satisfactionCount} satisfactions`)
    if (summary.frustrationCount > 0) emotionParts.push(`${summary.frustrationCount} frustrations`)
    if (summary.excitementCount > 0) emotionParts.push(`${summary.excitementCount} excitements`)
    if (summary.determinationCount > 0) emotionParts.push(`${summary.determinationCount} determinations`)
    if (summary.cautionCount > 0) emotionParts.push(`${summary.cautionCount} cautions`)
    if (summary.reliefCount > 0) emotionParts.push(`${summary.reliefCount} reliefs`)
    
    if (emotionParts.length > 0) {
      lines.push(`- **Emotions**: ${emotionParts.join(", ")}`)
    }
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
    const now = new Date().toISOString()
    const mode = state.session.currentMode
    const calibration = MODE_CALIBRATION[mode]

    if (category === "session") {
      state.session = SessionEmotions.parse({
        currentMode: mode,
        anxietyLevel: calibration.anxietyBaseline,
        confidenceLevel: calibration.confidenceBaseline,
        sessionStart: now,
      })
      state.lastSessionDecay = now
    } else if (category === "all" || !category) {
      state.fears = {}
      state.curiosities = {}
      state.satisfactions = {}
      state.frustrations = {}
      state.excitements = {}
      state.determinations = {}
      state.cautions = {}
      state.reliefs = {}
      state.session = SessionEmotions.parse({
        currentMode: mode,
        anxietyLevel: calibration.anxietyBaseline,
        confidenceLevel: calibration.confidenceBaseline,
        sessionStart: now,
      })
      state.lastSessionDecay = now
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
