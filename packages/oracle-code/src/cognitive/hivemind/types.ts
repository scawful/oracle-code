/**
 * Hivemind Types
 *
 * Core type definitions for the Hivemind shared learning system.
 * The Hivemind enables cross-session and cross-project knowledge sharing
 * with decay, council voting for conflicts, and golden entry promotion.
 */

import z from "zod"

// =============
// Core Enums
// =============

export const HivemindCategory = z.enum([
  "fear",
  "satisfaction",
  "knowledge",
  "decision",
  "preference",
])
export type HivemindCategory = z.infer<typeof HivemindCategory>

export const HivemindScope = z.enum(["project", "global"])
export type HivemindScope = z.infer<typeof HivemindScope>

export const EntryStatus = z.enum(["active", "decaying", "golden", "contested"])
export type EntryStatus = z.infer<typeof EntryStatus>

export const CouncilPurpose = z.enum([
  "conflict", // Two values disagree
  "decay_promotion", // Entry about to expire, should it be golden?
  "global_promotion", // Should project entry be promoted to global?
])
export type CouncilPurpose = z.infer<typeof CouncilPurpose>

export const VoteChoice = z.enum(["approve", "reject", "abstain"])
export type VoteChoice = z.infer<typeof VoteChoice>

export const CouncilStatus = z.enum([
  "voting",
  "approved",
  "rejected",
  "tie",
  "debating",
])
export type CouncilStatus = z.infer<typeof CouncilStatus>

// =============
// Entry Source
// =============

export const EntrySource = z.object({
  sessionId: z.string(),
  agentRole: z.string(), // "primary" | "explore" | "critic" etc.
  projectPath: z.string().optional(), // For global entries
  timestamp: z.string(),
  promotionReason: z.string(),
})
export type EntrySource = z.infer<typeof EntrySource>

// =============
// Decay Tracking
// =============

export const DecayInfo = z.object({
  lastAccessed: z.string(),
  accessCount: z.number().default(0),
  decayRate: z.number().min(0).max(1), // Per day
  expiresAt: z.string().optional(), // Calculated expiration
})
export type DecayInfo = z.infer<typeof DecayInfo>

// =============
// Entry Metadata
// =============

export const EntryMetadata = z.object({
  relatedEntries: z.array(z.string()).optional(), // Cross-references
  tags: z.array(z.string()).optional(),
  originalEntryId: z.string().optional(), // Link back to session-local entry
})
export type EntryMetadata = z.infer<typeof EntryMetadata>

// =============
// Contested Info
// =============

export const ContestedInfo = z.object({
  reason: z.string(),
  alternativeValue: z.string().optional(),
  councilSessionId: z.string().optional(),
})
export type ContestedInfo = z.infer<typeof ContestedInfo>

// =============
// Golden Info
// =============

export const GoldenInfo = z.object({
  promotedAt: z.string(),
  promotedBy: z.enum(["auto", "user", "council"]),
  councilSessionId: z.string().optional(),
})
export type GoldenInfo = z.infer<typeof GoldenInfo>

// =============
// Hivemind Entry
// =============

export const HivemindEntry = z.object({
  id: z.string(),
  category: HivemindCategory,
  scope: HivemindScope,
  key: z.string(), // Short identifier
  value: z.string(), // The actual content
  confidence: z.number().min(0).max(1), // Weighted by source reliability
  status: EntryStatus,
  source: EntrySource,
  decay: DecayInfo,
  metadata: EntryMetadata.default({}),
  contested: ContestedInfo.optional(),
  golden: GoldenInfo.optional(),
})
export type HivemindEntry = z.infer<typeof HivemindEntry>

// =============
// Promotion Request
// =============

export const PromotionRequest = z.object({
  id: z.string(),
  entryType: HivemindCategory,
  entry: z.any(), // The session-local entry
  reason: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  autoApprove: z.boolean().default(false),
  requestedBy: z.string(), // Session ID
  timestamp: z.string(),
  status: z.enum(["pending", "approved", "rejected", "contested"]),
  targetScope: HivemindScope,
})
export type PromotionRequest = z.infer<typeof PromotionRequest>

// =============
// Council Vote
// =============

export const CouncilVote = z.object({
  agentRole: z.string(), // explore, critic, general, or custom
  vote: VoteChoice,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  timestamp: z.string(),
})
export type CouncilVote = z.infer<typeof CouncilVote>

// =============
// Council Config
// =============

export const CouncilConfig = z.object({
  councilSize: z.number().min(1).max(7).default(3),
  quorum: z.number().min(1).default(2), // Minimum votes required
  threshold: z.number().min(0.5).max(1).default(0.67), // Approval ratio
  globalPromotionThreshold: z.number().min(0.5).max(1).default(0.67), // Threshold for global promotion
  debateOnTie: z.boolean().default(true),
  councilAgents: z.array(z.string()).default(["explore", "critic", "general"]), // Configurable agents
})
export type CouncilConfig = z.infer<typeof CouncilConfig>

// =============
// Council Audit Info
// =============

export const CouncilAuditInfo = z.object({
  initiatedBy: z.string(), // Session ID that initiated
  initiatedAt: z.string(),
  completedAt: z.string().optional(),
  logPath: z.string().optional(), // Path in history/councils/
})
export type CouncilAuditInfo = z.infer<typeof CouncilAuditInfo>

// =============
// Council Session
// =============

export const CouncilSession = z.object({
  id: z.string(),
  purpose: CouncilPurpose,
  entryKey: z.string(),
  contestReason: z.string(),
  currentValue: z.string(),
  proposedValue: z.string(),
  votes: z.array(CouncilVote).default([]),
  config: CouncilConfig,
  status: CouncilStatus,
  result: z
    .object({
      finalDecision: z.enum(["approve", "reject"]),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    })
    .optional(),
  audit: CouncilAuditInfo,
  timestamp: z.string(),
})
export type CouncilSession = z.infer<typeof CouncilSession>

// =============
// Debate Round
// =============

export const DebateRound = z.object({
  round: z.number(),
  proArgument: z.string(),
  conArgument: z.string(),
  proAgent: z.string(),
  conAgent: z.string(),
})
export type DebateRound = z.infer<typeof DebateRound>

// =============
// Debate Session (extends CouncilSession)
// =============

export const DebateInfo = z.object({
  rounds: z.array(DebateRound).default([]),
  arbitratorAgent: z.string(),
  finalSynthesis: z.string().optional(),
})
export type DebateInfo = z.infer<typeof DebateInfo>

// =============
// Council Audit Log
// =============

export const CouncilAuditLog = z.object({
  session: CouncilSession,
  debate: DebateInfo.optional(),
  outcome: z.object({
    entryId: z.string(),
    action: z.enum([
      "created",
      "updated",
      "promoted_golden",
      "promoted_global",
      "rejected",
    ]),
    previousValue: z.string().optional(),
    newValue: z.string().optional(),
  }),
})
export type CouncilAuditLog = z.infer<typeof CouncilAuditLog>

// =============
// Decay Config
// =============

const DEFAULT_DECAY_RATES = {
  fear: 0.1, // 10% per day
  satisfaction: 0.1,
  knowledge: 0, // Knowledge doesn't decay
  decision: 0.05, // 5% per day
  preference: 0, // Preferences don't decay
}

export const DecayConfig = z.object({
  defaultRates: z
    .object({
      fear: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.fear),
      satisfaction: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.satisfaction),
      knowledge: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.knowledge),
      decision: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.decision),
      preference: z.number().min(0).max(1).default(DEFAULT_DECAY_RATES.preference),
    })
    .default(DEFAULT_DECAY_RATES),
  checkIntervalMs: z.number().default(3600000), // 1 hour
  warningThresholdDays: z.number().default(7), // Warn 7 days before expiry
  goldenExempt: z.boolean().default(true),
  preferencesExempt: z.boolean().default(true),
})
export type DecayConfig = z.infer<typeof DecayConfig>

// =============
// Manifest Stats
// =============

const DEFAULT_CATEGORY_COUNTS = {
  fear: 0,
  satisfaction: 0,
  knowledge: 0,
  decision: 0,
  preference: 0,
}

export const HivemindStats = z.object({
  totalEntries: z.number().default(0),
  entriesByCategory: z
    .object({
      fear: z.number().default(0),
      satisfaction: z.number().default(0),
      knowledge: z.number().default(0),
      decision: z.number().default(0),
      preference: z.number().default(0),
    })
    .default(DEFAULT_CATEGORY_COUNTS),
  goldenCount: z.number().default(0),
  decayingCount: z.number().default(0),
  contestedCount: z.number().default(0),
  lastCouncilVote: z.string().optional(),
})
export type HivemindStats = z.infer<typeof HivemindStats>

// =============
// Hivemind Manifest
// =============

const DEFAULT_STATS: z.infer<typeof HivemindStats> = {
  totalEntries: 0,
  entriesByCategory: DEFAULT_CATEGORY_COUNTS,
  goldenCount: 0,
  decayingCount: 0,
  contestedCount: 0,
}

const DEFAULT_DECAY_CONFIG: z.infer<typeof DecayConfig> = {
  defaultRates: DEFAULT_DECAY_RATES,
  checkIntervalMs: 3600000,
  warningThresholdDays: 7,
  goldenExempt: true,
  preferencesExempt: true,
}

const DEFAULT_COUNCIL_CONFIG: z.infer<typeof CouncilConfig> = {
  councilSize: 3,
  quorum: 2,
  threshold: 0.67,
  globalPromotionThreshold: 0.67,
  debateOnTie: true,
  councilAgents: ["explore", "critic", "general"],
}

// =============
// Global Filter
// =============

export const GlobalFilter = z.object({
  includeTags: z.array(z.string()).optional(), // Only include entries with these tags
  excludeTags: z.array(z.string()).optional(), // Exclude entries with these tags
  includeCategories: z.array(HivemindCategory).optional(), // Only include these categories
  excludeCategories: z.array(HivemindCategory).optional(), // Exclude these categories
  includeKeys: z.array(z.string()).optional(), // Only include entries with keys matching these patterns
  excludeKeys: z.array(z.string()).optional(), // Exclude entries with keys matching these patterns
})
export type GlobalFilter = z.infer<typeof GlobalFilter>

export const HivemindManifest = z.object({
  version: z.string().default("1.0.0"),
  lastSync: z.string(),
  contributors: z.array(z.string()).default([]), // Session IDs that contributed
  globalEnabled: z.boolean().default(false),
  globalFilter: GlobalFilter.optional(), // Filter for which global entries to include
  stats: HivemindStats.default(DEFAULT_STATS),
  decay: DecayConfig.default(DEFAULT_DECAY_CONFIG),
  council: CouncilConfig.default(DEFAULT_COUNCIL_CONFIG),
})
export type HivemindManifest = z.infer<typeof HivemindManifest>

// =============
// Hivemind State
// =============

export const HivemindState = z.object({
  fears: z.array(HivemindEntry).default([]),
  satisfactions: z.array(HivemindEntry).default([]),
  knowledge: z.array(HivemindEntry).default([]),
  decisions: z.array(HivemindEntry).default([]),
  preferences: z.array(HivemindEntry).default([]),
  pending: z.array(PromotionRequest).default([]),
  councils: z.array(CouncilSession).default([]),
  manifest: HivemindManifest,
})
export type HivemindState = z.infer<typeof HivemindState>

// =============
// Decay Result
// =============

export const DecayResult = z.object({
  entry: HivemindEntry,
  daysUntilExpiry: z.number(),
  effectiveStrength: z.number().min(0).max(1),
  shouldWarn: z.boolean(),
  shouldExpire: z.boolean(),
  eligibleForCouncil: z.boolean(), // Can be nominated for golden promotion
})
export type DecayResult = z.infer<typeof DecayResult>

// =============
// Import/Export Types
// =============

export const HivemindExport = z.object({
  version: z.string(),
  exportedAt: z.string(),
  exportedFrom: z.string(), // Project path
  scope: HivemindScope,
  entries: z.array(HivemindEntry),
  manifest: HivemindManifest.partial(),
})
export type HivemindExport = z.infer<typeof HivemindExport>

export const ImportOptions = z.object({
  targetScope: HivemindScope,
  conflictResolution: z.enum(["skip", "replace", "council"]).default("skip"),
  preserveGolden: z.boolean().default(true), // Keep golden status on import
  preserveDecay: z.boolean().default(false), // Keep decay state or reset
})
export type ImportOptions = z.infer<typeof ImportOptions>

export const ImportResult = z.object({
  imported: z.number(),
  skipped: z.number(),
  conflicts: z.number(),
  errors: z.array(z.string()),
})
export type ImportResult = z.infer<typeof ImportResult>

// =============
// Promotion Rule
// =============

export const PromotionRule = z.object({
  autoPromote: z.boolean().default(false),
  minIntensity: z.number().optional(), // For emotions
  requiresResolution: z.boolean().optional(), // For fears
  requiresRepeat: z.number().optional(), // For satisfactions
  requiresGolden: z.boolean().optional(), // For knowledge
  minSessionAge: z.number().optional(), // For decisions
  requiresUserConfirm: z.boolean().optional(),
  requiresExplicit: z.boolean().optional(), // For preferences
  decayRate: z.number().default(0.1),
  goldenEligible: z.boolean().default(true),
})
export type PromotionRule = z.infer<typeof PromotionRule>

// =============
// Helper type for category to array mapping
// =============

export type CategoryArrayKey =
  | "fears"
  | "satisfactions"
  | "knowledge"
  | "decisions"
  | "preferences"

export const categoryToArrayKey: Record<HivemindCategory, CategoryArrayKey> = {
  fear: "fears",
  satisfaction: "satisfactions",
  knowledge: "knowledge",
  decision: "decisions",
  preference: "preferences",
}
