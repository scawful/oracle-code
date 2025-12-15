/**
 * Metacognition Module
 *
 * Implements self-monitoring capabilities for the agent including:
 * - Spin detection (repeated similar actions)
 * - Cognitive load tracking
 * - Strategy evaluation
 * - Flow state detection
 * - Help-seeking triggers
 *
 * Based on the HAFS Cognitive Protocol.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { createHash } from "crypto"
import { CognitiveCache } from "./cache"

export namespace Metacognition {
  // =============
  // Zod Schemas
  // =============

  export const ProgressStatus = z.enum(["making_progress", "spinning", "blocked"])
  export type ProgressStatus = z.infer<typeof ProgressStatus>

  export const Strategy = z.enum([
    "incremental",
    "divide_and_conquer",
    "depth_first",
    "breadth_first",
    "research_first",
    "prototype",
  ])
  export type Strategy = z.infer<typeof Strategy>

  export const SpinDetection = z.object({
    recentActions: z.array(z.string()).default([]),
    similarActionCount: z.number().default(0),
    lastDistinctActionTime: z.string().nullable().default(null),
    spinningThreshold: z.number().min(3).max(5).default(4),
  })
  export type SpinDetection = z.infer<typeof SpinDetection>

  export const CognitiveLoad = z.object({
    current: z.number().min(0).max(1).default(0),
    warningThreshold: z.number().min(0).max(1).default(0.8),
    itemsInFocus: z.number().min(0).default(0),
    maxRecommendedItems: z.number().default(7), // Miller's Law
  })
  export type CognitiveLoad = z.infer<typeof CognitiveLoad>

  export const HelpSeeking = z.object({
    uncertaintyThreshold: z.number().min(0).max(1).default(0.3),
    currentUncertainty: z.number().min(0).max(1).default(0),
    consecutiveFailures: z.number().min(0).default(0),
    failureThreshold: z.number().default(2),
  })
  export type HelpSeeking = z.infer<typeof HelpSeeking>

  export const SelfCorrection = z.object({
    id: z.string(),
    what: z.string(),
    when: z.string(),
    why: z.string(),
    outcome: z.string().default(""),
  })
  export type SelfCorrection = z.infer<typeof SelfCorrection>

  export const FlowStateIndicators = z.object({
    minProgressRequired: z.boolean().default(true),
    maxCognitiveLoad: z.number().default(0.7),
    minStrategyEffectiveness: z.number().default(0.6),
    maxFrustration: z.number().default(0.3),
    noHelpNeeded: z.boolean().default(true),
  })
  export type FlowStateIndicators = z.infer<typeof FlowStateIndicators>

  export const MetacognitiveState = z.object({
    currentStrategy: Strategy.default("incremental"),
    strategyEffectiveness: z.number().min(0).max(1).default(0.5),
    progressStatus: ProgressStatus.default("making_progress"),
    spinDetection: SpinDetection.default(() => ({
      recentActions: [],
      similarActionCount: 0,
      lastDistinctActionTime: null,
      spinningThreshold: 4,
    })),
    cognitiveLoad: CognitiveLoad.default(() => ({
      current: 0,
      warningThreshold: 0.8,
      itemsInFocus: 0,
      maxRecommendedItems: 7,
    })),
    helpSeeking: HelpSeeking.default(() => ({
      uncertaintyThreshold: 0.3,
      currentUncertainty: 0,
      consecutiveFailures: 0,
      failureThreshold: 2,
    })),
    selfCorrections: z.array(SelfCorrection).default([]),
    flowState: z.boolean().default(false),
    flowStateIndicators: FlowStateIndicators.default(() => ({
      minProgressRequired: true,
      maxCognitiveLoad: 0.7,
      minStrategyEffectiveness: 0.6,
      maxFrustration: 0.3,
      noHelpNeeded: true,
    })),
    frustrationLevel: z.number().min(0).max(1).default(0),
    lastUpdated: z.string().default(() => new Date().toISOString()),
  })
  export type MetacognitiveState = z.infer<typeof MetacognitiveState>

  // =============
  // Events
  // =============

  export const Event = {
    Updated: BusEvent.define(
      "metacognition.updated",
      z.object({
        root: z.string(),
        state: MetacognitiveState,
      }),
    ),
    FlowStateChanged: BusEvent.define(
      "metacognition.flow_state_changed",
      z.object({
        root: z.string(),
        inFlow: z.boolean(),
      }),
    ),
    SpinningDetected: BusEvent.define(
      "metacognition.spinning_detected",
      z.object({
        root: z.string(),
        actionCount: z.number(),
      }),
    ),
  }

  // =============
  // Strategy Descriptions
  // =============

  export const STRATEGY_DESCRIPTIONS: Record<Strategy, string> = {
    incremental: "Make small changes, validate frequently",
    divide_and_conquer: "Break problem into smaller subproblems",
    depth_first: "Fully explore one path before trying others",
    breadth_first: "Survey all options before committing",
    research_first: "Gather information before acting",
    prototype: "Build quick proof-of-concept first",
  }

  function applyMetadata<T extends Record<string, unknown>>(obj: T): T {
    return {
      schema_version: "0.3",
      producer: { name: "oracle-code", version: "unknown" },
      last_updated: new Date().toISOString(),
      ...obj,
    } as T
  }

  // =============
  // File Operations
  // =============

  export function getPath(contextRoot: string): string {
    return path.join(contextRoot, "scratchpad", "metacognition.json")
  }

  /**
   * Read metacognitive state from disk (bypasses cache)
   */
  async function readFromDisk(contextRoot: string): Promise<MetacognitiveState | null> {
    const filePath = getPath(contextRoot)
    try {
      const content = await Bun.file(filePath).text()
      const data = JSON.parse(content)
      return MetacognitiveState.parse(data)
    } catch {
      return null
    }
  }

  /**
   * Write metacognitive state to disk (bypasses cache)
   */
  async function writeToDisk(contextRoot: string, state: MetacognitiveState): Promise<void> {
    const filePath = getPath(contextRoot)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    state.lastUpdated = new Date().toISOString()
    const withMeta = applyMetadata(state)
    await Bun.write(filePath, JSON.stringify(withMeta, null, 2))
  }

  /**
   * Read metacognitive state (uses cache)
   */
  export async function read(contextRoot: string): Promise<MetacognitiveState | null> {
    // Check cache first
    const cached = CognitiveCache.metacognition.get<MetacognitiveState>(contextRoot)
    if (cached) return cached

    // Read from disk and cache
    const state = await readFromDisk(contextRoot)
    if (state) {
      CognitiveCache.metacognition.set(contextRoot, state)
    }
    return state
  }

  /**
   * Write metacognitive state (batched writes to reduce I/O)
   */
  export async function write(contextRoot: string, state: MetacognitiveState): Promise<void> {
    state.lastUpdated = new Date().toISOString()

    // Update cache immediately
    CognitiveCache.metacognition.set(contextRoot, state)

    // Batch the disk write
    CognitiveCache.metacognition.writeBatched(contextRoot, state, async (data) => {
      await writeToDisk(contextRoot, applyMetadata(data as MetacognitiveState))
    })

    // Publish event immediately (from cache)
    Bus.publish(Event.Updated, { root: contextRoot, state })
  }

  /**
   * Get or create metacognitive state (uses cache)
   */
  export async function getOrCreate(contextRoot: string): Promise<MetacognitiveState> {
    return CognitiveCache.metacognition.getOrCompute(
      contextRoot,
      () => readFromDisk(contextRoot),
      () => MetacognitiveState.parse({}),
    )
  }

  // =============
  // Core Logic
  // =============

  /**
   * Compute a hash signature for an action (for spin detection)
   */
  function computeActionSignature(action: string): string {
    const normalized = action.toLowerCase().trim().replace(/\s+/g, " ")
    return createHash("sha256").update(normalized).digest("hex").slice(0, 8)
  }

  /**
   * Record an action for spin detection
   */
  export async function recordAction(contextRoot: string, actionDescription: string): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)
    const signature = computeActionSignature(actionDescription)
    const recent = state.spinDetection.recentActions

    // Check similarity to last action
    if (recent.length > 0 && recent[recent.length - 1] === signature) {
      state.spinDetection.similarActionCount++
    } else {
      state.spinDetection.similarActionCount = 0
      state.spinDetection.lastDistinctActionTime = new Date().toISOString()
    }

    // Maintain action history (max 10)
    recent.push(signature)
    if (recent.length > 10) {
      state.spinDetection.recentActions = recent.slice(-10)
    }

    // Update progress status
    updateProgressStatus(state)

    // Check for spinning
    if (isSpinning(state)) {
      Bus.publish(Event.SpinningDetected, {
        root: contextRoot,
        actionCount: state.spinDetection.similarActionCount,
      })
    }

    await write(contextRoot, state)
    return state
  }

  /**
   * Check if currently spinning
   */
  export function isSpinning(state: MetacognitiveState): boolean {
    return state.spinDetection.similarActionCount >= state.spinDetection.spinningThreshold
  }

  /**
   * Check if cognitive load is too high
   */
  export function isOverloaded(state: MetacognitiveState): boolean {
    return state.cognitiveLoad.current >= state.cognitiveLoad.warningThreshold
  }

  /**
   * Check if help should be sought
   */
  export function shouldSeekHelp(state: MetacognitiveState): boolean {
    return (
      state.helpSeeking.currentUncertainty > state.helpSeeking.uncertaintyThreshold ||
      state.helpSeeking.consecutiveFailures > state.helpSeeking.failureThreshold
    )
  }

  /**
   * Update progress status based on current state
   */
  function updateProgressStatus(state: MetacognitiveState): void {
    if (isSpinning(state)) {
      state.progressStatus = "spinning"
    } else if (shouldSeekHelp(state)) {
      state.progressStatus = "blocked"
    } else {
      state.progressStatus = "making_progress"
    }
  }

  /**
   * Update cognitive load based on items in focus
   */
  export async function updateCognitiveLoad(contextRoot: string, itemsInFocus: number): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)
    const maxItems = state.cognitiveLoad.maxRecommendedItems

    state.cognitiveLoad.itemsInFocus = itemsInFocus
    state.cognitiveLoad.current = Math.min(1.0, itemsInFocus / maxItems)

    await write(contextRoot, state)
    return state
  }

  /**
   * Record a failure
   */
  export async function recordFailure(contextRoot: string): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    state.helpSeeking.consecutiveFailures++
    state.frustrationLevel = Math.min(1.0, state.frustrationLevel + 0.2)
    updateProgressStatus(state)

    await write(contextRoot, state)
    return state
  }

  /**
   * Record a success
   */
  export async function recordSuccess(contextRoot: string): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    state.helpSeeking.consecutiveFailures = 0
    state.frustrationLevel = Math.max(0.0, state.frustrationLevel - 0.3)
    state.spinDetection.similarActionCount = 0

    // Increase strategy effectiveness
    state.strategyEffectiveness = Math.min(1.0, state.strategyEffectiveness + 0.1)

    await write(contextRoot, state)
    return state
  }

  /**
   * Update uncertainty level
   */
  export async function updateUncertainty(contextRoot: string, uncertainty: number): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    state.helpSeeking.currentUncertainty = Math.max(0, Math.min(1, uncertainty))
    updateProgressStatus(state)

    await write(contextRoot, state)
    return state
  }

  /**
   * Set the current strategy
   */
  export async function setStrategy(contextRoot: string, strategy: Strategy): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    if (strategy !== state.currentStrategy) {
      state.currentStrategy = strategy
      state.strategyEffectiveness = 0.5 // Reset effectiveness for new strategy
    }

    await write(contextRoot, state)
    return state
  }

  /**
   * Update strategy effectiveness
   */
  export async function updateStrategyEffectiveness(contextRoot: string, delta: number): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    state.strategyEffectiveness = Math.max(0, Math.min(1, state.strategyEffectiveness + delta))

    await write(contextRoot, state)
    return state
  }

  /**
   * Record a self-correction
   */
  export async function recordSelfCorrection(
    contextRoot: string,
    what: string,
    why: string,
    outcome: string = "",
  ): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    const correction: SelfCorrection = {
      id: `sc-${Date.now().toString(36)}`,
      what,
      why,
      when: new Date().toISOString(),
      outcome,
    }

    state.selfCorrections.push(correction)

    // Keep only last 10 corrections
    if (state.selfCorrections.length > 10) {
      state.selfCorrections = state.selfCorrections.slice(-10)
    }

    await write(contextRoot, state)
    return state
  }

  /**
   * Check and update flow state
   */
  export async function checkFlowState(contextRoot: string): Promise<{ inFlow: boolean; changed: boolean }> {
    const state = await getOrCreate(contextRoot)
    const indicators = state.flowStateIndicators
    const wasInFlow = state.flowState

    const inFlow =
      (!indicators.minProgressRequired || state.progressStatus === "making_progress") &&
      state.cognitiveLoad.current < indicators.maxCognitiveLoad &&
      state.strategyEffectiveness >= indicators.minStrategyEffectiveness &&
      state.frustrationLevel < indicators.maxFrustration &&
      (!indicators.noHelpNeeded || !shouldSeekHelp(state))

    state.flowState = inFlow

    if (wasInFlow !== inFlow) {
      Bus.publish(Event.FlowStateChanged, { root: contextRoot, inFlow })
    }

    await write(contextRoot, state)
    return { inFlow, changed: wasInFlow !== inFlow }
  }

  /**
   * Reset spin detection
   */
  export async function resetSpinDetection(contextRoot: string): Promise<MetacognitiveState> {
    const state = await getOrCreate(contextRoot)

    state.spinDetection = SpinDetection.parse({})
    state.progressStatus = "making_progress"

    await write(contextRoot, state)
    return state
  }

  /**
   * Reset all metacognitive state
   */
  export async function reset(contextRoot: string): Promise<MetacognitiveState> {
    const state = MetacognitiveState.parse({})
    await write(contextRoot, state)
    return state
  }

  /**
   * Get a summary of current status
   */
  export function getStatusSummary(state: MetacognitiveState): {
    strategy: string
    strategyEffectiveness: number
    progress: string
    cognitiveLoad: number
    isSpinning: boolean
    isOverloaded: boolean
    shouldSeekHelp: boolean
    flowState: boolean
    frustration: number
  } {
    return {
      strategy: state.currentStrategy,
      strategyEffectiveness: state.strategyEffectiveness,
      progress: state.progressStatus,
      cognitiveLoad: Math.round(state.cognitiveLoad.current * 100),
      isSpinning: isSpinning(state),
      isOverloaded: isOverloaded(state),
      shouldSeekHelp: shouldSeekHelp(state),
      flowState: state.flowState,
      frustration: state.frustrationLevel,
    }
  }
}
