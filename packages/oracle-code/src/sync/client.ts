/**
 * Halext Sync Client
 *
 * HTTP client for communicating with halext-org backend.
 * Supports offline-first operation with queued operations.
 */

import { SyncAuth } from "./auth"
import * as Endpoints from "./endpoints"
import type * as T from "./types"

// =============================================================================
// CLIENT CONFIGURATION
// =============================================================================

export interface SyncClientConfig {
  /** Base URL for the API (e.g., https://api.halext.org) */
  baseUrl?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Retry configuration */
  retry?: {
    maxAttempts: number
    backoffMs: number
    maxBackoffMs: number
  }
}

const DEFAULT_CONFIG: Required<SyncClientConfig> = {
  baseUrl: "https://api.halext.org",
  timeout: 30000,
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    maxBackoffMs: 10000,
  },
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class SyncError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown,
  ) {
    super(message)
    this.name = "SyncError"
  }
}

export class NetworkError extends SyncError {
  constructor(message: string) {
    super(message)
    this.name = "NetworkError"
  }
}

export class AuthError extends SyncError {
  constructor(message: string) {
    super(message, 401)
    this.name = "AuthError"
  }
}

// =============================================================================
// SYNC CLIENT
// =============================================================================

export class SyncClient {
  private config: Required<SyncClientConfig>
  private contextRoot?: string

  constructor(config?: SyncClientConfig, contextRoot?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.contextRoot = contextRoot
  }

  // ===========================================================================
  // CORE REQUEST METHOD
  // ===========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request<TResponse>(
    endpoint: Endpoints.Endpoint<any, any, TResponse>,
    params?: Record<string, unknown>,
    body?: unknown,
  ): Promise<TResponse> {
    // Get base URL
    const baseUrl = (await SyncAuth.getEndpoint(this.contextRoot)) ?? this.config.baseUrl

    // Build path
    const path = typeof endpoint.path === "function" ? endpoint.path(params ?? {}) : endpoint.path

    // Build URL with query params for GET requests
    const url = new URL(path, baseUrl)
    if (endpoint.method === "GET" && params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    if (endpoint.needsAuth) {
      const authHeaders = await SyncAuth.getHeaders(this.contextRoot)
      Object.assign(headers, authHeaders)

      // Check if we have auth
      if (!authHeaders["Authorization"] && !authHeaders["X-Sync-Token"]) {
        throw new AuthError("No authentication configured. Run /sync-config to set up.")
      }
    }

    // Make request with retry
    let lastError: Error | null = null
    const { maxAttempts, backoffMs, maxBackoffMs } = this.config.retry

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

        const response = await fetch(url.toString(), {
          method: endpoint.method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        // Handle response
        if (!response.ok) {
          const errorBody = await response.text().catch(() => "")
          let errorData: unknown
          try {
            errorData = JSON.parse(errorBody)
          } catch {
            errorData = errorBody
          }

          if (response.status === 401 || response.status === 403) {
            throw new AuthError(`Authentication failed: ${response.statusText}`)
          }

          throw new SyncError(`Request failed: ${response.status} ${response.statusText}`, response.status, errorData)
        }

        // Parse response
        const text = await response.text()
        if (!text) return undefined as TResponse
        return JSON.parse(text) as TResponse
      } catch (error) {
        lastError = error as Error

        // Don't retry auth errors
        if (error instanceof AuthError) throw error

        // Don't retry on abort
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new NetworkError("Request timed out")
        }

        // Retry with backoff
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(backoffMs * Math.pow(2, attempt), maxBackoffMs)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError ?? new NetworkError("Request failed after retries")
  }

  // ===========================================================================
  // CONNECTION STATUS
  // ===========================================================================

  /** Check if sync is configured */
  async isConfigured(): Promise<boolean> {
    return SyncAuth.isEnabled(this.contextRoot)
  }

  /** Test connection to backend */
  async ping(): Promise<boolean> {
    try {
      await this.request(Endpoints.Context.getPreferences, {})
      return true
    } catch {
      return false
    }
  }

  // ===========================================================================
  // CONTEXT SYNC
  // ===========================================================================

  /** Get context state entries */
  async getState(section?: T.ContextSection): Promise<T.ContextState[]> {
    return this.request(Endpoints.Context.getState, { section })
  }

  /** Upsert context state */
  async upsertState(entry: T.ContextState): Promise<T.ContextState> {
    return this.request(Endpoints.Context.upsertState, {}, entry)
  }

  /** Bulk upsert context state */
  async bulkUpsertState(entries: T.ContextState[]): Promise<T.ContextState[]> {
    return this.request(Endpoints.Context.bulkUpsertState, {}, entries)
  }

  /** Delete context state entry */
  async deleteState(section: T.ContextSection, key: string): Promise<void> {
    return this.request(Endpoints.Context.deleteState, { section, key })
  }

  /** Bidirectional sync */
  async sync(request: T.SyncRequest): Promise<T.SyncResponse> {
    const response = await this.request(Endpoints.Context.sync, {}, request)
    await SyncAuth.recordSync(this.contextRoot)
    return response
  }

  /** Get tiered prompt context */
  async getTieredPrompt(options?: {
    tier?: T.CognitiveTier
    conversationId?: number
    agentId?: number
    includeTasks?: boolean
    includeCalendar?: boolean
    includeMood?: boolean
    includeGroceries?: boolean
  }): Promise<T.PromptContext> {
    return this.request(Endpoints.Context.getTieredPrompt, {
      tier: options?.tier,
      conversation_id: options?.conversationId,
      agent_id: options?.agentId,
      include_tasks: options?.includeTasks,
      include_calendar: options?.includeCalendar,
      include_mood: options?.includeMood,
      include_groceries: options?.includeGroceries,
    })
  }

  /** Get user preferences */
  async getPreferences(): Promise<T.UserContextPreferences> {
    return this.request(Endpoints.Context.getPreferences, {})
  }

  /** Update user preferences */
  async updatePreferences(
    update: Partial<{
      cognitiveTier: T.CognitiveTier
      cognitiveFormat: "verbose" | "condensed"
      includeEmotions: boolean
      includeHivemind: boolean
      includeTasks: boolean
      includeCalendar: boolean
      includeMood: boolean
      includeGroceries: boolean
    }>,
  ): Promise<T.UserContextPreferences> {
    return this.request(
      Endpoints.Context.updatePreferences,
      {},
      {
        cognitive_tier: update.cognitiveTier,
        cognitive_format: update.cognitiveFormat,
        include_emotions: update.includeEmotions,
        include_hivemind: update.includeHivemind,
        include_tasks: update.includeTasks,
        include_calendar: update.includeCalendar,
        include_mood: update.includeMood,
        include_groceries: update.includeGroceries,
      },
    )
  }

  /** Get context load metrics */
  async getLoadMetrics(options?: {
    tier?: T.CognitiveTier
    includeTasks?: boolean
    includeCalendar?: boolean
    includeMood?: boolean
    includeGroceries?: boolean
  }): Promise<T.ContextLoadMetrics> {
    return this.request(Endpoints.Context.getLoad, {
      tier: options?.tier,
      include_tasks: options?.includeTasks,
      include_calendar: options?.includeCalendar,
      include_mood: options?.includeMood,
      include_groceries: options?.includeGroceries,
    })
  }

  // ===========================================================================
  // HIVEMIND
  // ===========================================================================

  /** List hivemind entries */
  async listHivemind(options?: {
    category?: T.HivemindCategory
    status?: T.HivemindStatus
    scope?: T.HivemindScope
    limit?: number
    offset?: number
  }): Promise<T.HivemindEntry[]> {
    return this.request(Endpoints.Hivemind.list, options)
  }

  /** Get global hivemind entries */
  async getGlobalHivemind(options?: { category?: T.HivemindCategory; limit?: number }): Promise<T.HivemindEntry[]> {
    return this.request(Endpoints.Hivemind.getGlobal, options)
  }

  /** Create/update hivemind entry */
  async upsertHivemind(entry: T.HivemindEntryCreate): Promise<T.HivemindEntry> {
    return this.request(Endpoints.Hivemind.upsert, {}, entry)
  }

  /** Update hivemind entry */
  async updateHivemind(entryId: number, update: Partial<T.HivemindEntry>): Promise<T.HivemindEntry> {
    return this.request(Endpoints.Hivemind.update, { entryId }, update)
  }

  /** Delete hivemind entry */
  async deleteHivemind(entryId: number): Promise<void> {
    return this.request(Endpoints.Hivemind.delete, { entryId })
  }

  /** Record access to hivemind entry */
  async accessHivemind(entryId: number): Promise<T.HivemindEntry> {
    return this.request(Endpoints.Hivemind.recordAccess, { entryId })
  }

  /** Promote entry to golden */
  async promoteToGolden(entryId: number): Promise<T.HivemindEntry> {
    return this.request(Endpoints.Hivemind.promoteToGolden, { entryId })
  }

  /** Promote entry to global scope */
  async promoteToGlobal(entryId: number): Promise<T.HivemindEntry> {
    return this.request(Endpoints.Hivemind.promoteToGlobal, { entryId })
  }

  /** Get decay status report */
  async getDecayStatus(): Promise<{
    entries_decaying: Array<{
      key: string
      category: T.HivemindCategory
      days_until_expiry: number
      last_accessed_at: string
    }>
    entries_expired: Array<{
      key: string
      category: T.HivemindCategory
      expired_at: string
    }>
    total_active: number
    total_golden: number
    decay_warning_days: number
    generated_at: string
  }> {
    return this.request(Endpoints.Hivemind.getDecayStatus, {})
  }

  /** Run batch decay */
  async runBatchDecay(): Promise<{
    entries_decayed: number
    entries_promoted_to_decaying: number
    entries_deleted: number
    entries_unchanged: number
    ran_at: string
  }> {
    return this.request(Endpoints.Hivemind.runBatchDecay, {})
  }

  /** Get golden candidates */
  async getGoldenCandidates(): Promise<{
    candidates: Array<{
      key: string
      category: T.HivemindCategory
      access_count: number
      value_preview: string
    }>
    access_threshold: number
    generated_at: string
  }> {
    return this.request(Endpoints.Hivemind.getGoldenCandidates, {})
  }

  /** Get contested entries */
  async getContests(): Promise<{
    contested_entries: Array<{
      key: string
      values: string[]
      conflict_type: string
    }>
    similarity_threshold: number
    generated_at: string
  }> {
    return this.request(Endpoints.Hivemind.getContests, {})
  }

  // ===========================================================================
  // COGNITIVE STATE
  // ===========================================================================

  /** Get cognitive state */
  async getCognitiveState(conversationId: number, agentId: number): Promise<T.CognitiveState> {
    return this.request(Endpoints.Cognitive.get, { conversationId, agentId })
  }

  /** Update cognitive state */
  async updateCognitiveState(
    conversationId: number,
    agentId: number,
    update: T.CognitiveStateUpdate,
  ): Promise<T.CognitiveState> {
    return this.request(Endpoints.Cognitive.update, { conversationId, agentId }, update)
  }

  /** Check spin detection */
  async checkSpin(
    conversationId: number,
    agentId: number,
    recentActions: string[],
    threshold = 3,
  ): Promise<{
    spin_detected: boolean
    spin_count: number
    pattern: string | null
    recommendation: "continue" | "reflect" | "change_strategy" | "escalate"
  }> {
    return this.request(
      Endpoints.Cognitive.checkSpin,
      { conversationId, agentId },
      { recent_actions: recentActions, threshold },
    )
  }

  /** Reset spin detection */
  async resetSpin(conversationId: number, agentId: number): Promise<T.CognitiveState> {
    return this.request(Endpoints.Cognitive.resetSpin, { conversationId, agentId })
  }

  /** Get cognitive snapshot (all states) */
  async getCognitiveSnapshot(conversationId: number, agentId: number): Promise<T.CognitiveSnapshot> {
    return this.request(Endpoints.Cognitive.getSnapshot, { conversationId, agentId })
  }

  /** Initialize all cognitive states */
  async initializeCognitive(conversationId: number, agentId: number): Promise<T.CognitiveSnapshot> {
    return this.request(Endpoints.Cognitive.initialize, { conversationId, agentId })
  }

  // ===========================================================================
  // EMOTIONAL STATE
  // ===========================================================================

  /** Get emotional state */
  async getEmotionalState(conversationId: number, agentId: number): Promise<T.EmotionalState> {
    return this.request(Endpoints.Emotional.get, { conversationId, agentId })
  }

  /** Update emotional state */
  async updateEmotionalState(
    conversationId: number,
    agentId: number,
    update: Partial<T.EmotionalState>,
  ): Promise<T.EmotionalState> {
    return this.request(Endpoints.Emotional.update, { conversationId, agentId }, update)
  }

  /** Add rich emotion entry */
  async addEmotion(conversationId: number, agentId: number, entry: T.EmotionEntryCreate): Promise<T.EmotionalState> {
    return this.request(Endpoints.Emotional.addEmotion, { conversationId, agentId }, entry)
  }

  /** Set session mood */
  async setMood(conversationId: number, agentId: number, mood: string, trigger: string): Promise<T.EmotionalState> {
    return this.request(Endpoints.Emotional.setMood, { conversationId, agentId }, { mood, trigger })
  }

  /** Set current mode */
  async setMode(
    conversationId: number,
    agentId: number,
    mode: "build" | "explore" | "debug" | "review" | "plan" | "research",
  ): Promise<T.EmotionalState> {
    return this.request(Endpoints.Emotional.setMode, { conversationId, agentId }, { mode })
  }

  // ===========================================================================
  // GOAL STATE
  // ===========================================================================

  /** Get goal state */
  async getGoalState(conversationId: number, agentId: number): Promise<T.GoalState> {
    return this.request(Endpoints.Goals.get, { conversationId, agentId })
  }

  /** Set primary goal */
  async setPrimaryGoal(conversationId: number, agentId: number, goal: string): Promise<T.GoalState> {
    return this.request(Endpoints.Goals.setPrimary, { conversationId, agentId }, { goal })
  }

  /** Push goal to stack */
  async pushGoal(
    conversationId: number,
    agentId: number,
    goal: string,
    priority?: T.GoalPriority,
  ): Promise<T.GoalState> {
    return this.request(Endpoints.Goals.push, { conversationId, agentId }, { goal, priority })
  }

  /** Pop goal from stack */
  async popGoal(conversationId: number, agentId: number, completed = true): Promise<T.GoalState> {
    return this.request(Endpoints.Goals.pop, { conversationId, agentId }, { completed })
  }

  // ===========================================================================
  // COUNCIL
  // ===========================================================================

  /** List council sessions */
  async listCouncils(conversationId: number, status?: T.CouncilStatus): Promise<T.CouncilSession[]> {
    return this.request(Endpoints.Council.list, { conversationId, status })
  }

  /** Create council session */
  async createCouncil(conversationId: number, session: T.CouncilSessionCreate): Promise<T.CouncilSession> {
    return this.request(Endpoints.Council.create, { conversationId }, session)
  }

  /** Get council session */
  async getCouncil(sessionId: number): Promise<T.CouncilSession> {
    return this.request(Endpoints.Council.get, { sessionId })
  }

  /** Submit council vote */
  async voteCouncil(sessionId: number, vote: T.CouncilVoteCreate): Promise<T.CouncilVote> {
    return this.request(Endpoints.Council.vote, { sessionId }, vote)
  }

  /** Resolve council */
  async resolveCouncil(
    sessionId: number,
    outcome: string,
    finalDecision: string,
    consensusLevel: number,
  ): Promise<T.CouncilSession> {
    return this.request(
      Endpoints.Council.resolve,
      { sessionId },
      { outcome, final_decision: finalDecision, consensus_level: consensusLevel },
    )
  }

  /** Run auto council checks */
  async runAutoCouncil(conversationId?: number): Promise<{
    actions: Array<{
      type: string
      entry_key: string
      council_id?: number
    }>
    councils_created: number
    entries_processed: number
    errors: string[]
    ran_at: string
  }> {
    return this.request(Endpoints.Council.runAutoCouncil, {}, { conversation_id: conversationId })
  }

  // ===========================================================================
  // ANALYSIS MODES
  // ===========================================================================

  /** Get analysis modes */
  async getAnalysisModes(conversationId: number, agentId: number): Promise<T.AnalysisModeConfig> {
    return this.request(Endpoints.Analysis.getModes, { conversationId, agentId })
  }

  /** Toggle analysis modes */
  async toggleAnalysisModes(
    conversationId: number,
    agentId: number,
    modes: T.AnalysisMode[],
    enabled: boolean,
  ): Promise<T.AnalysisModeConfig> {
    return this.request(Endpoints.Analysis.toggleModes, { conversationId, agentId }, { modes, enabled })
  }

  /** Run analysis */
  async runAnalysis(
    conversationId: number,
    agentId: number,
    mode: T.AnalysisMode,
    request: T.AnalysisRunRequest,
  ): Promise<T.AnalysisResult> {
    return this.request(Endpoints.Analysis.run, { conversationId, agentId, mode }, request)
  }

  /** Check triggers */
  async checkTriggers(
    conversationId: number,
    agentId: number,
    conditions: {
      messageCount?: number
      content?: string
      hasCodeBlock?: boolean
      hasError?: boolean
      taskCompleted?: boolean
    },
  ): Promise<T.TriggerCheckResult> {
    return this.request(
      Endpoints.Analysis.checkTriggers,
      { conversationId, agentId },
      {
        message_count: conditions.messageCount,
        content: conditions.content,
        has_code_block: conditions.hasCodeBlock,
        has_error: conditions.hasError,
        task_completed: conditions.taskCompleted,
      },
    )
  }

  /** List analysis triggers */
  async listTriggers(options?: {
    conversationId?: number
    agentId?: number
    isActive?: boolean
  }): Promise<T.AnalysisTrigger[]> {
    return this.request(Endpoints.Analysis.listTriggers, {
      conversation_id: options?.conversationId,
      agent_id: options?.agentId,
      is_active: options?.isActive,
    })
  }

  /** Create analysis trigger */
  async createTrigger(trigger: Omit<T.AnalysisTrigger, "id" | "owner_id">): Promise<T.AnalysisTrigger> {
    return this.request(Endpoints.Analysis.createTrigger, {}, trigger)
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let defaultClient: SyncClient | null = null

export function getSyncClient(config?: SyncClientConfig, contextRoot?: string): SyncClient {
  if (!defaultClient || config || contextRoot) {
    defaultClient = new SyncClient(config, contextRoot)
  }
  return defaultClient
}

export function resetSyncClient(): void {
  defaultClient = null
}
