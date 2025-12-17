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
import { Log } from "../../util/log"
import { Cache } from "../../util/cache"
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
  GlobalFilter,
} from "./types"

export namespace HivemindStore {
  const log = Log.create({ service: "hivemind-store" })

  // =============
  // Constants
  // =============

  const HIVEMIND_DIR = "hivemind"
  // Global hivemind now uses ~/.context/hivemind/ to align with AFS structure
  // This enables cross-tool compatibility (oracle-code, hafs, etc.)
  const GLOBAL_HIVEMIND_DIR = ".context/hivemind"

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
  // Caching Layer
  // =============

  // Category-level caches with 5s TTL
  type CacheKey = `${HivemindScope}:${string}` // scope:dir
  const categoryCache = new Map<`${CacheKey}:${CategoryArrayKey}`, { data: HivemindEntry[]; expires: number }>()
  const manifestCache = new Map<CacheKey, { data: z.infer<typeof HivemindManifest>; expires: number }>()
  const pendingCache = new Map<CacheKey, { data: z.infer<typeof PromotionRequest>[]; expires: number }>()
  const councilsCache = new Map<CacheKey, { data: z.infer<typeof CouncilSession>[]; expires: number }>()

  const CACHE_TTL_MS = 5000

  function getCacheKey(scope: HivemindScope, dir: string): CacheKey {
    return `${scope}:${dir}`
  }

  function isCacheValid<T>(entry: { data: T; expires: number } | undefined): entry is { data: T; expires: number } {
    return entry !== undefined && Date.now() < entry.expires
  }

  function getCachedCategory(scope: HivemindScope, dir: string, arrayKey: CategoryArrayKey): HivemindEntry[] | null {
    const key = `${getCacheKey(scope, dir)}:${arrayKey}` as const
    const entry = categoryCache.get(key)
    if (isCacheValid(entry)) return entry.data
    return null
  }

  function setCachedCategory(scope: HivemindScope, dir: string, arrayKey: CategoryArrayKey, data: HivemindEntry[]): void {
    const key = `${getCacheKey(scope, dir)}:${arrayKey}` as const
    categoryCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
  }

  function invalidateCategoryCache(scope: HivemindScope, dir: string, arrayKey?: CategoryArrayKey): void {
    if (arrayKey) {
      categoryCache.delete(`${getCacheKey(scope, dir)}:${arrayKey}` as const)
    } else {
      // Invalidate all categories for this scope/dir
      const prefix = getCacheKey(scope, dir)
      for (const key of categoryCache.keys()) {
        if (key.startsWith(prefix)) categoryCache.delete(key)
      }
    }
  }

  function getCachedManifest(scope: HivemindScope, dir: string): z.infer<typeof HivemindManifest> | null {
    const entry = manifestCache.get(getCacheKey(scope, dir))
    if (isCacheValid(entry)) return entry.data
    return null
  }

  function setCachedManifest(scope: HivemindScope, dir: string, data: z.infer<typeof HivemindManifest>): void {
    manifestCache.set(getCacheKey(scope, dir), { data, expires: Date.now() + CACHE_TTL_MS })
  }

  function invalidateManifestCache(scope: HivemindScope, dir: string): void {
    manifestCache.delete(getCacheKey(scope, dir))
  }

  /**
   * Clear all hivemind caches (useful for testing or after bulk operations)
   */
  export function clearCaches(): void {
    categoryCache.clear()
    manifestCache.clear()
    pendingCache.clear()
    councilsCache.clear()
    log.info("hivemind caches cleared")
  }

  // =============
  // Path Helpers
  // =============

  /**
   * Get the project-level hivemind directory path.
   *
   * @param contextRoot - Should be the .context directory path (e.g., /project/.context).
   *                      If a project root is passed instead, this function will auto-correct
   *                      by appending .context if that directory exists.
   */
  export async function getProjectRoot(contextRoot?: string): Promise<string> {
    let root = contextRoot || (await AFS.getRoot())

    // Validate and fix path if someone passes project root instead of .context path
    if (root && !root.endsWith(".context")) {
      const contextPath = path.join(root, ".context")
      try {
        const stat = await fs.stat(contextPath)
        if (stat.isDirectory()) {
          log.warn("contextRoot should be .context path, not project root", {
            received: root,
            corrected: contextPath,
          })
          root = contextPath
        }
      } catch {
        // .context doesn't exist at expected location - this is an error state
        // but we'll let it fail naturally when trying to access the hivemind dir
      }
    }

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

  type SafeParseResult<T> = {
    value: T
    rewrite: boolean
  }

  async function backupCorruptFile(filePath: string, raw: string): Promise<string | null> {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const backupPath = `${filePath}.bak.${stamp}`
      await fs.writeFile(backupPath, raw)
      return backupPath
    } catch {
      return null
    }
  }

  function parseManifest(data: unknown): SafeParseResult<z.infer<typeof HivemindManifest>> {
    const parsed = HivemindManifest.safeParse(data)
    if (parsed.success) return { value: parsed.data, rewrite: false }

    const source = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>
    const candidate = {
      ...source,
      lastSync: typeof source.lastSync === "string" ? source.lastSync : new Date().toISOString(),
    }
    const repaired = HivemindManifest.safeParse(candidate)
    if (repaired.success) return { value: repaired.data, rewrite: true }

    return { value: HivemindManifest.parse({ lastSync: new Date().toISOString() }), rewrite: true }
  }

  function parseArrayOf<T extends z.ZodTypeAny>(itemSchema: T, data: unknown): SafeParseResult<Array<z.infer<T>>> {
    const arraySchema = z.array(itemSchema)
    const parsed = arraySchema.safeParse(data)
    if (parsed.success) return { value: parsed.data, rewrite: false }
    if (!Array.isArray(data)) return { value: [], rewrite: true }

    const valid: Array<z.infer<T>> = []
    for (const item of data) {
      const res = itemSchema.safeParse(item)
      if (res.success) valid.push(res.data)
    }

    return { value: valid, rewrite: true }
  }

  async function readJsonFileSafe<T>(
    filePath: string,
    parser: (data: unknown) => SafeParseResult<T>,
    fallback: () => T,
  ): Promise<T> {
    let raw: string
    try {
      raw = await fs.readFile(filePath, "utf-8")
    } catch (error) {
      const value = fallback()
      await writeJsonFile(filePath, value).catch(() => {})
      return value
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (error) {
      const value = fallback()
      const backupPath = await backupCorruptFile(filePath, raw)
      log.error("invalid JSON in hivemind file; resetting", {
        filePath,
        backupPath,
        error: error instanceof Error ? error.message : String(error),
      })
      await writeJsonFile(filePath, value).catch(() => {})
      return value
    }

    try {
      const parsed = parser(json)
      if (parsed.rewrite) {
        const backupPath = await backupCorruptFile(filePath, raw)
        log.warn("invalid data in hivemind file; rewriting with sanitized content", { filePath, backupPath })
        await writeJsonFile(filePath, parsed.value).catch(() => {})
      }
      return parsed.value
    } catch (error) {
      const value = fallback()
      const backupPath = await backupCorruptFile(filePath, raw)
      log.error("failed to parse hivemind file; resetting", {
        filePath,
        backupPath,
        error: error instanceof Error ? error.message : String(error),
      })
      await writeJsonFile(filePath, value).catch(() => {})
      return value
    }
  }

  async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
    const withMeta =
      typeof data === "object" && data !== null
        ? {
            schema_version: "0.3",
            producer: { name: "oracle-code", version: "unknown" },
            last_updated: new Date().toISOString(),
            ...(data as Record<string, unknown>),
          }
        : data
    await fs.writeFile(filePath, JSON.stringify(withMeta, null, 2))
  }

  // =============
  // Cached Single-File Readers (Lazy Loading)
  // =============

  /**
   * Read a single category file with caching
   */
  async function readCategoryFileCached(
    scope: HivemindScope,
    dir: string,
    arrayKey: CategoryArrayKey
  ): Promise<HivemindEntry[]> {
    // Check cache first
    const cached = getCachedCategory(scope, dir, arrayKey)
    if (cached !== null) return cached

    // Read from disk
    const filename = FILES[arrayKey]
    const data = await readJsonFileSafe(
      path.join(dir, filename),
      (d) => parseArrayOf(HivemindEntry, d),
      () => []
    )

    // Cache and return
    setCachedCategory(scope, dir, arrayKey, data)
    return data
  }

  /**
   * Read manifest file with caching
   */
  async function readManifestCached(
    scope: HivemindScope,
    dir: string
  ): Promise<z.infer<typeof HivemindManifest>> {
    // Check cache first
    const cached = getCachedManifest(scope, dir)
    if (cached !== null) return cached

    // Read from disk
    const data = await readJsonFileSafe(
      path.join(dir, FILES.manifest),
      (d) => parseManifest(d),
      () => HivemindManifest.parse({ lastSync: new Date().toISOString() })
    )

    // Cache and return
    setCachedManifest(scope, dir, data)
    return data
  }

  /**
   * Read pending promotions with caching
   */
  async function readPendingCached(scope: HivemindScope, dir: string): Promise<z.infer<typeof PromotionRequest>[]> {
    const key = getCacheKey(scope, dir)
    const entry = pendingCache.get(key)
    if (isCacheValid(entry)) return entry.data

    const data = await readJsonFileSafe(
      path.join(dir, FILES.pending),
      (d) => parseArrayOf(PromotionRequest, d),
      () => []
    )
    pendingCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
    return data
  }

  /**
   * Read councils with caching
   */
  async function readCouncilsCached(scope: HivemindScope, dir: string): Promise<z.infer<typeof CouncilSession>[]> {
    const key = getCacheKey(scope, dir)
    const entry = councilsCache.get(key)
    if (isCacheValid(entry)) return entry.data

    const data = await readJsonFileSafe(
      path.join(dir, FILES.councils),
      (d) => parseArrayOf(CouncilSession, d),
      () => []
    )
    councilsCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
    return data
  }

  // =============
  // Read Operations
  // =============

  /**
   * Get the complete hivemind state for a scope.
   * NOTE: This reads all files. For better performance, use getEntriesByCategory()
   * or getEntry() when you only need specific data.
   */
  export async function getState(
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<HivemindState> {
    const dir = scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    await ensureDirectory(dir)

    // Use cached readers for all files
    const [fears, satisfactions, knowledge, decisions, preferences, pending, councils, manifest] =
      await Promise.all([
        readCategoryFileCached(scope, dir, "fears"),
        readCategoryFileCached(scope, dir, "satisfactions"),
        readCategoryFileCached(scope, dir, "knowledge"),
        readCategoryFileCached(scope, dir, "decisions"),
        readCategoryFileCached(scope, dir, "preferences"),
        readPendingCached(scope, dir),
        readCouncilsCached(scope, dir),
        readManifestCached(scope, dir),
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
   * Get a single entry by ID (lazy loading - searches category by category)
   */
  export async function getEntry(
    id: string,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry | null> {
    const scopes: HivemindScope[] = scope ? [scope] : ["project", "global"]

    for (const s of scopes) {
      try {
        const dir = s === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
        await ensureDirectory(dir)
        
        // Search categories one at a time (lazy) instead of loading all
        for (const arrayKey of Object.values(categoryToArrayKey)) {
          const entries = await readCategoryFileCached(s, dir, arrayKey)
          const entry = entries.find((e) => e.id === id)
          if (entry) return entry
        }
      } catch {
        // Scope not available
      }
    }

    return null
  }

  /**
   * Get entries by category (lazy loading - only reads the specific category file)
   */
  export async function getEntriesByCategory(
    category: HivemindCategory,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry[]> {
    const arrayKey = categoryToArrayKey[category]
    const results: HivemindEntry[] = []

    if (!scope || scope === "project") {
      const dir = await getProjectRoot(contextRoot)
      await ensureDirectory(dir)
      const entries = await readCategoryFileCached("project", dir, arrayKey)
      results.push(...entries)
    }

    if (!scope || scope === "global") {
      try {
        const dir = getGlobalRoot()
        await ensureDirectory(dir)
        const entries = await readCategoryFileCached("global", dir, arrayKey)
        results.push(...entries)
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
   * Get the manifest for a scope (lazy - only reads manifest file)
   */
  export async function getManifest(
    contextRoot?: string,
    scope: HivemindScope = "project"
  ): Promise<HivemindManifest> {
    const dir = scope === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
    await ensureDirectory(dir)
    return readManifestCached(scope, dir)
  }

  /**
   * Get an entry by key (lazy loading - searches category by category)
   */
  export async function getEntryByKey(
    key: string,
    contextRoot?: string,
    scope?: HivemindScope
  ): Promise<HivemindEntry | null> {
    const scopes: HivemindScope[] = scope ? [scope] : ["project", "global"]

    for (const s of scopes) {
      try {
        const dir = s === "global" ? getGlobalRoot() : await getProjectRoot(contextRoot)
        await ensureDirectory(dir)
        
        for (const arrayKey of Object.values(categoryToArrayKey)) {
          const entries = await readCategoryFileCached(s, dir, arrayKey)
          const entry = entries.find((e) => e.key === key)
          if (entry) return entry
        }
      } catch {
        // Scope not available
      }
    }

    return null
  }

  /**
   * Find potential duplicate entries based on key similarity
   */
  export async function findDuplicates(
    contextRoot?: string,
    options: {
      scope?: HivemindScope
      threshold?: number // Similarity threshold 0-1, default 0.7
    } = {}
  ): Promise<Array<{ entries: HivemindEntry[]; reason: string }>> {
    const threshold = options.threshold ?? 0.7
    const duplicateGroups: Array<{ entries: HivemindEntry[]; reason: string }> = []

    // Collect all entries
    const allEntries: HivemindEntry[] = []
    
    if (!options.scope || options.scope === "project") {
      const projectState = await getState(contextRoot, "project")
      for (const arrayKey of Object.values(categoryToArrayKey)) {
        allEntries.push(...projectState[arrayKey])
      }
    }

    if (!options.scope || options.scope === "global") {
      try {
        const globalState = await getState(undefined, "global")
        for (const arrayKey of Object.values(categoryToArrayKey)) {
          allEntries.push(...globalState[arrayKey])
        }
      } catch {
        // Global not available
      }
    }

    // Simple key similarity check using Levenshtein-like comparison
    const keyGroups = new Map<string, HivemindEntry[]>()
    
    for (const entry of allEntries) {
      const normalizedKey = entry.key.toLowerCase().replace(/[_-]/g, "")
      let foundGroup = false
      
      for (const [groupKey, group] of keyGroups.entries()) {
        const similarity = calculateSimilarity(normalizedKey, groupKey)
        if (similarity >= threshold) {
          group.push(entry)
          foundGroup = true
          break
        }
      }
      
      if (!foundGroup) {
        keyGroups.set(normalizedKey, [entry])
      }
    }

    // Filter to groups with more than one entry
    for (const [, group] of keyGroups.entries()) {
      if (group.length > 1) {
        duplicateGroups.push({
          entries: group,
          reason: `Similar keys: ${group.map(e => e.key).join(", ")}`,
        })
      }
    }

    // Also check for entries with overlapping tags
    const tagGroups = new Map<string, HivemindEntry[]>()
    for (const entry of allEntries) {
      if (entry.metadata.tags && entry.metadata.tags.length > 0) {
        const tagKey = entry.metadata.tags.sort().join(",")
        if (!tagGroups.has(tagKey)) {
          tagGroups.set(tagKey, [])
        }
        tagGroups.get(tagKey)!.push(entry)
      }
    }

    for (const [tags, group] of tagGroups.entries()) {
      if (group.length > 1 && !duplicateGroups.some(d => 
        d.entries.every(e => group.includes(e))
      )) {
        duplicateGroups.push({
          entries: group,
          reason: `Same tags: [${tags}]`,
        })
      }
    }

    return duplicateGroups
  }

  /**
   * Merge multiple entries into one
   */
  export async function mergeEntries(
    sourceKeys: string[],
    targetKey: string,
    mergedValue: string,
    options: {
      category?: HivemindCategory
      scope?: HivemindScope
      tags?: string[]
      reason?: string
      contextRoot?: string
    } = {}
  ): Promise<{ merged: HivemindEntry; deleted: number }> {
    const contextRoot = options.contextRoot

    // Find all source entries
    const sourceEntries: HivemindEntry[] = []
    for (const key of sourceKeys) {
      const entry = await getEntryByKey(key, contextRoot, options.scope)
      if (entry) {
        sourceEntries.push(entry)
      }
    }

    if (sourceEntries.length === 0) {
      throw new Error(`No entries found for keys: ${sourceKeys.join(", ")}`)
    }

    // Determine merged properties
    const category = options.category || sourceEntries[0].category
    const scope = options.scope || sourceEntries[0].scope
    const highestConfidence = Math.max(...sourceEntries.map(e => e.confidence))
    const isGolden = sourceEntries.some(e => e.status === "golden")
    
    // Merge tags from all sources
    const allTags = new Set<string>()
    for (const entry of sourceEntries) {
      if (entry.metadata.tags) {
        entry.metadata.tags.forEach(t => allTags.add(t))
      }
    }
    if (options.tags) {
      options.tags.forEach(t => allTags.add(t))
    }

    // Delete source entries
    let deleted = 0
    for (const entry of sourceEntries) {
      const success = await removeEntry(entry.id, contextRoot)
      if (success) deleted++
    }

    // Create merged entry
    const merged = await addEntry({
      category,
      scope,
      key: targetKey,
      value: mergedValue,
      confidence: highestConfidence,
      status: isGolden ? "golden" : "active",
      source: {
        sessionId: sourceEntries[0].source.sessionId,
        agentRole: "merge",
        timestamp: new Date().toISOString(),
        promotionReason: options.reason || `Merged from: ${sourceKeys.join(", ")}`,
      },
      decay: {
        lastAccessed: new Date().toISOString(),
        accessCount: sourceEntries.reduce((sum, e) => sum + e.decay.accessCount, 0),
        decayRate: sourceEntries[0].decay.decayRate,
      },
      metadata: {
        tags: Array.from(allTags),
        relatedEntries: sourceEntries.map(e => e.id),
      },
      golden: isGolden ? {
        promotedAt: new Date().toISOString(),
        promotedBy: "user",
      } : undefined,
    }, contextRoot)

    return { merged, deleted }
  }

  /**
   * Apply global filter to entries
   */
  export function applyGlobalFilter(
    entries: HivemindEntry[],
    filter?: GlobalFilter
  ): HivemindEntry[] {
    if (!filter) return entries

    return entries.filter(entry => {
      // Check tag filters
      if (filter.includeTags && filter.includeTags.length > 0) {
        const entryTags = entry.metadata.tags || []
        if (!filter.includeTags.some(t => entryTags.includes(t))) {
          return false
        }
      }

      if (filter.excludeTags && filter.excludeTags.length > 0) {
        const entryTags = entry.metadata.tags || []
        if (filter.excludeTags.some(t => entryTags.includes(t))) {
          return false
        }
      }

      // Check category filters
      if (filter.includeCategories && filter.includeCategories.length > 0) {
        if (!filter.includeCategories.includes(entry.category)) {
          return false
        }
      }

      if (filter.excludeCategories && filter.excludeCategories.length > 0) {
        if (filter.excludeCategories.includes(entry.category)) {
          return false
        }
      }

      // Check key pattern filters
      if (filter.includeKeys && filter.includeKeys.length > 0) {
        if (!filter.includeKeys.some(pattern => 
          entry.key.includes(pattern) || new RegExp(pattern, "i").test(entry.key)
        )) {
          return false
        }
      }

      if (filter.excludeKeys && filter.excludeKeys.length > 0) {
        if (filter.excludeKeys.some(pattern => 
          entry.key.includes(pattern) || new RegExp(pattern, "i").test(entry.key)
        )) {
          return false
        }
      }

      return true
    })
  }

  /**
   * Get filtered global entries based on project manifest filter
   */
  export async function getFilteredGlobalEntries(
    contextRoot?: string,
    category?: HivemindCategory
  ): Promise<HivemindEntry[]> {
    const projectManifest = await getManifest(contextRoot, "project")
    
    if (!projectManifest.globalEnabled) {
      return []
    }

    try {
      const globalState = await getState(undefined, "global")
      let entries: HivemindEntry[] = []

      if (category) {
        entries = globalState[categoryToArrayKey[category]]
      } else {
        for (const arrayKey of Object.values(categoryToArrayKey)) {
          entries.push(...globalState[arrayKey])
        }
      }

      return applyGlobalFilter(entries, projectManifest.globalFilter)
    } catch {
      return []
    }
  }

  /**
   * Update global filter in manifest
   */
  export async function updateGlobalFilter(
    filter: GlobalFilter,
    contextRoot?: string
  ): Promise<void> {
    const dir = await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFileSafe(
      manifestPath,
      (d) => parseManifest(d),
      () => HivemindManifest.parse({ lastSync: new Date().toISOString() }),
    )

    manifest.globalFilter = filter
    manifest.lastSync = new Date().toISOString()
    await writeJsonFile(manifestPath, manifest)
    invalidateManifestCache("project", dir)
    Bus.publish(Event.Updated, { scope: "project" })
  }

  // Helper function for similarity calculation
  function calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0
    
    // Simple Jaccard similarity on character n-grams
    const ngramSize = 2
    const getNgrams = (s: string): Set<string> => {
      const ngrams = new Set<string>()
      for (let i = 0; i <= s.length - ngramSize; i++) {
        ngrams.add(s.substring(i, i + ngramSize))
      }
      return ngrams
    }

    const ngramsA = getNgrams(a)
    const ngramsB = getNgrams(b)
    
    let intersection = 0
    for (const ngram of ngramsA) {
      if (ngramsB.has(ngram)) intersection++
    }
    
    const union = ngramsA.size + ngramsB.size - intersection
    return union === 0 ? 0 : intersection / union
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

    const entries = await readJsonFileSafe(filePath, (d) => parseArrayOf(HivemindEntry, d), () => [])
    entries.push(fullEntry)
    await writeJsonFile(filePath, entries)

    // Invalidate cache for this category
    invalidateCategoryCache(fullEntry.scope, dir, arrayKey)

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

    const entries = await readJsonFileSafe(filePath, (d) => parseArrayOf(HivemindEntry, d), () => [])

    const index = entries.findIndex((e) => e.id === id)
    if (index === -1) return null

    const updated = HivemindEntry.parse({ ...entries[index], ...updates })
    entries[index] = updated
    await writeJsonFile(filePath, entries)

    // Invalidate cache for this category
    invalidateCategoryCache(existing.scope, dir, arrayKey)

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

    const entries = await readJsonFileSafe(filePath, (d) => parseArrayOf(HivemindEntry, d), () => [])

    const filtered = entries.filter((e) => e.id !== id)
    if (filtered.length === entries.length) return false

    await writeJsonFile(filePath, filtered)
    
    // Invalidate cache for this category
    invalidateCategoryCache(existing.scope, dir, arrayKey)
    
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
    const manifest = await readJsonFileSafe(
      manifestPath,
      (d) => parseManifest(d),
      () => HivemindManifest.parse({ lastSync: new Date().toISOString() }),
    )

    manifest.globalEnabled = true
    manifest.lastSync = new Date().toISOString()
    await writeJsonFile(manifestPath, manifest)
    invalidateManifestCache("project", dir)

    Bus.publish(Event.GlobalToggled, { enabled: true })
    Bus.publish(Event.Updated, { scope: "project" })
  }

  /**
   * Disable global hivemind
   */
  export async function disableGlobal(contextRoot?: string): Promise<void> {
    const dir = await getProjectRoot(contextRoot)
    const manifestPath = path.join(dir, FILES.manifest)
    const manifest = await readJsonFileSafe(
      manifestPath,
      (d) => parseManifest(d),
      () => HivemindManifest.parse({ lastSync: new Date().toISOString() }),
    )

    manifest.globalEnabled = false
    manifest.lastSync = new Date().toISOString()
    await writeJsonFile(manifestPath, manifest)
    invalidateManifestCache("project", dir)

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

    const pending = await readJsonFileSafe(filePath, (d) => parseArrayOf(PromotionRequest, d), () => [])
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

    const pending = await readJsonFileSafe(filePath, (d) => parseArrayOf(PromotionRequest, d), () => [])

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

    const pending = await readJsonFileSafe(filePath, (d) => parseArrayOf(PromotionRequest, d), () => [])

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

    const pending = await readJsonFileSafe(filePath, (d) => parseArrayOf(PromotionRequest, d), () => [])

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

    const councils = await readJsonFileSafe(filePath, (d) => parseArrayOf(CouncilSession, d), () => [])

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

    const councils = await readJsonFileSafe(filePath, (d) => parseArrayOf(CouncilSession, d), () => [])

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
    const state = await getState(contextRoot, scope)
    const manifest = state.manifest

    const arrays = [
      ["fear", state.fears],
      ["satisfaction", state.satisfactions],
      ["knowledge", state.knowledge],
      ["decision", state.decisions],
      ["preference", state.preferences],
    ] as const

    let total = 0
    let golden = 0
    let decaying = 0
    let contested = 0
    const byCategory: Record<HivemindCategory, number> = {
      fear: 0,
      satisfaction: 0,
      knowledge: 0,
      decision: 0,
      preference: 0,
    }

    for (const [category, entries] of arrays) {
      byCategory[category] = entries.length
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
    invalidateManifestCache(scope, dir)
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
    const manifest = await readJsonFileSafe(
      manifestPath,
      (d) => parseManifest(d),
      () => HivemindManifest.parse({ lastSync: new Date().toISOString() }),
    )

    if (updates.decay) {
      manifest.decay = { ...manifest.decay, ...updates.decay }
    }
    if (updates.council) {
      manifest.council = { ...manifest.council, ...updates.council }
    }
    manifest.lastSync = new Date().toISOString()

    await writeJsonFile(manifestPath, manifest)
    invalidateManifestCache(scope, dir)
    Bus.publish(Event.Updated, { scope })
  }
}
