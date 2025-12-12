/**
 * Analysis Module - AFS Cognitive Protocol v0.2
 *
 * Provides analysis modes for evaluating agent performance:
 * - Adaptive harsh critic with tone state machine
 * - Trigger system for automatic mode activation
 * - Type definitions for all analysis modes
 *
 * Per PROTOCOL_SPEC.md Sections 5.1-5.3.
 */

// Types and schemas
export {
  // Analysis modes
  AnalysisMode,
  AnalysisResult,
  AnalysisGateMode,

  // Critic types
  CriticTone,
  CriticReview,
  CriticState,
  AdaptiveCriticConfig,
  ReviewSeverity,
  TONE_PREFIXES,

  // Theory of Mind
  ToMMarkerType,
  ToMMarker,
  ToMAnalysis,

  // Scaling metrics
  AgentArchitecture,
  ScalingMetrics,

  // Trigger types
  TriggerConditionType,
  TriggerPriority,
} from "./types"

// Adaptive Critic
export {
  AdaptiveCritic,
  getCritic,
  resetCritic,
} from "./critic"

// Trigger System
export {
  TriggerManager,
  getTriggerManager,
  resetTriggerManager,
  type TriggerCondition,
  type TriggerAction,
  type AnalysisTrigger,
  type TriggerEvent,
} from "./triggers"
