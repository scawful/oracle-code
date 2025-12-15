/**
 * Historical Memory Module
 * 
 * Provides semantic retrieval of past session experiences using embeddings.
 * Supports both local models (privacy, offline) and API-based (quality).
 * 
 * Each session is embedded and stored with:
 * - Semantic content (goals, decisions, problems, solutions)
 * - Emotional arc (timeline of emotional state changes)
 * - Outcomes (what was accomplished, what failed)
 * - Key moments (significant events for learning)
 * 
 * The system enables:
 * - Seamless recall of relevant past experiences
 * - Emotional learning from similar situations
 * - Pattern recognition across sessions
 * - Sync with halext.org API backend
 */

import z from "zod"
import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { Emotions } from "./emotions"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"

export namespace HistoricalMemory {
  // =============
  // Configuration
  // =============

  export const EmbeddingProvider = z.enum([
    "local",      // Local embedding model (privacy, offline)
    "openai",     // OpenAI embeddings API
    "anthropic",  // Anthropic (if available)
    "halext",     // halext.org API backend
    "custom",     // Custom provider
  ])
  export type EmbeddingProvider = z.infer<typeof EmbeddingProvider>

  export const MemoryConfig = z.object({
    // Embedding provider
    provider: EmbeddingProvider.default("local"),
    
    // Retrieval settings
    maxRetrievalResults: z.number().default(5),
    similarityThreshold: z.number().min(0).max(1).default(0.7),
    
    // Scope settings
    searchScope: z.enum(["project", "global", "blend"]).default("blend"),
    blendRatio: z.number().min(0).max(1).default(0.7), // Project weight when blending
    
    // Sync settings
    syncEnabled: z.boolean().default(false),
    syncEndpoint: z.string().optional(), // halext.org API endpoint
    syncApiKey: z.string().optional(),
    
    // Storage settings
    maxSessionsStored: z.number().default(100),
    embedDimensions: z.number().default(384), // Default for small models
  })
  export type MemoryConfig = z.infer<typeof MemoryConfig>

  // =============
  // Schemas
  // =============

  // Emotional snapshot at a point in time
  export const EmotionSnapshot = z.object({
    timestamp: z.string(),
    anxietyLevel: z.number(),
    confidenceLevel: z.number(),
    mood: Emotions.Mood,
    dominantEmotions: z.array(z.object({
      category: Emotions.EmotionCategory,
      intensity: z.number(),
    })),
  })
  export type EmotionSnapshot = z.infer<typeof EmotionSnapshot>

  // Emotional arc across a session
  export const EmotionalArc = z.object({
    sessionId: z.string(),
    snapshots: z.array(EmotionSnapshot),
    summary: z.object({
      startMood: Emotions.Mood,
      endMood: Emotions.Mood,
      peakAnxiety: z.number(),
      lowestConfidence: z.number(),
      dominantEmotion: Emotions.EmotionCategory.optional(),
      groundingEvents: z.number().default(0),
      moodTransitions: z.number().default(0),
    }),
  })
  export type EmotionalArc = z.infer<typeof EmotionalArc>

  // Key moment during a session
  export const KeyMoment = z.object({
    id: z.string(),
    timestamp: z.string(),
    type: z.enum([
      "breakthrough",     // Found solution, understood something
      "obstacle",         // Hit a wall
      "decision",         // Made important choice
      "discovery",        // Found something unexpected
      "grounding",        // Needed to reset
      "goal_complete",    // Finished a goal
      "goal_blocked",     // Goal got stuck
      "emotional_shift",  // Significant mood change
    ]),
    description: z.string(),
    emotionalState: EmotionSnapshot,
    relatedFiles: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  export type KeyMoment = z.infer<typeof KeyMoment>

  // Outcome of a session
  export const SessionOutcome = z.object({
    type: z.enum(["success", "partial", "failure", "abandoned", "ongoing"]),
    description: z.string(),
    goalsCompleted: z.array(z.string()),
    goalsIncomplete: z.array(z.string()),
    lessonsLearned: z.array(z.string()),
  })
  export type SessionOutcome = z.infer<typeof SessionOutcome>

  // Content for embedding
  export const EmbeddingContent = z.object({
    // Task/goal descriptions
    goals: z.array(z.string()),
    // Key decisions made
    decisions: z.array(z.string()),
    // Problems encountered
    problems: z.array(z.string()),
    // Solutions found
    solutions: z.array(z.string()),
    // Files/areas worked on
    filePatterns: z.array(z.string()),
    // Emotional journey summary
    emotionalSummary: z.string(),
    // Tools used frequently
    toolsUsed: z.array(z.string()),
    // Tags for categorization
    tags: z.array(z.string()),
  })
  export type EmbeddingContent = z.infer<typeof EmbeddingContent>

  // Full session memory entry
  export const SessionMemory = z.object({
    id: z.string(),
    projectId: z.string().optional(),
    timestamp: z.string(),
    duration: z.number(), // minutes
    
    // Content
    summary: z.string(),
    embeddingContent: EmbeddingContent,
    embedding: z.array(z.number()).optional(), // The actual embedding vector
    
    // Emotional data
    emotionalArc: EmotionalArc,
    
    // Events
    keyMoments: z.array(KeyMoment),
    outcome: SessionOutcome,
    
    // Metadata
    agentMode: Emotions.AgentMode.optional(),
    autonomyLevel: z.number().optional(),
    
    // Sync status
    syncedAt: z.string().optional(),
    syncId: z.string().optional(), // ID in remote system
  })
  export type SessionMemory = z.infer<typeof SessionMemory>

  // Retrieved memory with relevance
  export const RetrievedMemory = z.object({
    session: SessionMemory,
    relevance: z.number(), // 0-1 similarity score
    matchedOn: z.array(z.string()), // What aspects matched
    emotionalLesson: z.object({
      applicableCautions: z.array(z.object({
        trigger: z.string(),
        reason: z.string(),
        intensity: z.number(),
      })),
      approachesThatWorked: z.array(z.string()),
      approachesToAvoid: z.array(z.string()),
      recoverySuccessful: z.boolean().optional(),
    }),
  })
  export type RetrievedMemory = z.infer<typeof RetrievedMemory>

  // Memory index state
  export const MemoryIndex = z.object({
    version: z.number().default(1),
    lastUpdated: z.string(),
    sessionCount: z.number().default(0),
    embeddingProvider: EmbeddingProvider,
    embeddingDimensions: z.number(),
    config: MemoryConfig,
  })
  export type MemoryIndex = z.infer<typeof MemoryIndex>

  // =============
  // Events
  // =============

  export const Event = {
    SessionStored: BusEvent.define(
      "historical_memory.session.stored",
      z.object({
        root: z.string(),
        sessionId: z.string(),
      })
    ),
    MemoryRecalled: BusEvent.define(
      "historical_memory.recalled",
      z.object({
        root: z.string(),
        queryContext: z.string(),
        resultsCount: z.number(),
      })
    ),
    SyncCompleted: BusEvent.define(
      "historical_memory.sync.completed",
      z.object({
        root: z.string(),
        sessionsUploaded: z.number(),
        sessionsDownloaded: z.number(),
      })
    ),
  }

  // =============
  // File Paths
  // =============

  function getHistoryDir(root: string): string {
    return path.join(root, "history")
  }

  function getSessionsDir(root: string): string {
    return path.join(getHistoryDir(root), "sessions")
  }

  function getEmbeddingsDir(root: string): string {
    return path.join(getHistoryDir(root), "embeddings")
  }

  function getEmotionalArcsDir(root: string): string {
    return path.join(getHistoryDir(root), "emotional-arcs")
  }

  function getIndexPath(root: string): string {
    return path.join(getHistoryDir(root), "index.json")
  }

  function getConfigPath(root: string): string {
    return path.join(getHistoryDir(root), "config.json")
  }

  // =============
  // Initialization
  // =============

  /**
   * Initialize historical memory directories
   */
  export async function init(root: string): Promise<void> {
    await fs.mkdir(getSessionsDir(root), { recursive: true })
    await fs.mkdir(getEmbeddingsDir(root), { recursive: true })
    await fs.mkdir(getEmotionalArcsDir(root), { recursive: true })
    
    // Create index if doesn't exist
    const indexPath = getIndexPath(root)
    try {
      await fs.access(indexPath)
    } catch {
      const index: MemoryIndex = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        sessionCount: 0,
        embeddingProvider: "local",
        embeddingDimensions: 384,
        config: MemoryConfig.parse({}),
      }
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2))
    }
  }

  /**
   * Get or create config
   */
  export async function getConfig(root: string): Promise<MemoryConfig> {
    const configPath = getConfigPath(root)
    try {
      const content = await fs.readFile(configPath, "utf-8")
      return MemoryConfig.parse(JSON.parse(content))
    } catch {
      const config = MemoryConfig.parse({})
      await fs.writeFile(configPath, JSON.stringify(config, null, 2))
      return config
    }
  }

  /**
   * Update config
   */
  export async function updateConfig(root: string, updates: Partial<MemoryConfig>): Promise<void> {
    const current = await getConfig(root)
    const updated = { ...current, ...updates }
    await fs.writeFile(getConfigPath(root), JSON.stringify(updated, null, 2))
  }

  // =============
  // Session Storage
  // =============

  /**
   * Store a completed session's memory
   */
  export async function storeSession(root: string, memory: SessionMemory): Promise<void> {
    await init(root)
    
    // Store session data
    const sessionPath = path.join(getSessionsDir(root), `${memory.id}.json`)
    await fs.writeFile(sessionPath, JSON.stringify(memory, null, 2))
    
    // Store emotional arc separately for quick access
    const arcPath = path.join(getEmotionalArcsDir(root), `${memory.id}.json`)
    await fs.writeFile(arcPath, JSON.stringify(memory.emotionalArc, null, 2))
    
    // Store embedding if present
    if (memory.embedding && memory.embedding.length > 0) {
      const embeddingPath = path.join(getEmbeddingsDir(root), `${memory.id}.json`)
      await fs.writeFile(embeddingPath, JSON.stringify({
        id: memory.id,
        embedding: memory.embedding,
        timestamp: memory.timestamp,
      }, null, 2))
    }
    
    // Update index
    const indexPath = getIndexPath(root)
    const index = JSON.parse(await fs.readFile(indexPath, "utf-8")) as MemoryIndex
    index.sessionCount++
    index.lastUpdated = new Date().toISOString()
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2))
    
    Bus.publish(Event.SessionStored, { root, sessionId: memory.id })
  }

  /**
   * Get a session by ID
   */
  export async function getSession(root: string, sessionId: string): Promise<SessionMemory | null> {
    try {
      const sessionPath = path.join(getSessionsDir(root), `${sessionId}.json`)
      const content = await fs.readFile(sessionPath, "utf-8")
      return SessionMemory.parse(JSON.parse(content))
    } catch {
      return null
    }
  }

  /**
   * List recent sessions
   */
  export async function listSessions(root: string, limit: number = 20): Promise<SessionMemory[]> {
    await init(root)
    
    const sessionsDir = getSessionsDir(root)
    const files = await fs.readdir(sessionsDir)
    const sessions: SessionMemory[] = []
    
    for (const file of files.filter(f => f.endsWith(".json")).slice(-limit)) {
      try {
        const content = await fs.readFile(path.join(sessionsDir, file), "utf-8")
        sessions.push(SessionMemory.parse(JSON.parse(content)))
      } catch {
        // Skip invalid files
      }
    }
    
    return sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }

  // =============
  // Retrieval
  // =============

  /**
   * Recall relevant memories for a given context
   * This is a placeholder - actual embedding/search requires provider integration
   */
  export async function recall(
    root: string,
    context: {
      currentGoal?: string
      currentFiles?: string[]
      currentProblems?: string[]
      emotionalState?: Emotions.EmotionalState
    },
    options?: {
      limit?: number
      threshold?: number
      scope?: "project" | "global" | "blend"
    }
  ): Promise<RetrievedMemory[]> {
    const config = await getConfig(root)
    const limit = options?.limit || config.maxRetrievalResults
    const threshold = options?.threshold || config.similarityThreshold
    
    // For now, do keyword-based retrieval as fallback
    // TODO: Integrate actual embedding provider
    const sessions = await listSessions(root, 50)
    const results: RetrievedMemory[] = []
    
    for (const session of sessions) {
      const relevance = calculateKeywordRelevance(session, context)
      
      if (relevance >= threshold) {
        results.push({
          session,
          relevance,
          matchedOn: getMatchedAspects(session, context),
          emotionalLesson: extractEmotionalLesson(session),
        })
      }
    }
    
    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance)
    const limited = results.slice(0, limit)
    
    if (limited.length > 0) {
      Bus.publish(Event.MemoryRecalled, {
        root,
        queryContext: context.currentGoal || "unknown",
        resultsCount: limited.length,
      })
    }
    
    return limited
  }

  /**
   * Calculate keyword-based relevance (fallback when embeddings not available)
   */
  function calculateKeywordRelevance(
    session: SessionMemory,
    context: {
      currentGoal?: string
      currentFiles?: string[]
      currentProblems?: string[]
    }
  ): number {
    let score = 0
    let maxScore = 0
    
    const content = session.embeddingContent
    
    // Goal similarity
    if (context.currentGoal) {
      maxScore += 3
      const goalWords = context.currentGoal.toLowerCase().split(/\s+/)
      for (const goal of content.goals) {
        const matches = goalWords.filter(w => goal.toLowerCase().includes(w)).length
        score += (matches / goalWords.length) * 3
      }
    }
    
    // File pattern overlap
    if (context.currentFiles && context.currentFiles.length > 0) {
      maxScore += 2
      for (const file of context.currentFiles) {
        if (content.filePatterns.some(p => file.includes(p) || p.includes(file))) {
          score += 2 / context.currentFiles.length
        }
      }
    }
    
    // Problem similarity
    if (context.currentProblems && context.currentProblems.length > 0) {
      maxScore += 2
      for (const problem of context.currentProblems) {
        const problemWords = problem.toLowerCase().split(/\s+/)
        for (const sessionProblem of content.problems) {
          const matches = problemWords.filter(w => sessionProblem.toLowerCase().includes(w)).length
          if (matches > problemWords.length * 0.3) {
            score += 2 / context.currentProblems.length
            break
          }
        }
      }
    }
    
    return maxScore > 0 ? score / maxScore : 0
  }

  /**
   * Get matched aspects for display
   */
  function getMatchedAspects(
    session: SessionMemory,
    context: { currentGoal?: string; currentFiles?: string[]; currentProblems?: string[] }
  ): string[] {
    const matched: string[] = []
    
    if (context.currentGoal && session.embeddingContent.goals.some(g => 
      g.toLowerCase().includes(context.currentGoal!.toLowerCase().slice(0, 20))
    )) {
      matched.push("similar_goal")
    }
    
    if (context.currentFiles?.some(f => 
      session.embeddingContent.filePatterns.some(p => f.includes(p))
    )) {
      matched.push("same_files")
    }
    
    if (context.currentProblems?.some(p =>
      session.embeddingContent.problems.some(sp => 
        sp.toLowerCase().includes(p.toLowerCase().slice(0, 20))
      )
    )) {
      matched.push("similar_problem")
    }
    
    return matched
  }

  /**
   * Extract emotional lessons from a session
   */
  function extractEmotionalLesson(session: SessionMemory): RetrievedMemory["emotionalLesson"] {
    const cautions: RetrievedMemory["emotionalLesson"]["applicableCautions"] = []
    const approachesThatWorked: string[] = []
    const approachesToAvoid: string[] = []
    
    // Extract from key moments
    for (const moment of session.keyMoments) {
      if (moment.type === "obstacle" || moment.type === "grounding") {
        cautions.push({
          trigger: moment.description,
          reason: `Previous ${moment.type}`,
          intensity: moment.emotionalState.dominantEmotions[0]?.intensity || 5,
        })
      }
      if (moment.type === "breakthrough") {
        approachesThatWorked.push(moment.description)
      }
    }
    
    // Extract from outcomes
    if (session.outcome.type === "failure" || session.outcome.type === "abandoned") {
      for (const lesson of session.outcome.lessonsLearned) {
        if (lesson.toLowerCase().includes("avoid") || lesson.toLowerCase().includes("don't")) {
          approachesToAvoid.push(lesson)
        }
      }
    }
    
    if (session.outcome.type === "success" || session.outcome.type === "partial") {
      for (const lesson of session.outcome.lessonsLearned) {
        if (!lesson.toLowerCase().includes("avoid")) {
          approachesThatWorked.push(lesson)
        }
      }
    }
    
    return {
      applicableCautions: cautions.slice(0, 3),
      approachesThatWorked: approachesThatWorked.slice(0, 3),
      approachesToAvoid: approachesToAvoid.slice(0, 3),
      recoverySuccessful: session.emotionalArc.summary.groundingEvents > 0 && 
        session.outcome.type !== "failure",
    }
  }

  // =============
  // Emotional Arc Recording
  // =============

  /**
   * Record an emotional snapshot for the current session
   */
  export async function recordEmotionalSnapshot(
    root: string,
    sessionId: string,
    emotionalState: Emotions.EmotionalState
  ): Promise<void> {
    const arcPath = path.join(getEmotionalArcsDir(root), `${sessionId}.json`)
    
    let arc: EmotionalArc
    try {
      const content = await fs.readFile(arcPath, "utf-8")
      arc = EmotionalArc.parse(JSON.parse(content))
    } catch {
      // Create new arc
      arc = {
        sessionId,
        snapshots: [],
        summary: {
          startMood: emotionalState.session.mood,
          endMood: emotionalState.session.mood,
          peakAnxiety: emotionalState.session.anxietyLevel,
          lowestConfidence: emotionalState.session.confidenceLevel,
          groundingEvents: 0,
          moodTransitions: 0,
        },
      }
    }
    
    // Create snapshot
    const snapshot: EmotionSnapshot = {
      timestamp: new Date().toISOString(),
      anxietyLevel: emotionalState.session.anxietyLevel,
      confidenceLevel: emotionalState.session.confidenceLevel,
      mood: emotionalState.session.mood,
      dominantEmotions: getDominantEmotions(emotionalState),
    }
    
    // Check for mood transition
    if (arc.snapshots.length > 0) {
      const lastSnapshot = arc.snapshots[arc.snapshots.length - 1]
      if (lastSnapshot.mood !== snapshot.mood) {
        arc.summary.moodTransitions++
      }
    }
    
    // Update summary
    arc.snapshots.push(snapshot)
    arc.summary.endMood = snapshot.mood
    arc.summary.peakAnxiety = Math.max(arc.summary.peakAnxiety, snapshot.anxietyLevel)
    arc.summary.lowestConfidence = Math.min(arc.summary.lowestConfidence, snapshot.confidenceLevel)
    
    // Determine dominant emotion
    const emotionCounts = new Map<Emotions.EmotionCategory, number>()
    for (const s of arc.snapshots) {
      for (const e of s.dominantEmotions) {
        emotionCounts.set(e.category, (emotionCounts.get(e.category) || 0) + e.intensity)
      }
    }
    let maxEmotion: Emotions.EmotionCategory | undefined
    let maxCount = 0
    for (const [emotion, count] of emotionCounts) {
      if (count > maxCount) {
        maxCount = count
        maxEmotion = emotion
      }
    }
    arc.summary.dominantEmotion = maxEmotion
    
    await fs.writeFile(arcPath, JSON.stringify(arc, null, 2))
  }

  /**
   * Get dominant emotions from state
   */
  function getDominantEmotions(
    state: Emotions.EmotionalState
  ): Array<{ category: Emotions.EmotionCategory; intensity: number }> {
    const emotions: Array<{ category: Emotions.EmotionCategory; intensity: number }> = []
    
    const stores: Array<{ cat: Emotions.EmotionCategory; store: Record<string, Emotions.EmotionEntry> }> = [
      { cat: "fear", store: state.fears },
      { cat: "curiosity", store: state.curiosities },
      { cat: "satisfaction", store: state.satisfactions },
      { cat: "frustration", store: state.frustrations },
      { cat: "excitement", store: state.excitements || {} },
      { cat: "determination", store: state.determinations || {} },
      { cat: "caution", store: state.cautions || {} },
      { cat: "relief", store: state.reliefs || {} },
    ]
    
    for (const { cat, store } of stores) {
      const entries = Object.values(store)
      if (entries.length > 0) {
        const maxIntensity = Math.max(...entries.map(e => e.intensity))
        if (maxIntensity >= 4) { // Only include notable emotions
          emotions.push({ category: cat, intensity: maxIntensity })
        }
      }
    }
    
    return emotions.sort((a, b) => b.intensity - a.intensity).slice(0, 3)
  }

  /**
   * Record a grounding event in the emotional arc
   */
  export async function recordGroundingEvent(root: string, sessionId: string): Promise<void> {
    const arcPath = path.join(getEmotionalArcsDir(root), `${sessionId}.json`)
    
    try {
      const content = await fs.readFile(arcPath, "utf-8")
      const arc = EmotionalArc.parse(JSON.parse(content))
      arc.summary.groundingEvents++
      await fs.writeFile(arcPath, JSON.stringify(arc, null, 2))
    } catch {
      // Arc doesn't exist yet, will be created on next snapshot
    }
  }

  // =============
  // Session Building Helper
  // =============

  /**
   * Create a new session memory builder
   */
  export function createSessionBuilder(projectId?: string): SessionMemoryBuilder {
    return new SessionMemoryBuilder(projectId)
  }

  export class SessionMemoryBuilder {
    private memory: Partial<SessionMemory>
    private goals: string[] = []
    private decisions: string[] = []
    private problems: string[] = []
    private solutions: string[] = []
    private files: string[] = []
    private tools: string[] = []
    private tags: string[] = []
    private keyMoments: KeyMoment[] = []
    private startTime: Date

    constructor(projectId?: string) {
      this.startTime = new Date()
      this.memory = {
        id: ulid(),
        projectId,
        timestamp: this.startTime.toISOString(),
      }
    }

    addGoal(goal: string): this {
      this.goals.push(goal)
      return this
    }

    addDecision(decision: string): this {
      this.decisions.push(decision)
      return this
    }

    addProblem(problem: string): this {
      this.problems.push(problem)
      return this
    }

    addSolution(solution: string): this {
      this.solutions.push(solution)
      return this
    }

    addFile(file: string): this {
      if (!this.files.includes(file)) {
        this.files.push(file)
      }
      return this
    }

    addTool(tool: string): this {
      this.tools.push(tool)
      return this
    }

    addTag(tag: string): this {
      if (!this.tags.includes(tag)) {
        this.tags.push(tag)
      }
      return this
    }

    addKeyMoment(moment: Omit<KeyMoment, "id">): this {
      this.keyMoments.push({ ...moment, id: ulid() })
      return this
    }

    setOutcome(outcome: SessionOutcome): this {
      this.memory.outcome = outcome
      return this
    }

    setEmotionalArc(arc: EmotionalArc): this {
      this.memory.emotionalArc = arc
      return this
    }

    setSummary(summary: string): this {
      this.memory.summary = summary
      return this
    }

    setAgentMode(mode: Emotions.AgentMode): this {
      this.memory.agentMode = mode
      return this
    }

    setAutonomyLevel(level: number): this {
      this.memory.autonomyLevel = level
      return this
    }

    build(): SessionMemory {
      const duration = Math.round((new Date().getTime() - this.startTime.getTime()) / 60000)
      
      // Generate emotional summary from arc if present
      let emotionalSummary = "No emotional data recorded"
      if (this.memory.emotionalArc) {
        const arc = this.memory.emotionalArc
        emotionalSummary = `Started ${arc.summary.startMood}, ended ${arc.summary.endMood}. ` +
          `Peak anxiety: ${arc.summary.peakAnxiety}%, lowest confidence: ${arc.summary.lowestConfidence}%. ` +
          `${arc.summary.moodTransitions} mood transitions, ${arc.summary.groundingEvents} grounding events.`
      }
      
      const embeddingContent: EmbeddingContent = {
        goals: this.goals,
        decisions: this.decisions,
        problems: this.problems,
        solutions: this.solutions,
        filePatterns: this.files,
        emotionalSummary,
        toolsUsed: [...new Set(this.tools)],
        tags: this.tags,
      }
      
      return SessionMemory.parse({
        ...this.memory,
        duration,
        embeddingContent,
        keyMoments: this.keyMoments,
        outcome: this.memory.outcome || {
          type: "ongoing",
          description: "Session ended without explicit outcome",
          goalsCompleted: [],
          goalsIncomplete: this.goals,
          lessonsLearned: [],
        },
        emotionalArc: this.memory.emotionalArc || {
          sessionId: this.memory.id,
          snapshots: [],
          summary: {
            startMood: "neutral",
            endMood: "neutral",
            peakAnxiety: 0,
            lowestConfidence: 100,
            groundingEvents: 0,
            moodTransitions: 0,
          },
        },
        summary: this.memory.summary || `Session working on: ${this.goals.join(", ") || "unspecified tasks"}`,
      })
    }
  }
}
