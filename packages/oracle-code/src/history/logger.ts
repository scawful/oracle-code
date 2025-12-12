/**
 * History Logger - Append-only JSONL logging.
 *
 * Implements the history logging per PROTOCOL_SPEC.md Section 2.3 and 2.4.
 */

import { appendFile, mkdir, readdir, readFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Identifier } from "@/id/id"
import type {
  HistoryEntry,
  HistoryQuery,
  OperationType,
  Provenance,
} from "./types"

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
export class HistoryLogger {
  private historyDir: string
  private projectId?: string
  private sessionId?: string
  private inFlight: Map<string, { name: string; startTime: number }> = new Map()

  constructor(options: {
    historyDir: string
    projectId?: string
    sessionId?: string
  }) {
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
  logToolStart(
    toolName: string,
    params: Record<string, unknown>,
    provenance?: Provenance
  ): string {
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
    filesTouched?: string[]
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
  async logCognitiveState(
    stateType: string,
    stateData: Record<string, unknown>,
    sessionId?: string
  ): Promise<string> {
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
  async logAgentMessage(
    agentId: string,
    message: string,
    sessionId?: string
  ): Promise<string> {
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
  async logSystemEvent(
    eventName: string,
    data?: Record<string, unknown>,
    sessionId?: string
  ): Promise<string> {
    return this.log({
      operationType: "system_event",
      name: eventName,
      input: data ?? {},
      sessionId,
    })
  }

  /**
   * Query history entries
   */
  async query(query: HistoryQuery): Promise<HistoryEntry[]> {
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
        if (query.startTime) {
          const start = new Date(query.startTime)
          if (fileDate < start) continue
        }
        if (query.endTime) {
          const end = new Date(query.endTime)
          if (fileDate > end) continue
        }
      }

      // Read and filter entries
      const filePath = path.join(this.historyDir, file)
      try {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n").filter((l) => l.trim())

        for (const line of lines) {
          try {
            const entry: HistoryEntry = JSON.parse(line)

            // Apply filters
            if (query.sessionId && entry.sessionId !== query.sessionId) continue
            if (query.projectId && entry.projectId !== query.projectId) continue
            if (
              query.operationTypes &&
              !query.operationTypes.includes(entry.operation.type as any)
            )
              continue
            if (
              query.tags &&
              !query.tags.some((t) => entry.metadata?.tags?.includes(t))
            )
              continue

            results.push(entry)

            const limit = query.limit ?? 100
            const offset = query.offset ?? 0
            if (results.length >= limit + offset) break
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }

      const limit = query.limit ?? 100
      const offset = query.offset ?? 0
      if (results.length >= limit + offset) break
    }

    // Apply offset and limit
    const limit = query.limit ?? 100
    const offset = query.offset ?? 0
    return results.slice(offset, offset + limit)
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
  async search(
    query: string,
    limit: number = 50
  ): Promise<HistoryEntry[]> {
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
export async function createHistoryLogger(
  contextRoot: string,
  sessionId?: string
): Promise<HistoryLogger> {
  const historyDir = path.join(contextRoot, "history")
  return new HistoryLogger({
    historyDir,
    sessionId,
  })
}
