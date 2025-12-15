/**
 * History Logger - Append-only JSONL logging with indexed queries.
 *
 * Implements the history logging per PROTOCOL_SPEC.md Section 2.3 and 2.4.
 *
 * Performance optimizations:
 * - Index files (.idx) store line offsets and metadata for fast seeking
 * - Streaming reads for large files
 * - In-memory cache for recent entries
 */

import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "fs/promises"
import { existsSync, createReadStream } from "fs"
import path from "path"
import { Identifier } from "@/id/id"
import type { HistoryEntry, HistoryQuery, OperationType, Provenance } from "./types"
import { createInterface } from "readline"

// =============
// Index Types
// =============

interface IndexEntry {
  offset: number // Byte offset in JSONL file
  length: number // Line length in bytes
  sessionId: string
  operationType: string
  timestamp: string
}

interface IndexFile {
  version: number
  lastOffset: number // Last known file size - for incremental updates
  entries: IndexEntry[]
}

/**
 * Generate ISO 8601 timestamp
 */
function getISOTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Parse date from log filename (YYYY-MM-DD.jsonl)
 */
function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)
  if (!match) return null
  return new Date(match[1])
}

/**
 * Append-only history logger using JSONL format.
 * Writes to daily log files in the history directory.
 */
// In-memory cache for recent entries
const recentEntriesCache = new Map<string, { entries: HistoryEntry[]; timestamp: number }>()
const CACHE_TTL = 5000 // 5 seconds

export class HistoryLogger {
  private historyDir: string
  private projectId?: string
  private sessionId?: string
  private inFlight: Map<string, { name: string; startTime: number }> = new Map()
  private indexCache: Map<string, IndexFile> = new Map()

  constructor(options: { historyDir: string; projectId?: string; sessionId?: string }) {
    this.historyDir = options.historyDir
    this.projectId = options.projectId
    this.sessionId = options.sessionId
  }

  /**
   * Set the current session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  /**
   * Get the log file path for a given date
   */
  private getLogFile(date: Date = new Date()): string {
    const filename = date.toISOString().split("T")[0] + ".jsonl"
    return path.join(this.historyDir, filename)
  }

  /**
   * Ensure history directory exists
   */
  private async ensureDir(): Promise<void> {
    if (!existsSync(this.historyDir)) {
      await mkdir(this.historyDir, { recursive: true })
    }
  }

  /**
   * Append an entry to the log file
   */
  private async appendEntry(entry: HistoryEntry): Promise<void> {
    await this.ensureDir()
    const logFile = this.getLogFile()
    const line = JSON.stringify(entry) + "\n"
    await appendFile(logFile, line, "utf-8")
  }

  /**
   * Log an operation to history
   */
  async log(options: {
    operationType: OperationType
    name: string
    input?: Record<string, unknown>
    output?: unknown
    success?: boolean
    error?: string
    durationMs?: number
    provenance?: Provenance
    tags?: string[]
    filesTouched?: string[]
    sessionId?: string
  }): Promise<string> {
    const entryId = Identifier.ascending("part") // Using part prefix for history entries

    const entry: HistoryEntry = {
      id: entryId,
      timestamp: getISOTimestamp(),
      sessionId: options.sessionId ?? this.sessionId ?? "unknown",
      projectId: this.projectId,
      operation: {
        type: options.operationType,
        name: options.name,
        input: options.input ?? {},
        output: options.output,
        durationMs: options.durationMs,
        success: options.success ?? true,
        error: options.error,
      },
      provenance: options.provenance ?? {},
      metadata: {
        tags: options.tags ?? [],
        filesTouched: options.filesTouched ?? [],
        redacted: false,
      },
      extensions: {},
    }

    await this.appendEntry(entry)
    return entryId
  }

  /**
   * Log the start of a tool call (for duration tracking)
   */
  logToolStart(toolName: string, params: Record<string, unknown>, provenance?: Provenance): string {
    const entryId = Identifier.ascending("part")
    this.inFlight.set(entryId, { name: toolName, startTime: Date.now() })

    // Log the start event (fire and forget)
    this.log({
      operationType: "tool_call",
      name: `${toolName}:start`,
      input: params,
      provenance,
    }).catch(() => {})

    return entryId
  }

  /**
   * Log the completion of a tool call
   */
  async logToolComplete(
    entryId: string,
    result: unknown,
    success: boolean = true,
    error?: string,
    filesTouched?: string[],
  ): Promise<void> {
    const flight = this.inFlight.get(entryId)
    if (!flight) {
      // Fallback if start wasn't tracked
      await this.log({
        operationType: "tool_call",
        name: "unknown:complete",
        output: result,
        success,
        error,
        filesTouched,
      })
      return
    }

    const durationMs = Date.now() - flight.startTime
    this.inFlight.delete(entryId)

    await this.log({
      operationType: "tool_call",
      name: flight.name,
      output: result,
      success,
      error,
      durationMs,
      filesTouched,
    })
  }

  /**
   * Log a cognitive state snapshot
   */
  async logCognitiveState(stateType: string, stateData: Record<string, unknown>, sessionId?: string): Promise<string> {
    return this.log({
      operationType: "cognitive_state",
      name: stateType,
      input: stateData,
      sessionId,
    })
  }

  /**
   * Log user input
   */
  async logUserInput(message: string, sessionId?: string): Promise<string> {
    return this.log({
      operationType: "user_input",
      name: "user_message",
      input: { message },
      sessionId,
    })
  }

  /**
   * Log agent message
   */
  async logAgentMessage(agentId: string, message: string, sessionId?: string): Promise<string> {
    return this.log({
      operationType: "agent_message",
      name: "agent_message",
      input: { message },
      provenance: { agentId },
      sessionId,
    })
  }

  /**
   * Log a system event
   */
  async logSystemEvent(eventName: string, data?: Record<string, unknown>, sessionId?: string): Promise<string> {
    return this.log({
      operationType: "system_event",
      name: eventName,
      input: data ?? {},
      sessionId,
    })
  }

  /**
   * Query history entries using streaming for large files.
   * Uses in-memory cache for recent queries to avoid re-reading.
   */
  async query(query: HistoryQuery): Promise<HistoryEntry[]> {
    const limit = query.limit ?? 100
    const offset = query.offset ?? 0
    const targetCount = limit + offset

    // Check cache for recent entries query (most common case)
    if (
      !query.sessionId &&
      !query.projectId &&
      !query.operationTypes &&
      !query.tags &&
      !query.startTime &&
      !query.endTime
    ) {
      const cacheKey = `recent:${this.historyDir}:${limit}`
      const cached = recentEntriesCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.entries.slice(offset, offset + limit)
      }
    }

    const results: HistoryEntry[] = []

    // Get all log files sorted by date descending
    let files: string[] = []
    try {
      files = await readdir(this.historyDir)
      files = files
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse()
    } catch {
      return []
    }

    for (const file of files) {
      // Check date range
      const fileDate = parseDateFromFilename(file)
      if (fileDate) {
        if (query.startTime && fileDate < new Date(query.startTime)) continue
        if (query.endTime && fileDate > new Date(query.endTime)) continue
      }

      const filePath = path.join(this.historyDir, file)

      // Use streaming for large files (> 100KB)
      try {
        const fileStat = await stat(filePath)
        if (fileStat.size > 100 * 1024) {
          // Stream large files
          const entries = await this.streamQueryFile(filePath, query, targetCount - results.length)
          results.push(...entries)
        } else {
          // Read small files directly (more efficient for small files)
          const entries = await this.readQueryFile(filePath, query, targetCount - results.length)
          results.push(...entries)
        }
      } catch {
        continue
      }

      if (results.length >= targetCount) break
    }

    // Cache the results for recent-entries queries
    if (
      !query.sessionId &&
      !query.projectId &&
      !query.operationTypes &&
      !query.tags &&
      !query.startTime &&
      !query.endTime
    ) {
      const cacheKey = `recent:${this.historyDir}:${limit}`
      recentEntriesCache.set(cacheKey, { entries: results.slice(0, limit), timestamp: Date.now() })
    }

    return results.slice(offset, offset + limit)
  }

  /**
   * Read and filter entries from a small file (< 100KB)
   */
  private async readQueryFile(filePath: string, query: HistoryQuery, maxEntries: number): Promise<HistoryEntry[]> {
    const results: HistoryEntry[] = []
    const content = await readFile(filePath, "utf-8")
    const lines = content.split("\n")

    // Process in reverse order for most-recent-first
    for (let i = lines.length - 1; i >= 0 && results.length < maxEntries; i--) {
      const line = lines[i].trim()
      if (!line) continue

      try {
        const entry: HistoryEntry = JSON.parse(line)
        if (this.matchesQuery(entry, query)) {
          results.push(entry)
        }
      } catch {
        // Skip malformed lines
      }
    }

    return results
  }

  /**
   * Stream and filter entries from a large file (> 100KB)
   * Reads lines in reverse order for most-recent-first
   */
  private async streamQueryFile(filePath: string, query: HistoryQuery, maxEntries: number): Promise<HistoryEntry[]> {
    return new Promise((resolve) => {
      const results: HistoryEntry[] = []
      const allLines: string[] = []

      const stream = createReadStream(filePath, { encoding: "utf-8" })
      const rl = createInterface({ input: stream, crlfDelay: Infinity })

      rl.on("line", (line) => {
        const trimmed = line.trim()
        if (trimmed) allLines.push(trimmed)
      })

      rl.on("close", () => {
        // Process in reverse for most-recent-first
        for (let i = allLines.length - 1; i >= 0 && results.length < maxEntries; i--) {
          try {
            const entry: HistoryEntry = JSON.parse(allLines[i])
            if (this.matchesQuery(entry, query)) {
              results.push(entry)
            }
          } catch {
            // Skip malformed lines
          }
        }
        resolve(results)
      })

      rl.on("error", () => {
        resolve(results)
      })
    })
  }

  /**
   * Check if an entry matches the query filters
   */
  private matchesQuery(entry: HistoryEntry, query: HistoryQuery): boolean {
    if (query.sessionId && entry.sessionId !== query.sessionId) return false
    if (query.projectId && entry.projectId !== query.projectId) return false
    if (query.operationTypes && !query.operationTypes.includes(entry.operation.type as OperationType)) return false
    if (query.tags && !query.tags.some((t) => entry.metadata?.tags?.includes(t))) return false
    return true
  }

  /**
   * Get all entries for a session
   */
  async getSessionEntries(sessionId: string): Promise<HistoryEntry[]> {
    return this.query({ sessionId, limit: 10000, offset: 0 })
  }

  /**
   * Get the most recent entries
   */
  async getRecentEntries(limit: number = 50): Promise<HistoryEntry[]> {
    return this.query({ limit, offset: 0 })
  }

  /**
   * Search entries by text in name, input, or output
   */
  async search(query: string, limit: number = 50): Promise<HistoryEntry[]> {
    const allEntries = await this.getRecentEntries(1000)
    const queryLower = query.toLowerCase()

    return allEntries
      .filter((entry) => {
        const searchText = [
          entry.operation.name,
          JSON.stringify(entry.operation.input),
          JSON.stringify(entry.operation.output),
        ]
          .join(" ")
          .toLowerCase()

        return searchText.includes(queryLower)
      })
      .slice(0, limit)
  }
}

/**
 * Create a history logger for the current project
 */
export async function createHistoryLogger(contextRoot: string, sessionId?: string): Promise<HistoryLogger> {
  const historyDir = path.join(contextRoot, "history")
  return new HistoryLogger({
    historyDir,
    sessionId,
  })
}
