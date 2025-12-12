import { z } from "zod"

/**
 * Item Response Theory (IRT) ability model.
 *
 * Inspired by "Quantifying Human–AI Synergy" (NeurIPS submission). We use the
 * paper's solo and collaborative logit forms:
 * - P(success | solo) = logit^-1(θ - β)
 * - P(success | collaborative) = logit^-1(θ + κ - β - γ)
 *
 * Fitting here is a lightweight point-estimate optimizer with approximate
 * confidence intervals. A full Bayesian posterior implementation is a future
 * enhancement.
 */
export namespace IRT {
  /**
   * Model parameters for IRT
   */
  export interface ModelParams {
    /** θ: Individual ability per agent (higher = more capable) */
    theta: Record<string, number>
    /** κ: Collaborative ability per agent (higher = better at teamwork) */
    kappa: Record<string, number>
    /** β: Solo task difficulty (higher = harder) */
    beta: Record<string, number>
    /** γ: Collaborative difficulty modifier (higher = harder to coordinate) */
    gamma: Record<string, number>
    /** When the model was fitted */
    fittedAt: number
    /** Number of outcomes used to fit */
    sampleSize: number
    /** Log-likelihood of the fitted model (higher = better fit) */
    logLikelihood: number
    /** Confidence intervals for parameters */
    confidence: {
      theta: Record<string, { lower: number; upper: number }>
      kappa: Record<string, { lower: number; upper: number }>
    }
  }

  /**
   * Task outcome schema for model fitting
   */
  export const TaskOutcome = z.object({
    taskID: z.string(),
    agentID: z.string(),
    isCollaborative: z.boolean(),
    partnerIDs: z.array(z.string()).optional(),
    success: z.boolean(),
    tokens: z.number(),
    duration: z.number(),
    errorCount: z.number(),
    timestamp: z.number(),
  })
  export type TaskOutcome = z.infer<typeof TaskOutcome>

  /**
   * Stored model with metadata
   */
  export const StoredModel = z.object({
    params: z.custom<ModelParams>(),
    version: z.number(),
    createdAt: z.number(),
    outcomeCount: z.number(),
  })
  export type StoredModel = z.infer<typeof StoredModel>

  /**
   * Default priors for new agents/tasks
   */
  export const Priors = {
    /** Default individual ability (average) */
    theta: 0,
    /** Default collaborative ability (slight positive prior) */
    kappa: 0.1,
    /** Default task difficulty (average) */
    beta: 0,
    /** Default collaborative penalty (small positive) */
    gamma: 0.2,
    /** Prior standard deviation for regularization */
    priorSD: 1.0,
  } as const

  /**
   * Logistic function: σ(x) = 1 / (1 + e^(-x))
   */
  export function logistic(x: number): number {
    // Clamp to prevent overflow
    if (x > 20) return 1
    if (x < -20) return 0
    return 1 / (1 + Math.exp(-x))
  }

  /**
   * Log-odds (logit) function: logit(p) = log(p / (1-p))
   */
  export function logit(p: number): number {
    // Clamp to prevent infinity
    const clampedP = Math.max(0.001, Math.min(0.999, p))
    return Math.log(clampedP / (1 - clampedP))
  }

  /**
   * Calculate probability of success using IRT model
   *
   * From paper Equation 3:
   * P(Y_ij = 1 | θ_j, κ_j, β_i, γ_i, C) = σ(θ_j + κ_j·C - β_i - γ_i·C)
   */
  export function pSuccess(params: {
    theta: number
    kappa: number
    beta: number
    gamma: number
    isCollaborative: boolean
  }): number {
    const { theta, kappa, beta, gamma, isCollaborative } = params

    if (isCollaborative) {
      // P(success | collaborative) = σ(θ + κ - β - γ)
      const linearPredictor = theta + kappa - beta - gamma
      return logistic(linearPredictor)
    } else {
      // P(success | solo) = σ(θ - β)
      const linearPredictor = theta - beta
      return logistic(linearPredictor)
    }
  }

  /**
   * Calculate expected success probability for a team
   *
   * For multi-agent tasks, we model the team's effective ability
   * as a weighted combination of individual abilities
   */
  export function pTeamSuccess(params: {
    agentParams: Array<{ theta: number; kappa: number }>
    beta: number
    gamma: number
  }): number {
    const { agentParams, beta, gamma } = params

    if (agentParams.length === 0) {
      return 0.5 // No agents = random chance
    }

    if (agentParams.length === 1) {
      // Solo task
      return pSuccess({
        theta: agentParams[0].theta,
        kappa: 0,
        beta,
        gamma: 0,
        isCollaborative: false,
      })
    }

    // Multi-agent: Use mean theta and mean kappa
    // This is a simplification; research suggests more complex interactions
    const meanTheta = agentParams.reduce((sum, p) => sum + p.theta, 0) / agentParams.length
    const meanKappa = agentParams.reduce((sum, p) => sum + p.kappa, 0) / agentParams.length

    // Scale gamma by log(n) as a heuristic for coordination overhead.
    // This team-size adjustment is not specified in the Synergy paper.
    const scaledGamma = gamma * Math.log2(agentParams.length + 1)

    return pSuccess({
      theta: meanTheta,
      kappa: meanKappa,
      beta,
      gamma: scaledGamma,
      isCollaborative: true,
    })
  }

  /**
   * Fit IRT model using gradient descent with L2 regularization
   *
   * Minimizes negative log-likelihood with regularization:
   * L = -Σ[y·log(p) + (1-y)·log(1-p)] + λ·Σθ² + λ·Σκ²
   */
  export function fitModel(outcomes: TaskOutcome[], options?: {
    learningRate?: number
    iterations?: number
    regularization?: number
    convergenceThreshold?: number
  }): ModelParams {
    const {
      learningRate = 0.05,
      iterations = 2000,
      regularization = 0.01,
      convergenceThreshold = 1e-6,
    } = options ?? {}

    // Initialize parameter maps
    const theta: Record<string, number> = {}
    const kappa: Record<string, number> = {}
    const beta: Record<string, number> = {}
    const gamma: Record<string, number> = {}

    // Get unique agents and tasks
    const agents = new Set<string>()
    const tasks = new Set<string>()

    for (const outcome of outcomes) {
      agents.add(outcome.agentID)
      tasks.add(outcome.taskID)
      if (outcome.partnerIDs) {
        for (const partner of outcome.partnerIDs) {
          agents.add(partner)
        }
      }
    }

    // Initialize with priors
    for (const agent of agents) {
      theta[agent] = Priors.theta + (Math.random() - 0.5) * 0.1
      kappa[agent] = Priors.kappa + (Math.random() - 0.5) * 0.1
    }
    for (const task of tasks) {
      beta[task] = Priors.beta
      gamma[task] = Priors.gamma
    }

    // Gradient descent with early stopping
    let prevLL = -Infinity

    for (let iter = 0; iter < iterations; iter++) {
      // Accumulate gradients
      const gradTheta: Record<string, number> = {}
      const gradKappa: Record<string, number> = {}
      const gradBeta: Record<string, number> = {}
      const gradGamma: Record<string, number> = {}

      // Initialize gradients
      for (const agent of agents) {
        gradTheta[agent] = -regularization * theta[agent] // L2 regularization
        gradKappa[agent] = -regularization * kappa[agent]
      }
      for (const task of tasks) {
        gradBeta[task] = 0
        gradGamma[task] = 0
      }

      // Calculate gradients from outcomes
      for (const outcome of outcomes) {
        const p = pSuccess({
          theta: theta[outcome.agentID],
          kappa: outcome.isCollaborative ? kappa[outcome.agentID] : 0,
          beta: beta[outcome.taskID],
          gamma: outcome.isCollaborative ? gamma[outcome.taskID] : 0,
          isCollaborative: outcome.isCollaborative,
        })

        // Gradient of log-likelihood: y - p
        const error = (outcome.success ? 1 : 0) - p

        // Update gradients
        gradTheta[outcome.agentID] += error
        if (outcome.isCollaborative) {
          gradKappa[outcome.agentID] += error
          gradGamma[outcome.taskID] -= error
        }
        gradBeta[outcome.taskID] -= error
      }

      // Apply gradients
      for (const agent of agents) {
        theta[agent] += learningRate * gradTheta[agent]
        kappa[agent] += learningRate * gradKappa[agent]
      }
      for (const task of tasks) {
        beta[task] += learningRate * gradBeta[task]
        gamma[task] += learningRate * gradGamma[task]
      }

      // Check convergence every 100 iterations
      if (iter % 100 === 0) {
        const ll = calculateLogLikelihood(outcomes, { theta, kappa, beta, gamma })
        if (Math.abs(ll - prevLL) < convergenceThreshold) {
          break
        }
        prevLL = ll
      }
    }

    // Calculate final log-likelihood
    const logLikelihood = calculateLogLikelihood(outcomes, { theta, kappa, beta, gamma })

    // Calculate confidence intervals using Fisher information (approximate)
    const confidence = calculateConfidenceIntervals(outcomes, { theta, kappa, beta, gamma })

    return {
      theta,
      kappa,
      beta,
      gamma,
      fittedAt: Date.now(),
      sampleSize: outcomes.length,
      logLikelihood,
      confidence,
    }
  }

  /**
   * Calculate log-likelihood of the model
   */
  export function calculateLogLikelihood(
    outcomes: TaskOutcome[],
    params: Pick<ModelParams, "theta" | "kappa" | "beta" | "gamma">,
  ): number {
    let ll = 0

    for (const outcome of outcomes) {
      const p = pSuccess({
        theta: params.theta[outcome.agentID] ?? Priors.theta,
        kappa: outcome.isCollaborative ? (params.kappa[outcome.agentID] ?? Priors.kappa) : 0,
        beta: params.beta[outcome.taskID] ?? Priors.beta,
        gamma: outcome.isCollaborative ? (params.gamma[outcome.taskID] ?? Priors.gamma) : 0,
        isCollaborative: outcome.isCollaborative,
      })

      // Binary cross-entropy
      const clampedP = Math.max(1e-10, Math.min(1 - 1e-10, p))
      ll += outcome.success ? Math.log(clampedP) : Math.log(1 - clampedP)
    }

    return ll
  }

  /**
   * Calculate approximate confidence intervals using Fisher information
   */
  function calculateConfidenceIntervals(
    outcomes: TaskOutcome[],
    params: Pick<ModelParams, "theta" | "kappa" | "beta" | "gamma">,
  ): ModelParams["confidence"] {
    const confidence: ModelParams["confidence"] = {
      theta: {},
      kappa: {},
    }

    // Count outcomes per agent for variance estimation
    const agentCounts: Record<string, number> = {}
    const agentSuccesses: Record<string, number> = {}

    for (const outcome of outcomes) {
      agentCounts[outcome.agentID] = (agentCounts[outcome.agentID] ?? 0) + 1
      if (outcome.success) {
        agentSuccesses[outcome.agentID] = (agentSuccesses[outcome.agentID] ?? 0) + 1
      }
    }

    // Approximate standard error: SE ≈ 1 / sqrt(n * p * (1-p))
    for (const agentID of Object.keys(params.theta)) {
      const n = agentCounts[agentID] ?? 1
      const p = pSuccess({
        theta: params.theta[agentID],
        kappa: 0,
        beta: 0,
        gamma: 0,
        isCollaborative: false,
      })
      const se = 1 / Math.sqrt(n * Math.max(0.1, p * (1 - p)))
      const z = 1.96 // 95% CI

      confidence.theta[agentID] = {
        lower: params.theta[agentID] - z * se,
        upper: params.theta[agentID] + z * se,
      }
      confidence.kappa[agentID] = {
        lower: params.kappa[agentID] - z * se,
        upper: params.kappa[agentID] + z * se,
      }
    }

    return confidence
  }

  /**
   * Create empty/default model params
   */
  export function createEmptyModel(): ModelParams {
    return {
      theta: {},
      kappa: {},
      beta: {},
      gamma: {},
      fittedAt: Date.now(),
      sampleSize: 0,
      logLikelihood: 0,
      confidence: { theta: {}, kappa: {} },
    }
  }

  /**
   * Get agent ability estimate with uncertainty
   *
   * Returns both point estimate and uncertainty measure
   */
  export function getAgentAbility(
    model: ModelParams,
    agentID: string,
  ): {
    theta: number
    kappa: number
    thetaCI: { lower: number; upper: number }
    kappaCI: { lower: number; upper: number }
    isEstimated: boolean
  } {
    const theta = model.theta[agentID] ?? Priors.theta
    const kappa = model.kappa[agentID] ?? Priors.kappa
    const thetaCI = model.confidence.theta[agentID] ?? { lower: theta - 1, upper: theta + 1 }
    const kappaCI = model.confidence.kappa[agentID] ?? { lower: kappa - 1, upper: kappa + 1 }

    return {
      theta,
      kappa,
      thetaCI,
      kappaCI,
      isEstimated: agentID in model.theta,
    }
  }

  /**
   * Get task difficulty estimate
   */
  export function getTaskDifficulty(
    model: ModelParams,
    taskID: string,
  ): {
    beta: number
    gamma: number
    isEstimated: boolean
  } {
    return {
      beta: model.beta[taskID] ?? Priors.beta,
      gamma: model.gamma[taskID] ?? Priors.gamma,
      isEstimated: taskID in model.beta,
    }
  }

  /**
   * Update model incrementally with a new outcome (online learning)
   *
   * Uses stochastic gradient update for single sample
   */
  export function updateModelOnline(
    model: ModelParams,
    outcome: TaskOutcome,
    learningRate: number = 0.1,
  ): ModelParams {
    const newModel = { ...model }
    newModel.theta = { ...model.theta }
    newModel.kappa = { ...model.kappa }
    newModel.beta = { ...model.beta }
    newModel.gamma = { ...model.gamma }

    // Initialize if new agent/task
    if (!(outcome.agentID in newModel.theta)) {
      newModel.theta[outcome.agentID] = Priors.theta
      newModel.kappa[outcome.agentID] = Priors.kappa
    }
    if (!(outcome.taskID in newModel.beta)) {
      newModel.beta[outcome.taskID] = Priors.beta
      newModel.gamma[outcome.taskID] = Priors.gamma
    }

    // Calculate prediction
    const p = pSuccess({
      theta: newModel.theta[outcome.agentID],
      kappa: outcome.isCollaborative ? newModel.kappa[outcome.agentID] : 0,
      beta: newModel.beta[outcome.taskID],
      gamma: outcome.isCollaborative ? newModel.gamma[outcome.taskID] : 0,
      isCollaborative: outcome.isCollaborative,
    })

    // Gradient
    const error = (outcome.success ? 1 : 0) - p

    // Update parameters
    newModel.theta[outcome.agentID] += learningRate * error
    if (outcome.isCollaborative) {
      newModel.kappa[outcome.agentID] += learningRate * error
      newModel.gamma[outcome.taskID] -= learningRate * error
    }
    newModel.beta[outcome.taskID] -= learningRate * error

    // Update metadata
    newModel.sampleSize += 1
    newModel.fittedAt = Date.now()
    newModel.logLikelihood = calculateLogLikelihood([outcome], newModel)

    return newModel
  }

  /**
   * Compare two agents' abilities
   *
   * Returns probability that agent1 is more capable than agent2
   */
  export function compareAgents(
    model: ModelParams,
    agent1ID: string,
    agent2ID: string,
    collaborative: boolean = false,
  ): {
    probAgent1Better: number
    difference: number
    significant: boolean
  } {
    const a1 = getAgentAbility(model, agent1ID)
    const a2 = getAgentAbility(model, agent2ID)

    let diff: number
    if (collaborative) {
      diff = (a1.theta + a1.kappa) - (a2.theta + a2.kappa)
    } else {
      diff = a1.theta - a2.theta
    }

    // P(agent1 > agent2) using normal approximation
    const probBetter = logistic(diff)

    // Significance: check if confidence intervals overlap
    const significant = collaborative
      ? (a1.thetaCI.lower + a1.kappaCI.lower) > (a2.thetaCI.upper + a2.kappaCI.upper) ||
        (a2.thetaCI.lower + a2.kappaCI.lower) > (a1.thetaCI.upper + a1.kappaCI.upper)
      : a1.thetaCI.lower > a2.thetaCI.upper || a2.thetaCI.lower > a1.thetaCI.upper

    return {
      probAgent1Better: probBetter,
      difference: diff,
      significant,
    }
  }

  /**
   * Predict optimal team composition for a task
   *
   * Given a set of available agents and a task, recommend the best team
   */
  export function recommendTeam(
    model: ModelParams,
    availableAgentIDs: string[],
    taskID: string,
    maxTeamSize: number = 4,
  ): {
    recommendedTeam: string[]
    expectedSuccess: number
    rationale: string
  } {
    const task = getTaskDifficulty(model, taskID)

    // Get agent abilities
    const agents = availableAgentIDs.map((id) => ({
      id,
      ...getAgentAbility(model, id),
    }))

    // Sort by total ability (theta + kappa)
    agents.sort((a, b) => (b.theta + b.kappa) - (a.theta + a.kappa))

    // Find optimal team size by maximizing expected success
    let bestTeam: string[] = []
    let bestSuccess = 0
    let bestRationale = ""

    for (let size = 1; size <= Math.min(maxTeamSize, agents.length); size++) {
      const team = agents.slice(0, size)
      const success = pTeamSuccess({
        agentParams: team.map((a) => ({ theta: a.theta, kappa: a.kappa })),
        beta: task.beta,
        gamma: task.gamma,
      })

      if (success > bestSuccess) {
        bestSuccess = success
        bestTeam = team.map((a) => a.id)
        bestRationale = size === 1
          ? `Solo agent recommended due to low collaborative benefit or high coordination cost.`
          : `Team of ${size} recommended. Collaborative ability (κ) contributes ${((team.reduce((s, a) => s + a.kappa, 0) / size) * 100).toFixed(0)}% boost with ${((task.gamma * Math.log2(size + 1)) * 100).toFixed(0)}% coordination overhead.`
      }
    }

    return {
      recommendedTeam: bestTeam,
      expectedSuccess: bestSuccess,
      rationale: bestRationale,
    }
  }
}
