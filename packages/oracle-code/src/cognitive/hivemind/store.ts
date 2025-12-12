/**
 * Hivemind Store
 *
 * Core storage and CRUD operations for the Hivemind shared learning system.
 * Handles both project-level (.context/hivemind/) and global
 * (~/.config/oracle-code/global-hivemind/) storage.
 */

import path from "path"
import fs from "fs/promises"
import os from "os"
import z from "zod"
import { ulid } from "ulid"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { AFS } from "../../afs"
import {
  HivemindState,
  HivemindEntry,
  HivemindManifest,
  HivemindCategory,
  HivemindScope,
  EntryStatus,
  PromotionRequest,
  CouncilSession,
  categoryToArrayKey,
  type CategoryArrayKey,
} from "./types"

export namespace HivemindStore {
  // =============
  // Constants
  // =============

  const HIVEMIND_DIR = "hivemind"
  const GLOBAL_HIVEMIND_DIR = ".config/oracle-code/global-hivemind"

  const FILES = {
    fears: "fears.json",
    satisfactions: "satisfactions.json",
    knowledge: "knowledge.json",
    decisions: "decisions.json",
    preferences: "preferences.json",
    pending: "pending.json",
    councils: "councils.json",
    manifest: "manifest.json",
  } as const

  // =============
  // Bus Events
  // =============

  export const Event = {
    Updated: BusEvent.define(
      "hivemind.updated",
      z.object({
        scope: HivemindScope,
        category: HivemindCategory.optional(),
      })
    ),
    EntryAdded: BusEvent.define(
      "hivemind.entry.added",
      z.object({
        entry: HivemindEntry,
      })
    ),
    EntryUpdated: BusEvent.define(
      "hivemind.entry.updated",
      z.object({
        entryId: z.string(),
        updates: z.record(z.string(), z.any()),
      })
    ),
    EntryRemoved: BusEvent.define(
      "hivemind.entry.removed",
      z.object({
        entryId: z.string(),
        category: HivemindCategory,
      })
    ),
    EntryPromotedGolden: BusEvent.define(
      "hivemind.entry.promoted_golden",
      z.object({
        entryId: z.string(),
        promotedBy: z.enum(["auto", "user", "council"]),
      })
    ),
    PromotionRequested: BusEvent.define(
      "hivemind.promotion.requested",
      z.object({
        requestId: z.string(),
        category: HivemindCategory,
      })
    ),
    GlobalToggled: BusEvent.define(
      "hivemind.global.toggled",
      z.object({
        enabled: z.boolean(),
      })
    ),
  } as const

  // =============
  // Path Helpers
  // =============

  /**
   * Get the project-level hivemind directory path
   */
  export async function getProjectRoot(contextRoot?: string): Promise<string> {
    const root = contextRoot || (await AFS.getRoot())
    return path.join(root, HIVEMIND_DIR)
  }

  /**
   * Get the global hivemind directory path
   */
  export function getGlobalRoot(): string {
    return path.join(os.homedir(), GLOBAL_HIVEMIND_DIR)
  }

  /**
   * Ensure a hivemind directory exists with all required files
   */
  async function ensureDirectory(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })

    // Ensure all JSON files exist with defaults
    for (const [key, filename] of Object.entries(FILES)) {
      const filePath = path.join(dir, filename)
      try {
        await fs.access(filePath)
      } catch {
        // File doesn't exist, create with default
        const defaultContent =
          key === "manifest"
            ? HivemindManifest.parse({
                lastSync: new Date().toISOString(),
              })
            : []
        await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2))
      }
    }
  }

  // =============
  // File I/O
  // =============

  async function readJsonFile<T>(filePath: string, schema: { parse: (data: unknown) => T }): Promise<T> {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return schema.parse(JSON.parse(content))
    } catch (error) {
      // Return default based on schema - let caller handle
      throw error
    }
  }

  async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
  }

  // =============
  // Read Operations
  // =============

  /**
   * Get the complete hivemind state for a scope
   */
  export async function getState(
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<HivemindState> {
    const dir = scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    await ensureDirectory(dir)

    const [fears, satisfactions, knowledge, decisions, preferences, pending, councils, manifest] =
      await Promise.all([
        readJsonFile(path.join(dir, FILES.fears), { parse: (d) => HivemindEntry.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.satisfactions), { parse: (d) => HivemindEntry.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.knowledge), { parse: (d) => HivemindEntry.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.decisions), { parse: (d) => HivemindEntry.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.preferences), { parse: (d) => HivemindEntry.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.pending), { parse: (d) => PromotionRequest.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.councils), { parse: (d) => CouncilSession.array().parse(d) }),
        readJsonFile(path.join(dir, FILES.manifest), HivemindManifest),
      ])

    return {
      fears,
      satisfactions,
      knowledge,
      decisions,
      preferences,
      pending,
      councils,
      manifest,
    }
  }

  /**
   * Get combined state from both project and global scopes
   */
  export async function getCombinedState(contextRoot?: string): Promise<{
    project: HivemindState
    global: HivemindState | null
  }> {
    const projectState = await getState(contextRoot, "project")
    let globalState: HivemindState | null = null

    if (projectState.manifest.globalEnabled) {
      try {
        globalState = await getState(undefined, "global")
      } catch {
        // Global hivemind not initialized
      }
    }

    return { project: projectState, global: globalState }
  }

  /**
   * Get a single entry by ID
   */
  export async function getEntry(
    id: string,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry | null> {
    const scopes: HivemindScope[] = scope ? [scope] : ["project", "global"]

    for (const s of scopes) {
      try {
        const state = await getState(contextRoot, s)
        for (const arrayKey of Object.values(categoryToArrayKey)) {
          const entry = state[arrayKey].find((e) => e.id === id)
          if (entry) return entry
        }
      } catch {
        // Scope not available
      }
    }

    return null
  }

  /**
   * Get entries by category
   */
  export async function getEntriesByCategory(
    category: HivemindCategory,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry[]> {
    const arrayKey = categoryToArrayKey[category]
    const results: HivemindEntry[] = []

    if (!scope || scope === "project") {
      const projectState = await getState(contextRoot, "project")
      results.push(...projectState[arrayKey])
    }

    if (!scope || scope === "global") {
      try {
        const globalState = await getState(undefined, "global")
        results.push(...globalState[arrayKey])
      } catch {
        // Global not available
      }
    }

    return results
  }

  /**
   * Get entries by status (decaying, golden, etc.)
   */
  export async function getEntriesByStatus(
    status: EntryStatus,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry[]> {
    const results: HivemindEntry[] = []

    const processState = (state: HivemindState) => {
      for (const arrayKey of Object.values(categoryToArrayKey)) {
        results.push(...state[arrayKey].filter((e) => e.status === status))
      }
    }

    if (!scope || scope === "project") {
      processState(await getState(contextRoot, "project"))
    }

    if (!scope || scope === "global") {
      try {
        processState(await getState(undefined, "global"))
      } catch {
        // Global not available
      }
    }

    return results
  }

  /**
   * Search entries by key or value
   */
  export async function search(
    query: string,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry[]> {
    const results: HivemindEntry[] = []
    const lowerQuery = query.toLowerCase()

    const processState = (state: HivemindState) => {
      for (const arrayKey of Object.values(categoryToArrayKey)) {
        results.push(
          ...state[arrayKey].filter(
            (e) =>
              e.key.toLowerCase().includes(lowerQuery) ||
              e.value.toLowerCase().includes(lowerQuery) ||
              e.metadata.tags?.some((t) => t.toLowerCase().includes(lowerQuery))
          )
        )
      }
    }

    if (!scope || scope === "project") {
      processState(await getState(contextRoot, "project"))
    }

    if (!scope || scope === "global") {
      try {
        processState(await getState(undefined, "global"))
      } catch {
        // Global not available
      }
    }

    return results
  }

  /**
   * Get the manifest for a scope
   */
  export async function getManifest(
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<HivemindManifest> {
    const state = await getState(contextRoot, scope)
    return state.manifest
  }

  // =============
  // Write Operations
  // =============

  /**
   * Add a new entry to the hivemind
   */
  export async function addEntry(
    entry: Omit<HivemindEntry, "id">,
    contextRoot?: string
  ): Promise<HivemindEntry> {
    const id = ulid()
    const fullEntry = HivemindEntry.parse({ ...entry, id })

    const dir =
      fullEntry.scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    await ensureDirectory(dir)

    const arrayKey = categoryToArrayKey[fullEntry.category]
    const filePath = path.join(dir, FILES[arrayKey])

    const entries = await readJsonFile(filePath, {
      parse: (d) => HivemindEntry.array().parse(d),
    })
    entries.push(fullEntry)
    await writeJsonFile(filePath, entries)

    // Update manifest stats
    await updateStats(contextRoot, fullEntry.scope)

    Bus.publish(Event.EntryAdded, { entry: fullEntry })
    Bus.publish(Event.Updated, { scope: fullEntry.scope, category: fullEntry.category })

    return fullEntry
  }

  /**
   * Update an existing entry
   */
  export async function updateEntry(
    id: string,
    updates: Partial<Omit<HivemindEntry, "id">>,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    // Find the entry first
    const existing = await getEntry(id, contextRoot)
    if (!existing) return null

    const dir =
      existing.scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    const arrayKey = categoryToArrayKey[existing.category]
    const filePath = path.join(dir, FILES[arrayKey])

    const entries = await readJsonFile(filePath, {
      parse: (d) => HivemindEntry.array().parse(d),
    })

    const index = entries.findIndex((e) => e.id === id)
    if (index === -1) return null

    const updated = HivemindEntry.parse({ ...entries[index], ...updates })
    entries[index] = updated
    await writeJsonFile(filePath, entries)

    // Update stats if status changed
    if (updates.status) {
      await updateStats(contextRoot, existing.scope)
    }

    Bus.publish(Event.EntryUpdated, { entryId: id, updates })
    Bus.publish(Event.Updated, { scope: existing.scope, category: existing.category })

    return updated
  }

  /**
   * Remove an entry
   */
  export async function removeEntry(id: string, contextRoot?: string): Promise<boolean> {
    const existing = await getEntry(id, contextRoot)
    if (!existing) return false

    const dir =
      existing.scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    const arrayKey = categoryToArrayKey[existing.category]
    const filePath = path.join(dir, FILES[arrayKey])

    const entries = await readJsonFile(filePath, {
      parse: (d) => HivemindEntry.array().parse(d),
    })

    const filtered = entries.filter((e) => e.id !== id)
    if (filtered.length === entries.length) return false

    await writeJsonFile(filePath, filtered)
    await updateStats(contextRoot, existing.scope)

    Bus.publish(Event.EntryRemoved, { entryId: id, category: existing.category })
    Bus.publish(Event.Updated, { scope: existing.scope, category: existing.category })

    return true
  }

  /**
   * Mark an entry as accessed (updates lastAccessed, resets decay timer)
   */
  export async function accessEntry(id: string, contextRoot?: string): Promise<void> {
    const existing = await getEntry(id, contextRoot)
    if (!existing) return

    await updateEntry(
      id,
      {
        decay: {
          ...existing.decay,
          lastAccessed: new Date().toISOString(),
          accessCount: existing.decay.accessCount + 1,
        },
      },
      contextRoot
    )
  }

  /**
   * Promote an entry to golden status
   */
  export async function promoteToGolden(
    id: string,
    promotedBy: "auto" | "user" | "council",
    councilSessionId?: string,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    const existing = await getEntry(id, contextRoot)
    if (!existing) return null

    const updated = await updateEntry(
      id,
      {
        status: "golden",
        golden: {
          promotedAt: new Date().toISOString(),
          promotedBy,
          councilSessionId,
        },
      },
      contextRoot
    )

    if (updated) {
      Bus.publish(Event.EntryPromotedGolden, { entryId: id, promotedBy })
    }

    return updated
  }

  // =============
  // Scope Management
  // =============

  /**
   * Check if global hivemind is enabled
   */
  export async function isGlobalEnabled(contextRoot?: string): Promise<boolean> {
    const manifest = await getManifest(contextRoot, "project")
    return manifest.globalEnabled
  }

  /**
   * Enable global hivemind
   */
  export async function enableGlobal(contextRoot?: string): Promise<void> {
    // Ensure global directory exists
    await ensureDirectory(getGlobalRoot())

    // Update project manifest
    const dir = await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFile(manifestPath, HivemindManifest)

    manifest.globalEnabled = true
    manifest.lastSync = new Date().toISOString()
    await writeJsonFile(manifestPath, manifest)

    Bus.publish(Event.GlobalToggled, { enabled: true })
    Bus.publish(Event.Updated, { scope: "project" })
  }

  /**
   * Disable global hivemind
   */
  export async function disableGlobal(contextRoot?: string): Promise<void> {
    const dir = await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFile(manifestPath, HivemindManifest)

    manifest.globalEnabled = false
    manifest.lastSync = new Date().toISOString()
    await writeJsonFile(manifestPath, manifest)

    Bus.publish(Event.GlobalToggled, { enabled: false })
    Bus.publish(Event.Updated, { scope: "project" })
  }

  // =============
  // Promotion Queue
  // =============

  /**
   * Request promotion of an entry to hivemind
   */
  export async function requestPromotion(
    request: Omit<PromotionRequest, "id" | "status" | "timestamp">
  ): Promise<string> {
    const id = ulid()
    const fullRequest = PromotionRequest.parse({
      ...request,
      id,
      status: request.autoApprove ? "approved" : "pending",
      timestamp: new Date().toISOString(),
    })

    const dir = await getProjectRoot()
    const filePath = path.join(dir, FILES.pending)

    const pending = await readJsonFile(filePath, {
      parse: (d) => PromotionRequest.array().parse(d),
    })
    pending.push(fullRequest)
    await writeJsonFile(filePath, pending)

    Bus.publish(Event.PromotionRequested, {
      requestId: id,
      category: fullRequest.entryType,
    })

    return id
  }

  /**
   * Approve a promotion request
   */
  export async function approvePromotion(
    requestId: string,
    contextRoot?: string
  ): Promise<HivemindEntry | null> {
    const dir = await getProjectRoot(contextRoot)
    const filePath = path.join(dir, FILES.pending)

    const pending = await readJsonFile(filePath, {
      parse: (d) => PromotionRequest.array().parse(d),
    })

    const index = pending.findIndex((p) => p.id === requestId)
    if (index === -1) return null

    const request = pending[index]

    // Create the hivemind entry from the promotion request
    const entry = await addEntry(
      {
        category: request.entryType,
        scope: request.targetScope,
        key: request.entry.key || request.entry.trigger || `entry-${ulid()}`,
        value: request.entry.value || request.entry.context || JSON.stringify(request.entry),
        confidence: request.entry.confidence || 0.8,
        status: "active",
        source: {
          sessionId: request.requestedBy,
          agentRole: "primary",
          timestamp: new Date().toISOString(),
          promotionReason: request.reason,
        },
        decay: {
          lastAccessed: new Date().toISOString(),
          accessCount: 0,
          decayRate: 0.1, // Will be overridden based on category
        },
        metadata: {
          originalEntryId: request.entry.id,
        },
      },
      contextRoot
    )

    // Remove from pending
    pending.splice(index, 1)
    await writeJsonFile(filePath, pending)

    return entry
  }

  /**
   * Reject a promotion request
   */
  export async function rejectPromotion(
    requestId: string,
    reason: string,
    contextRoot?: string
  ): Promise<void> {
    const dir = await getProjectRoot(contextRoot)
    const filePath = path.join(dir, FILES.pending)

    const pending = await readJsonFile(filePath, {
      parse: (d) => PromotionRequest.array().parse(d),
    })

    const index = pending.findIndex((p) => p.id === requestId)
    if (index === -1) return

    pending[index].status = "rejected"
    await writeJsonFile(filePath, pending)
  }

  /**
   * Get all pending promotion requests
   */
  export async function getPendingPromotions(
    contextRoot?: string
  ): Promise<PromotionRequest[]> {
    const dir = await getProjectRoot(contextRoot)
    const filePath = path.join(dir, FILES.pending)

    const pending = await readJsonFile(filePath, {
      parse: (d) => PromotionRequest.array().parse(d),
    })

    return pending.filter((p) => p.status === "pending")
  }

  // =============
  // Council Sessions
  // =============

  /**
   * Save a council session
   */
  export async function saveCouncilSession(
    session: CouncilSession,
    contextRoot?: string
  ): Promise<void> {
    const dir = await getProjectRoot(contextRoot)
    const filePath = path.join(dir, FILES.councils)

    const councils = await readJsonFile(filePath, {
      parse: (d) => CouncilSession.array().parse(d),
    })

    const index = councils.findIndex((c) => c.id === session.id)
    if (index === -1) {
      councils.push(session)
    } else {
      councils[index] = session
    }

    await writeJsonFile(filePath, councils)
  }

  /**
   * Get active council sessions
   */
  export async function getActiveCouncils(contextRoot?: string): Promise<CouncilSession[]> {
    const dir = await getProjectRoot(contextRoot)
    const filePath = path.join(dir, FILES.councils)

    const councils = await readJsonFile(filePath, {
      parse: (d) => CouncilSession.array().parse(d),
    })

    return councils.filter(
      (c) => c.status === "voting" || c.status === "debating" || c.status === "tie"
    )
  }

  // =============
  // Stats & Sync
  // =============

  /**
   * Update manifest stats
   */
  async function updateStats(contextRoot?: string, scope: HivemindScope = "project"): Promise<void> {
    const dir = scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFile(manifestPath, HivemindManifest)

    // Count entries by category and status
    let total = 0
    let golden = 0
    let decaying = 0
    let contested = 0
    const byCategory = { fear: 0, satisfaction: 0, knowledge: 0, decision: 0, preference: 0 }

    for (const [category, arrayKey] of Object.entries(categoryToArrayKey)) {
      const entries = await readJsonFile(path.join(dir, FILES[arrayKey]), {
        parse: (d) => HivemindEntry.array().parse(d),
      })

      byCategory[category as HivemindCategory] = entries.length
      total += entries.length

      for (const entry of entries) {
        if (entry.status === "golden") golden++
        if (entry.status === "decaying") decaying++
        if (entry.status === "contested") contested++
      }
    }

    manifest.stats = {
      totalEntries: total,
      entriesByCategory: byCategory,
      goldenCount: golden,
      decayingCount: decaying,
      contestedCount: contested,
      lastCouncilVote: manifest.stats.lastCouncilVote,
    }
    manifest.lastSync = new Date().toISOString()

    await writeJsonFile(manifestPath, manifest)
  }

  /**
   * Sync the hivemind state (recalculate all stats)
   */
  export async function sync(contextRoot?: string): Promise<void> {
    await updateStats(contextRoot, "project")

    const manifest = await getManifest(contextRoot, "project")
    if (manifest.globalEnabled) {
      try {
        await updateStats(undefined, "global")
      } catch {
        // Global not available
      }
    }

    Bus.publish(Event.Updated, { scope: "project" })
  }

  /**
   * Update manifest config (council, decay settings)
   */
  export async function updateManifestConfig(
    updates: Partial<Pick<HivemindManifest, "decay" | "council">>,
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<void> {
    const dir = scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFile(manifestPath, HivemindManifest)

    if (updates.decay) {
      manifest.decay = { ...manifest.decay, ...updates.decay }
    }
    if (updates.council) {
      manifest.council = { ...manifest.council, ...updates.council }
    }
    manifest.lastSync = new Date().toISOString()

    await writeJsonFile(manifestPath, manifest)
    Bus.publish(Event.Updated, { scope })
  }
}
