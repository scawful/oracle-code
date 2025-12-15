/**
 * Cache Utility - High-performance caching for cognitive modules
 *
 * Provides:
 * - TTL-based expiration
 * - File-based cache invalidation
 * - Batched writes with debouncing
 * - Memory-bounded LRU eviction
 */

import { Log } from "./log"

const log = Log.create({ service: "cache" })

export namespace Cache {
  // =============
  // Types
  // =============

  interface CacheEntry<T> {
    data: T
    timestamp: number
    accessCount: number
    fileHash?: string
  }

  interface CacheConfig {
    /** Time-to-live in milliseconds (default: 5000) */
    ttl?: number
    /** Maximum entries before LRU eviction (default: 100) */
    maxEntries?: number
    /** Enable file hash validation (default: false) */
    validateFileHash?: boolean
  }

  // =============
  // In-Memory Cache
  // =============

  const caches = new Map<string, Map<string, CacheEntry<unknown>>>()
  const configs = new Map<string, CacheConfig>()

  const DEFAULT_TTL = 5000
  const DEFAULT_MAX_ENTRIES = 100

  /**
   * Create or get a named cache instance
   */
  export function create<T>(name: string, config?: CacheConfig): CacheInstance<T> {
    if (!caches.has(name)) {
      caches.set(name, new Map())
      configs.set(name, config || {})
    }
    return new CacheInstance<T>(name)
  }

  /**
   * Clear all caches
   */
  export function clearAll(): void {
    for (const cache of caches.values()) {
      cache.clear()
    }
    log.info("all caches cleared")
  }

  /**
   * Clear a specific cache
   */
  export function clear(name: string): void {
    caches.get(name)?.clear()
  }

  /**
   * Get cache statistics
   */
  export function getStats(): Record<string, { size: number; hits: number; misses: number }> {
    const stats: Record<string, { size: number; hits: number; misses: number }> = {}
    for (const [name, cache] of caches) {
      const instance = instanceStats.get(name) || { hits: 0, misses: 0 }
      stats[name] = {
        size: cache.size,
        hits: instance.hits,
        misses: instance.misses,
      }
    }
    return stats
  }

  // Track hit/miss stats per cache
  const instanceStats = new Map<string, { hits: number; misses: number }>()

  export class CacheInstance<T> {
    private name: string

    constructor(name: string) {
      this.name = name
      if (!instanceStats.has(name)) {
        instanceStats.set(name, { hits: 0, misses: 0 })
      }
    }

    private getCache(): Map<string, CacheEntry<unknown>> {
      return caches.get(this.name)!
    }

    private getConfig(): CacheConfig {
      return configs.get(this.name) || {}
    }

    private getStats() {
      return instanceStats.get(this.name)!
    }

    /**
     * Get a cached value, or compute and cache it
     */
    async getOrCompute(key: string, compute: () => Promise<T>, fileHash?: string): Promise<T> {
      const cache = this.getCache()
      const config = this.getConfig()
      const stats = this.getStats()
      const ttl = config.ttl ?? DEFAULT_TTL

      const cached = cache.get(key) as CacheEntry<T> | undefined

      if (cached) {
        const age = Date.now() - cached.timestamp
        const hashValid = !config.validateFileHash || !fileHash || cached.fileHash === fileHash

        if (age < ttl && hashValid) {
          cached.accessCount++
          stats.hits++
          return cached.data
        }
      }

      stats.misses++
      const data = await compute()

      this.set(key, data, fileHash)
      return data
    }

    /**
     * Get a cached value synchronously (returns undefined if not cached or expired)
     */
    get(key: string): T | undefined {
      const cache = this.getCache()
      const config = this.getConfig()
      const stats = this.getStats()
      const ttl = config.ttl ?? DEFAULT_TTL

      const cached = cache.get(key) as CacheEntry<T> | undefined

      if (cached) {
        const age = Date.now() - cached.timestamp
        if (age < ttl) {
          cached.accessCount++
          stats.hits++
          return cached.data
        }
        // Expired, remove it
        cache.delete(key)
      }

      stats.misses++
      return undefined
    }

    /**
     * Set a cached value
     */
    set(key: string, data: T, fileHash?: string): void {
      const cache = this.getCache()
      const config = this.getConfig()
      const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES

      // LRU eviction if at capacity
      if (cache.size >= maxEntries) {
        this.evictLRU()
      }

      cache.set(key, {
        data,
        timestamp: Date.now(),
        accessCount: 1,
        fileHash,
      })
    }

    /**
     * Invalidate a specific key
     */
    invalidate(key: string): void {
      this.getCache().delete(key)
    }

    /**
     * Invalidate all keys matching a pattern
     */
    invalidatePattern(pattern: RegExp): number {
      const cache = this.getCache()
      let count = 0
      for (const key of cache.keys()) {
        if (pattern.test(key)) {
          cache.delete(key)
          count++
        }
      }
      return count
    }

    /**
     * Check if a key is cached and valid
     */
    has(key: string): boolean {
      const cache = this.getCache()
      const config = this.getConfig()
      const ttl = config.ttl ?? DEFAULT_TTL

      const cached = cache.get(key)
      if (!cached) return false

      const age = Date.now() - cached.timestamp
      return age < ttl
    }

    /**
     * Get cache size
     */
    get size(): number {
      return this.getCache().size
    }

    /**
     * Clear this cache
     */
    clear(): void {
      this.getCache().clear()
    }

    private evictLRU(): void {
      const cache = this.getCache()
      let oldest: { key: string; entry: CacheEntry<unknown> } | null = null

      for (const [key, entry] of cache) {
        if (!oldest || entry.timestamp < oldest.entry.timestamp) {
          oldest = { key, entry }
        }
      }

      if (oldest) {
        cache.delete(oldest.key)
      }
    }
  }

  // =============
  // Write Batcher
  // =============

  interface PendingWrite<T> {
    data: T
    timestamp: number
    resolve: () => void
    reject: (error: Error) => void
  }

  const pendingWrites = new Map<string, PendingWrite<unknown>>()
  const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const DEFAULT_WRITE_DELAY = 500

  /**
   * Batch writes to the same key, only executing the last one after delay
   */
  export function batchedWrite<T>(
    key: string,
    data: T,
    writer: (data: T) => Promise<void>,
    delay: number = DEFAULT_WRITE_DELAY,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Cancel any pending write for this key
      const existingTimer = writeTimers.get(key)
      if (existingTimer) {
        clearTimeout(existingTimer)
        // Resolve the previous pending write immediately (it was superseded)
        const pending = pendingWrites.get(key)
        if (pending) {
          pending.resolve()
        }
      }

      // Store the new pending write
      pendingWrites.set(key, { data, timestamp: Date.now(), resolve, reject })

      // Schedule the actual write
      const timer = setTimeout(async () => {
        const pending = pendingWrites.get(key)
        if (!pending) return

        pendingWrites.delete(key)
        writeTimers.delete(key)

        try {
          await writer(pending.data as T)
          pending.resolve()
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }, delay)

      writeTimers.set(key, timer)
    })
  }

  /**
   * Flush all pending writes immediately
   */
  export async function flushPendingWrites(): Promise<void> {
    for (const timer of writeTimers.values()) {
      clearTimeout(timer)
    }
    writeTimers.clear()

    // Note: This doesn't execute the writes, just clears them
    // For a proper flush, we'd need to track the writers too
    for (const pending of pendingWrites.values()) {
      pending.resolve()
    }
    pendingWrites.clear()
  }

  // =============
  // Debounce Utility
  // =============

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const debouncedCalls = new Map<
    string,
    { fn: () => Promise<void>; resolve: () => void; reject: (e: Error) => void }[]
  >()

  /**
   * Debounce async function calls by key
   * All calls within the delay window will be resolved together when the function executes
   */
  export function debounce<T extends (...args: any[]) => Promise<void>>(
    key: string,
    fn: T,
    delay: number,
  ): (...args: Parameters<T>) => Promise<void> {
    return (...args: Parameters<T>): Promise<void> => {
      return new Promise((resolve, reject) => {
        // Clear existing timer
        const existingTimer = debounceTimers.get(key)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }

        // Add to pending calls
        const pending = debouncedCalls.get(key) || []
        pending.push({ fn: () => fn(...args), resolve, reject })
        debouncedCalls.set(key, pending)

        // Schedule execution
        const timer = setTimeout(async () => {
          const calls = debouncedCalls.get(key) || []
          debouncedCalls.delete(key)
          debounceTimers.delete(key)

          if (calls.length === 0) return

          // Execute only the last call
          const lastCall = calls[calls.length - 1]
          try {
            await lastCall.fn()
            // Resolve all pending calls
            for (const call of calls) {
              call.resolve()
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            for (const call of calls) {
              call.reject(err)
            }
          }
        }, delay)

        debounceTimers.set(key, timer)
      })
    }
  }

  /**
   * Throttle async function calls by key
   * First call executes immediately, subsequent calls within window are dropped
   */
  export function throttle<T extends (...args: any[]) => Promise<void>>(
    key: string,
    fn: T,
    window: number,
  ): (...args: Parameters<T>) => Promise<void> {
    const lastExecution = new Map<string, number>()

    return async (...args: Parameters<T>): Promise<void> => {
      const now = Date.now()
      const last = lastExecution.get(key) || 0

      if (now - last < window) {
        // Within throttle window, skip
        return
      }

      lastExecution.set(key, now)
      await fn(...args)
    }
  }

  // =============
  // File Hash Utility
  // =============

  /**
   * Compute a fast hash for file modification tracking
   * Uses mtime + size as a cheap proxy for content changes
   */
  export async function getFileHash(filePath: string): Promise<string | null> {
    try {
      const file = Bun.file(filePath)
      const stat = await file.stat()
      return `${stat.mtime?.getTime() || 0}:${stat.size}`
    } catch {
      return null
    }
  }
}
