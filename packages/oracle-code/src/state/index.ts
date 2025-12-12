import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { AFS } from "../afs"
import { CognitiveIntegration } from "../cognitive/integration"

export namespace State {
  export const Event = {
    Updated: BusEvent.define(
      "state.updated",
      z.object({
        root: z.string(),
        key: z.string().optional(),
        value: z.string().optional(),
      }),
    ),
  }

  export const Section = z.enum([
    "facts", // Confirmed information
    "assumptions", // Working assumptions
    "decisions", // Architectural/design decisions
    "uncertainties", // Areas needing clarification
    "goals", // Current objectives
    "context", // Environmental context
  ])
  export type Section = z.infer<typeof Section>

  export interface StateEntry {
    key: string
    value: string
    timestamp: string
    section: Section
  }

  export interface StateData {
    entries: StateEntry[]
    lastUpdated: string
  }

  /**
   * Get the state file path
   */
  export function getStatePath(contextRoot: string): string {
    return path.join(contextRoot, "scratchpad", "state.md")
  }

  /**
   * Parse state.md content into structured data
   */
  export function parse(content: string): StateData {
    const entries: StateEntry[] = []
    let currentSection: Section = "context"
    const lines = content.split("\n")

    for (const line of lines) {
      // Check for section headers
      const sectionMatch = line.match(/^##\s+(\w+)$/i)
      if (sectionMatch) {
        const section = sectionMatch[1].toLowerCase()
        if (Section.safeParse(section).success) {
          currentSection = section as Section
        }
        continue
      }

      // Parse key-value entries: - **key**: value [timestamp]
      const entryMatch = line.match(/^-\s+\*\*([^*]+)\*\*:\s+(.+?)(?:\s+\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2})\])?$/)
      if (entryMatch) {
        entries.push({
          key: entryMatch[1].trim(),
          value: entryMatch[2].trim(),
          timestamp: entryMatch[3] || new Date().toISOString().slice(0, 16),
          section: currentSection,
        })
      }
    }

    return {
      entries,
      lastUpdated: new Date().toISOString(),
    }
  }

  /**
   * Serialize state data to markdown format
   */
  export function serialize(data: StateData, cognitiveExport?: string | null): string {
    const sections = new Map<Section, StateEntry[]>()

    for (const entry of data.entries) {
      const list = sections.get(entry.section) || []
      list.push(entry)
      sections.set(entry.section, list)
    }

    let content = `# Shared State\n\n_Last updated: ${data.lastUpdated}_\n\n`

    for (const section of Section.options) {
      const entries = sections.get(section)
      if (!entries?.length) continue

      content += `## ${section.charAt(0).toUpperCase() + section.slice(1)}\n\n`
      for (const entry of entries) {
        content += `- **${entry.key}**: ${entry.value} [${entry.timestamp}]\n`
      }
      content += "\n"
    }

    // Append cognitive state export if provided
    if (cognitiveExport) {
      content += "---\n\n"
      content += "# Cognitive Protocol State\n\n"
      content += cognitiveExport
    }

    return content
  }

  /**
   * Read the current state as raw content
   */
  export async function read(contextRoot: string): Promise<string | null> {
    const statePath = getStatePath(contextRoot)
    try {
      return await Bun.file(statePath).text()
    } catch {
      return null
    }
  }

  /**
   * Read and parse the current state
   */
  export async function getData(contextRoot: string): Promise<StateData | null> {
    const content = await read(contextRoot)
    if (!content) return null
    return parse(content)
  }

  /**
   * Get a specific key from state
   */
  export async function get(contextRoot: string, key: string): Promise<string | null> {
    const data = await getData(contextRoot)
    if (!data) return null
    const entry = data.entries.find((e) => e.key.toLowerCase() === key.toLowerCase())
    return entry?.value ?? null
  }

  /**
   * Get all entries for a specific section
   */
  export async function getSection(contextRoot: string, section: Section): Promise<StateEntry[]> {
    const data = await getData(contextRoot)
    if (!data) return []
    return data.entries.filter((e) => e.section === section)
  }

  /**
   * Set a key-value pair in state
   */
  export async function set(
    contextRoot: string,
    key: string,
    value: string,
    section: Section = "context",
  ): Promise<void> {
    const statePath = getStatePath(contextRoot)
    const scratchpadDir = path.dirname(statePath)
    await fs.mkdir(scratchpadDir, { recursive: true })

    let data = (await getData(contextRoot)) || { entries: [], lastUpdated: "" }

    // Update or add entry
    const existingIdx = data.entries.findIndex((e) => e.key.toLowerCase() === key.toLowerCase())
    const newEntry: StateEntry = {
      key,
      value,
      timestamp: new Date().toISOString().slice(0, 16),
      section,
    }

    if (existingIdx >= 0) {
      data.entries[existingIdx] = newEntry
    } else {
      data.entries.push(newEntry)
    }

    data.lastUpdated = new Date().toISOString()
    
    // Include cognitive export when writing state
    const cognitiveExport = await CognitiveIntegration.getStateMdExport()
    await Bun.write(statePath, serialize(data, cognitiveExport))

    Bus.publish(Event.Updated, {
      root: contextRoot,
      key,
      value,
    })
  }

  /**
   * Remove a key from state
   */
  export async function remove(contextRoot: string, key: string): Promise<boolean> {
    const data = await getData(contextRoot)
    if (!data) return false

    const idx = data.entries.findIndex((e) => e.key.toLowerCase() === key.toLowerCase())
    if (idx < 0) return false

    data.entries.splice(idx, 1)
    data.lastUpdated = new Date().toISOString()

    const statePath = getStatePath(contextRoot)
    await Bun.write(statePath, serialize(data))

    Bus.publish(Event.Updated, { root: contextRoot })
    return true
  }

  /**
   * Sync state - write current understanding to state.md
   * Includes cognitive protocol state (metacognition, goals, knowledge)
   */
  export async function sync(contextRoot: string): Promise<void> {
    const data = (await getData(contextRoot)) || { entries: [], lastUpdated: "" }
    data.lastUpdated = new Date().toISOString()

    // Get cognitive state export
    const cognitiveExport = await CognitiveIntegration.getStateMdExport()

    const statePath = getStatePath(contextRoot)
    const scratchpadDir = path.dirname(statePath)
    await fs.mkdir(scratchpadDir, { recursive: true })
    await Bun.write(statePath, serialize(data, cognitiveExport))

    Bus.publish(Event.Updated, { root: contextRoot })
  }

  /**
   * Clear all state
   */
  export async function clear(contextRoot: string): Promise<void> {
    const statePath = getStatePath(contextRoot)
    try {
      await fs.unlink(statePath)
    } catch {
      // File doesn't exist
    }
    Bus.publish(Event.Updated, { root: contextRoot })
  }

  /**
   * List all keys in state
   */
  export async function keys(contextRoot: string): Promise<string[]> {
    const data = await getData(contextRoot)
    if (!data) return []
    return data.entries.map((e) => e.key)
  }
}
