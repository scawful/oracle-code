import z from "zod"
import { Tool } from "./tool"
import { State } from "../state"
import { AFS } from "../afs"
import DESCRIPTION from "./state-write.txt"

export const StateWriteTool = Tool.define("state_write", {
  description: DESCRIPTION,
  parameters: z.object({
    key: z.string().describe("Key to set in shared state"),
    value: z.string().describe("Value to store"),
    section: State.Section.optional().default("context").describe("State section: facts, assumptions, decisions, uncertainties, goals, context"),
  }),
  async execute(params) {
    const root = await AFS.getRoot()

    // Check if key already exists
    const existing = await State.get(root, params.key)
    const action = existing ? "Updated" : "Added"

    await State.set(root, params.key, params.value, params.section)

    let output = `${action} shared state:\n\n`
    output += `**${params.key}**: ${params.value}\n`
    output += `Section: ${params.section}\n`

    if (existing && existing !== params.value) {
      output += `\nPrevious value: ${existing}`
    }

    return {
      title: `${action} ${params.key}`,
      output,
      metadata: {
        key: params.key,
        value: params.value,
        section: params.section,
        action: action.toLowerCase(),
        previousValue: existing,
      },
    }
  },
})
