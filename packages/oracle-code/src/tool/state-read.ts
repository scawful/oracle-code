import z from "zod"
import { Tool } from "./tool"
import { State } from "../state"
import { AFS } from "../afs"
import DESCRIPTION from "./state-read.txt"

export const StateReadTool = Tool.define("state_read", {
  description: DESCRIPTION,
  parameters: z.object({
    key: z.string().optional().describe("Specific key to read. Omit to read all state."),
    section: State.Section.optional().describe("Filter by section (facts, assumptions, decisions, etc.)"),
  }),
  async execute(params) {
    const root = await AFS.findRoot()
    if (!root) {
      return {
        title: "State Not Found",
        output: "AFS not initialized. No .context directory found.\nRun 'codewizard afs init' to initialize.",
        metadata: {
          exists: false,
          count: 0,
          key: undefined as string | undefined,
          value: undefined as string | undefined,
          found: undefined as boolean | undefined,
          section: undefined as string | undefined,
          sections: [] as string[],
          lastUpdated: undefined as string | undefined,
        },
      }
    }

    // If specific key requested
    if (params.key) {
      const value = await State.get(root, params.key)
      if (value) {
        return {
          title: params.key,
          output: `**${params.key}**: ${value}`,
          metadata: {
            exists: true,
            count: 1,
            key: params.key,
            value,
            found: true,
            section: undefined as string | undefined,
            sections: [] as string[],
            lastUpdated: undefined as string | undefined,
          },
        }
      }
      return {
        title: params.key,
        output: `Key '${params.key}' not found in shared state.`,
        metadata: {
          exists: true,
          count: 0,
          key: params.key,
          value: undefined as string | undefined,
          found: false,
          section: undefined as string | undefined,
          sections: [] as string[],
          lastUpdated: undefined as string | undefined,
        },
      }
    }

    // Read all or filtered by section
    const data = await State.getData(root)
    if (!data || data.entries.length === 0) {
      return {
        title: "Empty State",
        output: "No shared state entries found.\nUse state_write to add entries.",
        metadata: {
          exists: true,
          count: 0,
          key: undefined as string | undefined,
          value: undefined as string | undefined,
          found: undefined as boolean | undefined,
          section: undefined as string | undefined,
          sections: [] as string[],
          lastUpdated: undefined as string | undefined,
        },
      }
    }

    let entries = data.entries
    if (params.section) {
      entries = entries.filter((e) => e.section === params.section)
      if (entries.length === 0) {
        return {
          title: `No ${params.section}`,
          output: `No entries found in section '${params.section}'.`,
          metadata: {
            exists: true,
            count: 0,
            key: undefined as string | undefined,
            value: undefined as string | undefined,
            found: undefined as boolean | undefined,
            section: params.section,
            sections: [] as string[],
            lastUpdated: undefined as string | undefined,
          },
        }
      }
    }

    // Group by section
    const sections = new Map<State.Section, State.StateEntry[]>()
    for (const entry of entries) {
      const list = sections.get(entry.section) || []
      list.push(entry)
      sections.set(entry.section, list)
    }

    let output = ""
    for (const section of State.Section.options) {
      const sectionEntries = sections.get(section)
      if (!sectionEntries?.length) continue

      output += `## ${section.charAt(0).toUpperCase() + section.slice(1)}\n`
      for (const entry of sectionEntries) {
        output += `- **${entry.key}**: ${entry.value} [${entry.timestamp}]\n`
      }
      output += "\n"
    }

    return {
      title: "Shared State",
      output: output.trim(),
      metadata: {
        exists: true,
        count: entries.length,
        key: undefined as string | undefined,
        value: undefined as string | undefined,
        found: undefined as boolean | undefined,
        section: params.section,
        sections: [...sections.keys()],
        lastUpdated: data.lastUpdated,
      },
    }
  },
})
