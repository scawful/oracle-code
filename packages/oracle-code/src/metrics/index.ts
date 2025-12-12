import { z } from "zod"
import { IRT } from "./irt"
import { ErrorDetection } from "./errors"
import { TaskTracking } from "./tracking"

// Re-export sub-modules for convenient access
export { IRT } from "./irt"
export { ErrorDetection } from "./errors"
export { TaskTracking } from "./tracking"

/**
 * Agent Metrics.
 *
 * Coordination metrics are inspired by "Towards a Science of Scaling Agent Systems"
 * (arXiv:2512.08296). Published baselines (for example 17.2× vs 4.4× error
 * amplification) are kept as reference values for UI/heuristics, not as measured
 * oracle-code data.
 *
 * Ability estimation uses an Item Response Theory (IRT) model inspired by
 * "Quantifying Human–AI Synergy" (NeurIPS submission). Current fitting is a
 * point-estimate optimizer with approximate confidence intervals; a full Bayesian
 * posterior fit is a future enhancement.
 */
export namespace AgentMetrics {
  /**
   * Error types from the MAST taxonomy (Multi-Agent System Failure Taxonomy)
   */
  export type ErrorType =
    | "logical_contradiction" // Agent asserts both X and not-X
    | "numerical_drift" // Accumulated computational error from rounding/conversion
    | "context_omission" // Failure to reference previously established information
    | "coordination_failure" // MAS-specific: message misinterpretation, task conflicts

  /**
   * Error entry for tracking agent errors
   */
  export const ErrorEntry = z.object({
    type: z.enum(["logical_contradiction", "numerical_drift", "context_omission", "coordination_failure"]),
    message: z.string(),
    timestamp: z.number(),
    sessionID: z.string().optional(),
    agentName: z.string().optional(),
  })
  export type ErrorEntry = z.infer<typeof ErrorEntry>

  /**
   * Tool call tracking for efficiency metrics
   */
  export const ToolCallEntry = z.object({
    tool: z.string(),
    success: z.boolean(),
    duration: z.number(), // milliseconds
    timestamp: z.number(),
  })
  export type ToolCallEntry = z.infer<typeof ToolCallEntry>

  /**
   * Per-session metrics for tracking individual agent performance
   */
  export const SessionMetrics = z.object({
    sessionID: z.string(),
    parentID: z.string().optional(),
    agentName: z.string(),

    // Token tracking
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      total: z.number(),
    }),

    // Timing
    timing: z.object({
      started: z.number(),
      completed: z.number().optional(),
      duration: z.number().optional(), // milliseconds
    }),

    // Tool usage
    toolCalls: z.array(ToolCallEntry),

    // Error tracking
    errors: z.array(ErrorEntry),

    // Message counts for density calculation
    messageCount: z.number(),
    interAgentMessages: z.number(),
  })
  export type SessionMetrics = z.infer<typeof SessionMetrics>

  /**
   * Coordination metrics aggregated across all active sessions
   * Based on Table 5 from the research paper
   */
  export const CoordinationMetrics = z.object({
    /**
     * Coordination Efficiency (Ec) = Success / (T / T_SAS)
     * Success normalized by relative turn count
     * SAS baseline: 0.466, Centralized: 0.120, Decentralized: 0.132
     */
    coordinationEfficiency: z.number(),

    /**
     * Error Amplification (Ae) = E_MAS / E_SAS
     * Relative failure probability
     * SAS: 1.0, Independent: 17.2x, Centralized: 4.4x, Decentralized: 7.8x
     */
    errorAmplification: z.number(),

    /**
     * Message Density (c) = inter-agent messages per reasoning turn
     * Performance plateaus near 0.39-0.41 messages/turn
     */
    messageDensity: z.number(),

    /**
     * Redundancy (R) = mean similarity of agent outputs
     * Optimal around 0.41 (Centralized median)
     * High redundancy (>0.50) correlates negatively with success
     */
    redundancy: z.number(),

    /**
     * Overhead percentage = (T_MAS - T_SAS) / T_SAS * 100
     * SAS: 0%, Independent: 58%, Centralized: 285%, Hybrid: 515%
     */
    overheadPercent: z.number(),

    /**
     * Token efficiency = success per 1K tokens
     * SAS: 67.7, Centralized: 21.5, Decentralized: 23.9
     */
    successPer1KTokens: z.number(),

    /**
     * Current agent count
     * Optimal: 3-4 (beyond this, per-agent quality degrades)
     */
    activeAgentCount: z.number(),

    /**
     * Total turns/reasoning steps
     */
    totalTurns: z.number(),

    /**
     * Total tokens consumed
     */
    totalTokens: z.number(),

    /**
     * Success rate (0-1)
     */
    successRate: z.number(),

    /**
     * Last updated timestamp
     */
    lastUpdated: z.number(),
  })
  export type CoordinationMetrics = z.infer<typeof CoordinationMetrics>

  /**
   * Recommended coordination architecture
   */
  export type ArchitectureType = "single" | "centralized" | "decentralized" | "hybrid"

  /**
   * Task analysis for routing recommendations
   * Based on Section 4.3 of the research paper
   */
  export const TaskAnalysis = z.object({
    /**
     * Task decomposability (0-1)
     * Higher = more parallelizable subtasks
     * Finance Agent-style tasks are highly decomposable
     * PlanCraft-style sequential reasoning is not
     */
    decomposability: z.number(),

    /**
     * Domain complexity D (0-1)
     * Composite metric from paper's Appendix B:
     * - Performance ceiling (1 - p_max)
     * - Coefficient of variation (sigma/mu)
     * - Best-model baseline (1 - p_best)
     */
    domainComplexity: z.number(),

    /**
     * Tool-heavy indicator
     * >8 tools = tool-heavy (MAS penalty, beta=-0.330)
     */
    toolHeavy: z.boolean(),

    /**
     * Tool count for context
     */
    toolCount: z.number(),

    /**
     * Estimated single-agent baseline performance (0-1)
     * If >0.45, MAS yields negative returns (capability ceiling)
     */
    singleAgentBaseline: z.number(),

    /**
     * Recommended architecture based on task properties
     */
    recommendedArchitecture: z.enum(["single", "centralized", "decentralized", "hybrid"]),

    /**
     * Human-readable rationale for the recommendation
     */
    recommendationRationale: z.string(),

    /**
     * Confidence in the recommendation (0-1)
     */
    confidence: z.number(),

    /**
     * Analysis timestamp
     */
    analyzedAt: z.number(),
  })
  export type TaskAnalysis = z.infer<typeof TaskAnalysis>

  /**
   * Research paper thresholds and baselines
   */
  export const Thresholds = {
    // Coordination efficiency baselines
    efficiency: {
      sas: 0.466,
      independent: 0.234,
      decentralized: 0.132,
      centralized: 0.12,
      hybrid: 0.074,
    },

    // Error amplification factors
    errorAmplification: {
      sas: 1.0,
      independent: 17.2,
      decentralized: 7.8,
      centralized: 4.4,
      hybrid: 5.1,
    },

    // Warning thresholds
    errorAmplificationWarning: 4.4, // Centralized baseline
    errorAmplificationCritical: 10.0,

    // Agent count
    optimalAgentCountMin: 3,
    optimalAgentCountMax: 4,

    // Message density plateau
    messageDensityOptimal: 0.39,

    // Capability ceiling - above this, MAS yields negative returns
    sasBaselineThreshold: 0.45,

    // Tool-heavy threshold
    toolHeavyThreshold: 8,

    // Overhead percentages
    overhead: {
      sas: 0,
      independent: 58,
      decentralized: 263,
      centralized: 285,
      hybrid: 515,
    },

    // Success per 1K tokens
    successPer1KTokens: {
      sas: 67.7,
      independent: 42.4,
      decentralized: 23.9,
      centralized: 21.5,
      hybrid: 13.6,
    },
  } as const

  /**
   * Create default/empty coordination metrics
   */
  export function createEmptyMetrics(): CoordinationMetrics {
    return {
      coordinationEfficiency: 0,
      errorAmplification: 1.0,
      messageDensity: 0,
      redundancy: 0,
      overheadPercent: 0,
      successPer1KTokens: 0,
      activeAgentCount: 0,
      totalTurns: 0,
      totalTokens: 0,
      successRate: 0,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Create default/empty session metrics
   */
  export function createEmptySessionMetrics(sessionID: string, agentName: string, parentID?: string): SessionMetrics {
    return {
      sessionID,
      parentID,
      agentName,
      tokens: { input: 0, output: 0, total: 0 },
      timing: { started: Date.now() },
      toolCalls: [],
      errors: [],
      messageCount: 0,
      interAgentMessages: 0,
    }
  }

  /**
   * Analyze task properties and recommend architecture
   */
  export function analyzeTask(params: {
    toolCount: number
    estimatedBaseline?: number
    isSequential?: boolean
    requiresExploration?: boolean
  }): TaskAnalysis {
    const { toolCount, estimatedBaseline = 0.3, isSequential = false, requiresExploration = false } = params

    const toolHeavy = toolCount > Thresholds.toolHeavyThreshold

    // Calculate decomposability (inverse of sequential requirement)
    const decomposability = isSequential ? 0.2 : requiresExploration ? 0.7 : 0.5

    // Domain complexity approximation
    const domainComplexity = Math.min(1, (toolCount / 20) * 0.5 + (isSequential ? 0.3 : 0) + (1 - estimatedBaseline) * 0.2)

    // Determine recommended architecture based on paper findings
    let recommendedArchitecture: ArchitectureType
    let recommendationRationale: string
    let confidence: number

    if (estimatedBaseline > Thresholds.sasBaselineThreshold) {
      recommendedArchitecture = "single"
      recommendationRationale = `Single-agent baseline (${(estimatedBaseline * 100).toFixed(0)}%) exceeds 45% threshold. MAS would yield negative returns due to capability ceiling effect.`
      confidence = 0.85
    } else if (isSequential) {
      recommendedArchitecture = "single"
      recommendationRationale = `Sequential reasoning task. MAS degrades performance by 39-70% on tasks requiring strict sequential constraint satisfaction.`
      confidence = 0.9
    } else if (toolHeavy) {
      recommendedArchitecture = "single"
      recommendationRationale = `Tool-heavy task (${toolCount} tools). Tool-coordination trade-off (beta=-0.330) causes efficiency penalties to compound with complexity.`
      confidence = 0.75
    } else if (requiresExploration) {
      recommendedArchitecture = "decentralized"
      recommendationRationale = `Dynamic exploration task benefits from decentralized coordination (+9.2% vs single-agent). Peer debate enables diverse search strategies.`
      confidence = 0.7
    } else if (decomposability > 0.6) {
      recommendedArchitecture = "centralized"
      recommendationRationale = `Parallelizable task structure. Centralized coordination provides +81% improvement through orchestrated subtask delegation with 4.4x error containment.`
      confidence = 0.8
    } else {
      recommendedArchitecture = "single"
      recommendationRationale = `Default to single-agent for balanced task. Coordination overhead may not justify potential gains.`
      confidence = 0.6
    }

    return {
      decomposability,
      domainComplexity,
      toolHeavy,
      toolCount,
      singleAgentBaseline: estimatedBaseline,
      recommendedArchitecture,
      recommendationRationale,
      confidence,
      analyzedAt: Date.now(),
    }
  }

  /**
   * Get efficiency status color based on thresholds
   */
  export function getEfficiencyStatus(efficiency: number): "success" | "warning" | "error" {
    if (efficiency >= 0.3) return "success"
    if (efficiency >= 0.15) return "warning"
    return "error"
  }

  /**
   * Get error amplification status
   */
  export function getErrorAmplificationStatus(ae: number): "success" | "warning" | "error" {
    if (ae <= Thresholds.errorAmplificationWarning) return "success"
    if (ae <= Thresholds.errorAmplificationCritical) return "warning"
    return "error"
  }

  /**
   * Get agent count status
   */
  export function getAgentCountStatus(count: number): "success" | "warning" | "error" {
    if (count >= Thresholds.optimalAgentCountMin && count <= Thresholds.optimalAgentCountMax) return "success"
    if (count > 0 && count <= 5) return "warning"
    return "error"
  }

  // IRT-enhanced metrics derived from the paper-inspired ability model.

  /**
   * Calculate coordination efficiency using IRT model
   *
   * Replaces ad-hoc formula:
   *   coordinationEfficiency = sasBaseline / (1 + activeAgentCount * 0.3)
   *
   * With principled calculation:
   *   P(success) = logit^-1(mean(θ) + mean(κ) - β - γ·log(n))
   */
  export function calculateCoordinationEfficiencyIRT(params: {
    irtModel: IRT.ModelParams
    agentIDs: string[]
    taskID: string
  }): {
    efficiency: number
    confidence: { lower: number; upper: number }
    breakdown: {
      meanTheta: number
      meanKappa: number
      taskBeta: number
      taskGamma: number
      scaledGamma: number
    }
  } {
    const { irtModel, agentIDs, taskID } = params

    if (agentIDs.length === 0) {
      return {
        efficiency: 0,
        confidence: { lower: 0, upper: 0 },
        breakdown: { meanTheta: 0, meanKappa: 0, taskBeta: 0, taskGamma: 0, scaledGamma: 0 },
      }
    }

    // Get agent abilities
    const abilities = agentIDs.map((id) => IRT.getAgentAbility(irtModel, id))
    const meanTheta = abilities.reduce((sum, a) => sum + a.theta, 0) / abilities.length
    const meanKappa = abilities.reduce((sum, a) => sum + a.kappa, 0) / abilities.length

    // Get task difficulty
    const task = IRT.getTaskDifficulty(irtModel, taskID)
    const taskBeta = task.beta
    const taskGamma = task.gamma

    // Scale gamma by log(n) for coordination overhead
    const scaledGamma = agentIDs.length > 1 ? taskGamma * Math.log2(agentIDs.length + 1) : 0

    // Calculate success probability
    const efficiency = IRT.pSuccess({
      theta: meanTheta,
      kappa: agentIDs.length > 1 ? meanKappa : 0,
      beta: taskBeta,
      gamma: scaledGamma,
      isCollaborative: agentIDs.length > 1,
    })

    // Calculate confidence interval using worst/best case combinations
    const worstTheta = Math.min(...abilities.map((a) => a.thetaCI.lower))
    const worstKappa = Math.min(...abilities.map((a) => a.kappaCI.lower))
    const bestTheta = Math.max(...abilities.map((a) => a.thetaCI.upper))
    const bestKappa = Math.max(...abilities.map((a) => a.kappaCI.upper))

    const lower = IRT.pSuccess({
      theta: worstTheta,
      kappa: agentIDs.length > 1 ? worstKappa : 0,
      beta: taskBeta + 0.5, // Assume task could be harder
      gamma: scaledGamma * 1.2,
      isCollaborative: agentIDs.length > 1,
    })

    const upper = IRT.pSuccess({
      theta: bestTheta,
      kappa: agentIDs.length > 1 ? bestKappa : 0,
      beta: taskBeta - 0.5, // Assume task could be easier
      gamma: scaledGamma * 0.8,
      isCollaborative: agentIDs.length > 1,
    })

    return {
      efficiency,
      confidence: { lower, upper },
      breakdown: { meanTheta, meanKappa, taskBeta, taskGamma, scaledGamma },
    }
  }

  /**
   * Calculate error amplification using detected errors
   *
   * Replaces threshold binning:
   *   if (messageDensity > 0.3) errorAmplification = 4.4
   *
   * With evidence-based calculation:
   *   Ae = (errors_detected / baseline_error_rate) * severity_weight
   */
  export function calculateErrorAmplificationIRT(params: {
    detectedErrors: ErrorDetection.DetectedError[]
    baselineErrorRate?: number
    outputWordCount: number
  }): {
    amplification: number
    byType: Record<ErrorDetection.ErrorType, number>
    severity: "low" | "medium" | "high"
  } {
    const { detectedErrors, baselineErrorRate = 0.05, outputWordCount } = params

    // Calculate error rate per 100 words
    const errorRate = detectedErrors.length / Math.max(1, outputWordCount / 100)

    // Count by type
    const byType: Record<ErrorDetection.ErrorType, number> = {
      logical_contradiction: 0,
      numerical_drift: 0,
      context_omission: 0,
      coordination_failure: 0,
    }

    let totalSeverity = 0
    for (const error of detectedErrors) {
      byType[error.type]++
      totalSeverity += error.severity
    }

    // Weight by severity
    const weightedErrorRate = detectedErrors.length > 0
      ? (totalSeverity / detectedErrors.length) * errorRate
      : 0

    // Calculate amplification relative to baseline
    const amplification = baselineErrorRate > 0 ? weightedErrorRate / baselineErrorRate : 1

    // Determine severity level
    let severity: "low" | "medium" | "high"
    if (amplification <= Thresholds.errorAmplificationWarning) {
      severity = "low"
    } else if (amplification <= Thresholds.errorAmplificationCritical) {
      severity = "medium"
    } else {
      severity = "high"
    }

    return {
      amplification: Math.max(1, amplification),
      byType,
      severity,
    }
  }

  /**
   * Comprehensive session analysis using all metrics
   *
   * Combines:
   * - IRT-based coordination efficiency
   * - Evidence-based error detection
   * - Task analysis recommendations
   */
  export function analyzeSessionIRT(params: {
    irtModel: IRT.ModelParams
    agentIDs: string[]
    taskID: string
    outputs: Array<{ agentID: string; output: string; timestamp: number }>
    previousOutputs?: string[]
    requiredContext?: string[]
  }): {
    coordination: ReturnType<typeof calculateCoordinationEfficiencyIRT>
    errors: ReturnType<typeof calculateErrorAmplificationIRT>
    errorDetails: ErrorDetection.DetectedError[]
    taskAnalysis: TaskAnalysis
    recommendations: string[]
    overallScore: number
  } {
    const { irtModel, agentIDs, taskID, outputs, previousOutputs = [], requiredContext = [] } = params

    // Calculate coordination efficiency
    const coordination = calculateCoordinationEfficiencyIRT({ irtModel, agentIDs, taskID })

    // Run error detection on all outputs
    const allErrors: ErrorDetection.DetectedError[] = []
    let totalWordCount = 0

    for (const { agentID, output } of outputs) {
      const analysis = ErrorDetection.analyzeOutput(output, {
        previousOutputs,
        requiredContext,
        otherAgentOutputs: outputs.filter((o) => o.agentID !== agentID),
        agentID,
      })
      allErrors.push(...analysis.errors)
      totalWordCount += output.split(/\s+/).length
    }

    // Calculate error amplification
    const errors = calculateErrorAmplificationIRT({
      detectedErrors: allErrors,
      outputWordCount: totalWordCount,
    })

    // Get task analysis
    const taskAnalysis = analyzeTask({
      toolCount: 5, // Default, should be passed in
      estimatedBaseline: coordination.efficiency,
      isSequential: false,
      requiresExploration: false,
    })

    // Generate recommendations
    const recommendations: string[] = []

    // Coordination recommendations
    if (coordination.efficiency < 0.5) {
      recommendations.push(
        `Coordination efficiency is low (${(coordination.efficiency * 100).toFixed(0)}%). Consider reducing team size or improving agent abilities.`,
      )
    }

    if (coordination.breakdown.scaledGamma > 0.5) {
      recommendations.push(
        `High coordination overhead detected (γ=${coordination.breakdown.scaledGamma.toFixed(2)}). Consider using centralized architecture.`,
      )
    }

    // Error recommendations
    if (errors.severity === "high") {
      recommendations.push(
        `High error amplification (${errors.amplification.toFixed(1)}x). Dominant error type: ${Object.entries(errors.byType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown"}.`,
      )
    }

    if (errors.byType.logical_contradiction > 0) {
      recommendations.push("Logical contradictions detected. Review agent outputs for consistency.")
    }

    if (errors.byType.context_omission > 0) {
      recommendations.push("Context omissions detected. Ensure required context is included in prompts.")
    }

    if (errors.byType.coordination_failure > 0) {
      recommendations.push("Coordination failures detected. Review task assignment and handoffs.")
    }

    // Task analysis recommendations
    recommendations.push(taskAnalysis.recommendationRationale)

    // Calculate overall score (0-100)
    const coordinationScore = coordination.efficiency * 40
    const errorScore = Math.max(0, 30 - errors.amplification * 3)
    const confidenceScore = (coordination.confidence.upper - coordination.confidence.lower < 0.3 ? 15 : 5)
    const taskFitScore = taskAnalysis.confidence * 15

    const overallScore = Math.round(coordinationScore + errorScore + confidenceScore + taskFitScore)

    return {
      coordination,
      errors,
      errorDetails: allErrors,
      taskAnalysis,
      recommendations,
      overallScore: Math.min(100, Math.max(0, overallScore)),
    }
  }

  /**
   * Create a task outcome for IRT model training
   *
   * Call this after each task completion to build the training dataset
   */
  export function createTaskOutcome(params: {
    taskID: string
    agentID: string
    partnerIDs?: string[]
    success: boolean
    tokens: number
    duration: number
    errors: ErrorDetection.DetectedError[]
  }): IRT.TaskOutcome {
    return {
      taskID: params.taskID,
      agentID: params.agentID,
      isCollaborative: (params.partnerIDs?.length ?? 0) > 0,
      partnerIDs: params.partnerIDs,
      success: params.success,
      tokens: params.tokens,
      duration: params.duration,
      errorCount: params.errors.length,
      timestamp: Date.now(),
    }
  }

  /**
   * Get model training status and recommendations
   */
  export function getModelStatus(model: IRT.ModelParams): {
    isWellFitted: boolean
    sampleSize: number
    agentCount: number
    taskCount: number
    recommendations: string[]
  } {
    const agentCount = Object.keys(model.theta).length
    const taskCount = Object.keys(model.beta).length
    const recommendations: string[] = []

    // Check sample size
    if (model.sampleSize < 30) {
      recommendations.push(`Low sample size (${model.sampleSize}). Collect more task outcomes for reliable estimates.`)
    }

    // Check agent coverage
    if (agentCount < 2) {
      recommendations.push("Only one agent in model. Add more agents for comparison capabilities.")
    }

    // Check task coverage
    if (taskCount < 3) {
      recommendations.push("Few task types in model. Diversify task types for better difficulty estimation.")
    }

    // Check model age
    const age = Date.now() - model.fittedAt
    if (age > 24 * 60 * 60 * 1000) {
      // 24 hours
      recommendations.push("Model is >24 hours old. Consider refitting with recent data.")
    }

    return {
      isWellFitted: model.sampleSize >= 30 && agentCount >= 2 && taskCount >= 3,
      sampleSize: model.sampleSize,
      agentCount,
      taskCount,
      recommendations,
    }
  }
}
