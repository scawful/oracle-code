/**
 * Cognitive Cache Module
 *
 * Centralized caching layer for all cognitive state to reduce file I/O.
 * Provides:
 * - In-memory caching with TTL
 * - Batched writes with debouncing
 * - Cache invalidation on file changes
 * - Per-root cache isolation
 *
 * NOTE: This module uses generic types to avoid circular dependencies.
 * The cognitive modules (metacognition, emotions, etc.) import from here,
 * not the other way around.
 */

import { Cache } from "../util/cache"
import { Log } from "../util/log"

const log = Log.create({ service: "cognitive-cache" })

export namespace CognitiveCache {
  // =============
  // Generic Cache Factory
  // =============

  type CacheType = "metacognition" | "emotions" | "epistemic" | "goals" | "grounding" | "analysis-triggers"

  interface CacheConfig {
    ttl: number
    maxEntries: number
  }

  const CACHE_CONFIGS: Record<CacheType, CacheConfig> = {
    metacognition: { ttl: 3000, maxEntries: 10 },
    emotions: { ttl: 3000, maxEntries: 10 },
    epistemic: { ttl: 5000, maxEntries: 10 },
    goals: { ttl: 5000, maxEntries: 10 },
    grounding: { ttl: 5000, maxEntries: 10 },
    "analysis-triggers": { ttl: 5000, maxEntries: 10 },
  }

  // Lazy-initialized caches
  const cacheInstances = new Map<CacheType, Cache.CacheInstance<unknown>>()

  function getCache<T>(type: CacheType): Cache.CacheInstance<T> {
    if (!cacheInstances.has(type)) {
      const config = CACHE_CONFIGS[type]
      cacheInstances.set(type, Cache.create<T>(type, config))
    }
    return cacheInstances.get(type) as Cache.CacheInstance<T>
  }

  // =============
  // Write Batching
  // =============

  interface PendingWrite {
    data: unknown
    writer: (data: unknown) => Promise<void>
  }

  const pendingWrites = new Map<string, PendingWrite>()
  const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const WRITE_DELAY_MS = 300 // Batch writes within 300ms

  /**
   * Schedule a batched write. Multiple writes to the same key within
   * WRITE_DELAY_MS will be coalesced into a single write.
   */
  function scheduleBatchedWrite(key: string, data: unknown, writer: (data: unknown) => Promise<void>): void {
    // Store the latest data
    pendingWrites.set(key, { data, writer })

    // Clear any existing timer
    const existingTimer = writeTimers.get(key)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule the write
    const timer = setTimeout(async () => {
      const pending = pendingWrites.get(key)
      if (!pending) return

      pendingWrites.delete(key)
      writeTimers.delete(key)

      try {
        await pending.writer(pending.data)
      } catch (error) {
        log.error("batched write failed", { key, error })
      }
    }, WRITE_DELAY_MS)

    writeTimers.set(key, timer)
  }

  /**
   * Flush all pending writes immediately (call before exit)
   */
  export async function flushAll(): Promise<void> {
    // Clear all timers
    for (const timer of writeTimers.values()) {
      clearTimeout(timer)
    }
    writeTimers.clear()

    // Execute all pending writes
    const writes = Array.from(pendingWrites.entries())
    pendingWrites.clear()

    await Promise.all(
      writes.map(async ([key, pending]) => {
        try {
          await pending.writer(pending.data)
        } catch (error) {
          log.error("flush write failed", { key, error })
        }
      }),
    )
  }

  // =============
  // Generic Accessors
  // =============

  /**
   * Get cached data for a cognitive module
   */
  export function get<T>(type: CacheType, root: string): T | undefined {
    return getCache<T>(type).get(root)
  }

  /**
   * Set cached data for a cognitive module
   */
  export function set<T>(type: CacheType, root: string, data: T): void {
    getCache<T>(type).set(root, data)
  }

  /**
   * Get cached data or compute it
   */
  export async function getOrCompute<T>(
    type: CacheType,
    root: string,
    reader: () => Promise<T | null>,
    fallback: () => T,
  ): Promise<T> {
    return getCache<T>(type).getOrCompute(root, async () => {
      const data = await reader()
      return data ?? fallback()
    })
  }

  /**
   * Write data with batching - updates cache immediately, batches disk write
   */
  export function writeBatched<T>(type: CacheType, root: string, data: T, writer: (data: T) => Promise<void>): void {
    getCache<T>(type).set(root, data)
    scheduleBatchedWrite(`${type}:${root}`, data, writer as (data: unknown) => Promise<void>)
  }

  /**
   * Check if data is cached
   */
  export function has(type: CacheType, root: string): boolean {
    return getCache<unknown>(type).has(root)
  }

  // =============
  // Cache Invalidation
  // =============

  /**
   * Invalidate all caches for a root
   */
  export function invalidateRoot(root: string): void {
    for (const type of Object.keys(CACHE_CONFIGS) as CacheType[]) {
      getCache<unknown>(type).invalidate(root)
    }
    log.info("invalidated cache for root", { root })
  }

  /**
   * Invalidate a specific cache type for a root
   */
  export function invalidate(type: CacheType, root: string): void {
    getCache<unknown>(type).invalidate(root)
  }

  /**
   * Clear all cognitive caches
   */
  export function clearAll(): void {
    for (const cache of cacheInstances.values()) {
      cache.clear()
    }
    log.info("all cognitive caches cleared")
  }

  /**
   * Get cache statistics
   */
  export function getStats(): Record<string, { size: number; hits: number; misses: number }> {
    return Cache.getStats()
  }

  // =============
  // Convenience Methods for Specific Types
  // =============

  // Metacognition
  export const metacognition = {
    get: <T>(root: string) => get<T>("metacognition", root),
    set: <T>(root: string, data: T) => set<T>("metacognition", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("metacognition", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("metacognition", root, data, writer),
    invalidate: (root: string) => invalidate("metacognition", root),
  }

  // Emotions
  export const emotions = {
    get: <T>(root: string) => get<T>("emotions", root),
    set: <T>(root: string, data: T) => set<T>("emotions", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("emotions", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("emotions", root, data, writer),
    invalidate: (root: string) => invalidate("emotions", root),
  }

  // Epistemic
  export const epistemic = {
    get: <T>(root: string) => get<T>("epistemic", root),
    set: <T>(root: string, data: T) => set<T>("epistemic", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("epistemic", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("epistemic", root, data, writer),
    invalidate: (root: string) => invalidate("epistemic", root),
  }

  // Goals
  export const goals = {
    get: <T>(root: string) => get<T>("goals", root),
    set: <T>(root: string, data: T) => set<T>("goals", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("goals", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("goals", root, data, writer),
    invalidate: (root: string) => invalidate("goals", root),
  }

  // Grounding
  export const grounding = {
    get: <T>(root: string) => get<T>("grounding", root),
    set: <T>(root: string, data: T) => set<T>("grounding", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("grounding", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("grounding", root, data, writer),
    invalidate: (root: string) => invalidate("grounding", root),
  }

  // Analysis Triggers
  export const analysisTriggers = {
    get: <T>(root: string) => get<T>("analysis-triggers", root),
    set: <T>(root: string, data: T) => set<T>("analysis-triggers", root, data),
    getOrCompute: <T>(root: string, reader: () => Promise<T | null>, fallback: () => T) =>
      getOrCompute<T>("analysis-triggers", root, reader, fallback),
    writeBatched: <T>(root: string, data: T, writer: (data: T) => Promise<void>) =>
      writeBatched<T>("analysis-triggers", root, data, writer),
    invalidate: (root: string) => invalidate("analysis-triggers", root),
  }
}
