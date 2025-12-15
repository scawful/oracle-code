/**
 * Cognitive Metrics Module
 *
 * Tracks session-level metrics to measure the effectiveness of the cognitive protocol.
 * Enables A/B testing of different configurations and validates which features help.
 *
 * Key metrics:
 * - Token overhead: How many tokens spent on cognitive state injection
 * - Outcome correlation: Does anxiety/confidence predict tool success?
 * - Spin accuracy: Do spin warnings precede actual spinning?
 * - User corrections: How often does user override agent decisions?
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { ulid } from "ulid"
import { AFS } from "../afs"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"

const log = Log.create({ service: "cognitive-metrics" })

export namespace CognitiveMetrics {
  // =============
  // Constants
  // =============

  const METRICS_DIR = "metrics"
  const SESSION_METRICS_FILE = "session-metrics.json"
  const AGGREGATE_FILE = "aggregate.json"

  // =============
  // Schemas
  // =============

  export const CognitiveTier = z.enum(["0", "1", "2", "3"])
  export type CognitiveTier = z.infer<typeof CognitiveTier>

  export const CognitiveFormat = z.enum(["verbose", "condensed"])
  export type CognitiveFormat = z.infer<typeof CognitiveFormat>

  export const AnxietySample = z.object({
    timestamp: z.string(),
    level: z.number(),
    nextToolSuccess: z.boolean().optional(),
    toolName: z.string().optional(),
  })
  export type AnxietySample = z.infer<typeof AnxietySample>

  export const ConfidenceSample = z.object({
    timestamp: z.string(),
    level: z.number(),
    nextToolSuccess: z.boolean().optional(),
    toolName: z.string().optional(),
  })
  export type ConfidenceSample = z.infer<typeof ConfidenceSample>

  export const SessionOutcomes = z.object({
    goalsStated: z.number().default(0),
    goalsCompleted: z.number().default(0),
    toolCallsTotal: z.number().default(0),
    toolCallsSucceeded: z.number().default(0),
    toolCallsFailed: z.number().default(0),
    spinWarningsIssued: z.number().default(0),
    spinWarningsAccurate: z.number().default(0),
    userCorrections: z.number().default(0),
    errorsRecovered: z.number().default(0),
  })
  export type SessionOutcomes = z.infer<typeof SessionOutcomes>

  export const SessionEfficiency = z.object({
    totalTokensIn: z.number().default(0),
    totalTokensOut: z.number().default(0),
    cognitiveOverheadTokens: z.number().default(0),
    cognitiveInjectionCount: z.number().default(0),
    turnsTotal: z.number().default(0),
    turnsToFirstGoalCompletion: z.number().optional(),
    averageTurnsPerGoal: z.number().optional(),
  })
  export type SessionEfficiency = z.infer<typeof SessionEfficiency>

  export const SessionMetrics = z.object({
    schemaVersion: z.literal("0.3"),
    id: z.string(),
    sessionId: z.string(),
    startedAt: z.string(),
    endedAt: z.string().optional(),

    // Configuration for this session (for A/B comparison)
    config: z.object({
      cognitiveTier: CognitiveTier.default("1"),
      cognitiveFormat: CognitiveFormat.default("verbose"),
      promptInjectionEnabled: z.boolean().default(true),
      emotionsEnabled: z.boolean().default(true),
      hivemindEnabled: z.boolean().default(true),
      mode: z.string().default("build"),
    }),

    // Outcome metrics
    outcomes: SessionOutcomes,

    // Efficiency metrics
    efficiency: SessionEfficiency,

    // Correlation samples (for statistical analysis)
    anxietySamples: z.array(AnxietySample).default([]),
    confidenceSamples: z.array(ConfidenceSample).default([]),

    // Derived metrics (calculated on session end)
    derived: z
      .object({
        toolSuccessRate: z.number().optional(),
        cognitiveOverheadPercent: z.number().optional(),
        goalCompletionRate: z.number().optional(),
        spinWarningAccuracy: z.number().optional(),
        anxietyCorrelation: z.number().optional(),
        confidenceCorrelation: z.number().optional(),
      })
      .optional(),
  })
  export type SessionMetrics = z.infer<typeof SessionMetrics>

  export const AggregateMetrics = z.object({
    schemaVersion: z.literal("0.3"),
    lastUpdated: z.string(),
    totalSessions: z.number().default(0),

    // Aggregate by format (for A/B comparison)
    byFormat: z
      .record(
        z.string(),
        z.object({
          sessionCount: z.number(),
          avgToolSuccessRate: z.number(),
          avgCognitiveOverheadPercent: z.number(),
          avgGoalCompletionRate: z.number(),
          avgSpinWarningAccuracy: z.number(),
        }),
      )
      .optional()
      .default({}),

    // Aggregate by tier
    byTier: z
      .record(
        z.string(),
        z.object({
          sessionCount: z.number(),
          avgToolSuccessRate: z.number(),
          avgCognitiveOverheadPercent: z.number(),
        }),
      )
      .optional()
      .default({}),
  })
  export type AggregateMetrics = z.infer<typeof AggregateMetrics>

  // =============
  // Events
  // =============

  export const Event = {
    SessionStarted: BusEvent.define(
      "metrics.session.started",
      z.object({ sessionId: z.string(), metricsId: z.string() }),
    ),
    SessionEnded: BusEvent.define("metrics.session.ended", z.object({ sessionId: z.string(), metricsId: z.string() })),
    ToolRecorded: BusEvent.define("metrics.tool.recorded", z.object({ toolName: z.string(), success: z.boolean() })),
  }

  // =============
  // State
  // =============

  let currentMetrics: SessionMetrics | null = null
  let pendingAnxietySample: Omit<AnxietySample, "nextToolSuccess"> | null = null
  let pendingConfidenceSample: Omit<ConfidenceSample, "nextToolSuccess"> | null = null

  // =============
  // Path Helpers
  // =============

  async function getMetricsDir(root?: string): Promise<string> {
    const afsRoot = root || (await AFS.getRoot())
    const dir = path.join(afsRoot, "scratchpad", METRICS_DIR)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async function getSessionMetricsPath(root?: string): Promise<string> {
    const dir = await getMetricsDir(root)
    return path.join(dir, SESSION_METRICS_FILE)
  }

  async function getAggregatePath(root?: string): Promise<string> {
    const dir = await getMetricsDir(root)
    return path.join(dir, AGGREGATE_FILE)
  }

  // =============
  // Session Lifecycle
  // =============

  /**
   * Start tracking metrics for a new session
   */
  export async function startSession(
    sessionId: string,
    config: Partial<SessionMetrics["config"]> = {},
  ): Promise<SessionMetrics> {
    const now = new Date().toISOString()
    const metricsId = ulid()

    currentMetrics = SessionMetrics.parse({
      schemaVersion: "0.3",
      id: metricsId,
      sessionId,
      startedAt: now,
      config: {
        cognitiveTier: config.cognitiveTier || "1",
        cognitiveFormat: config.cognitiveFormat || "verbose",
        promptInjectionEnabled: config.promptInjectionEnabled ?? true,
        emotionsEnabled: config.emotionsEnabled ?? true,
        hivemindEnabled: config.hivemindEnabled ?? true,
        mode: config.mode || "build",
      },
      outcomes: {},
      efficiency: {},
      anxietySamples: [],
      confidenceSamples: [],
    })

    Bus.publish(Event.SessionStarted, { sessionId, metricsId })
    log.info("metrics session started", { sessionId, metricsId })

    return currentMetrics
  }

  /**
   * End the current metrics session and persist
   */
  export async function endSession(root?: string): Promise<SessionMetrics | null> {
    if (!currentMetrics) return null

    currentMetrics.endedAt = new Date().toISOString()

    // Calculate derived metrics
    currentMetrics.derived = calculateDerivedMetrics(currentMetrics)

    // Persist to file
    try {
      const filePath = await getSessionMetricsPath(root)

      // Read existing sessions
      let sessions: SessionMetrics[] = []
      try {
        const content = await fs.readFile(filePath, "utf-8")
        const parsed = JSON.parse(content)
        sessions = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        // File doesn't exist yet
      }

      // Add current session
      sessions.push(currentMetrics)

      // Keep last 100 sessions
      if (sessions.length > 100) {
        sessions = sessions.slice(-100)
      }

      await fs.writeFile(filePath, JSON.stringify(sessions, null, 2))

      // Update aggregate metrics
      await updateAggregate(root)

      Bus.publish(Event.SessionEnded, {
        sessionId: currentMetrics.sessionId,
        metricsId: currentMetrics.id,
      })

      log.info("metrics session ended", {
        sessionId: currentMetrics.sessionId,
        toolSuccessRate: currentMetrics.derived?.toolSuccessRate,
        cognitiveOverhead: currentMetrics.derived?.cognitiveOverheadPercent,
      })

      const result = currentMetrics
      currentMetrics = null
      return result
    } catch (e) {
      log.error("failed to persist metrics", { error: e })
      return currentMetrics
    }
  }

  /**
   * Get current session metrics (if active)
   */
  export function getCurrentSession(): SessionMetrics | null {
    return currentMetrics
  }

  // =============
  // Recording Functions
  // =============

  /**
   * Record a tool call outcome
   */
  export function recordToolCall(toolName: string, success: boolean): void {
    if (!currentMetrics) return

    currentMetrics.outcomes.toolCallsTotal++
    if (success) {
      currentMetrics.outcomes.toolCallsSucceeded++
    } else {
      currentMetrics.outcomes.toolCallsFailed++
    }

    // Complete pending anxiety/confidence samples
    if (pendingAnxietySample) {
      currentMetrics.anxietySamples.push({
        ...pendingAnxietySample,
        nextToolSuccess: success,
        toolName,
      })
      pendingAnxietySample = null
    }

    if (pendingConfidenceSample) {
      currentMetrics.confidenceSamples.push({
        ...pendingConfidenceSample,
        nextToolSuccess: success,
        toolName,
      })
      pendingConfidenceSample = null
    }

    Bus.publish(Event.ToolRecorded, { toolName, success })
  }

  /**
   * Record anxiety level before a tool call (for correlation analysis)
   */
  export function recordAnxietySample(level: number): void {
    if (!currentMetrics) return
    pendingAnxietySample = {
      timestamp: new Date().toISOString(),
      level,
    }
  }

  /**
   * Record confidence level before a tool call (for correlation analysis)
   */
  export function recordConfidenceSample(level: number): void {
    if (!currentMetrics) return
    pendingConfidenceSample = {
      timestamp: new Date().toISOString(),
      level,
    }
  }

  /**
   * Record cognitive state injection token count
   */
  export function recordCognitiveInjection(tokenCount: number): void {
    if (!currentMetrics) return
    currentMetrics.efficiency.cognitiveOverheadTokens += tokenCount
    currentMetrics.efficiency.cognitiveInjectionCount++
  }

  /**
   * Record total tokens for a turn
   */
  export function recordTurnTokens(tokensIn: number, tokensOut: number): void {
    if (!currentMetrics) return
    currentMetrics.efficiency.totalTokensIn += tokensIn
    currentMetrics.efficiency.totalTokensOut += tokensOut
    currentMetrics.efficiency.turnsTotal++
  }

  /**
   * Record a spin warning
   */
  export function recordSpinWarning(wasAccurate: boolean): void {
    if (!currentMetrics) return
    currentMetrics.outcomes.spinWarningsIssued++
    if (wasAccurate) {
      currentMetrics.outcomes.spinWarningsAccurate++
    }
  }

  /**
   * Record a user correction (user overrode agent decision)
   */
  export function recordUserCorrection(): void {
    if (!currentMetrics) return
    currentMetrics.outcomes.userCorrections++
  }

  /**
   * Record goal stated
   */
  export function recordGoalStated(): void {
    if (!currentMetrics) return
    currentMetrics.outcomes.goalsStated++
  }

  /**
   * Record goal completed
   */
  export function recordGoalCompleted(): void {
    if (!currentMetrics) return
    currentMetrics.outcomes.goalsCompleted++

    // Track turns to first goal completion
    if (currentMetrics.outcomes.goalsCompleted === 1 && !currentMetrics.efficiency.turnsToFirstGoalCompletion) {
      currentMetrics.efficiency.turnsToFirstGoalCompletion = currentMetrics.efficiency.turnsTotal
    }
  }

  // =============
  // Analysis Functions
  // =============

  /**
   * Calculate derived metrics from raw data
   */
  function calculateDerivedMetrics(metrics: SessionMetrics): SessionMetrics["derived"] {
    const { outcomes, efficiency, anxietySamples, confidenceSamples } = metrics

    // Tool success rate
    const toolSuccessRate =
      outcomes.toolCallsTotal > 0 ? outcomes.toolCallsSucceeded / outcomes.toolCallsTotal : undefined

    // Cognitive overhead as percent of total tokens
    const totalTokens = efficiency.totalTokensIn + efficiency.totalTokensOut
    const cognitiveOverheadPercent =
      totalTokens > 0 ? (efficiency.cognitiveOverheadTokens / totalTokens) * 100 : undefined

    // Goal completion rate
    const goalCompletionRate = outcomes.goalsStated > 0 ? outcomes.goalsCompleted / outcomes.goalsStated : undefined

    // Spin warning accuracy
    const spinWarningAccuracy =
      outcomes.spinWarningsIssued > 0 ? outcomes.spinWarningsAccurate / outcomes.spinWarningsIssued : undefined

    // Anxiety correlation with tool success
    const anxietyCorrelation = calculateCorrelation(anxietySamples.filter((s) => s.nextToolSuccess !== undefined))

    // Confidence correlation with tool success
    const confidenceCorrelation = calculateCorrelation(confidenceSamples.filter((s) => s.nextToolSuccess !== undefined))

    return {
      toolSuccessRate,
      cognitiveOverheadPercent,
      goalCompletionRate,
      spinWarningAccuracy,
      anxietyCorrelation,
      confidenceCorrelation,
    }
  }

  /**
   * Calculate point-biserial correlation between level and success
   */
  function calculateCorrelation(samples: Array<{ level: number; nextToolSuccess?: boolean }>): number | undefined {
    if (samples.length < 5) return undefined

    const successSamples = samples.filter((s) => s.nextToolSuccess === true)
    const failureSamples = samples.filter((s) => s.nextToolSuccess === false)

    if (successSamples.length === 0 || failureSamples.length === 0) {
      return undefined
    }

    const avgSuccess = successSamples.reduce((sum, s) => sum + s.level, 0) / successSamples.length
    const avgFailure = failureSamples.reduce((sum, s) => sum + s.level, 0) / failureSamples.length

    // Simple difference as proxy for correlation direction
    // Positive = higher level correlates with success
    // Negative = higher level correlates with failure
    return (avgSuccess - avgFailure) / 100 // Normalize to -1 to 1 range
  }

  /**
   * Update aggregate metrics from all sessions
   */
  async function updateAggregate(root?: string): Promise<void> {
    try {
      const sessionsPath = await getSessionMetricsPath(root)
      const aggregatePath = await getAggregatePath(root)

      let sessions: SessionMetrics[] = []
      try {
        const content = await fs.readFile(sessionsPath, "utf-8")
        const parsed = JSON.parse(content)
        sessions = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return
      }

      const aggregate: AggregateMetrics = {
        schemaVersion: "0.3",
        lastUpdated: new Date().toISOString(),
        totalSessions: sessions.length,
        byFormat: {} as Record<
          string,
          {
            sessionCount: number
            avgToolSuccessRate: number
            avgCognitiveOverheadPercent: number
            avgGoalCompletionRate: number
            avgSpinWarningAccuracy: number
          }
        >,
        byTier: {} as Record<
          string,
          { sessionCount: number; avgToolSuccessRate: number; avgCognitiveOverheadPercent: number }
        >,
      }

      // Group by format
      const byFormat = new Map<CognitiveFormat, SessionMetrics[]>()
      const byTier = new Map<CognitiveTier, SessionMetrics[]>()

      for (const session of sessions) {
        const format = session.config.cognitiveFormat
        const tier = session.config.cognitiveTier

        if (!byFormat.has(format)) byFormat.set(format, [])
        byFormat.get(format)!.push(session)

        if (!byTier.has(tier)) byTier.set(tier, [])
        byTier.get(tier)!.push(session)
      }

      // Calculate format aggregates
      for (const [format, formatSessions] of byFormat) {
        const withDerived = formatSessions.filter((s) => s.derived)
        aggregate.byFormat[format] = {
          sessionCount: formatSessions.length,
          avgToolSuccessRate: average(withDerived.map((s) => s.derived?.toolSuccessRate)),
          avgCognitiveOverheadPercent: average(withDerived.map((s) => s.derived?.cognitiveOverheadPercent)),
          avgGoalCompletionRate: average(withDerived.map((s) => s.derived?.goalCompletionRate)),
          avgSpinWarningAccuracy: average(withDerived.map((s) => s.derived?.spinWarningAccuracy)),
        }
      }

      // Calculate tier aggregates
      for (const [tier, tierSessions] of byTier) {
        const withDerived = tierSessions.filter((s) => s.derived)
        aggregate.byTier[tier] = {
          sessionCount: tierSessions.length,
          avgToolSuccessRate: average(withDerived.map((s) => s.derived?.toolSuccessRate)),
          avgCognitiveOverheadPercent: average(withDerived.map((s) => s.derived?.cognitiveOverheadPercent)),
        }
      }

      await fs.writeFile(aggregatePath, JSON.stringify(aggregate, null, 2))
    } catch (e) {
      log.error("failed to update aggregate metrics", { error: e })
    }
  }

  function average(values: (number | undefined)[]): number {
    const valid = values.filter((v): v is number => v !== undefined)
    if (valid.length === 0) return 0
    return valid.reduce((sum, v) => sum + v, 0) / valid.length
  }

  // =============
  // Query Functions
  // =============

  /**
   * Get aggregate metrics
   */
  export async function getAggregate(root?: string): Promise<AggregateMetrics | null> {
    try {
      const filePath = await getAggregatePath(root)
      const content = await fs.readFile(filePath, "utf-8")
      return AggregateMetrics.parse(JSON.parse(content))
    } catch {
      return null
    }
  }

  /**
   * Get recent sessions
   */
  export async function getRecentSessions(root?: string, limit: number = 10): Promise<SessionMetrics[]> {
    try {
      const filePath = await getSessionMetricsPath(root)
      const content = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(content)
      const sessions: SessionMetrics[] = Array.isArray(parsed) ? parsed : [parsed]
      return sessions.slice(-limit)
    } catch {
      return []
    }
  }

  /**
   * Get A/B comparison between formats
   */
  export async function getABComparison(root?: string): Promise<{
    verbose: { sessions: number; avgSuccessRate: number; avgOverhead: number } | null
    condensed: { sessions: number; avgSuccessRate: number; avgOverhead: number } | null
    recommendation: string
  }> {
    const aggregate = await getAggregate(root)

    const verbose = aggregate?.byFormat.verbose
    const condensed = aggregate?.byFormat.condensed

    let recommendation = "Not enough data for comparison (need 5+ sessions each)"

    if (verbose && condensed && verbose.sessionCount >= 5 && condensed.sessionCount >= 5) {
      const successDiff = condensed.avgToolSuccessRate - verbose.avgToolSuccessRate
      const overheadDiff = verbose.avgCognitiveOverheadPercent - condensed.avgCognitiveOverheadPercent

      if (successDiff >= -0.05 && overheadDiff > 5) {
        recommendation = `Condensed format recommended: ${overheadDiff.toFixed(1)}% less overhead with similar success rate`
      } else if (successDiff < -0.05) {
        recommendation = `Verbose format recommended: ${Math.abs(successDiff * 100).toFixed(1)}% higher success rate`
      } else {
        recommendation = "No significant difference - consider other factors"
      }
    }

    return {
      verbose: verbose
        ? {
            sessions: verbose.sessionCount,
            avgSuccessRate: verbose.avgToolSuccessRate,
            avgOverhead: verbose.avgCognitiveOverheadPercent,
          }
        : null,
      condensed: condensed
        ? {
            sessions: condensed.sessionCount,
            avgSuccessRate: condensed.avgToolSuccessRate,
            avgOverhead: condensed.avgCognitiveOverheadPercent,
          }
        : null,
      recommendation,
    }
  }

  /**
   * Format metrics for display
   */
  export function formatMetricsSummary(metrics: SessionMetrics): string {
    const lines: string[] = []

    lines.push(`## Session Metrics (${metrics.config.cognitiveFormat} format, Tier ${metrics.config.cognitiveTier})`)
    lines.push("")

    // Outcomes
    lines.push("### Outcomes")
    lines.push(`- Tool calls: ${metrics.outcomes.toolCallsSucceeded}/${metrics.outcomes.toolCallsTotal} succeeded`)
    if (metrics.outcomes.goalsStated > 0) {
      lines.push(`- Goals: ${metrics.outcomes.goalsCompleted}/${metrics.outcomes.goalsStated} completed`)
    }
    if (metrics.outcomes.spinWarningsIssued > 0) {
      lines.push(
        `- Spin warnings: ${metrics.outcomes.spinWarningsAccurate}/${metrics.outcomes.spinWarningsIssued} accurate`,
      )
    }
    if (metrics.outcomes.userCorrections > 0) {
      lines.push(`- User corrections: ${metrics.outcomes.userCorrections}`)
    }

    // Efficiency
    lines.push("")
    lines.push("### Efficiency")
    lines.push(`- Turns: ${metrics.efficiency.turnsTotal}`)
    const totalTokens = metrics.efficiency.totalTokensIn + metrics.efficiency.totalTokensOut
    if (totalTokens > 0) {
      lines.push(`- Total tokens: ${totalTokens.toLocaleString()}`)
      lines.push(`- Cognitive overhead: ${metrics.efficiency.cognitiveOverheadTokens.toLocaleString()} tokens`)
    }

    // Derived
    if (metrics.derived) {
      lines.push("")
      lines.push("### Analysis")
      if (metrics.derived.toolSuccessRate !== undefined) {
        lines.push(`- Tool success rate: ${(metrics.derived.toolSuccessRate * 100).toFixed(1)}%`)
      }
      if (metrics.derived.cognitiveOverheadPercent !== undefined) {
        lines.push(`- Cognitive overhead: ${metrics.derived.cognitiveOverheadPercent.toFixed(1)}% of tokens`)
      }
      if (metrics.derived.anxietyCorrelation !== undefined) {
        const dir = metrics.derived.anxietyCorrelation > 0 ? "positive" : "negative"
        lines.push(`- Anxiety/success correlation: ${dir} (${metrics.derived.anxietyCorrelation.toFixed(2)})`)
      }
      if (metrics.derived.confidenceCorrelation !== undefined) {
        const dir = metrics.derived.confidenceCorrelation > 0 ? "positive" : "negative"
        lines.push(`- Confidence/success correlation: ${dir} (${metrics.derived.confidenceCorrelation.toFixed(2)})`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Format A/B comparison for display
   */
  export function formatABComparison(comparison: Awaited<ReturnType<typeof getABComparison>>): string {
    const lines: string[] = []

    lines.push("## A/B Comparison: Verbose vs Condensed Format")
    lines.push("")

    if (comparison.verbose) {
      lines.push("### Verbose Format")
      lines.push(`- Sessions: ${comparison.verbose.sessions}`)
      lines.push(`- Avg success rate: ${(comparison.verbose.avgSuccessRate * 100).toFixed(1)}%`)
      lines.push(`- Avg cognitive overhead: ${comparison.verbose.avgOverhead.toFixed(1)}%`)
    } else {
      lines.push("### Verbose Format")
      lines.push("- No data yet")
    }

    lines.push("")

    if (comparison.condensed) {
      lines.push("### Condensed Format")
      lines.push(`- Sessions: ${comparison.condensed.sessions}`)
      lines.push(`- Avg success rate: ${(comparison.condensed.avgSuccessRate * 100).toFixed(1)}%`)
      lines.push(`- Avg cognitive overhead: ${comparison.condensed.avgOverhead.toFixed(1)}%`)
    } else {
      lines.push("### Condensed Format")
      lines.push("- No data yet")
    }

    lines.push("")
    lines.push(`### Recommendation`)
    lines.push(comparison.recommendation)

    return lines.join("\n")
  }
}
