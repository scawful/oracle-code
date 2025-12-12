/**
 * History Store - Singleton state management for history.
 *
 * Provides a project-level history instance that can be used across
 * the application.
 */

import { Instance } from "@/project/instance"
import { AFS } from "@/afs"
import { HistoryLogger, createHistoryLogger } from "./logger"
import type { HistoryEntry, HistoryQuery } from "./types"

/**
 * Global history state management.
 */
export namespace HistoryStore {
  // Cached logger instance
  let cachedLogger: HistoryLogger | null = null
  let cachedRoot: string | null = null

  /**
   * Get or create the history logger for the current project.
   */
  export async function getLogger(): Promise<HistoryLogger | null> {
    const root = await AFS.findRoot()
    if (!root) return null

    // Return cached if same root
    if (cachedLogger && cachedRoot === root) {
      return cachedLogger
    }

    // Create new logger
    cachedLogger = await createHistoryLogger(root)
    cachedRoot = root
    return cachedLogger
  }

  /**
   * Log a tool call to history.
   */
  export async function logToolCall(options: {
    name: string
    input: Record<string, unknown>
    output?: unknown
    success?: boolean
    error?: string
    durationMs?: number
    sessionId?: string
    filesTouched?: string[]
  }): Promise<string | null> {
    const logger = await getLogger()
    if (!logger) return null

    return logger.log({
      operationType: "tool_call",
      name: options.name,
      input: options.input,
      output: options.output,
      success: options.success ?? true,
      error: options.error,
      durationMs: options.durationMs,
      sessionId: options.sessionId,
      filesTouched: options.filesTouched,
    })
  }

  /**
   * Log user input to history.
   */
  export async function logUserInput(
    message: string,
    sessionId?: string
  ): Promise<string | null> {
    const logger = await getLogger()
    if (!logger) return null

    return logger.logUserInput(message, sessionId)
  }

  /**
   * Log agent message to history.
   */
  export async function logAgentMessage(
    agentId: string,
    message: string,
    sessionId?: string
  ): Promise<string | null> {
    const logger = await getLogger()
    if (!logger) return null

    return logger.logAgentMessage(agentId, message, sessionId)
  }

  /**
   * Log a system event to history.
   */
  export async function logSystemEvent(
    eventName: string,
    data?: Record<string, unknown>,
    sessionId?: string
  ): Promise<string | null> {
    const logger = await getLogger()
    if (!logger) return null

    return logger.logSystemEvent(eventName, data, sessionId)
  }

  /**
   * Query history entries.
   */
  export async function query(
    query: HistoryQuery
  ): Promise<HistoryEntry[]> {
    const logger = await getLogger()
    if (!logger) return []

    return logger.query(query)
  }

  /**
   * Search history entries by text.
   */
  export async function search(
    query: string,
    limit: number = 50
  ): Promise<HistoryEntry[]> {
    const logger = await getLogger()
    if (!logger) return []

    return logger.search(query, limit)
  }

  /**
   * Get recent history entries.
   */
  export async function getRecent(
    limit: number = 50
  ): Promise<HistoryEntry[]> {
    const logger = await getLogger()
    if (!logger) return []

    return logger.getRecentEntries(limit)
  }

  /**
   * Get session entries.
   */
  export async function getSessionEntries(
    sessionId: string
  ): Promise<HistoryEntry[]> {
    const logger = await getLogger()
    if (!logger) return []

    return logger.getSessionEntries(sessionId)
  }

  /**
   * Set the current session ID for logging.
   */
  export async function setSessionId(sessionId: string): Promise<void> {
    const logger = await getLogger()
    if (logger) {
      logger.setSessionId(sessionId)
    }
  }

  /**
   * Reset the cached logger (useful for testing or project switch).
   */
  export function reset(): void {
    cachedLogger = null
    cachedRoot = null
  }
}
