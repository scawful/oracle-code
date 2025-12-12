import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import { HivemindStore, HivemindDecay, HivemindCategory, HivemindScope } from "../cognitive/hivemind"
import DESCRIPTION from "./hivemind-promote.txt"

export const HivemindPromoteTool = Tool.define("hivemind_promote", {
  description: DESCRIPTION,
  parameters: z.object({
    category: HivemindCategory.describe("Type of entry: fear, satisfaction, knowledge, decision, preference"),
    key: z.string().describe("Short identifier for the entry (e.g., 'test_flakiness')"),
    value: z.string().describe("The actual content/description"),
    confidence: z.number().min(0).max(1).optional().default(0.8).describe("Confidence level (0-1)"),
    reason: z.string().describe("Why this should be promoted to the hivemind"),
    scope: HivemindScope.optional().default("project").describe("Scope: project or global"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    requestGolden: z.boolean().optional().default(false).describe("Request immediate golden (permanent) status"),
  }),
  async execute(params, ctx): Promise<{
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
          success: false,
        },
      }
    }

    try {
      // Check if entry with this key already exists
      const existing = await HivemindStore.search(params.key, root)
      const exactMatch = existing.find(
        e => e.key === params.key && e.category === params.category && e.scope === params.scope
      )

      if (exactMatch) {
        // Update existing entry
        await HivemindStore.updateEntry(
          exactMatch.id,
          {
            value: params.value,
            confidence: params.confidence,
            metadata: {
              ...exactMatch.metadata,
              tags: params.tags,
            },
          },
          root
        )

        // Refresh decay timer
        await HivemindDecay.refreshEntry(exactMatch.id, root)

        return {
          title: "Entry Updated",
          output: `Updated existing hivemind entry:\n\n**Key**: ${params.key}\n**Value**: ${params.value}\n**Confidence**: ${Math.round(params.confidence * 100)}%\n**Status**: ${exactMatch.status}`,
          metadata: {
            success: true,
            entryId: exactMatch.id,
            action: "updated",
            category: params.category,
            key: params.key,
            status: exactMatch.status,
          },
        }
      }

      // Create new entry
      const entry = await HivemindStore.addEntry(
        {
          category: params.category,
          scope: params.scope,
          key: params.key,
          value: params.value,
          confidence: params.confidence,
          status: params.requestGolden ? "golden" : "active",
          source: {
            sessionId: ctx.sessionID,
            agentRole: ctx.agent || "primary",
            timestamp: new Date().toISOString(),
            promotionReason: params.reason,
          },
          decay: {
            lastAccessed: new Date().toISOString(),
            accessCount: 0,
            decayRate: getDecayRate(params.category),
          },
          metadata: {
            tags: params.tags,
          },
          golden: params.requestGolden
            ? {
                promotedAt: new Date().toISOString(),
                promotedBy: "user",
              }
            : undefined,
        },
        root
      )

      const statusNote = params.requestGolden
        ? "This entry is marked as **golden** (permanent) and will not decay."
        : `This entry will decay over time. Access it regularly or promote to golden to preserve.`

      return {
        title: "Entry Created",
        output: `Successfully promoted to hivemind:\n\n**Key**: ${entry.key}\n**Category**: ${entry.category}\n**Value**: ${entry.value}\n**Confidence**: ${Math.round(entry.confidence * 100)}%\n**Scope**: ${entry.scope}\n**Status**: ${entry.status}\n\n${statusNote}`,
        metadata: {
          success: true,
          entryId: entry.id,
          action: "created",
          category: entry.category,
          key: entry.key,
          status: entry.status,
          scope: entry.scope,
        },
      }
    } catch (error) {
      return {
        title: "Promotion Failed",
        output: `Failed to promote to hivemind: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          success: false,
        },
      }
    }
  },
})

function getDecayRate(category: string): number {
  switch (category) {
    case "fear":
      return 0.1 // 10% per day
    case "satisfaction":
      return 0.1
    case "knowledge":
      return 0 // Knowledge doesn't decay
    case "decision":
      return 0.05 // 5% per day
    case "preference":
      return 0 // Preferences don't decay
    default:
      return 0.1
  }
}
