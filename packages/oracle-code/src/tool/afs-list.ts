import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import DESCRIPTION from "./afs-list.txt"

export const AfsListTool = Tool.define("afs_list", {
  description: DESCRIPTION,
  parameters: z.object({
    directory: z
      .enum(["memory", "knowledge", "tools", "scratchpad", "history"])
      .optional()
      .describe("Specific AFS directory to list. Omit to list all directories."),
    recursive: z.boolean().optional().default(false).describe("Whether to list files recursively"),
  }),
  async execute(params, ctx) {
    const root = await AFS.findRoot()

    if (!root) {
      return {
        title: "AFS Not Found",
        output: `AFS not initialized. No .context directory found.\nRun 'codewizard afs init' to initialize the Agentic File System.`,
        metadata: {
          exists: false,
          root: "",
          totalFiles: 0,
          directories: 0,
        },
      }
    }

    const status = await AFS.getStatus(root)
    let output = ""
    let totalFiles = 0

    const directoriesToList = params.directory
      ? status.directories.filter((d) => d.name === params.directory)
      : status.directories

    for (const dir of directoriesToList) {
      const policyIcon =
        dir.policy === "writable" ? "[W]" : dir.policy === "executable" ? "[X]" : "[R]"

      output += `\n${policyIcon} ${dir.name}/ (${dir.policy})\n`

      if (!dir.exists) {
        output += `    (directory not created)\n`
        continue
      }

      const files = params.recursive
        ? await AFS.listDirectory(root, dir.name as AFS.DirectoryName, true)
        : dir.files

      if (files.length === 0) {
        output += `    (empty)\n`
      } else {
        for (const file of files) {
          const icon = file.isDirectory ? "📁" : "📄"
          const size = file.isDirectory ? "" : ` (${formatSize(file.size)})`
          const displayPath = params.recursive ? file.relativePath : file.name
          output += `    ${icon} ${displayPath}${size}\n`
          if (!file.isDirectory) totalFiles++
        }
      }
    }

    const title = params.directory ? `AFS: ${params.directory}/` : "AFS Status"

    return {
      title,
      output: output.trim(),
      metadata: {
        exists: true,
        root,
        totalFiles,
        directories: directoriesToList.length,
      },
    }
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
