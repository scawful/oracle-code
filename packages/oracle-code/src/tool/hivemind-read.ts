import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import { HivemindStore, HivemindCategory, HivemindScope, EntryStatus } from "../cognitive/hivemind"
import type { HivemindEntry } from "../cognitive/hivemind"
import DESCRIPTION from "./hivemind-read.txt"

export const HivemindReadTool = Tool.define("hivemind_read", {
  description: DESCRIPTION,
  parameters: z.object({
    category: HivemindCategory.optional().describe("Filter by category: fear, satisfaction, knowledge, decision, preference"),
    scope: HivemindScope.optional().describe("Filter by scope: project or global"),
    key: z.string().optional().describe("Get a specific entry by key"),
    status: EntryStatus.optional().describe("Filter by status: active, decaying, golden, contested"),
    search: z.string().optional().describe("Search query to filter entries"),
    limit: z.number().optional().default(20).describe("Maximum entries to return"),
  }),
  async execute(params): Promise<{
    title: string
    output: string
    metadata: Record<string, unknown>
  }> {
    const root = await AFS.findRoot()
    if (!root) {
      return {
        title: "Hivemind Not Found",
        output: "AFS not initialized. No .context directory found.\nRun 'ocode afs init' to initialize.",
        metadata: {
          exists: false,
          count: 0,
          categories: [],
        },
      }
    }

    try {
      // If searching for specific key
      if (params.key) {
        const entries = await HivemindStore.search(params.key, root)
        const entry = entries.find(e => e.key === params.key)
        if (entry) {
          return {
            title: `Hivemind Entry: ${entry.key}`,
            output: formatEntry(entry),
            metadata: {
              exists: true,
              count: 1,
              categories: [entry.category],
              entryId: entry.id,
              status: entry.status,
              confidence: entry.confidence,
            },
          }
        }
        return {
          title: "Entry Not Found",
          output: `No entry found with key '${params.key}'`,
          metadata: {
            exists: true,
            count: 0,
            categories: [],
          },
        }
      }

      // If searching by text query
      if (params.search) {
        const entries = await HivemindStore.search(params.search, root, params.scope)
        const filtered = filterEntries(entries, params)
        return formatResults(filtered.slice(0, params.limit), "Search Results")
      }

      // If filtering by category
      if (params.category) {
        const entries = await HivemindStore.getEntriesByCategory(params.category, root, params.scope)
        const filtered = filterEntries(entries, params)
        return formatResults(filtered.slice(0, params.limit), `${capitalize(params.category)} Entries`)
      }

      // If filtering by status
      if (params.status) {
        const entries = await HivemindStore.getEntriesByStatus(params.status, root, params.scope)
        const filtered = filterEntries(entries, params)
        return formatResults(filtered.slice(0, params.limit), `${capitalize(params.status)} Entries`)
      }

      // Get summary of all hivemind entries
      const state = await HivemindStore.getState(root)
      const stats = state.manifest.stats

      const lines: string[] = []
      lines.push("## Hivemind Summary")
      lines.push("")
      lines.push(`**Total Entries**: ${stats.totalEntries}`)
      lines.push(`**Golden**: ${stats.goldenCount}`)
      lines.push(`**Decaying**: ${stats.decayingCount}`)
      lines.push(`**Contested**: ${stats.contestedCount}`)
      lines.push("")

      // Show recent entries by category
      if (state.fears.length > 0) {
        lines.push("### Known Pitfalls")
        for (const e of state.fears.slice(0, 5)) {
          lines.push(`- **${e.key}**${e.status === "golden" ? " [GOLDEN]" : ""}: ${e.value}`)
        }
        lines.push("")
      }

      if (state.satisfactions.length > 0) {
        lines.push("### What Works Well")
        for (const e of state.satisfactions.slice(0, 5)) {
          lines.push(`- **${e.key}**${e.status === "golden" ? " [GOLDEN]" : ""}: ${e.value}`)
        }
        lines.push("")
      }

      if (state.knowledge.length > 0) {
        lines.push("### Established Knowledge")
        for (const e of state.knowledge.slice(0, 5)) {
          lines.push(`- **${e.key}**${e.status === "golden" ? " [GOLDEN]" : ""}: ${e.value}`)
        }
        lines.push("")
      }

      if (state.decisions.length > 0) {
        lines.push("### Past Decisions")
        for (const e of state.decisions.slice(0, 5)) {
          lines.push(`- **${e.key}**${e.status === "golden" ? " [GOLDEN]" : ""}: ${e.value}`)
        }
        lines.push("")
      }

      if (state.preferences.length > 0) {
        lines.push("### Preferences")
        for (const e of state.preferences.slice(0, 5)) {
          lines.push(`- **${e.key}**: ${e.value}`)
        }
        lines.push("")
      }

      return {
        title: "Hivemind Overview",
        output: lines.join("\n"),
        metadata: {
          exists: true,
          count: stats.totalEntries,
          categories: ["fear", "satisfaction", "knowledge", "decision", "preference"],
          golden: stats.goldenCount,
          decaying: stats.decayingCount,
          contested: stats.contestedCount,
        },
      }
    } catch (error) {
      return {
        title: "Hivemind Error",
        output: `Error reading hivemind: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          exists: false,
          count: 0,
          categories: [],
          error: String(error),
        },
      }
    }
  },
})

function filterEntries(
  entries: HivemindEntry[],
  params: { status?: string; scope?: string }
): HivemindEntry[] {
  let filtered = entries
  if (params.status) {
    filtered = filtered.filter(e => e.status === params.status)
  }
  if (params.scope) {
    filtered = filtered.filter(e => e.scope === params.scope)
  }
  // Sort by relevance: golden first, then by confidence
  return filtered.sort((a, b) => {
    if (a.status === "golden" && b.status !== "golden") return -1
    if (b.status === "golden" && a.status !== "golden") return 1
    return b.confidence - a.confidence
  })
}

function formatEntry(entry: HivemindEntry): string {
  const lines: string[] = []
  lines.push(`**Key**: ${entry.key}`)
  lines.push(`**Value**: ${entry.value}`)
  lines.push(`**Category**: ${entry.category}`)
  lines.push(`**Scope**: ${entry.scope}`)
  lines.push(`**Status**: ${entry.status}${entry.status === "golden" ? " (permanent)" : ""}`)
  lines.push(`**Confidence**: ${Math.round(entry.confidence * 100)}%`)
  lines.push(`**Source**: ${entry.source.agentRole} (${entry.source.sessionId})`)
  lines.push(`**Reason**: ${entry.source.promotionReason}`)
  lines.push(`**Last Accessed**: ${entry.decay.lastAccessed}`)
  lines.push(`**Access Count**: ${entry.decay.accessCount}`)
  if (entry.status !== "golden" && entry.decay.decayRate > 0) {
    lines.push(`**Decay Rate**: ${Math.round(entry.decay.decayRate * 100)}% per day`)
  }
  if (entry.contested) {
    lines.push(`**Contested**: ${entry.contested.reason}`)
  }
  if (entry.golden) {
    lines.push(`**Promoted to Golden**: ${entry.golden.promotedAt} by ${entry.golden.promotedBy}`)
  }
  return lines.join("\n")
}

function formatResults(entries: HivemindEntry[], title: string): {
  title: string
  output: string
  metadata: Record<string, unknown>
} {
  if (entries.length === 0) {
    return {
      title,
      output: "No entries found.",
      metadata: {
        exists: true,
        count: 0,
        categories: [],
      },
    }
  }

  const lines: string[] = []
  const categories = new Set<string>()

  for (const entry of entries) {
    categories.add(entry.category)
    const badge = entry.status === "golden" ? " [GOLDEN]" : entry.status === "decaying" ? " [DECAYING]" : ""
    lines.push(`- **${entry.key}**${badge} (${entry.category}): ${entry.value}`)
    lines.push(`  _Confidence: ${Math.round(entry.confidence * 100)}% | Scope: ${entry.scope}_`)
  }

  return {
    title,
    output: lines.join("\n"),
    metadata: {
      exists: true,
      count: entries.length,
      categories: [...categories],
      entries: entries.map(e => e.id),
    },
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
