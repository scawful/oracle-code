/**
 * Halext Backend Endpoint Definitions
 *
 * Typed endpoint paths and request/response configurations
 * aligned with halext-org/backend/app/routers/
 */

import type * as T from "./types"

// =============================================================================
// ENDPOINT CONFIGURATION
// =============================================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH"

export interface Endpoint<TParams = unknown, TBody = unknown, TResponse = unknown> {
  method: HttpMethod
  path: string | ((params: TParams) => string)
  needsAuth: boolean
}

function endpoint<TParams = void, TBody = void, TResponse = unknown>(
  method: HttpMethod,
  path: string | ((params: TParams) => string),
  needsAuth = true,
): Endpoint<TParams, TBody, TResponse> {
  return { method, path, needsAuth }
}

// =============================================================================
// AUTHENTICATION ENDPOINTS
// =============================================================================

export const Auth = {
  /** Create a new sync token */
  createToken: endpoint<void, { name: string; device_id?: string }, T.SyncToken>("POST", "/context/tokens"),

  /** List sync tokens */
  listTokens: endpoint<void, void, T.SyncToken[]>("GET", "/context/tokens"),

  /** Revoke a sync token */
  revokeToken: endpoint<{ tokenId: number }, void, void>("DELETE", (p) => `/context/tokens/${p.tokenId}`),
}

// =============================================================================
// CONTEXT SYNC ENDPOINTS
// =============================================================================

export const Context = {
  /** Get context state entries */
  getState: endpoint<{ section?: T.ContextSection }, void, T.ContextState[]>("GET", "/context/state"),

  /** Upsert a context state entry */
  upsertState: endpoint<void, T.ContextState, T.ContextState>("PUT", "/context/state"),

  /** Bulk upsert context state */
  bulkUpsertState: endpoint<void, T.ContextState[], T.ContextState[]>("POST", "/context/state/bulk"),

  /** Delete a context state entry */
  deleteState: endpoint<{ section: T.ContextSection; key: string }, void, void>(
    "DELETE",
    (p) => `/context/state/${p.section}/${p.key}`,
  ),

  /** Bidirectional sync */
  sync: endpoint<void, T.SyncRequest, T.SyncResponse>("POST", "/context/sync"),

  /** Get prompt context (legacy) */
  getPrompt: endpoint<void, void, T.PromptContext>("GET", "/context/prompt"),

  /** Get tiered prompt context */
  getTieredPrompt: endpoint<
    {
      tier?: T.CognitiveTier
      conversation_id?: number
      agent_id?: number
      include_tasks?: boolean
      include_calendar?: boolean
      include_mood?: boolean
      include_groceries?: boolean
    },
    void,
    T.PromptContext
  >("GET", "/context/prompt/tiered"),

  /** Get user preferences */
  getPreferences: endpoint<void, void, T.UserContextPreferences>("GET", "/context/preferences"),

  /** Update user preferences */
  updatePreferences: endpoint<
    void,
    Partial<{
      cognitive_tier: T.CognitiveTier
      cognitive_format: "verbose" | "condensed"
      include_emotions: boolean
      include_hivemind: boolean
      include_tasks: boolean
      include_calendar: boolean
      include_mood: boolean
      include_groceries: boolean
    }>,
    T.UserContextPreferences
  >("PUT", "/context/preferences"),

  /** Get context load metrics */
  getLoad: endpoint<
    {
      tier?: T.CognitiveTier
      include_tasks?: boolean
      include_calendar?: boolean
      include_mood?: boolean
      include_groceries?: boolean
    },
    void,
    T.ContextLoadMetrics
  >("GET", "/context/load"),
}

// =============================================================================
// HIVEMIND ENDPOINTS
// =============================================================================

export const Hivemind = {
  /** List hivemind entries */
  list: endpoint<
    {
      category?: T.HivemindCategory
      status?: T.HivemindStatus
      scope?: T.HivemindScope
      limit?: number
      offset?: number
    },
    void,
    T.HivemindEntry[]
  >("GET", "/hivemind/entries"),

  /** Get global hivemind entries */
  getGlobal: endpoint<{ category?: T.HivemindCategory; limit?: number }, void, T.HivemindEntry[]>(
    "GET",
    "/context/hivemind/global",
  ),

  /** Create/update hivemind entry */
  upsert: endpoint<void, T.HivemindEntryCreate, T.HivemindEntry>("POST", "/context/hivemind"),

  /** Update hivemind entry */
  update: endpoint<{ entryId: number }, Partial<T.HivemindEntry>, T.HivemindEntry>(
    "PUT",
    (p) => `/context/hivemind/${p.entryId}`,
  ),

  /** Delete hivemind entry */
  delete: endpoint<{ entryId: number }, void, void>("DELETE", (p) => `/context/hivemind/${p.entryId}`),

  /** Record access to entry */
  recordAccess: endpoint<{ entryId: number }, void, T.HivemindEntry>(
    "POST",
    (p) => `/context/hivemind/${p.entryId}/access`,
  ),

  /** Promote entry to golden */
  promoteToGolden: endpoint<{ entryId: number }, void, T.HivemindEntry>(
    "POST",
    (p) => `/hivemind/entries/${p.entryId}/promote-golden`,
  ),

  /** Promote entry to global scope */
  promoteToGlobal: endpoint<{ entryId: number }, void, T.HivemindEntry>(
    "POST",
    (p) => `/context/hivemind/global/${p.entryId}`,
  ),

  /** Get decay status report */
  getDecayStatus: endpoint<
    void,
    void,
    {
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
    }
  >("GET", "/hivemind/decay-status"),

  /** Run batch decay */
  runBatchDecay: endpoint<
    void,
    void,
    {
      entries_decayed: number
      entries_promoted_to_decaying: number
      entries_deleted: number
      entries_unchanged: number
      ran_at: string
    }
  >("POST", "/hivemind/batch-decay"),

  /** Get golden candidates */
  getGoldenCandidates: endpoint<
    void,
    void,
    {
      candidates: Array<{
        key: string
        category: T.HivemindCategory
        access_count: number
        value_preview: string
      }>
      access_threshold: number
      generated_at: string
    }
  >("GET", "/hivemind/golden-candidates"),

  /** Get contested entries */
  getContests: endpoint<
    void,
    void,
    {
      contested_entries: Array<{
        key: string
        values: string[]
        conflict_type: string
      }>
      similarity_threshold: number
      generated_at: string
    }
  >("GET", "/hivemind/contests"),
}

// =============================================================================
// COGNITIVE STATE ENDPOINTS
// =============================================================================

export const Cognitive = {
  /** Get cognitive state */
  get: endpoint<{ conversationId: number; agentId: number }, void, T.CognitiveState>(
    "GET",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/cognitive`,
  ),

  /** Update cognitive state */
  update: endpoint<{ conversationId: number; agentId: number }, T.CognitiveStateUpdate, T.CognitiveState>(
    "PUT",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/cognitive`,
  ),

  /** Check spin detection */
  checkSpin: endpoint<
    { conversationId: number; agentId: number },
    { recent_actions: string[]; threshold: number },
    {
      spin_detected: boolean
      spin_count: number
      pattern: string | null
      recommendation: "continue" | "reflect" | "change_strategy" | "escalate"
    }
  >("POST", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/cognitive/spin`),

  /** Reset spin detection */
  resetSpin: endpoint<{ conversationId: number; agentId: number }, void, T.CognitiveState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/cognitive/reset-spin`,
  ),

  /** Add reflection */
  addReflection: endpoint<{ conversationId: number; agentId: number }, { reflection: string }, T.CognitiveState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/cognitive/reflect`,
  ),

  /** Get cognitive snapshot (all states) */
  getSnapshot: endpoint<{ conversationId: number; agentId: number }, void, T.CognitiveSnapshot>(
    "GET",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/snapshot`,
  ),

  /** Initialize all cognitive states */
  initialize: endpoint<{ conversationId: number; agentId: number }, void, T.CognitiveSnapshot>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/initialize`,
  ),
}

// =============================================================================
// EMOTIONAL STATE ENDPOINTS
// =============================================================================

export const Emotional = {
  /** Get emotional state */
  get: endpoint<{ conversationId: number; agentId: number }, void, T.EmotionalState>(
    "GET",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional`,
  ),

  /** Update emotional state */
  update: endpoint<{ conversationId: number; agentId: number }, Partial<T.EmotionalState>, T.EmotionalState>(
    "PUT",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional`,
  ),

  /** Add fear */
  addFear: endpoint<{ conversationId: number; agentId: number }, { fear: string }, T.EmotionalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional/fear`,
  ),

  /** Resolve fear */
  resolveFear: endpoint<{ conversationId: number; agentId: number; fear: string }, void, T.EmotionalState>(
    "DELETE",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional/fear?fear=${encodeURIComponent(p.fear)}`,
  ),

  /** Add satisfaction */
  addSatisfaction: endpoint<{ conversationId: number; agentId: number }, { satisfaction: string }, T.EmotionalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional/satisfaction`,
  ),

  /** Add rich emotion entry */
  addEmotion: endpoint<{ conversationId: number; agentId: number }, T.EmotionEntryCreate, T.EmotionalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotions`,
  ),

  /** Set session mood */
  setMood: endpoint<{ conversationId: number; agentId: number }, { mood: string; trigger: string }, T.EmotionalState>(
    "PUT",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional/mood`,
  ),

  /** Set current mode */
  setMode: endpoint<
    { conversationId: number; agentId: number },
    { mode: "build" | "explore" | "debug" | "review" | "plan" | "research" },
    T.EmotionalState
  >("PUT", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotional/mode`),

  /** Run emotion decay */
  runDecay: endpoint<
    { conversationId: number; agentId: number },
    { category?: string },
    {
      decayed_count: number
      pruned_count: number
      categories_processed: string[]
      timestamp: string
    }
  >("POST", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/emotions/decay`),
}

// =============================================================================
// GOAL STATE ENDPOINTS
// =============================================================================

export const Goals = {
  /** Get goal state */
  get: endpoint<{ conversationId: number; agentId: number }, void, T.GoalState>(
    "GET",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals`,
  ),

  /** Update goal state */
  update: endpoint<{ conversationId: number; agentId: number }, Partial<T.GoalState>, T.GoalState>(
    "PUT",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals`,
  ),

  /** Set primary goal */
  setPrimary: endpoint<{ conversationId: number; agentId: number }, { goal: string }, T.GoalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals/primary`,
  ),

  /** Push goal to stack */
  push: endpoint<{ conversationId: number; agentId: number }, { goal: string; priority?: T.GoalPriority }, T.GoalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals/push`,
  ),

  /** Pop goal from stack */
  pop: endpoint<{ conversationId: number; agentId: number }, { completed?: boolean }, T.GoalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals/pop`,
  ),

  /** Complete subgoal */
  completeSubgoal: endpoint<{ conversationId: number; agentId: number; subgoalId: string }, void, T.GoalState>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/goals/subgoals/${p.subgoalId}/complete`,
  ),
}

// =============================================================================
// COUNCIL ENDPOINTS
// =============================================================================

export const Council = {
  /** List council sessions */
  list: endpoint<{ conversationId: number; status?: T.CouncilStatus }, void, T.CouncilSession[]>(
    "GET",
    (p) => `/conversations/${p.conversationId}/councils`,
  ),

  /** Create council session */
  create: endpoint<{ conversationId: number }, T.CouncilSessionCreate, T.CouncilSession>(
    "POST",
    (p) => `/conversations/${p.conversationId}/councils`,
  ),

  /** Get council session */
  get: endpoint<{ sessionId: number }, void, T.CouncilSession>("GET", (p) => `/councils/${p.sessionId}`),

  /** Submit vote */
  vote: endpoint<{ sessionId: number }, T.CouncilVoteCreate, T.CouncilVote>(
    "POST",
    (p) => `/councils/${p.sessionId}/vote`,
  ),

  /** Resolve council */
  resolve: endpoint<
    { sessionId: number },
    { outcome: string; final_decision: string; consensus_level: number },
    T.CouncilSession
  >("POST", (p) => `/councils/${p.sessionId}/resolve`),

  /** Add debate entry */
  addDebate: endpoint<
    { sessionId: number },
    { speaker: string; argument?: string; rebuttal?: string },
    T.CouncilSession
  >("POST", (p) => `/councils/${p.sessionId}/debate`),

  /** Get council config */
  getConfig: endpoint<
    void,
    void,
    {
      auto_council_enabled: boolean
      decay_warning_days: number
      golden_access_threshold: number
      contest_similarity_threshold: number
      default_quorum: number
    }
  >("GET", "/council/config"),

  /** Update council config */
  updateConfig: endpoint<
    void,
    Partial<{
      auto_council_enabled: boolean
      decay_warning_days: number
      golden_access_threshold: number
      contest_similarity_threshold: number
      default_quorum: number
    }>,
    {
      auto_council_enabled: boolean
      decay_warning_days: number
      golden_access_threshold: number
      contest_similarity_threshold: number
      default_quorum: number
    }
  >("PUT", "/council/config"),

  /** Run auto council checks */
  runAutoCouncil: endpoint<
    void,
    { conversation_id?: number },
    {
      actions: Array<{
        type: string
        entry_key: string
        council_id?: number
      }>
      councils_created: number
      entries_processed: number
      errors: string[]
      ran_at: string
    }
  >("POST", "/hivemind/auto-council"),
}

// =============================================================================
// ANALYSIS MODE ENDPOINTS
// =============================================================================

export const Analysis = {
  /** Get analysis modes */
  getModes: endpoint<{ conversationId: number; agentId: number }, void, T.AnalysisModeConfig>(
    "GET",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/modes`,
  ),

  /** Update analysis modes */
  updateModes: endpoint<
    { conversationId: number; agentId: number },
    Partial<T.AnalysisModeConfig>,
    T.AnalysisModeConfig
  >("PUT", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/modes`),

  /** Toggle modes */
  toggleModes: endpoint<{ conversationId: number; agentId: number }, T.AnalysisModeToggle, T.AnalysisModeConfig>(
    "POST",
    (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/modes/toggle`,
  ),

  /** Run analysis */
  run: endpoint<
    { conversationId: number; agentId: number; mode: T.AnalysisMode },
    T.AnalysisRunRequest,
    T.AnalysisResult
  >("POST", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/run/${p.mode}`),

  /** Get analysis result */
  getResult: endpoint<
    { conversationId: number; agentId: number; mode: T.AnalysisMode },
    void,
    { mode: T.AnalysisMode; result: unknown }
  >("GET", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/result/${p.mode}`),

  /** Check triggers */
  checkTriggers: endpoint<
    { conversationId: number; agentId: number },
    {
      message_count?: number
      content?: string
      has_code_block?: boolean
      has_error?: boolean
      task_completed?: boolean
    },
    T.TriggerCheckResult
  >("POST", (p) => `/conversations/${p.conversationId}/agents/${p.agentId}/analysis/check-triggers`),

  /** List triggers */
  listTriggers: endpoint<
    {
      conversation_id?: number
      agent_id?: number
      is_active?: boolean
    },
    void,
    T.AnalysisTrigger[]
  >("GET", "/analysis/triggers"),

  /** Create trigger */
  createTrigger: endpoint<void, Omit<T.AnalysisTrigger, "id" | "owner_id">, T.AnalysisTrigger>(
    "POST",
    "/analysis/triggers",
  ),

  /** Update trigger */
  updateTrigger: endpoint<{ triggerId: number }, Partial<T.AnalysisTrigger>, T.AnalysisTrigger>(
    "PUT",
    (p) => `/analysis/triggers/${p.triggerId}`,
  ),

  /** Delete trigger */
  deleteTrigger: endpoint<{ triggerId: number }, void, void>("DELETE", (p) => `/analysis/triggers/${p.triggerId}`),
}
