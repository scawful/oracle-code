/**
 * Analysis Mode Types - AFS Cognitive Protocol v0.2
 *
 * Type definitions for analysis modes per PROTOCOL_SPEC.md Section 5.
 */

import z from "zod"

/**
 * Analysis modes available per PROTOCOL_SPEC.md Section 5.1.
 */
export const AnalysisMode = z.enum([
  "none",           // Standard operation, no analysis overlay
  "eval",           // Prompt/response quality evaluation
  "tom",            // Theory of Mind marker detection
  "metrics",        // Coordination efficiency and scaling metrics
  "critic",         // Adaptive harsh criticism
  "emotional",      // Emotional valence and cognitive load
  "synergy",        // Human-AI collaboration quality (future)
  "review",         // Google-style code review
  "documentation",  // Comment placement analysis
])
export type AnalysisMode = z.infer<typeof AnalysisMode>

/**
 * Critic tone levels per PROTOCOL_SPEC.md Section 5.2.4.
 */
export const CriticTone = z.enum([
  "neutral",      // No prefix
  "direct",       // "Identify issues in this:"
  "challenging",  // "I doubt this is correct. Find the problems:"
  "harsh",        // "This looks wrong. Point out every flaw:"
])
export type CriticTone = z.infer<typeof CriticTone>

/**
 * Tone prefixes from the "Mind Your Tone" paper.
 */
export const TONE_PREFIXES: Record<CriticTone, string> = {
  neutral: "",
  direct: "Identify issues in this:",
  challenging: "I doubt this is correct. Find the problems:",
  harsh: "This looks wrong. Point out every flaw:",
}

/**
 * Review severity levels.
 */
export const ReviewSeverity = z.enum([
  "critical",
  "major",
  "minor",
  "nitpick",
])
export type ReviewSeverity = z.infer<typeof ReviewSeverity>

/**
 * A single review finding from the critic.
 */
export const CriticReview = z.object({
  severity: ReviewSeverity,
  aspect: z.string().optional(),
  location: z.object({
    file: z.string(),
    line: z.number().optional(),
  }).optional(),
  issue: z.string(),
  suggestion: z.string().optional(),
  confidence: z.number().min(0).max(1),
})
export type CriticReview = z.infer<typeof CriticReview>

/**
 * Configuration for the adaptive critic.
 */
export const AdaptiveCriticConfig = z.object({
  // Default: harsh (per Mind Your Tone findings: +4% accuracy)
  defaultTone: CriticTone.optional(),

  // Automatic downgrade thresholds
  anxietyThreshold: z.number().min(0).max(1).optional(),
  anxietyDowngradeTo: CriticTone.optional(),

  frustrationCountThreshold: z.number().optional(),
  frustrationDowngradeTo: CriticTone.optional(),

  // Manual override
  allowUserEscalation: z.boolean().optional(),
  allowUserOverride: z.boolean().optional(),

  // Gradual escalation when stable
  stableIterationsForEscalation: z.number().optional(),
  escalationPath: z.array(CriticTone).optional(),
})
export type AdaptiveCriticConfig = z.infer<typeof AdaptiveCriticConfig>

/**
 * Critic state tracking.
 */
export const CriticState = z.object({
  currentTone: CriticTone,
  stableIterations: z.number(),
  userOverride: CriticTone.optional(),
  lastAnxiety: z.number(),
  frustrationCount: z.number(),
})
export type CriticState = z.infer<typeof CriticState>

/**
 * Analysis result from any mode.
 */
export const AnalysisResult = z.object({
  mode: AnalysisMode,
  timestamp: z.string(),
  success: z.boolean(),
  error: z.string().optional(),

  // Mode-specific results
  data: z.record(z.string(), z.unknown()).optional(),

  // Metadata
  durationMs: z.number().optional(),
  modelUsed: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})
export type AnalysisResult = z.infer<typeof AnalysisResult>

/**
 * Theory of Mind marker types (17 indicators from paper 7799).
 */
export const ToMMarkerType = z.enum([
  // High ToM Indicators
  "perspective_taking",
  "goal_inference",
  "knowledge_gap_detection",
  "communication_repair",
  "confirmation_seeking",
  "mental_state_attribution",
  "plan_coordination",
  "belief_tracking",
  "explanatory_dialogue",
  "build_on_ideas",
  "reference_back",
  "challenge_disagree",
  "epistemic_markers",
  "justification_requests",
  "metacognitive_references",
  "conversational_adaptation",
  // Low ToM Indicators (negative markers)
  "irrelevant_sharing",
  "assumed_context",
  "capability_misunderstanding",
])
export type ToMMarkerType = z.infer<typeof ToMMarkerType>

/**
 * A detected ToM marker.
 */
export const ToMMarker = z.object({
  type: ToMMarkerType,
  text: z.string(),
  position: z.number(),
  confidence: z.number().min(0).max(1),
})
export type ToMMarker = z.infer<typeof ToMMarker>

/**
 * ToM analysis result.
 */
export const ToMAnalysis = z.object({
  markersDetected: z.array(ToMMarker),
  traitTomScore: z.number().min(0).max(1),
  dynamicTomDeviation: z.number(),
  predictedResponseQuality: z.number(),
})
export type ToMAnalysis = z.infer<typeof ToMAnalysis>

/**
 * Agent architecture types for scaling metrics.
 */
export const AgentArchitecture = z.enum([
  "single",       // One agent, sequential
  "independent",  // Multiple agents, no inter-agent communication
  "centralized",  // Orchestrator coordinates worker agents
  "decentralized", // All agents can communicate with each other
  "hybrid",       // Centralized + peer communication
])
export type AgentArchitecture = z.infer<typeof AgentArchitecture>

/**
 * Scaling metrics per PROTOCOL_SPEC.md Section 5.2.3.
 */
export const ScalingMetrics = z.object({
  coordinationOverhead: z.number(),
  messageDensity: z.number(),
  redundancyRate: z.number(),
  coordinationEfficiency: z.number(),
  errorAmplification: z.number(),

  baselineAccuracy: z.number(),
  taskToolCount: z.number(),
  taskDecomposability: z.number(),

  shouldUseMultiAgent: z.boolean(),
  recommendedArchitecture: AgentArchitecture,
  maxEffectiveAgents: z.number(),

  errorRates: z.record(z.string(), z.number()).optional(),
})
export type ScalingMetrics = z.infer<typeof ScalingMetrics>

/**
 * Trigger condition types.
 */
export const TriggerConditionType = z.enum([
  "threshold",  // Metric exceeds threshold
  "pattern",    // Regex pattern match
  "count",      // Event count within window
  "time",       // Time-based trigger
])
export type TriggerConditionType = z.infer<typeof TriggerConditionType>

/**
 * Trigger priority levels.
 */
export const TriggerPriority = z.enum([
  "low",
  "medium",
  "high",
  "critical",
])
export type TriggerPriority = z.infer<typeof TriggerPriority>

/**
 * Analysis gate modes.
 */
export const AnalysisGateMode = z.enum([
  "confirm-all",   // All triggers require user confirmation (default)
  "auto-accept",   // Flow-friendly automatic acceptance
  "auto-deny",     // Silently ignore all triggers
  "selective",     // Per-trigger configuration
])
export type AnalysisGateMode = z.infer<typeof AnalysisGateMode>
