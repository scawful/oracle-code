/**
 * Epistemic States Module
 *
 * Tracks what the agent knows, believes, and doesn't know with confidence levels
 * and provenance. Implements tiered fact storage:
 * - Golden facts: Essential, long-term, high-confidence (max 10)
 * - Working facts: Session-relevant, subject to decay (max 100)
 *
 * Also tracks assumptions (need validation), unknowns (knowledge gaps),
 * and contradictions (conflicting information).
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { ulid } from "ulid"
import { CognitiveCache } from "./cache"

export namespace Epistemic {
  // =============
  // Zod Schemas
  // =============

  // Key pattern: category.subcategory.key (e.g., file.package_json.exists)
  export const KeyPattern = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z_][a-z0-9_]*)+$/, {
    message: "Key must follow pattern: category.subcategory.key (e.g., file.package_json.exists)",
  })

  export const KnowledgeSource = z.enum([
    "user_stated", // User explicitly said this
    "file_read", // Read from a file
    "tool_output", // Result of a tool execution
    "inferred", // Derived from other facts
    "assumed", // Best guess without confirmation
  ])
  export type KnowledgeSource = z.infer<typeof KnowledgeSource>

  export const GoldenCategory = z.enum([
    "architecture", // Tech stack, patterns, structure
    "constraints", // Hard requirements, limitations
    "user_preference", // User's stated preferences
    "project_identity", // Project name, purpose, key info
  ])
  export type GoldenCategory = z.infer<typeof GoldenCategory>

  export const Importance = z.enum(["critical", "high", "medium", "low"])
  export type Importance = z.infer<typeof Importance>

  export const Severity = z.enum(["high", "medium", "low"])
  export type Severity = z.infer<typeof Severity>

  // Base fact structure
  export const BaseFact = z.object({
    key: z.string(), // Validated separately for flexibility
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    source: KnowledgeSource,
    timestamp: z.string(),
    dependencies: z.array(z.string()).optional(),
  })
  export type BaseFact = z.infer<typeof BaseFact>

  // Golden fact - essential, persistent, no decay
  export const GoldenFact = BaseFact.extend({
    category: GoldenCategory,
    promotedAt: z.string(),
    promotionReason: z.string(),
  })
  export type GoldenFact = z.infer<typeof GoldenFact>

  // Working fact - transient, subject to decay
  export const WorkingFact = BaseFact.extend({
    lastValidated: z.string(),
    decayRate: z.number().min(0).max(1).default(0.05), // Per hour
    relatedFiles: z.array(z.string()).optional(),
  })
  export type WorkingFact = z.infer<typeof WorkingFact>

  // Assumption - needs validation
  export const Assumption = z.object({
    key: z.string(),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    basis: z.string(), // Why we assume this
    needsValidation: z.boolean().default(true),
    createdAt: z.string(),
    validatedAt: z.string().optional(),
  })
  export type Assumption = z.infer<typeof Assumption>

  // Unknown - knowledge gap
  export const Unknown = z.object({
    topic: z.string(),
    importance: Importance,
    relatedGoals: z.array(z.string()).optional(),
    suggestedResolution: z.string().optional(),
    addedAt: z.string(),
  })
  export type Unknown = z.infer<typeof Unknown>

  // Contradiction - conflicting information
  export const Contradiction = z.object({
    id: z.string(),
    factKeys: z.array(z.string()),
    description: z.string(),
    severity: Severity,
    resolved: z.boolean().default(false),
    resolution: z.string().optional(),
    detectedAt: z.string(),
  })
  export type Contradiction = z.infer<typeof Contradiction>

  // Settings
  export const Settings = z.object({
    autoRecordFromTools: z.boolean().default(true),
    autoDetectContradictions: z.boolean().default(true),
    minConfidenceForAutoRecord: z.number().min(0).max(1).default(0.7),
    decayRatePerHour: z.number().min(0).max(1).default(0.05),
    pruneThreshold: z.number().min(0).max(1).default(0.1),
    maxGoldenFacts: z.number().default(10),
    maxWorkingFacts: z.number().default(100),
  })
  export type Settings = z.infer<typeof Settings>

  // Complete epistemic state
  export const EpistemicState = z.object({
    goldenFacts: z.record(z.string(), GoldenFact).default({}),
    workingFacts: z.record(z.string(), WorkingFact).default({}),
    assumptions: z.record(z.string(), Assumption).default({}),
    unknowns: z.array(Unknown).default([]),
    contradictions: z.array(Contradiction).default([]),
    settings: Settings,
    lastUpdated: z.string(),
    lastDecayCheck: z.string(),
  })
  export type EpistemicState = z.infer<typeof EpistemicState>

  // Summary for UI/prompts
  export interface EpistemicSummary {
    goldenFactCount: number
    maxGoldenFacts: number
    workingFactCount: number
    maxWorkingFacts: number
    avgConfidence: number
    assumptionCount: number
    unvalidatedCount: number
    unknownCount: number
    criticalUnknowns: number
    contradictionCount: number
    hasData: boolean
  }

  // =============
  // Events
  // =============

  export const Event = {
    Updated: BusEvent.define(
      "epistemic.updated",
      z.object({
        root: z.string(),
        changeType: z.enum([
          "fact_added",
          "fact_removed",
          "assumption_added",
          "unknown_added",
          "contradiction_detected",
          "decay_applied",
        ]),
      }),
    ),
    ContradictionDetected: BusEvent.define(
      "epistemic.contradiction_detected",
      z.object({
        contradiction: Contradiction,
      }),
    ),
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

  const EPISTEMIC_FILE = "epistemic.json"

  function getFilePath(root: string): string {
    return path.join(root, "scratchpad", EPISTEMIC_FILE)
  }

  function createEmptyState(): EpistemicState {
    const now = new Date().toISOString()
    return {
      goldenFacts: {},
      workingFacts: {},
      assumptions: {},
      unknowns: [],
      contradictions: [],
      settings: Settings.parse({}),
      lastUpdated: now,
      lastDecayCheck: now,
    }
  }

  async function readFromDisk(root: string): Promise<EpistemicState | null> {
    try {
      const filePath = getFilePath(root)
      const content = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(content)
      return EpistemicState.parse(data)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  async function writeToDisk(root: string, state: EpistemicState): Promise<void> {
    const filePath = getFilePath(root)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const withMeta = applyMetadata(state)
    await fs.writeFile(filePath, JSON.stringify(withMeta, null, 2))
  }

  export async function read(root: string): Promise<EpistemicState | null> {
    const cached = CognitiveCache.epistemic.get<EpistemicState>(root)
    if (cached) return cached

    const data = await readFromDisk(root)
    if (data) {
      CognitiveCache.epistemic.set(root, data)
    }
    return data
  }

  export async function write(root: string, state: EpistemicState): Promise<void> {
    state.lastUpdated = new Date().toISOString()
    CognitiveCache.epistemic.writeBatched(root, state, (data) =>
      writeToDisk(root, applyMetadata(data as EpistemicState)),
    )
  }

  export async function getOrCreate(root: string): Promise<EpistemicState> {
    return CognitiveCache.epistemic.getOrCompute(root, () => readFromDisk(root), createEmptyState)
  }

  export async function reset(root: string, scope: "golden" | "working" | "all" = "all"): Promise<void> {
    const state = await getOrCreate(root)

    switch (scope) {
      case "golden":
        state.goldenFacts = {}
        break
      case "working":
        state.workingFacts = {}
        state.assumptions = {}
        state.unknowns = []
        state.contradictions = []
        break
      case "all":
        const settings = state.settings
        Object.assign(state, createEmptyState())
        state.settings = settings // Preserve settings
        break
    }

    await write(root, state)
  }

  // =============
  // Settings
  // =============

  export async function getSettings(root: string): Promise<Settings> {
    const state = await getOrCreate(root)
    return state.settings
  }

  export async function updateSettings(root: string, updates: Partial<Settings>): Promise<Settings> {
    const state = await getOrCreate(root)
    state.settings = { ...state.settings, ...updates }
    await write(root, state)
    return state.settings
  }

  // =============
  // Working Fact Operations
  // =============

  export async function addWorkingFact(
    root: string,
    key: string,
    value: unknown,
    confidence: number,
    source: KnowledgeSource,
    relatedFiles?: string[],
  ): Promise<void> {
    const state = await getOrCreate(root)
    const now = new Date().toISOString()

    // Check capacity
    if (Object.keys(state.workingFacts).length >= state.settings.maxWorkingFacts) {
      // Prune lowest confidence fact
      await pruneLowestConfidence(state)
    }

    state.workingFacts[key] = {
      key,
      value,
      confidence: Math.max(0, Math.min(1, confidence)),
      source,
      timestamp: now,
      lastValidated: now,
      decayRate: state.settings.decayRatePerHour,
      relatedFiles,
    }

    await write(root, state)

    // Check for contradictions if enabled
    if (state.settings.autoDetectContradictions) {
      await detectAndRecordContradictions(root, state)
    }

    Bus.publish(Event.Updated, { root, changeType: "fact_added" })
  }

  export async function removeWorkingFact(root: string, key: string): Promise<boolean> {
    const state = await getOrCreate(root)
    if (!state.workingFacts[key]) return false

    delete state.workingFacts[key]
    await write(root, state)

    Bus.publish(Event.Updated, { root, changeType: "fact_removed" })
    return true
  }

  export async function refreshFactConfidence(root: string, key: string): Promise<boolean> {
    const state = await getOrCreate(root)

    const fact = state.workingFacts[key]
    if (!fact) return false

    fact.lastValidated = new Date().toISOString()
    fact.confidence = Math.min(1, fact.confidence + 0.2) // Boost confidence on refresh

    await write(root, state)
    return true
  }

  function pruneLowestConfidence(state: EpistemicState): void {
    const facts = Object.entries(state.workingFacts)
    if (facts.length === 0) return

    // Sort by confidence, remove lowest
    facts.sort((a, b) => a[1].confidence - b[1].confidence)
    const [lowestKey] = facts[0]
    delete state.workingFacts[lowestKey]
  }

  // =============
  // Golden Fact Operations
  // =============

  export async function promoteToGolden(
    root: string,
    key: string,
    category: GoldenCategory,
    reason: string,
  ): Promise<void> {
    const state = await getOrCreate(root)

    // Check capacity
    if (Object.keys(state.goldenFacts).length >= state.settings.maxGoldenFacts) {
      throw new Error(`Golden facts at capacity (${state.settings.maxGoldenFacts}). Demote one first.`)
    }

    // Can promote from working facts or assumptions
    let baseFact: BaseFact | null = null

    if (state.workingFacts[key]) {
      baseFact = state.workingFacts[key]
      delete state.workingFacts[key]
    } else if (state.assumptions[key]) {
      const assumption = state.assumptions[key]
      baseFact = {
        key,
        value: assumption.value,
        confidence: assumption.confidence,
        source: "inferred",
        timestamp: assumption.createdAt,
      }
      delete state.assumptions[key]
    }

    if (!baseFact) {
      throw new Error(`Fact or assumption '${key}' not found`)
    }

    const now = new Date().toISOString()
    state.goldenFacts[key] = {
      ...baseFact,
      confidence: 1.0, // Golden facts have max confidence
      category,
      promotedAt: now,
      promotionReason: reason,
    }

    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "fact_added" })
  }

  export async function demoteFromGolden(root: string, key: string): Promise<void> {
    const state = await getOrCreate(root)

    const goldenFact = state.goldenFacts[key]
    if (!goldenFact) {
      throw new Error(`Golden fact '${key}' not found`)
    }

    // Move to working facts
    const now = new Date().toISOString()
    state.workingFacts[key] = {
      key: goldenFact.key,
      value: goldenFact.value,
      confidence: 0.9, // Start with high confidence
      source: goldenFact.source,
      timestamp: goldenFact.timestamp,
      lastValidated: now,
      decayRate: state.settings.decayRatePerHour,
    }

    delete state.goldenFacts[key]
    await write(root, state)
  }

  export async function addGoldenFactDirect(
    root: string,
    key: string,
    value: unknown,
    category: GoldenCategory,
    reason: string,
    source: KnowledgeSource = "user_stated",
  ): Promise<void> {
    const state = await getOrCreate(root)

    if (Object.keys(state.goldenFacts).length >= state.settings.maxGoldenFacts) {
      throw new Error(`Golden facts at capacity (${state.settings.maxGoldenFacts}). Demote one first.`)
    }

    const now = new Date().toISOString()
    state.goldenFacts[key] = {
      key,
      value,
      confidence: 1.0,
      source,
      timestamp: now,
      category,
      promotedAt: now,
      promotionReason: reason,
    }

    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "fact_added" })
  }

  // =============
  // Assumption Operations
  // =============

  export async function addAssumption(
    root: string,
    key: string,
    value: unknown,
    basis: string,
    confidence: number = 0.5,
  ): Promise<void> {
    const state = await getOrCreate(root)
    const now = new Date().toISOString()

    state.assumptions[key] = {
      key,
      value,
      confidence: Math.max(0, Math.min(1, confidence)),
      basis,
      needsValidation: true,
      createdAt: now,
    }

    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "assumption_added" })
  }

  export async function validateAssumption(root: string, key: string): Promise<void> {
    const state = await getOrCreate(root)

    const assumption = state.assumptions[key]
    if (!assumption) {
      throw new Error(`Assumption '${key}' not found`)
    }

    // Promote to working fact
    const now = new Date().toISOString()
    state.workingFacts[key] = {
      key,
      value: assumption.value,
      confidence: Math.min(1, assumption.confidence + 0.3), // Boost on validation
      source: "inferred",
      timestamp: assumption.createdAt,
      lastValidated: now,
      decayRate: state.settings.decayRatePerHour,
    }

    delete state.assumptions[key]
    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "fact_added" })
  }

  export async function invalidateAssumption(root: string, key: string): Promise<boolean> {
    const state = await getOrCreate(root)

    if (!state.assumptions[key]) return false

    delete state.assumptions[key]
    await write(root, state)
    return true
  }

  export function getUnvalidatedAssumptions(state: EpistemicState): Assumption[] {
    return Object.values(state.assumptions).filter((a) => a.needsValidation)
  }

  // =============
  // Unknown Operations
  // =============

  export async function addUnknown(
    root: string,
    topic: string,
    importance: Importance,
    relatedGoals?: string[],
    suggestedResolution?: string,
  ): Promise<void> {
    const state = await getOrCreate(root)

    // Check if already exists
    const existing = state.unknowns.find((u) => u.topic === topic)
    if (existing) {
      // Update importance if higher
      const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      if (importanceOrder[importance] < importanceOrder[existing.importance]) {
        existing.importance = importance
      }
      if (relatedGoals) {
        existing.relatedGoals = [...new Set([...(existing.relatedGoals || []), ...relatedGoals])]
      }
      await write(root, state)
      return
    }

    state.unknowns.push({
      topic,
      importance,
      relatedGoals,
      suggestedResolution,
      addedAt: new Date().toISOString(),
    })

    // Sort by importance
    const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    state.unknowns.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance])

    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "unknown_added" })
  }

  export async function resolveUnknown(root: string, topic: string, resolution: string): Promise<boolean> {
    const state = await getOrCreate(root)

    const index = state.unknowns.findIndex((u) => u.topic === topic)
    if (index === -1) return false

    // Optionally record the resolution as a fact
    const unknown = state.unknowns[index]
    state.unknowns.splice(index, 1)

    // Add resolution as a working fact if it looks like a key-value
    if (resolution.includes("=") || resolution.includes(":")) {
      // Just remove the unknown, let user add fact separately
    }

    await write(root, state)
    return true
  }

  export function getCriticalUnknowns(state: EpistemicState): Unknown[] {
    return state.unknowns.filter((u) => u.importance === "critical")
  }

  export function getUnknownsBlockingGoal(state: EpistemicState, goalId: string): Unknown[] {
    return state.unknowns.filter((u) => u.relatedGoals?.includes(goalId))
  }

  // =============
  // Contradiction Operations
  // =============

  interface ContradictionPattern {
    name: string
    description: string
    detect: (facts: Record<string, BaseFact>) => Array<{ keys: string[]; description: string }>
  }

  const CONTRADICTION_PATTERNS: ContradictionPattern[] = [
    {
      name: "boolean_conflict",
      description: "Same property with opposite boolean values",
      detect: (facts) => {
        const conflicts: Array<{ keys: string[]; description: string }> = []
        const byKey = new Map<string, BaseFact[]>()

        for (const fact of Object.values(facts)) {
          const existing = byKey.get(fact.key)
          if (existing) {
            existing.push(fact)
          } else {
            byKey.set(fact.key, [fact])
          }
        }

        for (const [key, factsForKey] of byKey) {
          if (factsForKey.length > 1) {
            const values = factsForKey.map((f) => f.value)
            if (values.includes(true) && values.includes(false)) {
              conflicts.push({
                keys: [key],
                description: `Key '${key}' has both true and false values`,
              })
            }
          }
        }

        return conflicts
      },
    },
    {
      name: "version_conflict",
      description: "Same dependency with different versions",
      detect: (facts) => {
        const conflicts: Array<{ keys: string[]; description: string }> = []
        const versions = new Map<string, Array<{ key: string; version: string }>>()

        for (const [key, fact] of Object.entries(facts)) {
          if (key.startsWith("dep.") && key.endsWith(".version")) {
            const depName = key.split(".")[1]
            const existing = versions.get(depName) || []
            existing.push({ key, version: String(fact.value) })
            versions.set(depName, existing)
          }
        }

        for (const [depName, versionFacts] of versions) {
          if (versionFacts.length > 1) {
            const uniqueVersions = [...new Set(versionFacts.map((v) => v.version))]
            if (uniqueVersions.length > 1) {
              conflicts.push({
                keys: versionFacts.map((v) => v.key),
                description: `Dependency '${depName}' has conflicting versions: ${uniqueVersions.join(", ")}`,
              })
            }
          }
        }

        return conflicts
      },
    },
    {
      name: "existence_conflict",
      description: "File both exists and doesn't exist",
      detect: (facts) => {
        const conflicts: Array<{ keys: string[]; description: string }> = []
        const existence = new Map<string, Array<{ key: string; exists: boolean }>>()

        for (const [key, fact] of Object.entries(facts)) {
          if (key.startsWith("file.") && key.endsWith(".exists")) {
            const fileName = key.slice(5, -7) // Remove "file." and ".exists"
            const existing = existence.get(fileName) || []
            existing.push({ key, exists: Boolean(fact.value) })
            existence.set(fileName, existing)
          }
        }

        for (const [fileName, existsFacts] of existence) {
          if (existsFacts.length > 1) {
            const hasTrue = existsFacts.some((e) => e.exists)
            const hasFalse = existsFacts.some((e) => !e.exists)
            if (hasTrue && hasFalse) {
              conflicts.push({
                keys: existsFacts.map((e) => e.key),
                description: `File '${fileName}' is recorded as both existing and not existing`,
              })
            }
          }
        }

        return conflicts
      },
    },
  ]

  export function detectContradictions(state: EpistemicState): Contradiction[] {
    const allFacts: Record<string, BaseFact> = {
      ...state.goldenFacts,
      ...state.workingFacts,
    }

    const detected: Contradiction[] = []
    const existingKeys = new Set(state.contradictions.map((c) => c.factKeys.sort().join(",")))

    for (const pattern of CONTRADICTION_PATTERNS) {
      const conflicts = pattern.detect(allFacts)
      for (const conflict of conflicts) {
        const key = conflict.keys.sort().join(",")
        if (!existingKeys.has(key)) {
          detected.push({
            id: ulid(),
            factKeys: conflict.keys,
            description: conflict.description,
            severity: "medium",
            resolved: false,
            detectedAt: new Date().toISOString(),
          })
        }
      }
    }

    return detected
  }

  async function detectAndRecordContradictions(root: string, state: EpistemicState): Promise<void> {
    const newContradictions = detectContradictions(state)

    if (newContradictions.length > 0) {
      state.contradictions.push(...newContradictions)
      await write(root, state)

      for (const contradiction of newContradictions) {
        Bus.publish(Event.ContradictionDetected, { contradiction })
      }
    }
  }

  export async function addContradiction(
    root: string,
    factKeys: string[],
    description: string,
    severity: Severity,
  ): Promise<void> {
    const state = await getOrCreate(root)

    state.contradictions.push({
      id: ulid(),
      factKeys,
      description,
      severity,
      resolved: false,
      detectedAt: new Date().toISOString(),
    })

    await write(root, state)
    Bus.publish(Event.Updated, { root, changeType: "contradiction_detected" })
  }

  export async function resolveContradiction(root: string, id: string, resolution: string): Promise<boolean> {
    const state = await getOrCreate(root)

    const contradiction = state.contradictions.find((c) => c.id === id)
    if (!contradiction) return false

    contradiction.resolved = true
    contradiction.resolution = resolution

    await write(root, state)
    return true
  }

  export function getUnresolvedContradictions(state: EpistemicState): Contradiction[] {
    return state.contradictions.filter((c) => !c.resolved)
  }

  // =============
  // Decay & Pruning
  // =============

  export async function applyDecay(root: string, modifiedFiles: string[] = []): Promise<number> {
    const state = await getOrCreate(root)
    const now = Date.now()
    const lastCheck = Date.parse(state.lastDecayCheck)
    const hoursSinceCheck = (now - lastCheck) / (1000 * 60 * 60)

    if (hoursSinceCheck < 0.1) {
      // Don't apply decay too frequently (min 6 minutes)
      return 0
    }

    let prunedCount = 0
    const modifiedFilesSet = new Set(modifiedFiles)

    for (const [key, fact] of Object.entries(state.workingFacts)) {
      const lastValidated = Date.parse(fact.lastValidated)
      const hoursSinceValidation = (now - lastValidated) / (1000 * 60 * 60)

      // Base decay over time
      let decayAmount = fact.decayRate * hoursSinceValidation

      // Extra decay if related files were modified
      if (fact.relatedFiles?.some((f) => modifiedFilesSet.has(f))) {
        decayAmount += 0.3 // Significant confidence hit
      }

      fact.confidence = Math.max(0, fact.confidence - decayAmount)

      // Prune facts that decay below threshold
      if (fact.confidence < state.settings.pruneThreshold) {
        delete state.workingFacts[key]
        prunedCount++
      }
    }

    state.lastDecayCheck = new Date().toISOString()
    await write(root, state)

    if (prunedCount > 0) {
      Bus.publish(Event.Updated, { root, changeType: "decay_applied" })
    }

    return prunedCount
  }

  export async function pruneWorkingFacts(root: string, minConfidence?: number): Promise<number> {
    const state = await getOrCreate(root)
    const threshold = minConfidence ?? state.settings.pruneThreshold

    let prunedCount = 0
    for (const [key, fact] of Object.entries(state.workingFacts)) {
      if (fact.confidence < threshold) {
        delete state.workingFacts[key]
        prunedCount++
      }
    }

    if (prunedCount > 0) {
      await write(root, state)
    }

    return prunedCount
  }

  // =============
  // Query Functions
  // =============

  export function getFactsByPattern(state: EpistemicState, pattern: string): BaseFact[] {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    const allFacts = { ...state.goldenFacts, ...state.workingFacts }

    return Object.values(allFacts).filter((f) => regex.test(f.key))
  }

  export function getAllFacts(state: EpistemicState): Array<BaseFact & { tier: "golden" | "working" }> {
    const result: Array<BaseFact & { tier: "golden" | "working" }> = []

    for (const fact of Object.values(state.goldenFacts)) {
      result.push({ ...fact, tier: "golden" })
    }
    for (const fact of Object.values(state.workingFacts)) {
      result.push({ ...fact, tier: "working" })
    }

    return result
  }

  // =============
  // Summary Functions
  // =============

  export function getStatusSummary(state: EpistemicState): EpistemicSummary {
    const workingFacts = Object.values(state.workingFacts)
    const avgConfidence =
      workingFacts.length > 0
        ? Math.round((workingFacts.reduce((sum, f) => sum + f.confidence, 0) / workingFacts.length) * 100)
        : 100

    const unvalidated = Object.values(state.assumptions).filter((a) => a.needsValidation).length
    const criticalUnknowns = state.unknowns.filter((u) => u.importance === "critical").length
    const unresolvedContradictions = state.contradictions.filter((c) => !c.resolved).length

    return {
      goldenFactCount: Object.keys(state.goldenFacts).length,
      maxGoldenFacts: state.settings.maxGoldenFacts,
      workingFactCount: Object.keys(state.workingFacts).length,
      maxWorkingFacts: state.settings.maxWorkingFacts,
      avgConfidence,
      assumptionCount: Object.keys(state.assumptions).length,
      unvalidatedCount: unvalidated,
      unknownCount: state.unknowns.length,
      criticalUnknowns,
      contradictionCount: unresolvedContradictions,
      hasData:
        Object.keys(state.goldenFacts).length > 0 ||
        Object.keys(state.workingFacts).length > 0 ||
        state.unknowns.length > 0,
    }
  }

  export function getStateForPrompt(state: EpistemicState): string {
    const summary = getStatusSummary(state)
    const lines: string[] = ["## Knowledge State"]

    lines.push(`- Golden Facts: ${summary.goldenFactCount}/${summary.maxGoldenFacts}`)
    lines.push(
      `- Working Facts: ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% avg confidence)`,
    )
    lines.push(`- Assumptions: ${summary.assumptionCount} (${summary.unvalidatedCount} unvalidated)`)
    lines.push(`- Unknowns: ${summary.unknownCount} (${summary.criticalUnknowns} critical)`)
    lines.push(`- Contradictions: ${summary.contradictionCount}`)

    // List critical unknowns
    const criticalUnknowns = getCriticalUnknowns(state)
    if (criticalUnknowns.length > 0) {
      lines.push("")
      lines.push("### Critical Unknowns")
      for (const unknown of criticalUnknowns) {
        lines.push(`- ${unknown.topic}`)
      }
    }

    // Note contradictions
    const contradictions = getUnresolvedContradictions(state)
    if (contradictions.length > 0) {
      lines.push("")
      lines.push("### Unresolved Contradictions")
      for (const c of contradictions) {
        lines.push(`- ${c.description}`)
      }
    }

    lines.push("")
    lines.push("Use `/knowledge` or read `.context/scratchpad/epistemic.json` for details.")

    return lines.join("\n")
  }

  export function exportToStateMarkdown(state: EpistemicState): string {
    const summary = getStatusSummary(state)
    const lines: string[] = ["## 7. Knowledge State"]

    lines.push(`- **Golden Facts:** ${summary.goldenFactCount}/${summary.maxGoldenFacts}`)
    lines.push(
      `- **Working Facts:** ${summary.workingFactCount}/${summary.maxWorkingFacts} (avg confidence: ${summary.avgConfidence}%)`,
    )
    lines.push(`- **Assumptions:** ${summary.assumptionCount} (${summary.unvalidatedCount} unvalidated)`)
    lines.push(`- **Unknowns:** ${summary.unknownCount} (${summary.criticalUnknowns} critical)`)
    lines.push(`- **Contradictions:** ${summary.contradictionCount}`)
    lines.push("")
    lines.push("Use `/knowledge facts golden` or read `.context/scratchpad/epistemic.json` for details.")

    return lines.join("\n")
  }
}
