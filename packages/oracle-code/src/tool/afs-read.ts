import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { AFS } from "../afs"
import DESCRIPTION from "./afs-read.txt"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export const AfsReadTool = Tool.define("afs_read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Path relative to .context/ or absolute path within AFS"),
    offset: z.coerce.number().optional().describe("Line number to start reading from (1-based)"),
    limit: z.coerce.number().optional().describe("Number of lines to read (default: 2000)"),
  }),
  async execute(params, ctx) {
    const root = await AFS.getRoot()
    const resolvedPath = AFS.resolvePath(root, params.filePath)

    // Verify the path is within AFS
    if (!AFS.isAfsPath(root, resolvedPath)) {
      throw new Error(
        `Path "${params.filePath}" is not within the AFS (.context/) directory.\nUse the regular 'read' tool for files outside AFS.`,
      )
    }

    const file = Bun.file(resolvedPath)
    if (!(await file.exists())) {
      // Try to suggest similar files
      const dirName = AFS.getDirectoryName(root, resolvedPath)
      if (dirName) {
        const files = await AFS.listDirectory(root, dirName, true)
        const suggestions = files
          .filter((f) => !f.isDirectory)
          .map((f) => f.relativePath)
          .slice(0, 5)

        if (suggestions.length > 0) {
          throw new Error(
            `File not found: ${params.filePath}\n\nAvailable files in ${dirName}/:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`,
          )
        }
      }
      throw new Error(`File not found: ${params.filePath}`)
    }

    const relativePath = path.relative(root, resolvedPath)
    const dirName = AFS.getDirectoryName(root, resolvedPath)
    const policy = dirName ? AFS.DIRECTORIES[dirName].policy : "unknown"

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = (params.offset ?? 1) - 1 // Convert to 0-based
    const lines = await file.text().then((text) => text.split("\n"))

    const raw = lines.slice(offset, offset + limit).map((line) => {
      return line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
    })

    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })

    let output = `<afs-file path="${relativePath}" policy="${policy}">\n`
    output += content.join("\n")

    const totalLines = lines.length
    const lastReadLine = offset + content.length
    const hasMoreLines = totalLines > lastReadLine

    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</afs-file>"

    return {
      title: relativePath,
      output,
      metadata: {
        policy,
        directory: dirName,
        totalLines,
        linesRead: content.length,
        preview: raw.slice(0, 10).join("\n"),
      },
    }
  },
})
