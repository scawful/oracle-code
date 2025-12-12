import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import { HivemindScope } from "../cognitive/hivemind"
import { HivemindTransfer } from "../cognitive/hivemind/transfer"
import DESCRIPTION from "./hivemind-transfer.txt"

const ConflictResolution = z.enum(["skip", "replace", "council"])

export const HivemindTransferTool = Tool.define("hivemind_transfer", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["export", "import", "backup", "restore"]).describe("Operation: export, import, backup, or restore"),
    filePath: z.string().optional().describe("Path to the file (required for export/import)"),
    scope: HivemindScope.optional().describe("Scope to export: project or global"),
    conflictResolution: ConflictResolution.optional().default("skip").describe("How to handle import conflicts"),
    preserveGolden: z.boolean().optional().default(true).describe("Keep golden status on import"),
    categories: z.array(z.string()).optional().describe("Filter export to specific categories"),
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
          action: params.action,
        },
      }
    }

    try {
      switch (params.action) {
        case "export": {
          if (!params.filePath) {
            return {
              title: "Export Failed",
              output: "File path is required for export.",
              metadata: {
                success: false,
                action: "export",
              },
            }
          }

          const scope: "project" | "global" = params.scope || "project"
          
          await HivemindTransfer.exportToFile(
            params.filePath,
            scope,
            params.categories ? { categories: params.categories as any[] } : undefined,
            root
          )

          // Get count
          const exportData = await HivemindTransfer.exportHivemind(scope, undefined, root)

          return {
            title: "Export Complete",
            output: `Successfully exported hivemind entries:\n\n**File**: ${params.filePath}\n**Scope**: ${scope}\n**Entries**: ${exportData.entries.length}\n**Exported At**: ${exportData.exportedAt}`,
            metadata: {
              success: true,
              action: "export",
              filePath: params.filePath,
              count: exportData.entries.length,
              scope,
            },
          }
        }

        case "import": {
          if (!params.filePath) {
            return {
              title: "Import Failed",
              output: "File path is required for import.",
              metadata: {
                success: false,
                action: "import",
              },
            }
          }

          const targetScope: "project" | "global" = params.scope || "project"

          // Perform import
          const result = await HivemindTransfer.importFromFile(
            params.filePath,
            {
              targetScope,
              conflictResolution: params.conflictResolution || "skip",
              preserveGolden: params.preserveGolden ?? true,
              preserveDecay: false,
            },
            ctx.sessionID,
            root
          )

          const lines: string[] = []
          lines.push("## Import Complete")
          lines.push("")
          lines.push(`**Imported**: ${result.imported} entries`)
          lines.push(`**Skipped**: ${result.skipped} entries`)
          lines.push(`**Conflicts**: ${result.conflicts}`)
          if (result.errors.length > 0) {
            lines.push("")
            lines.push("### Errors")
            for (const err of result.errors) {
              lines.push(`- ${err}`)
            }
          }

          return {
            title: "Import Complete",
            output: lines.join("\n"),
            metadata: {
              success: true,
              action: "import",
              imported: result.imported,
              skipped: result.skipped,
              conflicts: result.conflicts,
            },
          }
        }

        case "backup": {
          // Use root's parent as backup directory, or a default location
          const backupDir = `${root}/backups`
          const backupResult = await HivemindTransfer.createBackup(backupDir, root)

          return {
            title: "Backup Created",
            output: `Successfully created hivemind backup:\n\n**Project**: ${backupResult.project}${backupResult.global ? `\n**Global**: ${backupResult.global}` : ""}`,
            metadata: {
              success: true,
              action: "backup",
              backupPath: backupResult.project,
            },
          }
        }

        case "restore": {
          if (!params.filePath) {
            return {
              title: "Restore Failed",
              output: "File path is required for restore.",
              metadata: {
                success: false,
                action: "restore",
              },
            }
          }

          const restoreResult = await HivemindTransfer.restoreFromBackup(
            params.filePath,
            { scope: params.scope },
            root
          )

          return {
            title: "Restore Complete",
            output: `Successfully restored hivemind from backup:\n\n**File**: ${params.filePath}\n**Imported**: ${restoreResult.imported}`,
            metadata: {
              success: true,
              action: "restore",
              filePath: params.filePath,
            },
          }
        }

        default:
          return {
            title: "Unknown Action",
            output: `Unknown action: ${params.action}`,
            metadata: {
              success: false,
              action: String(params.action),
            },
          }
      }
    } catch (error) {
      return {
        title: `${capitalize(params.action)} Failed`,
        output: `Failed to ${params.action}: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          success: false,
          action: params.action,
        },
      }
    }
  },
})

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
