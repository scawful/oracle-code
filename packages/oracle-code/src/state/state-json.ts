import path from "path"
import fs from "fs/promises"
import { AFS } from "../afs"
import { State } from "./index"
import { CognitiveIntegration } from "../cognitive/integration"

export namespace StateJson {
  interface CanonicalState {
    schema_version: string
    producer: { name: string; version?: string }
    last_updated: string
    entries: Array<{
      key: string
      value: string
      section: State.Section
      timestamp: string
    }>
  }

  function applyMetadata(state: CanonicalState): CanonicalState {
    return {
      schema_version: state.schema_version || "0.3",
      producer: state.producer || { name: "oracle-code", version: "unknown" },
      last_updated: new Date().toISOString(),
      entries: state.entries,
    }
  }

  function getPath(root: string): string {
    return path.join(root, "scratchpad", "state.json")
  }

  export async function read(root?: string): Promise<CanonicalState | null> {
    const contextRoot = root ?? (await AFS.findRoot())
    if (!contextRoot) return null
    const filePath = getPath(contextRoot)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content) as CanonicalState
    } catch {
      return null
    }
  }

  export async function write(root: string, data: CanonicalState): Promise<void> {
    const filePath = getPath(root)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const withMeta = applyMetadata(data)
    await fs.writeFile(filePath, JSON.stringify(withMeta, null, 2))
  }

  /**
   * Sync state.md from state.json (canonical -> rendered)
   */
  export async function renderToMarkdown(root: string): Promise<void> {
    const canonical = await read(root)
    if (!canonical) return
    const data: State.StateData = {
      entries: canonical.entries.map((e) => ({
        key: e.key,
        value: e.value,
        timestamp: e.timestamp,
        section: e.section,
      })),
      lastUpdated: canonical.last_updated,
    }
    const cognitiveExport = await CognitiveIntegration.getStateMdExport()
    const md = State.serialize(data, cognitiveExport)
    await fs.writeFile(State.getStatePath(root), md)
  }

  /**
   * Sync state.json from state.md (rendered -> canonical) when present.
   */
  export async function ingestFromMarkdown(root: string): Promise<void> {
    const data = await State.getData(root)
    if (!data) return
    const canonical: CanonicalState = applyMetadata({
      schema_version: "0.3",
      producer: { name: "oracle-code", version: "unknown" },
      last_updated: data.lastUpdated,
      entries: data.entries.map((e) => ({
        key: e.key,
        value: e.value,
        section: e.section,
        timestamp: e.timestamp,
      })),
    })
    await write(root, canonical)
  }
}
