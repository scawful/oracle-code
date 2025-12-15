import z from "zod"
import { Tool } from "./tool"
import { AFS } from "../afs"
import { HivemindStore, HivemindDecay, HivemindCategory, HivemindScope, GlobalFilter } from "../cognitive/hivemind"
import DESCRIPTION from "./hivemind-manage.txt"

const ActionSchema = z.enum([
  "create",      // Create a new entry (same as promote)
  "read",        // Read entries by various filters
  "update",      // Update an existing entry
  "delete",      // Delete entries by key
  "merge",       // Merge multiple entries into one
  "find_duplicates", // Find potential duplicate entries
  "set_filter",  // Set global filter for project
])

const ParamsSchema = z.object({
  action: ActionSchema.describe("The operation to perform"),
  
  // For create/update
  category: HivemindCategory.optional().describe("Type: fear, satisfaction, knowledge, decision, preference"),
  key: z.string().optional().describe("Entry identifier"),
  value: z.string().optional().describe("Entry content"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence level (0-1)"),
  reason: z.string().optional().describe("Reason for the operation"),
  scope: HivemindScope.optional().describe("Scope: project or global"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
  requestGolden: z.boolean().optional().describe("Request golden (permanent) status"),
  
  // For delete/merge
  keys: z.array(z.string()).optional().describe("List of keys to delete or merge"),
  targetKey: z.string().optional().describe("Target key for merge operation"),
  mergedValue: z.string().optional().describe("Merged value for merge operation"),
  
  // For read
  search: z.string().optional().describe("Search query for read action"),
  status: z.enum(["active", "golden", "decaying", "contested"]).optional().describe("Filter by status"),
  limit: z.number().optional().default(20).describe("Max entries to return for read"),
  
  // For find_duplicates
  threshold: z.number().min(0).max(1).optional().describe("Similarity threshold for duplicates (0-1)"),
  
  // For set_filter
  filter: z.object({
    includeTags: z.array(z.string()).optional(),
    excludeTags: z.array(z.string()).optional(),
    includeCategories: z.array(HivemindCategory).optional(),
    excludeCategories: z.array(HivemindCategory).optional(),
    includeKeys: z.array(z.string()).optional(),
    excludeKeys: z.array(z.string()).optional(),
  }).optional().describe("Global filter configuration"),
})

type Params = z.infer<typeof ParamsSchema>

export const HivemindManageTool = Tool.define("hivemind_manage", {
  description: DESCRIPTION,
  parameters: ParamsSchema,
  
  async execute(params, ctx): Promise<{
    title: string
    output: string
    metadata: Record<string, unknown>
  }> {
    const root = await AFS.findRoot()
    if (!root) {
      return {
        title: "AFS Not Found",
        output: "No .context directory found. Run 'ocode afs init' to initialize.",
        metadata: { success: false },
      }
    }

    try {
      switch (params.action) {
        case "create":
          return await handleCreate(params, root, ctx)
        case "read":
          return await handleRead(params, root)
        case "update":
          return await handleUpdate(params, root)
        case "delete":
          return await handleDelete(params, root)
        case "merge":
          return await handleMerge(params, root)
        case "find_duplicates":
          return await handleFindDuplicates(params, root)
        case "set_filter":
          return await handleSetFilter(params, root)
        default:
          return {
            title: "Invalid Action",
            output: `Unknown action: ${params.action}\n\nValid actions: create, read, update, delete, merge, find_duplicates, set_filter`,
            metadata: { success: false },
          }
      }
    } catch (error) {
      return {
        title: "Operation Failed",
        output: `Failed to execute ${params.action}: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { success: false, error: String(error) },
      }
    }
  },
})

async function handleCreate(
  params: Params,
  root: string,
  ctx: { sessionID: string; agent?: string }
) {
  if (!params.key || !params.value || !params.category) {
    return {
      title: "Missing Required Fields",
      output: "Action 'create' requires: key, value, category\n\nExample:\n```\nhivemind_manage({\n  action: \"create\",\n  key: \"my_learning\",\n  value: \"What I learned...\",\n  category: \"knowledge\",\n  reason: \"Why this matters\"\n})\n```",
      metadata: { success: false },
    }
  }

  // Check for existing entry
  const existing = await HivemindStore.getEntryByKey(params.key, root, params.scope)
  if (existing) {
    return {
      title: "Entry Exists",
      output: `An entry with key "${params.key}" already exists.\n\nExisting entry:\n- Category: ${existing.category}\n- Value: ${existing.value}\n- Status: ${existing.status}\n\nUse action: "update" to modify it, or choose a different key.`,
      metadata: { success: false, existingEntry: existing },
    }
  }

  const entry = await HivemindStore.addEntry({
    category: params.category,
    scope: params.scope || "project",
    key: params.key,
    value: params.value,
    confidence: params.confidence || 0.8,
    status: params.requestGolden ? "golden" : "active",
    source: {
      sessionId: ctx.sessionID,
      agentRole: ctx.agent || "primary",
      timestamp: new Date().toISOString(),
      promotionReason: params.reason || "Created via hivemind_manage",
    },
    decay: {
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      decayRate: getDecayRate(params.category),
    },
    metadata: { tags: params.tags },
    golden: params.requestGolden ? {
      promotedAt: new Date().toISOString(),
      promotedBy: "user",
    } : undefined,
  }, root)

  return {
    title: "Entry Created",
    output: `Created hivemind entry:\n\n**Key**: ${entry.key}\n**Category**: ${entry.category}\n**Scope**: ${entry.scope}\n**Status**: ${entry.status}\n**Value**: ${entry.value}`,
    metadata: { success: true, entryId: entry.id, action: "created" },
  }
}

async function handleRead(
  params: Params,
  root: string
) {
  let entries: Awaited<ReturnType<typeof HivemindStore.search>> = []
  
  if (params.search) {
    entries = await HivemindStore.search(params.search, root, params.scope)
  } else if (params.category) {
    entries = await HivemindStore.getEntriesByCategory(params.category, root, params.scope)
  } else if (params.status) {
    entries = await HivemindStore.getEntriesByStatus(params.status, root, params.scope)
  } else if (params.key) {
    const entry = await HivemindStore.getEntryByKey(params.key, root, params.scope)
    entries = entry ? [entry] : []
  } else {
    // Get all entries
    const state = await HivemindStore.getCombinedState(root)
    const allEntries: typeof entries = []
    for (const key of ["fears", "satisfactions", "knowledge", "decisions", "preferences"] as const) {
      allEntries.push(...state.project[key])
      if (state.global) {
        // Apply global filter
        const filtered = HivemindStore.applyGlobalFilter(
          state.global[key],
          state.project.manifest.globalFilter
        )
        allEntries.push(...filtered)
      }
    }
    entries = allEntries
  }

  // Apply limit
  entries = entries.slice(0, params.limit || 20)

  if (entries.length === 0) {
    return {
      title: "No Entries Found",
      output: "No hivemind entries match your query.",
      metadata: { success: true, count: 0 },
    }
  }

  const lines = entries.map(e => {
    const golden = e.status === "golden" ? " [GOLDEN]" : ""
    return `- **${e.key}**${golden} (${e.category}): ${e.value.substring(0, 100)}${e.value.length > 100 ? "..." : ""}\n  _Confidence: ${Math.round(e.confidence * 100)}% | Scope: ${e.scope}_`
  })

  return {
    title: `Found ${entries.length} Entries`,
    output: lines.join("\n\n"),
    metadata: { success: true, count: entries.length, entries: entries.map(e => e.key) },
  }
}

async function handleUpdate(
  params: Params,
  root: string
) {
  if (!params.key) {
    return {
      title: "Missing Key",
      output: "Action 'update' requires: key\n\nOptional: value, confidence, tags, requestGolden",
      metadata: { success: false },
    }
  }

  const existing = await HivemindStore.getEntryByKey(params.key, root, params.scope)
  if (!existing) {
    return {
      title: "Entry Not Found",
      output: `No entry found with key "${params.key}".\n\nUse action: "create" to create a new entry.`,
      metadata: { success: false },
    }
  }

  const updates: Parameters<typeof HivemindStore.updateEntry>[1] = {}
  if (params.value) updates.value = params.value
  if (params.confidence !== undefined) updates.confidence = params.confidence
  if (params.tags) updates.metadata = { ...existing.metadata, tags: params.tags }
  if (params.requestGolden) {
    updates.status = "golden"
    updates.golden = {
      promotedAt: new Date().toISOString(),
      promotedBy: "user",
    }
  }

  const updated = await HivemindStore.updateEntry(existing.id, updates, root)
  await HivemindDecay.refreshEntry(existing.id, root)

  return {
    title: "Entry Updated",
    output: `Updated "${params.key}":\n\n**Value**: ${updated?.value}\n**Status**: ${updated?.status}\n**Confidence**: ${Math.round((updated?.confidence || 0) * 100)}%`,
    metadata: { success: true, entryId: existing.id, action: "updated" },
  }
}

async function handleDelete(
  params: Params,
  root: string
) {
  const keysToDelete = params.keys || (params.key ? [params.key] : [])
  
  if (keysToDelete.length === 0) {
    return {
      title: "Missing Keys",
      output: "Action 'delete' requires: key or keys\n\nExample:\n```\nhivemind_manage({\n  action: \"delete\",\n  key: \"old_entry\"\n})\n```\n\nOr for multiple:\n```\nhivemind_manage({\n  action: \"delete\",\n  keys: [\"entry1\", \"entry2\"]\n})\n```",
      metadata: { success: false },
    }
  }

  let deleted = 0
  const notFound: string[] = []

  for (const key of keysToDelete) {
    const entry = await HivemindStore.getEntryByKey(key, root, params.scope)
    if (entry) {
      await HivemindStore.removeEntry(entry.id, root)
      deleted++
    } else {
      notFound.push(key)
    }
  }

  const output = [`Deleted ${deleted} entries.`]
  if (notFound.length > 0) {
    output.push(`\nNot found: ${notFound.join(", ")}`)
  }

  return {
    title: "Entries Deleted",
    output: output.join(""),
    metadata: { success: true, deleted, notFound },
  }
}

async function handleMerge(
  params: Params,
  root: string
) {
  if (!params.keys || params.keys.length < 2) {
    return {
      title: "Missing Keys",
      output: "Action 'merge' requires: keys (at least 2), targetKey, mergedValue\n\nExample:\n```\nhivemind_manage({\n  action: \"merge\",\n  keys: [\"user_profile\", \"user_identity\"],\n  targetKey: \"user_info\",\n  mergedValue: \"Combined user information...\",\n  reason: \"Consolidating duplicate entries\"\n})\n```",
      metadata: { success: false },
    }
  }

  if (!params.targetKey || !params.mergedValue) {
    return {
      title: "Missing Target",
      output: "Action 'merge' requires: targetKey and mergedValue",
      metadata: { success: false },
    }
  }

  const result = await HivemindStore.mergeEntries(
    params.keys,
    params.targetKey,
    params.mergedValue,
    {
      category: params.category,
      scope: params.scope,
      tags: params.tags,
      reason: params.reason,
      contextRoot: root,
    }
  )

  return {
    title: "Entries Merged",
    output: `Merged ${result.deleted} entries into "${result.merged.key}":\n\n**Key**: ${result.merged.key}\n**Value**: ${result.merged.value}\n**Category**: ${result.merged.category}\n**Status**: ${result.merged.status}`,
    metadata: { success: true, merged: result.merged.key, deleted: result.deleted },
  }
}

async function handleFindDuplicates(
  params: Params,
  root: string
) {
  const duplicates = await HivemindStore.findDuplicates(root, {
    scope: params.scope,
    threshold: params.threshold,
  })

  if (duplicates.length === 0) {
    return {
      title: "No Duplicates Found",
      output: "No potential duplicate entries detected.",
      metadata: { success: true, count: 0 },
    }
  }

  const lines = duplicates.map((group, i) => {
    const entryList = group.entries.map(e => 
      `  - ${e.key} (${e.category}, ${e.scope}): ${e.value.substring(0, 50)}...`
    ).join("\n")
    return `**Group ${i + 1}**: ${group.reason}\n${entryList}`
  })

  return {
    title: `Found ${duplicates.length} Duplicate Groups`,
    output: `Potential duplicates detected:\n\n${lines.join("\n\n")}\n\nUse action: "merge" to consolidate entries.`,
    metadata: { success: true, count: duplicates.length, groups: duplicates.map(g => g.entries.map(e => e.key)) },
  }
}

async function handleSetFilter(
  params: Params,
  root: string
) {
  if (!params.filter) {
    // Show current filter
    const manifest = await HivemindStore.getManifest(root, "project")
    const filter = manifest.globalFilter

    if (!filter) {
      return {
        title: "No Global Filter Set",
        output: "No global filter is configured. All global entries are included when globalEnabled is true.\n\nTo set a filter:\n```\nhivemind_manage({\n  action: \"set_filter\",\n  filter: {\n    includeTags: [\"personal\", \"identity\"],\n    excludeTags: [\"code-specific\"]\n  }\n})\n```",
        metadata: { success: true, filter: null },
      }
    }

    return {
      title: "Current Global Filter",
      output: `Global filter configuration:\n\n${JSON.stringify(filter, null, 2)}`,
      metadata: { success: true, filter },
    }
  }

  await HivemindStore.updateGlobalFilter(params.filter as GlobalFilter, root)

  return {
    title: "Global Filter Updated",
    output: `Updated global filter:\n\n${JSON.stringify(params.filter, null, 2)}\n\nThis filter will be applied when reading global hivemind entries.`,
    metadata: { success: true, filter: params.filter },
  }
}

function getDecayRate(category: string): number {
  switch (category) {
    case "fear": return 0.1
    case "satisfaction": return 0.1
    case "knowledge": return 0
    case "decision": return 0.05
    case "preference": return 0
    default: return 0.1
  }
}
