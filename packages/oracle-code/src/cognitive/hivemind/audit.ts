/**
 * Hivemind Audit System
 *
 * Logs all council votes and decisions to .context/history/councils/
 * for transparency and learning. Each council session gets its own
 * audit log file.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { AFS } from "../../afs"
import { HivemindStore } from "./store"
import {
  CouncilSession,
  CouncilAuditLog,
  DebateInfo,
  CouncilPurpose,
} from "./types"

export namespace HivemindAudit {
  // =============
  // Constants
  // =============

  const COUNCILS_DIR = "history/councils"
  const LOG_TIMESTAMP_RE =
    /^vote-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-/

  // =============
  // Bus Events
  // =============

  export const Event = {
    LogCreated: BusEvent.define(
      "hivemind.audit.log_created",
      z.object({
        sessionId: z.string(),
        logPath: z.string(),
      })
    ),
  } as const

  // =============
  // Path Helpers
  // =============

  /**
   * Get the councils audit directory path
   */
  async function getCouncilsDir(contextRoot?: string): Promise<string> {
    const root = contextRoot || (await AFS.getRoot())
    return path.join(root, COUNCILS_DIR)
  }

  /**
   * Generate the audit log filename for a session
   */
  function getLogFilename(session: CouncilSession): string {
    const timestamp = new Date(session.timestamp).toISOString().replace(/[:.]/g, "-")
    const safeKey = session.entryKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)
    return `vote-${timestamp}-${safeKey}.json`
  }

  function parseLogTimestamp(filename: string): Date | null {
    // Filename format: vote-2024-01-15T14-30-00-000Z-key.json
    const match = filename.match(LOG_TIMESTAMP_RE)
    if (!match) return null

    const dashedIso = match[1]
    const iso = dashedIso.replace(
      /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
      "$1:$2:$3.$4Z"
    )

    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date
  }

  /**
   * Get the full path to a council audit log
   */
  export async function getAuditPath(
    sessionId: string,
    contextRoot?: string
  ): Promise<string | null> {
    const state = await HivemindStore.getState(contextRoot)
    const session = state.councils.find((c) => c.id === sessionId)
    if (!session) return null

    const dir = await getCouncilsDir(contextRoot)
    return path.join(dir, getLogFilename(session))
  }

  // =============
  // Logging
  // =============

  /**
   * Log a completed council session
   */
  export async function logCouncilSession(
    session: CouncilSession,
    outcome: {
      entryId: string
      action: "created" | "updated" | "promoted_golden" | "promoted_global" | "rejected"
      previousValue?: string
      newValue?: string
    },
    debate?: DebateInfo,
    contextRoot?: string
  ): Promise<string> {
    const dir = await getCouncilsDir(contextRoot)
    await fs.mkdir(dir, { recursive: true })

    const logPath = path.join(dir, getLogFilename(session))

    const auditLog: CouncilAuditLog = {
      session,
      debate,
      outcome,
    }

    await fs.writeFile(logPath, JSON.stringify(auditLog, null, 2))

    // Update session with log path
    session.audit.logPath = logPath
    await HivemindStore.saveCouncilSession(session, contextRoot)

    Bus.publish(Event.LogCreated, {
      sessionId: session.id,
      logPath,
    })

    return logPath
  }

  /**
   * Get an audit log by session ID
   */
  export async function getAuditLog(
    sessionId: string,
    contextRoot?: string
  ): Promise<CouncilAuditLog | null> {
    const logPath = await getAuditPath(sessionId, contextRoot)
    if (!logPath) return null

    try {
      const content = await fs.readFile(logPath, "utf-8")
      return CouncilAuditLog.parse(JSON.parse(content))
    } catch {
      return null
    }
  }

  /**
   * List all audit logs
   */
  export async function listAuditLogs(
    options?: {
      from?: Date
      to?: Date
      purpose?: CouncilPurpose
      limit?: number
    },
    contextRoot?: string
  ): Promise<string[]> {
    const dir = await getCouncilsDir(contextRoot)

    try {
      const files = await fs.readdir(dir)
      let logs = files.filter((f) => f.startsWith("vote-") && f.endsWith(".json"))

      // Filter by date range if specified
      if (options?.from || options?.to) {
        logs = logs.filter((filename) => {
          const timestamp = parseLogTimestamp(filename)
          if (!timestamp) return true
          if (options.from && timestamp < options.from) return false
          if (options.to && timestamp > options.to) return false
          return true
        })
      }

      // Sort by date (newest first)
      logs.sort().reverse()

      // Apply limit
      if (options?.limit) {
        logs = logs.slice(0, options.limit)
      }

      // Filter by purpose if specified (requires reading files)
      if (options?.purpose) {
        const filtered: string[] = []
        for (const filename of logs) {
          try {
            const content = await fs.readFile(path.join(dir, filename), "utf-8")
            const log = JSON.parse(content) as CouncilAuditLog
            if (log.session.purpose === options.purpose) {
              filtered.push(filename)
            }
          } catch {
            // Skip invalid files
          }
        }
        return filtered.map((f) => path.join(dir, f))
      }

      return logs.map((f) => path.join(dir, f))
    } catch {
      // Directory doesn't exist yet
      return []
    }
  }

  /**
   * Get summary statistics from audit logs
   */
  export async function getAuditStats(
    contextRoot?: string
  ): Promise<{
    totalCouncils: number
    approved: number
    rejected: number
    byPurpose: Record<string, number>
    byOutcome: Record<string, number>
    averageVotes: number
    averageConfidence: number
  }> {
    const logPaths = await listAuditLogs(undefined, contextRoot)
    
    const stats = {
      totalCouncils: 0,
      approved: 0,
      rejected: 0,
      byPurpose: {} as Record<string, number>,
      byOutcome: {} as Record<string, number>,
      totalVotes: 0,
      totalConfidence: 0,
    }

    for (const logPath of logPaths) {
      try {
        const content = await fs.readFile(logPath, "utf-8")
        const log = JSON.parse(content) as CouncilAuditLog

        stats.totalCouncils++
        
        if (log.session.status === "approved") stats.approved++
        if (log.session.status === "rejected") stats.rejected++

        stats.byPurpose[log.session.purpose] = (stats.byPurpose[log.session.purpose] || 0) + 1
        stats.byOutcome[log.outcome.action] = (stats.byOutcome[log.outcome.action] || 0) + 1

        stats.totalVotes += log.session.votes.length
        stats.totalConfidence += log.session.votes.reduce((sum, v) => sum + v.confidence, 0)
      } catch {
        // Skip invalid files
      }
    }

    return {
      totalCouncils: stats.totalCouncils,
      approved: stats.approved,
      rejected: stats.rejected,
      byPurpose: stats.byPurpose,
      byOutcome: stats.byOutcome,
      averageVotes: stats.totalCouncils > 0 ? stats.totalVotes / stats.totalCouncils : 0,
      averageConfidence: stats.totalVotes > 0 ? stats.totalConfidence / stats.totalVotes : 0,
    }
  }

  /**
   * Format an audit log for display
   */
  export function formatAuditLog(log: CouncilAuditLog): string {
    const lines: string[] = []

    lines.push(`# Council Audit Log`)
    lines.push(``)
    lines.push(`**Session ID:** ${log.session.id}`)
    lines.push(`**Purpose:** ${formatPurpose(log.session.purpose)}`)
    lines.push(`**Entry Key:** ${log.session.entryKey}`)
    lines.push(`**Status:** ${log.session.status.toUpperCase()}`)
    lines.push(`**Initiated:** ${log.session.audit.initiatedAt}`)
    lines.push(`**Completed:** ${log.session.audit.completedAt || "N/A"}`)
    lines.push(``)

    lines.push(`## Contest`)
    lines.push(`**Reason:** ${log.session.contestReason}`)
    lines.push(``)
    lines.push(`**Current Value:**`)
    lines.push("```")
    lines.push(log.session.currentValue)
    lines.push("```")
    lines.push(``)
    lines.push(`**Proposed Value:**`)
    lines.push("```")
    lines.push(log.session.proposedValue)
    lines.push("```")
    lines.push(``)

    lines.push(`## Votes`)
    for (const vote of log.session.votes) {
      const icon = vote.vote === "approve" ? "+" : vote.vote === "reject" ? "-" : "?"
      lines.push(`- [${icon}] **${vote.agentRole}**: ${vote.vote} (conf: ${vote.confidence.toFixed(2)})`)
      lines.push(`  > ${vote.rationale}`)
    }
    lines.push(``)

    if (log.debate && log.debate.rounds.length > 0) {
      lines.push(`## Debate`)
      for (const round of log.debate.rounds) {
        lines.push(`### Round ${round.round}`)
        lines.push(`**Pro (${round.proAgent}):** ${round.proArgument}`)
        lines.push(``)
        lines.push(`**Con (${round.conAgent}):** ${round.conArgument}`)
        lines.push(``)
      }
      if (log.debate.finalSynthesis) {
        lines.push(`### Arbitration`)
        lines.push(`**Arbitrator:** ${log.debate.arbitratorAgent}`)
        lines.push(`**Synthesis:** ${log.debate.finalSynthesis}`)
      }
      lines.push(``)
    }

    lines.push(`## Result`)
    if (log.session.result) {
      lines.push(`**Decision:** ${log.session.result.finalDecision.toUpperCase()}`)
      lines.push(`**Confidence:** ${log.session.result.confidence.toFixed(2)}`)
      lines.push(`**Rationale:** ${log.session.result.rationale}`)
    }
    lines.push(``)

    lines.push(`## Outcome`)
    lines.push(`**Action:** ${log.outcome.action}`)
    lines.push(`**Entry ID:** ${log.outcome.entryId}`)
    if (log.outcome.previousValue) {
      lines.push(`**Previous Value:** ${log.outcome.previousValue}`)
    }
    if (log.outcome.newValue) {
      lines.push(`**New Value:** ${log.outcome.newValue}`)
    }

    return lines.join("\n")
  }

  function formatPurpose(purpose: CouncilPurpose): string {
    switch (purpose) {
      case "conflict":
        return "Conflict Resolution"
      case "decay_promotion":
        return "Decay-to-Golden Promotion"
      case "global_promotion":
        return "Global Promotion"
    }
  }

  /**
   * Clean up old audit logs (retain last N days)
   */
  export async function cleanupOldLogs(
    retentionDays: number = 90,
    contextRoot?: string
  ): Promise<number> {
    const dir = await getCouncilsDir(contextRoot)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    let deleted = 0

    try {
      const files = await fs.readdir(dir)

      for (const filename of files) {
        if (!filename.startsWith("vote-") || !filename.endsWith(".json")) continue

        const timestamp = parseLogTimestamp(filename)
        if (!timestamp) continue
        
        if (timestamp < cutoffDate) {
          await fs.unlink(path.join(dir, filename))
          deleted++
        }
      }
    } catch {
      // Directory doesn't exist or other error
    }

    return deleted
  }
}
