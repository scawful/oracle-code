import { z } from "zod"
import fs from "fs/promises"
import path from "path"
import { IRT } from "./irt"
import { ErrorDetection } from "./errors"

/**
 * Task outcome tracking for IRT fitting.
 *
 * Outcomes and fitted models are stored under the AFS context tree in a writable
 * directory. Legacy data from `history/metrics` is read and migrated on demand.
 */
export namespace TaskTracking {
  /**
   * Storage paths
   */
  const OUTCOMES_FILE = "task-outcomes.json"
  const MODEL_FILE = "irt-model.json"
  const STORAGE_SUBDIR = ["scratchpad", "metrics"] as const
  const LEGACY_SUBDIR = ["history", "metrics"] as const

  function getLegacyDir(contextRoot: string): string {
    return path.join(contextRoot, ...LEGACY_SUBDIR)
  }
  /**
   * Extended outcome with session context
   */
  export const TrackedOutcome = IRT.TaskOutcome.extend({
    sessionID: z.string(),
    agentName: z.string(),
    taskDescription: z.string().optional(),
    errors: z.array(ErrorDetection.DetectedError).optional(),
  })
  export type TrackedOutcome = z.infer<typeof TrackedOutcome>

  /**
   * Storage format for outcomes file
   */
  const OutcomesStorage = z.object({
    version: z.number(),
    outcomes: z.array(TrackedOutcome),
    lastUpdated: z.number(),
  })
  type OutcomesStorage = z.infer<typeof OutcomesStorage>

  /**
   * Storage format for model file
   */
  const ModelStorage = z.object({
    version: z.number(),
    params: z.custom<IRT.ModelParams>(),
    lastFitted: z.number(),
    outcomeCount: z.number(),
  })
  type ModelStorage = z.infer<typeof ModelStorage>

  /**
   * Get the writable storage directory path.
   */
  async function getStorageDir(contextRoot: string): Promise<string> {
    const dir = path.join(contextRoot, ...STORAGE_SUBDIR)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async function readOutcomesFile(filePath: string): Promise<TrackedOutcome[] | null> {
    return fs
      .readFile(filePath, "utf-8")
      .then((content) => OutcomesStorage.parse(JSON.parse(content)).outcomes)
      .catch(() => null)
  }

  async function readModelFile(filePath: string): Promise<IRT.ModelParams | null> {
    return fs
      .readFile(filePath, "utf-8")
      .then((content) => ModelStorage.parse(JSON.parse(content)).params)
      .catch(() => null)
  }

  /**
   * Load outcomes from storage
   */
  export async function loadOutcomes(contextRoot: string): Promise<TrackedOutcome[]> {
    const dir = await getStorageDir(contextRoot)
    const filePath = path.join(dir, OUTCOMES_FILE)
    const current = await readOutcomesFile(filePath)
    if (current) return current

    const legacyFilePath = path.join(getLegacyDir(contextRoot), OUTCOMES_FILE)
    const legacy = await readOutcomesFile(legacyFilePath)
    if (!legacy) return []

    await saveOutcomes(contextRoot, legacy).catch(() => {})
    return legacy
  }

  /**
   * Save outcomes to storage
   */
  export async function saveOutcomes(
    contextRoot: string,
    outcomes: TrackedOutcome[],
  ): Promise<void> {
    const dir = await getStorageDir(contextRoot)
    const filePath = path.join(dir, OUTCOMES_FILE)

    const storage: OutcomesStorage = {
      version: 1,
      outcomes,
      lastUpdated: Date.now(),
    }

    await fs.writeFile(filePath, JSON.stringify(storage, null, 2), "utf-8")
  }

  /**
   * Record a single task outcome
   */
  export async function recordOutcome(
    contextRoot: string,
    outcome: TrackedOutcome,
  ): Promise<void> {
    const outcomes = await loadOutcomes(contextRoot)
    outcomes.push(outcome)

    // Keep only last 1000 outcomes to prevent unbounded growth
    const trimmed = outcomes.slice(-1000)

    await saveOutcomes(contextRoot, trimmed)
  }

  /**
   * Load the IRT model from storage
   */
  export async function loadModel(contextRoot: string): Promise<IRT.ModelParams | null> {
    const dir = await getStorageDir(contextRoot)
    const filePath = path.join(dir, MODEL_FILE)
    const current = await readModelFile(filePath)
    if (current) return current

    const legacyFilePath = path.join(getLegacyDir(contextRoot), MODEL_FILE)
    const legacy = await readModelFile(legacyFilePath)
    if (!legacy) return null

    await saveModel(contextRoot, legacy, legacy.sampleSize).catch(() => {})
    return legacy
  }

  /**
   * Save the IRT model to storage
   */
  export async function saveModel(
    contextRoot: string,
    params: IRT.ModelParams,
    outcomeCount: number,
  ): Promise<void> {
    const dir = await getStorageDir(contextRoot)
    const filePath = path.join(dir, MODEL_FILE)

    const storage: ModelStorage = {
      version: 1,
      params,
      lastFitted: Date.now(),
      outcomeCount,
    }

    await fs.writeFile(filePath, JSON.stringify(storage, null, 2), "utf-8")
  }

  /**
   * Fit or update the IRT model from recorded outcomes
   */
  export async function fitModel(
    contextRoot: string,
    options?: {
      minOutcomes?: number
      forceRefit?: boolean
    },
  ): Promise<{
    model: IRT.ModelParams
    fitted: boolean
    message: string
  }> {
    const minOutcomes = options?.minOutcomes ?? 10
    const forceRefit = options?.forceRefit ?? false

    const outcomes = await loadOutcomes(contextRoot)
    const existingModel = await loadModel(contextRoot)

    // Check if we have enough data
    if (outcomes.length < minOutcomes) {
      if (existingModel) {
        return {
          model: existingModel,
          fitted: false,
          message: `Insufficient data (${outcomes.length}/${minOutcomes}). Using existing model.`,
        }
      }
      return {
        model: IRT.createEmptyModel(),
        fitted: false,
        message: `Insufficient data (${outcomes.length}/${minOutcomes}). No model available.`,
      }
    }

    // Check if refit is needed
    if (!forceRefit && existingModel && existingModel.sampleSize >= outcomes.length * 0.9) {
      return {
        model: existingModel,
        fitted: false,
        message: `Model is up to date (${existingModel.sampleSize} outcomes).`,
      }
    }

    // Convert TrackedOutcome to IRT.TaskOutcome
    const irtOutcomes: IRT.TaskOutcome[] = outcomes.map((o) => ({
      taskID: o.taskID,
      agentID: o.agentID,
      isCollaborative: o.isCollaborative,
      partnerIDs: o.partnerIDs,
      success: o.success,
      tokens: o.tokens,
      duration: o.duration,
      errorCount: o.errorCount,
      timestamp: o.timestamp,
    }))

    // Fit new model
    const model = IRT.fitModel(irtOutcomes)

    // Save to storage
    await saveModel(contextRoot, model, outcomes.length)

    return {
      model,
      fitted: true,
      message: `Model fitted on ${outcomes.length} outcomes.`,
    }
  }

  /**
   * Create a tracked outcome from session data
   *
   * Call this after each task/session completes
   */
  export function createTrackedOutcome(params: {
    sessionID: string
    taskID: string
    agentID: string
    agentName: string
    partnerIDs?: string[]
    success: boolean
    tokens: number
    duration: number
    errors: ErrorDetection.DetectedError[]
    taskDescription?: string
  }): TrackedOutcome {
    return {
      sessionID: params.sessionID,
      taskID: params.taskID,
      agentID: params.agentID,
      agentName: params.agentName,
      isCollaborative: (params.partnerIDs?.length ?? 0) > 0,
      partnerIDs: params.partnerIDs,
      success: params.success,
      tokens: params.tokens,
      duration: params.duration,
      errorCount: params.errors.length,
      errors: params.errors,
      timestamp: Date.now(),
      taskDescription: params.taskDescription,
    }
  }

  /**
   * Get model statistics for display
   */
  export async function getModelStats(contextRoot: string): Promise<{
    hasModel: boolean
    outcomeCount: number
    agentCount: number
    taskCount: number
    lastFitted: number | null
    topAgents: Array<{ id: string; theta: number; kappa: number }>
    hardestTasks: Array<{ id: string; beta: number; gamma: number }>
  }> {
    const outcomes = await loadOutcomes(contextRoot)
    const model = await loadModel(contextRoot)

    if (!model) {
      return {
        hasModel: false,
        outcomeCount: outcomes.length,
        agentCount: 0,
        taskCount: 0,
        lastFitted: null,
        topAgents: [],
        hardestTasks: [],
      }
    }

    // Get top agents by combined ability (theta + kappa)
    const agents = Object.entries(model.theta).map(([id, theta]) => ({
      id,
      theta,
      kappa: model.kappa[id] ?? 0,
      combined: theta + (model.kappa[id] ?? 0),
    }))
    agents.sort((a, b) => b.combined - a.combined)

    // Get hardest tasks by difficulty (beta + gamma)
    const tasks = Object.entries(model.beta).map(([id, beta]) => ({
      id,
      beta,
      gamma: model.gamma[id] ?? 0,
      combined: beta + (model.gamma[id] ?? 0),
    }))
    tasks.sort((a, b) => b.combined - a.combined)

    return {
      hasModel: true,
      outcomeCount: outcomes.length,
      agentCount: Object.keys(model.theta).length,
      taskCount: Object.keys(model.beta).length,
      lastFitted: model.fittedAt,
      topAgents: agents.slice(0, 5).map(({ id, theta, kappa }) => ({ id, theta, kappa })),
      hardestTasks: tasks.slice(0, 5).map(({ id, beta, gamma }) => ({ id, beta, gamma })),
    }
  }

  /**
   * Clear all tracking data (for testing/reset)
   */
  export async function clearAll(contextRoot: string): Promise<void> {
    const dir = await getStorageDir(contextRoot)
    await fs.unlink(path.join(dir, OUTCOMES_FILE)).catch(() => {})
    await fs.unlink(path.join(dir, MODEL_FILE)).catch(() => {})
  }

  /**
   * Export outcomes for analysis
   */
  export async function exportOutcomes(
    contextRoot: string,
    format: "json" | "csv",
  ): Promise<string> {
    const outcomes = await loadOutcomes(contextRoot)

    if (format === "json") {
      return JSON.stringify(outcomes, null, 2)
    }

    // CSV format
    const headers = [
      "sessionID",
      "taskID",
      "agentID",
      "agentName",
      "isCollaborative",
      "success",
      "tokens",
      "duration",
      "errorCount",
      "timestamp",
    ]

    const rows = outcomes.map((o) =>
      [
        o.sessionID,
        o.taskID,
        o.agentID,
        o.agentName,
        o.isCollaborative,
        o.success,
        o.tokens,
        o.duration,
        o.errorCount,
        o.timestamp,
      ].join(","),
    )

    return [headers.join(","), ...rows].join("\n")
  }

  /**
   * Import outcomes from JSON (for migration/backup)
   */
  export async function importOutcomes(
    contextRoot: string,
    json: string,
    merge: boolean = true,
  ): Promise<{ imported: number; total: number }> {
    const imported = z.array(TrackedOutcome).parse(JSON.parse(json))

    if (!merge) {
      await saveOutcomes(contextRoot, imported)
      return {
        imported: imported.length,
        total: imported.length,
      }
    }

    const existing = await loadOutcomes(contextRoot)
    const existingIds = new Set(existing.map((o) => `${o.sessionID}-${o.taskID}-${o.agentID}`))

    const newOutcomes = imported.filter((o) => !existingIds.has(`${o.sessionID}-${o.taskID}-${o.agentID}`))

    const combined = [...existing, ...newOutcomes]
    await saveOutcomes(contextRoot, combined)

    return {
      imported: newOutcomes.length,
      total: combined.length,
    }
  }
}
