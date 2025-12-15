/**
 * Halext Sync Module
 *
 * Provides synchronization between oracle-code and halext-org backend.
 * Supports offline-first operation with optional cloud sync.
 *
 * @module sync
 */

export { SyncClient, getSyncClient, resetSyncClient, SyncError, NetworkError, AuthError } from "./client"
export type { SyncClientConfig } from "./client"

export { SyncAuth } from "./auth"
export type { SyncConfig } from "./auth"

export * as Endpoints from "./endpoints"
export * as Types from "./types"

// Re-export commonly used types
export type {
  CognitiveState,
  CognitiveStateUpdate,
  CognitiveSnapshot,
  EmotionalState,
  EmotionEntry,
  EmotionEntryCreate,
  GoalState,
  GoalItem,
  GoalPriority,
  HivemindEntry,
  HivemindEntryCreate,
  HivemindCategory,
  HivemindStatus,
  HivemindScope,
  CouncilSession,
  CouncilSessionCreate,
  CouncilVote,
  CouncilVoteCreate,
  CouncilPurpose,
  CouncilStatus,
  ContextState,
  ContextSection,
  AnalysisMode,
  AnalysisModeConfig,
  AnalysisResult,
  AnalysisTrigger,
  TriggerCheckResult,
  UserContextPreferences,
  ContextLoadMetrics,
  CognitiveTier,
  SyncRequest,
  SyncResponse,
  PromptContext,
} from "./types"
