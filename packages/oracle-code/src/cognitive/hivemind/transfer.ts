/**
 * Hivemind Transfer System
 *
 * Handles import and export of hivemind data for sharing between projects
 * or backing up/restoring hivemind state.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { ulid } from "ulid"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { AFS } from "../../afs"
import { HivemindStore } from "./store"
import { HivemindCouncil } from "./council"
import {
  HivemindExport,
  HivemindEntry,
  HivemindScope,
  HivemindCategory,
  ImportOptions,
  ImportResult,
  categoryToArrayKey,
} from "./types"

export namespace HivemindTransfer {
  // =============
  // Constants
  // =============

  const EXPORT_VERSION = "1.0.0"

  // =============
  // Bus Events
  // =============

  export const Event = {
    Exported: BusEvent.define(
      "hivemind.transfer.exported",
      z.object({
        scope: HivemindScope,
        entryCount: z.number(),
        path: z.string().optional(),
      })
    ),
    Imported: BusEvent.define(
      "hivemind.transfer.imported",
      z.object({
        scope: HivemindScope,
        imported: z.number(),
        skipped: z.number(),
        conflicts: z.number(),
      })
    ),
  } as const

  // =============
  // Export
  // =============

  /**
   * Export hivemind data
   */
  export async function exportHivemind(
    scope: HivemindScope,
    options?: {
      categories?: HivemindCategory[]
      includeGoldenOnly?: boolean
      includeDecaying?: boolean
    },
    contextRoot?: string
  ): Promise<HivemindExport> {
    const state = await HivemindStore.getState(contextRoot, scope)
    const root = contextRoot || (await AFS.getRoot())

    let entries: HivemindEntry[] = []

    // Collect entries from specified categories or all
    const categories = options?.categories || [
      "fear",
      "satisfaction",
      "knowledge",
      "decision",
      "preference",
    ]

    for (const category of categories) {
      const arrayKey = categoryToArrayKey[category]
      let categoryEntries = state[arrayKey]

      // Filter by status if specified
      if (options?.includeGoldenOnly) {
        categoryEntries = categoryEntries.filter((e) => e.status === "golden")
      }
      if (!options?.includeDecaying) {
        categoryEntries = categoryEntries.filter((e) => e.status !== "decaying")
      }

      entries.push(...categoryEntries)
    }

    const exportData: HivemindExport = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedFrom: root,
      scope,
      entries,
      manifest: {
        version: state.manifest.version,
        stats: state.manifest.stats,
        decay: state.manifest.decay,
        council: state.manifest.council,
      },
    }

    Bus.publish(Event.Exported, {
      scope,
      entryCount: entries.length,
    })

    return exportData
  }

  /**
   * Export hivemind to a file
   */
  export async function exportToFile(
    filePath: string,
    scope: HivemindScope,
    options?: {
      categories?: HivemindCategory[]
      includeGoldenOnly?: boolean
      includeDecaying?: boolean
      pretty?: boolean
    },
    contextRoot?: string
  ): Promise<void> {
    const exportData = await exportHivemind(scope, options, contextRoot)

    // Ensure directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const content = options?.pretty
      ? JSON.stringify(exportData, null, 2)
      : JSON.stringify(exportData)

    await fs.writeFile(filePath, content)

    Bus.publish(Event.Exported, {
      scope,
      entryCount: exportData.entries.length,
      path: filePath,
    })
  }

  // =============
  // Validation
  // =============

  /**
   * Validate export data structure
   */
  export function validateExport(data: unknown): data is HivemindExport {
    const result = HivemindExport.safeParse(data)
    return result.success
  }

  /**
   * Get validation errors for export data
   */
  export function getValidationErrors(data: unknown): string[] {
    const result = HivemindExport.safeParse(data)
    if (result.success) return []

    // Zod v4 uses .issues instead of .errors
    const issues = (result.error as any).issues || (result.error as any).errors || []
    return issues.map(
      (e: { path: (string | number)[]; message: string }) => 
        `${e.path.join(".")}: ${e.message}`
    )
  }

  // =============
  // Import Preview
  // =============

  export interface ImportPreview {
    totalEntries: number
    byCategory: Record<string, number>
    conflicts: Array<{
      importKey: string
      importValue: string
      existingKey: string
      existingValue: string
      category: HivemindCategory
    }>
    newEntries: number
    goldenEntries: number
  }

  /**
   * Preview what would happen if import is executed
   */
  export async function previewImport(
    data: HivemindExport,
    options: ImportOptions,
    contextRoot?: string
  ): Promise<ImportPreview> {
    const existingState = await HivemindStore.getState(contextRoot, options.targetScope)

    const byCategory: Record<string, number> = {}
    const conflicts: ImportPreview["conflicts"] = []
    let newEntries = 0
    let goldenEntries = 0

    for (const entry of data.entries) {
      // Count by category
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1

      // Count golden
      if (entry.status === "golden") goldenEntries++

      // Check for conflicts
      const arrayKey = categoryToArrayKey[entry.category]
      const existing = existingState[arrayKey].find(
        (e) => e.key === entry.key
      )

      if (existing) {
        conflicts.push({
          importKey: entry.key,
          importValue: entry.value,
          existingKey: existing.key,
          existingValue: existing.value,
          category: entry.category,
        })
      } else {
        newEntries++
      }
    }

    return {
      totalEntries: data.entries.length,
      byCategory,
      conflicts,
      newEntries,
      goldenEntries,
    }
  }

  // =============
  // Import
  // =============

  /**
   * Import hivemind data
   */
  export async function importHivemind(
    data: HivemindExport,
    options: ImportOptions,
    parentSessionId?: string,
    contextRoot?: string
  ): Promise<ImportResult> {
    // Validate first
    if (!validateExport(data)) {
      return {
        imported: 0,
        skipped: 0,
        conflicts: 0,
        errors: getValidationErrors(data),
      }
    }

    const existingState = await HivemindStore.getState(contextRoot, options.targetScope)

    let imported = 0
    let skipped = 0
    let conflicts = 0
    const errors: string[] = []

    for (const entry of data.entries) {
      try {
        const arrayKey = categoryToArrayKey[entry.category]
        const existing = existingState[arrayKey].find(
          (e) => e.key === entry.key
        )

        if (existing) {
          // Handle conflict
          conflicts++

          switch (options.conflictResolution) {
            case "skip":
              skipped++
              continue

            case "replace":
              // Update existing entry
              await HivemindStore.updateEntry(
                existing.id,
                {
                  value: entry.value,
                  confidence: entry.confidence,
                  status: options.preserveGolden && entry.status === "golden"
                    ? "golden"
                    : existing.status,
                  decay: options.preserveDecay
                    ? entry.decay
                    : {
                        lastAccessed: new Date().toISOString(),
                        accessCount: 0,
                        decayRate: entry.decay.decayRate,
                      },
                },
                contextRoot
              )
              imported++
              break

            case "council":
              // Create council session to resolve conflict
              if (parentSessionId) {
                await HivemindCouncil.createSession(
                  "conflict",
                  entry.key,
                  `Import conflict: existing value differs from imported value`,
                  existing.value,
                  entry.value,
                  undefined,
                  contextRoot
                )
              }
              skipped++ // Skip for now, council will decide
              break
          }
        } else {
          // New entry - import it
          const { id: _id, ...entryWithoutId } = entry

          await HivemindStore.addEntry(
            {
              ...entryWithoutId,
              scope: options.targetScope,
              status: options.preserveGolden && entry.status === "golden"
                ? "golden"
                : "active",
              decay: options.preserveDecay
                ? entry.decay
                : {
                    lastAccessed: new Date().toISOString(),
                    accessCount: 0,
                    decayRate: entry.decay.decayRate,
                  },
              golden: options.preserveGolden && entry.golden
                ? entry.golden
                : undefined,
            },
            contextRoot
          )
          imported++
        }
      } catch (error) {
        errors.push(`Failed to import ${entry.key}: ${error}`)
      }
    }

    Bus.publish(Event.Imported, {
      scope: options.targetScope,
      imported,
      skipped,
      conflicts,
    })

    return { imported, skipped, conflicts, errors }
  }

  /**
   * Import hivemind from a file
   */
  export async function importFromFile(
    filePath: string,
    options: ImportOptions,
    parentSessionId?: string,
    contextRoot?: string
  ): Promise<ImportResult> {
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(content)

      return importHivemind(data, options, parentSessionId, contextRoot)
    } catch (error) {
      return {
        imported: 0,
        skipped: 0,
        conflicts: 0,
        errors: [`Failed to read file: ${error}`],
      }
    }
  }

  // =============
  // Merge
  // =============

  /**
   * Merge two hivemind exports (for combining from multiple sources)
   */
  export function mergeExports(
    primary: HivemindExport,
    secondary: HivemindExport,
    options?: {
      preferPrimary?: boolean
      dedupeByKey?: boolean
    }
  ): HivemindExport {
    const { preferPrimary = true, dedupeByKey = true } = options || {}

    let entries: HivemindEntry[]

    if (dedupeByKey) {
      // Use a map to dedupe by key
      const entryMap = new Map<string, HivemindEntry>()

      // Add secondary first (so primary can override if preferPrimary)
      const first = preferPrimary ? secondary.entries : primary.entries
      const second = preferPrimary ? primary.entries : secondary.entries

      for (const entry of first) {
        entryMap.set(`${entry.category}:${entry.key}`, entry)
      }
      for (const entry of second) {
        entryMap.set(`${entry.category}:${entry.key}`, entry)
      }

      entries = Array.from(entryMap.values())
    } else {
      entries = [...primary.entries, ...secondary.entries]
    }

    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedFrom: `merged:${primary.exportedFrom}+${secondary.exportedFrom}`,
      scope: primary.scope,
      entries,
      manifest: primary.manifest,
    }
  }

  // =============
  // Backup/Restore
  // =============

  /**
   * Create a full backup of both project and global hivemind
   */
  export async function createBackup(
    backupDir: string,
    contextRoot?: string
  ): Promise<{ project: string; global?: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    await fs.mkdir(backupDir, { recursive: true })

    // Backup project hivemind
    const projectPath = path.join(backupDir, `hivemind-project-${timestamp}.json`)
    await exportToFile(
      projectPath,
      "project",
      { pretty: true, includeDecaying: true },
      contextRoot
    )

    // Backup global if enabled
    let globalPath: string | undefined
    const manifest = await HivemindStore.getManifest(contextRoot)
    if (manifest.globalEnabled) {
      try {
        globalPath = path.join(backupDir, `hivemind-global-${timestamp}.json`)
        await exportToFile(globalPath, "global", { pretty: true, includeDecaying: true })
      } catch {
        // Global backup failed, continue without it
      }
    }

    return { project: projectPath, global: globalPath }
  }

  /**
   * Restore from a backup file
   */
  export async function restoreFromBackup(
    backupPath: string,
    options?: {
      clearExisting?: boolean
      scope?: HivemindScope
    },
    contextRoot?: string
  ): Promise<ImportResult> {
    const { clearExisting = false, scope } = options || {}

    // Read backup
    const content = await fs.readFile(backupPath, "utf-8")
    const data = JSON.parse(content) as HivemindExport

    // Determine target scope
    const targetScope = scope || data.scope

    // Clear existing if requested
    if (clearExisting) {
      const state = await HivemindStore.getState(contextRoot, targetScope)
      for (const arrayKey of Object.values(categoryToArrayKey)) {
        for (const entry of state[arrayKey]) {
          await HivemindStore.removeEntry(entry.id, contextRoot)
        }
      }
    }

    // Import
    return importHivemind(
      data,
      {
        targetScope,
        conflictResolution: clearExisting ? "replace" : "skip",
        preserveGolden: true,
        preserveDecay: true,
      },
      undefined,
      contextRoot
    )
  }
}
