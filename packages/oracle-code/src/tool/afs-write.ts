import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { AFS } from "../afs"
import DESCRIPTION from "./afs-write.txt"

export const AfsWriteTool = Tool.define("afs_write", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Path relative to .context/scratchpad/"),
    content: z.string().describe("Content to write to the file"),
  }),
  async execute(params, ctx) {
    const root = await AFS.getRoot()

    // Resolve the path - always relative to scratchpad
    let resolvedPath: string
    if (path.isAbsolute(params.filePath)) {
      resolvedPath = params.filePath
    } else if (params.filePath.startsWith("scratchpad/")) {
      resolvedPath = path.join(root, params.filePath)
    } else {
      resolvedPath = path.join(root, "scratchpad", params.filePath)
    }

    // Verify path is within AFS
    if (!AFS.isAfsPath(root, resolvedPath)) {
      throw new Error(
        `Path "${params.filePath}" resolves outside the AFS directory.\nUse the regular 'write' tool for files outside AFS.`,
      )
    }

    // Check policy - only scratchpad is writable
    const dirName = AFS.getDirectoryName(root, resolvedPath)
    if (dirName !== "scratchpad") {
      const policy = dirName ? AFS.DIRECTORIES[dirName].policy : "unknown"
      throw new Error(
        `Cannot write to ${dirName ?? "this location"}: policy is "${policy}".\n\n` +
          `Only the scratchpad/ directory is writable.\n` +
          `Writable path example: scratchpad/notes.md\n\n` +
          `AFS Directory Policies:\n` +
          Object.entries(AFS.DIRECTORIES)
            .map(([name, info]) => `  - ${name}/: ${info.policy}`)
            .join("\n"),
      )
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(resolvedPath)
    await fs.mkdir(parentDir, { recursive: true })

    // Check if file exists (for output message)
    const existed = await Bun.file(resolvedPath).exists()

    // Write the file
    await Bun.write(resolvedPath, params.content)

    const relativePath = path.relative(root, resolvedPath)
    const lines = params.content.split("\n").length
    const size = Buffer.byteLength(params.content, "utf8")

    return {
      title: relativePath,
      output: `${existed ? "Updated" : "Created"} ${relativePath}\n${lines} lines, ${formatSize(size)}`,
      metadata: {
        path: relativePath,
        created: !existed,
        lines,
        size,
        preview: params.content.slice(0, 200) + (params.content.length > 200 ? "..." : ""),
      },
    }
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
