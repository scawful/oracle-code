/**
 * History Search Tool - Search and query history entries.
 *
 * Provides MCP tool for querying the history pipeline.
 */

import z from "zod"
import { Tool } from "./tool"
import { HistoryStore } from "@/history/store"
import { OperationType } from "@/history/types"
import type { HistoryEntry } from "@/history/types"

const DESCRIPTION = `Search and query the history pipeline for past operations.

The history contains all agent operations including:
- Tool calls (tool_call)
- Agent messages (agent_message)
- User input (user_input)
- System events (system_event)
- Cognitive state snapshots (cognitive_state)

Use this tool to:
- Find past tool calls and their results
- Review conversation history
- Analyze patterns in agent behavior
- Retrieve context from previous sessions

Parameters:
- query: Text search query (searches name, input, output)
- sessionId: Filter by specific session ID
- operationType: Filter by operation type
- limit: Maximum entries to return (default: 50)
- recent: If true, return most recent entries without filtering
`

export const HistorySearchTool = Tool.define("history_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().optional().describe("Text search query"),
    sessionId: z.string().optional().describe("Filter by session ID"),
    operationType: OperationType.optional().describe(
      "Filter by operation type: tool_call, agent_message, user_input, system_event, cognitive_state"
    ),
    limit: z.number().optional().default(50).describe("Maximum entries to return"),
    recent: z.boolean().optional().describe("If true, return most recent entries"),
  }),
  async execute(params): Promise<{
    title: string
    output: string
    metadata: Record<string, unknown>
  }> {
    try {
      let entries: HistoryEntry[] = []

      if (params.recent) {
        // Get most recent entries
        entries = await HistoryStore.getRecent(params.limit)
      } else if (params.query) {
        // Search by text
        entries = await HistoryStore.search(params.query, params.limit)
      } else if (params.sessionId) {
        // Get session entries
        entries = await HistoryStore.getSessionEntries(params.sessionId)
        entries = entries.slice(0, params.limit)
      } else {
        // Default to recent
        entries = await HistoryStore.getRecent(params.limit)
      }

      // Filter by operation type if specified
      if (params.operationType) {
        entries = entries.filter(
          (e) => e.operation.type === params.operationType
        )
      }

      if (entries.length === 0) {
        return {
          title: "No History Found",
          output: "No history entries match the query.",
          metadata: {
            count: 0,
            query: params.query,
            sessionId: params.sessionId,
            operationType: params.operationType,
          },
        }
      }

      // Format results
      const lines: string[] = []
      lines.push(`## History Results (${entries.length} entries)\n`)

      const sessions = new Set<string>()
      const types = new Set<string>()

      for (const entry of entries) {
        sessions.add(entry.sessionId)
        types.add(entry.operation.type)

        const time = entry.timestamp.split("T")[1]?.split(".")[0] ?? entry.timestamp
        const success = entry.operation.success ? "✓" : "✗"
        const duration = entry.operation.durationMs
          ? ` (${entry.operation.durationMs}ms)`
          : ""

        lines.push(
          `### ${entry.operation.name} [${entry.operation.type}]`
        )
        lines.push(`- **Time**: ${time}${duration}`)
        lines.push(`- **Status**: ${success}`)
        lines.push(`- **Session**: ${entry.sessionId.slice(0, 12)}...`)

        // Show input summary
        if (entry.operation.input && Object.keys(entry.operation.input).length > 0) {
          const inputStr = JSON.stringify(entry.operation.input)
          lines.push(
            `- **Input**: ${inputStr.length > 100 ? inputStr.slice(0, 100) + "..." : inputStr}`
          )
        }

        // Show output summary
        if (entry.operation.output !== undefined) {
          const outputStr =
            typeof entry.operation.output === "string"
              ? entry.operation.output
              : JSON.stringify(entry.operation.output)
          lines.push(
            `- **Output**: ${outputStr.length > 100 ? outputStr.slice(0, 100) + "..." : outputStr}`
          )
        }

        // Show error if present
        if (entry.operation.error) {
          lines.push(`- **Error**: ${entry.operation.error}`)
        }

        lines.push("")
      }

      return {
        title: `History: ${entries.length} entries`,
        output: lines.join("\n"),
        metadata: {
          count: entries.length,
          sessions: [...sessions],
          types: [...types],
          query: params.query,
          sessionId: params.sessionId,
          operationType: params.operationType,
        },
      }
    } catch (error) {
      return {
        title: "History Error",
        output: `Error searching history: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          count: 0,
          error: String(error),
        },
      }
    }
  },
})
