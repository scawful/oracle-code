/**
 * Goal Hierarchy Module
 *
 * Implements goal tracking for the cognitive protocol including:
 * - Primary goals (user's main objective)
 * - Subgoals (decomposed steps)
 * - Instrumental goals (supporting meta-goals)
 * - Goal conflict detection
 * - Focus stack management
 *
 * Based on the HAFS Cognitive Protocol.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { AFS } from "../afs"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { CognitiveCache } from "./cache"

export namespace Goals {
  // =============
  // Zod Schemas
  // =============

  export const GoalStatus = z.enum(["pending", "in_progress", "completed", "blocked", "abandoned"])
  export type GoalStatus = z.infer<typeof GoalStatus>

  export const GoalPriority = z.enum(["critical", "high", "medium", "low", "deferred"])
  export type GoalPriority = z.infer<typeof GoalPriority>

  export const GoalType = z.enum(["primary", "subgoal", "instrumental"])
  export type GoalType = z.infer<typeof GoalType>

  const BaseGoal = z.object({
    id: z.string(),
    description: z.string(),
    goalType: GoalType,
    status: GoalStatus.default("pending"),
    priority: GoalPriority.default("medium"),
    progress: z.number().min(0).max(1).default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable().default(null),
    notes: z.string().default(""),
  })

  export const PrimaryGoal = BaseGoal.extend({
    goalType: z.literal("primary").default("primary"),
    userStated: z.string().default(""),
    successCriteria: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
  })
  export type PrimaryGoal = z.infer<typeof PrimaryGoal>

  export const Subgoal = BaseGoal.extend({
    goalType: z.literal("subgoal").default("subgoal"),
    parentId: z.string(),
    dependencies: z.array(z.string()).default([]),
    estimatedEffort: z.string().default(""),
  })
  export type Subgoal = z.infer<typeof Subgoal>

  export const InstrumentalGoal = BaseGoal.extend({
    goalType: z.literal("instrumental").default("instrumental"),
    supports: z.array(z.string()).default([]),
    reusable: z.boolean().default(true),
  })
  export type InstrumentalGoal = z.infer<typeof InstrumentalGoal>

  export const Goal = z.union([PrimaryGoal, Subgoal, InstrumentalGoal])
  export type Goal = z.infer<typeof Goal>

  export const GoalConflict = z.object({
    id: z.string(),
    goalAId: z.string(),
    goalBId: z.string(),
    conflictType: z.string(),
    description: z.string(),
    resolution: z.string().default(""),
    resolved: z.boolean().default(false),
    detectedAt: z.string(),
  })
  export type GoalConflict = z.infer<typeof GoalConflict>

  export const GoalHierarchy = z.object({
    primaryGoal: PrimaryGoal.nullable().default(null),
    subgoals: z.array(Subgoal).default([]),
    instrumentalGoals: z.array(InstrumentalGoal).default([]),
    goalStack: z.array(z.string()).default([]),
    conflicts: z.array(GoalConflict).default([]),
    lastUpdated: z.string().default(() => new Date().toISOString()),
  })
  export type GoalHierarchy = z.infer<typeof GoalHierarchy>

  // =============
  // Events
  // =============

  export const Event = {
    Updated: BusEvent.define(
      "goals.updated",
      z.object({
        root: z.string(),
        hierarchy: GoalHierarchy,
      }),
    ),
    GoalCompleted: BusEvent.define(
      "goals.goal_completed",
      z.object({
        root: z.string(),
        goalId: z.string(),
        description: z.string(),
      }),
    ),
    ConflictDetected: BusEvent.define(
      "goals.conflict_detected",
      z.object({
        root: z.string(),
        conflict: GoalConflict,
      }),
    ),
  }

  // =============
  // Conflict Patterns
  // =============

  export const CONFLICT_PATTERNS: Record<
    string,
    {
      keywordsA: string[]
      keywordsB: string[]
      description: string
    }
  > = {
    minimize_vs_refactor: {
      keywordsA: ["minimize", "small change", "minimal", "quick fix"],
      keywordsB: ["refactor", "restructure", "rewrite", "overhaul"],
      description: "Conflict between minimizing changes and refactoring",
    },
    speed_vs_quality: {
      keywordsA: ["fast", "quick", "asap", "urgent"],
      keywordsB: ["thorough", "complete", "comprehensive", "robust"],
      description: "Conflict between speed and thoroughness",
    },
    backward_compat_vs_modernize: {
      keywordsA: ["backward compatible", "legacy support", "don't break"],
      keywordsB: ["modernize", "upgrade", "migrate", "deprecate"],
      description: "Conflict between backward compatibility and modernization",
    },
  }

  // =============
  // File Operations
  // =============

  function applyMetadata<T extends Record<string, unknown>>(obj: T): T {
    return {
      schema_version: "0.3",
      producer: { name: "oracle-code", version: "unknown" },
      last_updated: new Date().toISOString(),
      ...obj,
    } as T
  }

  export function getPath(contextRoot: string): string {
    return path.join(contextRoot, "scratchpad", "goals.json")
  }

  async function readFromDisk(contextRoot: string): Promise<GoalHierarchy | null> {
    const filePath = getPath(contextRoot)
    try {
      const content = await Bun.file(filePath).text()
      const data = JSON.parse(content)
      return GoalHierarchy.parse(data)
    } catch {
      return null
    }
  }

  async function writeToDisk(contextRoot: string, hierarchy: GoalHierarchy): Promise<void> {
    const filePath = getPath(contextRoot)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    const withMeta = applyMetadata(hierarchy)
    await Bun.write(filePath, JSON.stringify(withMeta, null, 2))
  }

  export async function read(contextRoot: string): Promise<GoalHierarchy | null> {
    const cached = CognitiveCache.goals.get<GoalHierarchy>(contextRoot)
    if (cached) return cached

    const data = await readFromDisk(contextRoot)
    if (data) {
      CognitiveCache.goals.set(contextRoot, data)
    }
    return data
  }

  export async function write(contextRoot: string, hierarchy: GoalHierarchy): Promise<void> {
    hierarchy.lastUpdated = new Date().toISOString()
    CognitiveCache.goals.writeBatched(contextRoot, hierarchy, (data) =>
      writeToDisk(contextRoot, applyMetadata(data as GoalHierarchy)),
    )
    Bus.publish(Event.Updated, { root: contextRoot, hierarchy })
  }

  export async function getOrCreate(contextRoot: string): Promise<GoalHierarchy> {
    return CognitiveCache.goals.getOrCompute(
      contextRoot,
      () => readFromDisk(contextRoot),
      () => GoalHierarchy.parse({}),
    )
  }

  // =============
  // Helper Functions
  // =============

  function generateId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  function now(): string {
    return new Date().toISOString()
  }

  // =============
  // Goal Management
  // =============

  /**
   * Set the primary goal
   */
  export async function setPrimaryGoal(
    contextRoot: string,
    description: string,
    options: {
      userStated?: string
      successCriteria?: string[]
      constraints?: string[]
    } = {},
  ): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)

    hierarchy.primaryGoal = PrimaryGoal.parse({
      id: generateId("pg"),
      description,
      userStated: options.userStated || description,
      successCriteria: options.successCriteria || [],
      constraints: options.constraints || [],
      status: "in_progress",
      createdAt: now(),
      updatedAt: now(),
    })

    // Clear existing subgoals and stack when primary changes
    hierarchy.subgoals = []
    hierarchy.goalStack = []

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  /**
   * Add a subgoal
   */
  export async function addSubgoal(
    contextRoot: string,
    description: string,
    parentId: string,
    options: {
      dependencies?: string[]
      priority?: GoalPriority
      estimatedEffort?: string
    } = {},
  ): Promise<{ hierarchy: GoalHierarchy; subgoal: Subgoal }> {
    const hierarchy = await getOrCreate(contextRoot)

    const subgoal = Subgoal.parse({
      id: generateId("sg"),
      description,
      parentId,
      dependencies: options.dependencies || [],
      priority: options.priority || "medium",
      estimatedEffort: options.estimatedEffort || "",
      createdAt: now(),
      updatedAt: now(),
    })

    hierarchy.subgoals.push(subgoal)

    // Check for conflicts
    await detectConflictsForGoal(contextRoot, hierarchy, subgoal)

    await write(contextRoot, hierarchy)
    return { hierarchy, subgoal }
  }

  /**
   * Add an instrumental goal
   */
  export async function addInstrumentalGoal(
    contextRoot: string,
    description: string,
    supports: string[],
    reusable: boolean = true,
  ): Promise<{ hierarchy: GoalHierarchy; goal: InstrumentalGoal }> {
    const hierarchy = await getOrCreate(contextRoot)

    const goal = InstrumentalGoal.parse({
      id: generateId("ig"),
      description,
      supports,
      reusable,
      createdAt: now(),
      updatedAt: now(),
    })

    hierarchy.instrumentalGoals.push(goal)
    await write(contextRoot, hierarchy)
    return { hierarchy, goal }
  }

  /**
   * Update goal progress
   */
  export async function updateProgress(contextRoot: string, goalId: string, progress: number): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)
    const goal = findGoal(hierarchy, goalId)

    if (goal) {
      goal.progress = Math.max(0, Math.min(1, progress))
      goal.updatedAt = now()

      if (goal.progress >= 1.0) {
        goal.status = "completed"
        goal.completedAt = now()

        Bus.publish(Event.GoalCompleted, {
          root: contextRoot,
          goalId: goal.id,
          description: goal.description,
        })
      }

      // Update parent progress if this is a subgoal
      if (goal.goalType === "subgoal") {
        updateParentProgress(hierarchy, (goal as Subgoal).parentId)
      }
    }

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  /**
   * Complete a goal
   */
  export async function completeGoal(contextRoot: string, goalId: string): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)
    const goal = findGoal(hierarchy, goalId)

    if (goal) {
      goal.status = "completed"
      goal.progress = 1.0
      goal.completedAt = now()
      goal.updatedAt = now()

      // Remove from stack
      hierarchy.goalStack = hierarchy.goalStack.filter((id) => id !== goalId)

      // Update parent progress
      if (goal.goalType === "subgoal") {
        updateParentProgress(hierarchy, (goal as Subgoal).parentId)
      }

      Bus.publish(Event.GoalCompleted, {
        root: contextRoot,
        goalId: goal.id,
        description: goal.description,
      })
    }

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  /**
   * Block a goal
   */
  export async function blockGoal(contextRoot: string, goalId: string, reason: string = ""): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)
    const goal = findGoal(hierarchy, goalId)

    if (goal) {
      goal.status = "blocked"
      goal.updatedAt = now()
      if (reason) {
        goal.notes = goal.notes ? `${goal.notes}\nBlocked: ${reason}` : `Blocked: ${reason}`
      }
    }

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  // =============
  // Focus Stack
  // =============

  /**
   * Push a goal onto the focus stack
   */
  export async function pushFocus(contextRoot: string, goalId: string): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)

    if (findGoal(hierarchy, goalId) && !hierarchy.goalStack.includes(goalId)) {
      hierarchy.goalStack.push(goalId)
    }

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  /**
   * Pop the current focus
   */
  export async function popFocus(contextRoot: string): Promise<{ hierarchy: GoalHierarchy; poppedId: string | null }> {
    const hierarchy = await getOrCreate(contextRoot)
    const poppedId = hierarchy.goalStack.pop() || null

    await write(contextRoot, hierarchy)
    return { hierarchy, poppedId }
  }

  /**
   * Get the currently focused goal
   */
  export function getCurrentFocus(hierarchy: GoalHierarchy): Goal | null {
    if (hierarchy.goalStack.length === 0) {
      return hierarchy.primaryGoal
    }
    const focusId = hierarchy.goalStack[hierarchy.goalStack.length - 1]
    return findGoal(hierarchy, focusId)
  }

  // =============
  // Conflict Detection
  // =============

  async function detectConflictsForGoal(
    contextRoot: string,
    hierarchy: GoalHierarchy,
    newGoal: Goal,
  ): Promise<GoalConflict[]> {
    const conflicts: GoalConflict[] = []
    const newDesc = newGoal.description.toLowerCase()

    const allGoals = getAllGoals(hierarchy).filter((g) => g.id !== newGoal.id)

    for (const existingGoal of allGoals) {
      const existingDesc = existingGoal.description.toLowerCase()

      for (const [patternName, pattern] of Object.entries(CONFLICT_PATTERNS)) {
        const newMatchesA = pattern.keywordsA.some((kw) => newDesc.includes(kw))
        const existingMatchesB = pattern.keywordsB.some((kw) => existingDesc.includes(kw))
        const newMatchesB = pattern.keywordsB.some((kw) => newDesc.includes(kw))
        const existingMatchesA = pattern.keywordsA.some((kw) => existingDesc.includes(kw))

        if ((newMatchesA && existingMatchesB) || (newMatchesB && existingMatchesA)) {
          const conflict: GoalConflict = {
            id: generateId("conflict"),
            goalAId: newGoal.id,
            goalBId: existingGoal.id,
            conflictType: patternName,
            description: pattern.description,
            detectedAt: now(),
            resolved: false,
            resolution: "",
          }

          conflicts.push(conflict)
          hierarchy.conflicts.push(conflict)

          Bus.publish(Event.ConflictDetected, {
            root: contextRoot,
            conflict,
          })
        }
      }
    }

    return conflicts
  }

  /**
   * Resolve a conflict
   */
  export async function resolveConflict(
    contextRoot: string,
    conflictId: string,
    resolution: string,
  ): Promise<GoalHierarchy> {
    const hierarchy = await getOrCreate(contextRoot)

    const conflict = hierarchy.conflicts.find((c) => c.id === conflictId)
    if (conflict) {
      conflict.resolution = resolution
      conflict.resolved = true
    }

    await write(contextRoot, hierarchy)
    return hierarchy
  }

  // =============
  // Query Functions
  // =============

  /**
   * Get all goals in the hierarchy
   */
  export function getAllGoals(hierarchy: GoalHierarchy): Goal[] {
    const goals: Goal[] = []
    if (hierarchy.primaryGoal) goals.push(hierarchy.primaryGoal)
    goals.push(...hierarchy.subgoals)
    goals.push(...hierarchy.instrumentalGoals)
    return goals
  }

  /**
   * Find a goal by ID
   */
  export function findGoal(hierarchy: GoalHierarchy, goalId: string): Goal | null {
    for (const goal of getAllGoals(hierarchy)) {
      if (goal.id === goalId) return goal
    }
    return null
  }

  /**
   * Get active (non-completed, non-abandoned) goals
   */
  export function getActiveGoals(hierarchy: GoalHierarchy): Goal[] {
    return getAllGoals(hierarchy).filter((g) => g.status !== "completed" && g.status !== "abandoned")
  }

  /**
   * Get unresolved conflicts
   */
  export function getUnresolvedConflicts(hierarchy: GoalHierarchy): GoalConflict[] {
    return hierarchy.conflicts.filter((c) => !c.resolved)
  }

  /**
   * Calculate completion percentage
   */
  export function getCompletionPercentage(hierarchy: GoalHierarchy): number {
    if (!hierarchy.primaryGoal) return 0
    if (hierarchy.subgoals.length === 0) return hierarchy.primaryGoal.progress * 100

    const avgProgress = hierarchy.subgoals.reduce((sum, sg) => sum + sg.progress, 0) / hierarchy.subgoals.length
    return avgProgress * 100
  }

  /**
   * Get next actionable goal (pending/in_progress with met dependencies)
   */
  export function getNextActionableGoal(hierarchy: GoalHierarchy): Goal | null {
    for (const subgoal of hierarchy.subgoals) {
      if (subgoal.status === "pending" || subgoal.status === "in_progress") {
        const depsMet = subgoal.dependencies.every((depId) => {
          const dep = findGoal(hierarchy, depId)
          return dep && dep.status === "completed"
        })
        if (depsMet) return subgoal
      }
    }

    if (
      hierarchy.primaryGoal &&
      (hierarchy.primaryGoal.status === "pending" || hierarchy.primaryGoal.status === "in_progress")
    ) {
      return hierarchy.primaryGoal
    }

    return null
  }

  // =============
  // Internal Helpers
  // =============

  function updateParentProgress(hierarchy: GoalHierarchy, parentId: string): void {
    const parent = findGoal(hierarchy, parentId)
    if (!parent) return

    const children = hierarchy.subgoals.filter((sg) => sg.parentId === parentId)
    if (children.length === 0) return

    const avgProgress = children.reduce((sum, sg) => sum + sg.progress, 0) / children.length
    parent.progress = avgProgress
    parent.updatedAt = now()
  }

  /**
   * Reset all goals
   */
  export async function reset(contextRoot: string): Promise<GoalHierarchy> {
    const hierarchy = GoalHierarchy.parse({})
    await write(contextRoot, hierarchy)
    return hierarchy
  }

  /**
   * Get status summary
   */
  export function getStatusSummary(hierarchy: GoalHierarchy): {
    hasPrimaryGoal: boolean
    primaryGoal: string | null
    completionPercentage: number
    totalSubgoals: number
    completedSubgoals: number
    blockedGoals: number
    unresolvedConflicts: number
    currentFocus: string | null
  } {
    const focus = getCurrentFocus(hierarchy)
    return {
      hasPrimaryGoal: hierarchy.primaryGoal !== null,
      primaryGoal: hierarchy.primaryGoal?.description || null,
      completionPercentage: getCompletionPercentage(hierarchy),
      totalSubgoals: hierarchy.subgoals.length,
      completedSubgoals: hierarchy.subgoals.filter((sg) => sg.status === "completed").length,
      blockedGoals: getAllGoals(hierarchy).filter((g) => g.status === "blocked").length,
      unresolvedConflicts: getUnresolvedConflicts(hierarchy).length,
      currentFocus: focus?.description || null,
    }
  }
}
