/**
 * Sync Types - Schema definitions aligned with halext-org backend
 *
 * These types mirror the Pydantic schemas from halext-org/backend/app/schemas/
 * to ensure type-safe communication between oracle-code and the backend.
 */

import { z } from "zod"

// =============================================================================
// COGNITIVE STATE
// =============================================================================

export const CognitiveMode = z.enum(["empathetic", "analytical", "creative", "focused", "exploratory"])
export type CognitiveMode = z.infer<typeof CognitiveMode>

export const CognitiveState = z.object({
  id: z.number().optional(),
  conversation_id: z.number(),
  agent_id: z.number(),
  current_strategy: z.string().optional(),
  strategy_confidence: z.number().min(0).max(1).default(0.8),
  spin_count: z.number().default(0),
  spin_pattern: z.string().optional(),
  spin_detected: z.boolean().default(false),
  cognitive_load: z.number().min(0).max(1).default(0),
  context_saturation: z.number().min(0).max(1).default(0),
  tasks_completed: z.number().default(0),
  tasks_pending: z.number().default(0),
  current_task: z.string().optional(),
  uncertainties: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  last_reflection: z.string().optional(),
})
export type CognitiveState = z.infer<typeof CognitiveState>

export const CognitiveStateUpdate = CognitiveState.partial().omit({
  id: true,
  conversation_id: true,
  agent_id: true,
})
export type CognitiveStateUpdate = z.infer<typeof CognitiveStateUpdate>

// =============================================================================
// EMOTIONAL STATE
// =============================================================================

export const EmotionEntry = z.object({
  id: z.string(),
  category: z.string(),
  trigger: z.string(),
  context: z.string().default(""),
  intensity: z.number().min(1).max(10).default(5),
  timestamp: z.string(),
  last_accessed: z.string(),
  access_count: z.number().default(0),
  decay_rate: z.number().min(0).max(1).default(0.1),
})
export type EmotionEntry = z.infer<typeof EmotionEntry>

export const EmotionalState = z.object({
  id: z.number().optional(),
  conversation_id: z.number(),
  agent_id: z.number(),
  mood: z.number().min(0).max(1).default(0.5),
  energy: z.number().min(0).max(1).default(0.7),
  confidence: z.number().min(0).max(1).default(0.8),
  patience: z.number().min(0).max(1).default(0.7),
  curiosity: z.number().min(0).max(1).default(0.6),
  anxiety_level: z.number().min(0).max(1).default(0),
  stress_triggers: z.array(z.string()).default([]),
  fears: z.record(z.string(), EmotionEntry).default({}),
  curiosities: z.record(z.string(), EmotionEntry).default({}),
  satisfactions: z.record(z.string(), EmotionEntry).default({}),
  frustrations: z.record(z.string(), EmotionEntry).default({}),
  excitements: z.record(z.string(), EmotionEntry).default({}),
  determinations: z.record(z.string(), EmotionEntry).default({}),
  cautions: z.record(z.string(), EmotionEntry).default({}),
  reliefs: z.record(z.string(), EmotionEntry).default({}),
  session_mood: z.string().optional(),
  current_mode: z.enum(["build", "explore", "debug", "review", "plan", "research"]).optional(),
})
export type EmotionalState = z.infer<typeof EmotionalState>

export const EmotionEntryCreate = z.object({
  category: z.string(),
  trigger: z.string(),
  context: z.string().optional(),
  intensity: z.number().min(1).max(10).default(5),
  decay_rate: z.number().min(0).max(1).default(0.1),
})
export type EmotionEntryCreate = z.infer<typeof EmotionEntryCreate>

// =============================================================================
// GOAL STATE
// =============================================================================

export const GoalPriority = z.enum(["low", "medium", "high", "critical"])
export type GoalPriority = z.infer<typeof GoalPriority>

export const GoalItem = z.object({
  goal: z.string(),
  progress: z.number().min(0).max(1).default(0),
  priority: GoalPriority.default("medium"),
})
export type GoalItem = z.infer<typeof GoalItem>

export const SubgoalItem = z.object({
  id: z.string(),
  description: z.string(),
  completed: z.boolean().default(false),
  parent_goal: z.string().optional(),
})
export type SubgoalItem = z.infer<typeof SubgoalItem>

export const GoalState = z.object({
  id: z.number().optional(),
  conversation_id: z.number(),
  agent_id: z.number(),
  primary_goal: z.string().optional(),
  primary_goal_progress: z.number().min(0).max(1).default(0),
  goal_stack: z.array(GoalItem).default([]),
  subgoals: z.array(SubgoalItem).default([]),
  blocked_goals: z
    .array(
      z.object({
        goal: z.string(),
        reason: z.string(),
        blocked_at: z.string(),
      }),
    )
    .default([]),
  recently_completed: z.array(z.string()).default([]),
  goals_achieved_session: z.number().default(0),
  goals_failed_session: z.number().default(0),
})
export type GoalState = z.infer<typeof GoalState>

// =============================================================================
// COGNITIVE SNAPSHOT
// =============================================================================

export const CognitiveSnapshot = z.object({
  conversation_id: z.number(),
  agent_id: z.number(),
  cognitive: CognitiveState.optional(),
  emotional: EmotionalState.optional(),
  goals: GoalState.optional(),
  timestamp: z.string(),
})
export type CognitiveSnapshot = z.infer<typeof CognitiveSnapshot>

// =============================================================================
// COUNCIL
// =============================================================================

export const CouncilPurpose = z.enum(["conflict", "decay_promotion", "global_promotion", "decision"])
export type CouncilPurpose = z.infer<typeof CouncilPurpose>

export const CouncilStatus = z.enum(["pending", "voting", "debating", "resolved", "deadlocked"])
export type CouncilStatus = z.infer<typeof CouncilStatus>

export const CouncilVoteType = z.enum(["approve", "reject", "abstain", "modify"])
export type CouncilVoteType = z.infer<typeof CouncilVoteType>

export const CouncilVote = z.object({
  id: z.number().optional(),
  session_id: z.number(),
  agent_id: z.number(),
  vote: CouncilVoteType,
  confidence: z.number().min(0).max(1).default(0.8),
  reasoning: z.string().optional(),
  proposed_modification: z.string().optional(),
  voted_at: z.string(),
})
export type CouncilVote = z.infer<typeof CouncilVote>

export const DebateEntry = z.object({
  speaker: z.string(),
  argument: z.string().optional(),
  rebuttal: z.string().optional(),
  timestamp: z.string(),
})
export type DebateEntry = z.infer<typeof DebateEntry>

export const CouncilSession = z.object({
  id: z.number().optional(),
  conversation_id: z.number(),
  purpose: CouncilPurpose,
  topic: z.string(),
  entry_key: z.string().optional(),
  current_value: z.string().optional(),
  proposed_value: z.string().optional(),
  contest_reason: z.string().optional(),
  votes: z.array(CouncilVote).default([]),
  status: CouncilStatus.default("pending"),
  outcome: z.string().optional(),
  final_decision: z.string().optional(),
  consensus_level: z.number().min(0).max(1).optional(),
  debate_rounds: z.number().default(0),
  debate_log: z.array(DebateEntry).default([]),
  participant_agent_ids: z.array(z.number()).default([]),
  quorum_required: z.number().default(2),
  initiated_by_agent_id: z.number().optional(),
  initiated_by_user_id: z.number().optional(),
  created_at: z.string().optional(),
  resolved_at: z.string().optional(),
})
export type CouncilSession = z.infer<typeof CouncilSession>

export const CouncilSessionCreate = z.object({
  purpose: CouncilPurpose,
  topic: z.string(),
  entry_key: z.string().optional(),
  current_value: z.string().optional(),
  proposed_value: z.string().optional(),
  contest_reason: z.string().optional(),
  participant_agent_ids: z.array(z.number()).default([]),
  quorum_required: z.number().default(2),
  initiated_by_agent_id: z.number().optional(),
  initiated_by_user_id: z.number().optional(),
})
export type CouncilSessionCreate = z.infer<typeof CouncilSessionCreate>

export const CouncilVoteCreate = z.object({
  agent_id: z.number(),
  vote: CouncilVoteType,
  confidence: z.number().min(0).max(1).default(0.8),
  reasoning: z.string().optional(),
  proposed_modification: z.string().optional(),
})
export type CouncilVoteCreate = z.infer<typeof CouncilVoteCreate>

// =============================================================================
// HIVEMIND
// =============================================================================

export const HivemindCategory = z.enum(["fear", "satisfaction", "knowledge", "decision", "preference"])
export type HivemindCategory = z.infer<typeof HivemindCategory>

export const HivemindStatus = z.enum(["active", "golden", "decaying", "contested"])
export type HivemindStatus = z.infer<typeof HivemindStatus>

export const HivemindScope = z.enum(["user", "global"])
export type HivemindScope = z.infer<typeof HivemindScope>

export const HivemindEntry = z.object({
  id: z.number().optional(),
  owner_id: z.number().optional(),
  category: HivemindCategory,
  scope: HivemindScope.default("user"),
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  status: HivemindStatus.default("active"),
  tags: z.array(z.string()).optional(),
  source_device: z.string().optional(),
  source_session_id: z.string().optional(),
  promotion_reason: z.string().optional(),
  last_accessed_at: z.string().optional(),
  access_count: z.number().default(0),
  decay_rate: z.number().min(0).max(1).default(0.1),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})
export type HivemindEntry = z.infer<typeof HivemindEntry>

export const HivemindEntryCreate = z.object({
  category: HivemindCategory,
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  scope: HivemindScope.default("user"),
  status: HivemindStatus.default("active"),
  tags: z.array(z.string()).optional(),
})
export type HivemindEntryCreate = z.infer<typeof HivemindEntryCreate>

// =============================================================================
// CONTEXT STATE
// =============================================================================

export const ContextSection = z.enum(["facts", "assumptions", "decisions", "uncertainties", "goals", "context"])
export type ContextSection = z.infer<typeof ContextSection>

export const ContextState = z.object({
  id: z.number().optional(),
  owner_id: z.number(),
  section: ContextSection,
  key: z.string(),
  value: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})
export type ContextState = z.infer<typeof ContextState>

// =============================================================================
// ANALYSIS MODES
// =============================================================================

export const AnalysisMode = z.enum([
  "eval",
  "tom",
  "metrics",
  "critic",
  "emotional",
  "review",
  "documentation",
  "security",
  "performance",
])
export type AnalysisMode = z.infer<typeof AnalysisMode>

export const AnalysisModeConfig = z.object({
  id: z.number().optional(),
  conversation_id: z.number(),
  agent_id: z.number(),
  enabled_modes: z.array(AnalysisMode).default([]),
  auto_trigger: z.boolean().default(false),
  trigger_interval: z.number().default(5),
  last_run: z.record(z.string(), z.string()).default({}),
  results: z.record(z.string(), z.any()).default({}),
})
export type AnalysisModeConfig = z.infer<typeof AnalysisModeConfig>

export const AnalysisModeToggle = z.object({
  modes: z.array(AnalysisMode),
  enabled: z.boolean(),
})
export type AnalysisModeToggle = z.infer<typeof AnalysisModeToggle>

export const AnalysisRunRequest = z.object({
  content: z.string().optional(),
  context: z.record(z.string(), z.any()).optional(),
  options: z.record(z.string(), z.any()).optional(),
})
export type AnalysisRunRequest = z.infer<typeof AnalysisRunRequest>

export const AnalysisResult = z.object({
  mode: AnalysisMode,
  status: z.enum(["pending", "running", "completed", "error"]),
  timestamp: z.string(),
  data: z.any().optional(),
  errors: z.array(z.string()).default([]),
  conversation_id: z.number().optional(),
  agent_id: z.number().optional(),
  analysis_mode_id: z.number().optional(),
  duration_ms: z.number().optional(),
})
export type AnalysisResult = z.infer<typeof AnalysisResult>

// =============================================================================
// ANALYSIS TRIGGERS
// =============================================================================

export const TriggerCondition = z.enum([
  "message_count",
  "code_block",
  "error_detected",
  "task_completed",
  "keyword_match",
  "time_elapsed",
])
export type TriggerCondition = z.infer<typeof TriggerCondition>

export const AnalysisTrigger = z.object({
  id: z.number().optional(),
  owner_id: z.number(),
  name: z.string(),
  description: z.string().optional(),
  condition: TriggerCondition,
  condition_value: z.any(),
  trigger_modes: z.array(AnalysisMode),
  conversation_id: z.number().optional(),
  agent_id: z.number().optional(),
  is_active: z.boolean().default(true),
  cooldown_seconds: z.number().default(60),
  last_fired: z.string().optional(),
  fire_count: z.number().default(0),
})
export type AnalysisTrigger = z.infer<typeof AnalysisTrigger>

export const TriggerCheckResult = z.object({
  should_trigger: z.boolean(),
  triggered_modes: z.array(AnalysisMode),
  matching_triggers: z.array(z.number()),
  reason: z.string(),
})
export type TriggerCheckResult = z.infer<typeof TriggerCheckResult>

// =============================================================================
// CONTEXT PREFERENCES (v0.3 Tiered Injection)
// =============================================================================

export const CognitiveTier = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export type CognitiveTier = z.infer<typeof CognitiveTier>

export const CognitiveTierConfig = z.object({
  tier: CognitiveTier.default(2),
  format: z.enum(["verbose", "condensed"]).default("condensed"),
  include_emotions: z.boolean().default(true),
  include_hivemind: z.boolean().default(true),
})
export type CognitiveTierConfig = z.infer<typeof CognitiveTierConfig>

export const ContextSourcesConfig = z.object({
  include_tasks: z.boolean().default(true),
  include_calendar: z.boolean().default(true),
  include_mood: z.boolean().default(true),
  include_groceries: z.boolean().default(true),
})
export type ContextSourcesConfig = z.infer<typeof ContextSourcesConfig>

export const UserContextPreferences = z.object({
  cognitive: CognitiveTierConfig.optional().default({
    tier: 2,
    format: "condensed",
    include_emotions: true,
    include_hivemind: true,
  }),
  sources: ContextSourcesConfig.optional().default({
    include_tasks: true,
    include_calendar: true,
    include_mood: true,
    include_groceries: true,
  }),
  updated_at: z.string().optional(),
})
export type UserContextPreferences = z.infer<typeof UserContextPreferences>

export const ContextLoadMetrics = z.object({
  total_tokens: z.number().default(0),
  budget: z.number().default(500),
  utilization: z.number().min(0).max(1).default(0),
  breakdown: z.record(z.string(), z.number()).default({}),
})
export type ContextLoadMetrics = z.infer<typeof ContextLoadMetrics>

// =============================================================================
// SYNC OPERATIONS
// =============================================================================

export const SyncToken = z.object({
  id: z.number(),
  token: z.string(),
  name: z.string(),
  device_id: z.string().optional(),
  created_at: z.string(),
  last_used_at: z.string().optional(),
  expires_at: z.string().optional(),
})
export type SyncToken = z.infer<typeof SyncToken>

export const SyncRequest = z.object({
  device_id: z.string(),
  last_sync_at: z.string().optional(),
  state_entries: z.array(ContextState).default([]),
  hivemind_entries: z.array(HivemindEntry).default([]),
})
export type SyncRequest = z.infer<typeof SyncRequest>

export const SyncResponse = z.object({
  state_entries: z.array(ContextState),
  hivemind_entries: z.array(HivemindEntry),
  conflicts: z
    .array(
      z.object({
        type: z.enum(["state", "hivemind"]),
        key: z.string(),
        local_value: z.string(),
        remote_value: z.string(),
      }),
    )
    .default([]),
  synced_at: z.string(),
})
export type SyncResponse = z.infer<typeof SyncResponse>

// =============================================================================
// PROMPT CONTEXT
// =============================================================================

export const PromptContext = z.object({
  cognitive_state: z.string().optional(),
  hivemind_summary: z.string().optional(),
  dynamic_context: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  tier: CognitiveTier,
  token_count: z.number(),
})
export type PromptContext = z.infer<typeof PromptContext>
