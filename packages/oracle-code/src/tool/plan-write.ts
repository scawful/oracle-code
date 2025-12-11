import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { AFS } from "../afs"
import DESCRIPTION from "./plan-write.txt"

export const PlanWriteTool = Tool.define("plan_write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("Plan content in markdown format"),
    append: z.boolean().optional().default(false).describe("Append to existing plan instead of replacing"),
  }),
  async execute(params, ctx) {
    const root = await AFS.getRoot()
    const planPath = AFS.getPlanPath(root)

    // Ensure scratchpad directory exists
    const scratchpadDir = path.dirname(planPath)
    await fs.mkdir(scratchpadDir, { recursive: true })

    // Check if plan exists
    const file = Bun.file(planPath)
    const existed = await file.exists()
    let finalContent: string

    if (params.append && existed) {
      const existingContent = await file.text()
      const timestamp = new Date().toISOString().split("T")[0]
      finalContent = existingContent + `\n\n---\n_Updated: ${timestamp}_\n\n` + params.content
    } else {
      finalContent = params.content
    }

    // Write the plan
    await Bun.write(planPath, finalContent)

    const relativePath = path.relative(root, planPath)
    const lines = finalContent.split("\n").length
    const size = Buffer.byteLength(finalContent, "utf8")

    // Extract first heading as preview
    const headingMatch = finalContent.match(/^#\s+(.+)$/m)
    const preview = headingMatch ? headingMatch[1] : finalContent.slice(0, 100)

    return {
      title: "plan.md",
      output: `${params.append ? "Appended to" : existed ? "Updated" : "Created"} plan.md\n${lines} lines, ${formatSize(size)}`,
      metadata: {
        path: relativePath,
        created: !existed,
        appended: params.append && existed,
        lines,
        size,
        preview,
      },
    }
  },
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
