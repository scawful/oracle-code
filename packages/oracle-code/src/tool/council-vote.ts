import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import { HivemindStore, CouncilPurpose } from "../cognitive/hivemind"
import { HivemindCouncil } from "../cognitive/hivemind/council"
import DESCRIPTION from "./council-vote.txt"

export const CouncilVoteTool = Tool.define("council_vote", {
  description: DESCRIPTION,
  parameters: z.object({
    purpose: CouncilPurpose.describe("Purpose: conflict, decay_promotion, or global_promotion"),
    entryKey: z.string().describe("The key of the entry being voted on"),
    currentValue: z.string().describe("The current/existing value"),
    proposedValue: z.string().describe("The proposed/new value"),
    contestReason: z.string().describe("Explanation of why council is needed"),
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
      // Get council config
      const state = await HivemindStore.getState(root)
      const config = state.manifest.council

      // Create council session
      const session = await HivemindCouncil.createSession(
        params.purpose,
        params.entryKey,
        params.contestReason,
        params.currentValue,
        params.proposedValue,
        undefined, // use default config
        root
      )

      // Build output
      const lines: string[] = []
      lines.push(`## Council Session Created`)
      lines.push("")
      lines.push(`**Session ID**: ${session.id}`)
      lines.push(`**Purpose**: ${formatPurpose(params.purpose)}`)
      lines.push(`**Entry Key**: ${params.entryKey}`)
      lines.push(`**Status**: ${session.status}`)
      lines.push("")
      lines.push(`### Voting Configuration`)
      lines.push(`- Council Size: ${config.councilSize}`)
      lines.push(`- Quorum: ${config.quorum}`)
      lines.push(`- Threshold: ${Math.round(config.threshold * 100)}%`)
      lines.push(`- Agents: ${config.councilAgents.join(", ")}`)
      lines.push(`- Debate on Tie: ${config.debateOnTie ? "Yes" : "No"}`)
      lines.push("")
      lines.push(`### Values`)
      lines.push(`**Current**: ${params.currentValue}`)
      lines.push(`**Proposed**: ${params.proposedValue}`)
      lines.push("")
      lines.push(`### Reason`)
      lines.push(params.contestReason)
      lines.push("")
      lines.push(`The council session has been created. Voting agents will be spawned to evaluate and vote.`)
      lines.push(`Use \`hivemind_read\` with status="contested" to check on active councils.`)

      return {
        title: "Council Session Created",
        output: lines.join("\n"),
        metadata: {
          success: true,
          sessionId: session.id,
          purpose: params.purpose,
          entryKey: params.entryKey,
          status: session.status,
          councilSize: config.councilSize,
          agents: config.councilAgents,
        },
      }
    } catch (error) {
      return {
        title: "Council Creation Failed",
        output: `Failed to create council session: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          success: false,
        },
      }
    }
  },
})

function formatPurpose(purpose: string): string {
  switch (purpose) {
    case "conflict":
      return "Conflict Resolution"
    case "decay_promotion":
      return "Golden Promotion (Entry About to Expire)"
    case "global_promotion":
      return "Global Scope Promotion"
    default:
      return purpose
  }
}
