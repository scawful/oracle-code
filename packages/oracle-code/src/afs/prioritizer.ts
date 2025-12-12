import { z } from "zod"

/**
 * Context prioritization for AFS.
 *
 * Inspired by the "Everything is Context" pipeline (arXiv:2512.05470). Scores
 * context items by recency, source authority, query relevance, and prior
 * utilization to fit within a token budget. Token estimation is currently
 * heuristic.
 */
export namespace ContextPrioritizer {
  /**
   * Token estimation constant
   * Average characters per token (approximate, varies by model)
   * TODO: Use model-specific tokenizer for accuracy
   */
  const CHARS_PER_TOKEN = 4

  /**
   * Source priority weights (higher = more important)
   */
  export const SourcePriority: Record<string, number> = {
    memory: 0.95,      // Long-term facts - highest priority
    knowledge: 0.85,   // Reference materials
    scratchpad: 0.75,  // Working context
    tools: 0.70,       // Tool outputs
    tool_output: 0.65, // Recent tool results
    history: 0.50,     // Archived sessions
    default: 0.50,     // Unknown sources
  } as const

  /**
   * Context item for prioritization
   */
  export const ContextItem = z.object({
    content: z.string(),
    source: z.string(),
    path: z.string().optional(),
    timestamp: z.number(),
    /** Previous utilization score (0-1) if known */
    previousUtilization: z.number().optional(),
    /** Custom priority boost (-0.5 to 0.5) */
    priorityBoost: z.number().optional(),
  })
  export type ContextItem = z.infer<typeof ContextItem>

  /**
   * Scored context item with priority
   */
  export interface ScoredContext extends ContextItem {
    priority: number
    tokens: number
    breakdown: {
      recency: number
      sourcePriority: number
      relevance: number
      utilization: number
      boost: number
    }
  }

  /**
   * Selection result with metadata
   */
  export interface SelectionResult {
    selected: ScoredContext[]
    excluded: ScoredContext[]
    totalTokens: number
    budgetRemaining: number
    metrics: {
      averagePriority: number
      sourceDistribution: Record<string, number>
      recencyScore: number
    }
  }

  /**
   * Configuration for prioritization
   */
  export interface PrioritizationConfig {
    /** Maximum tokens to allocate for context */
    maxTokens: number
    /** Half-life for recency decay (milliseconds) */
    recencyHalfLife?: number
    /** Weight for recency in final score */
    recencyWeight?: number
    /** Weight for source priority in final score */
    sourceWeight?: number
    /** Weight for query relevance in final score */
    relevanceWeight?: number
    /** Weight for previous utilization in final score */
    utilizationWeight?: number
    /** Minimum priority to include (0-1) */
    minPriority?: number
  }

  const DEFAULT_CONFIG: Required<Omit<PrioritizationConfig, "maxTokens">> = {
    recencyHalfLife: 30 * 60 * 1000, // 30 minutes
    recencyWeight: 0.2,
    sourceWeight: 0.3,
    relevanceWeight: 0.35,
    utilizationWeight: 0.15,
    minPriority: 0.2,
  }

  /**
   * Estimate token count for a string
   *
   * TODO: Replace with model-specific tokenizer for accuracy
   */
  export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN)
  }

  /**
   * Calculate recency score using exponential decay
   *
   * Returns 1.0 for current, ~0.5 at half-life, approaching 0 as age increases
   */
  function calculateRecencyScore(timestamp: number, halfLife: number): number {
    const age = Date.now() - timestamp
    const decayRate = Math.LN2 / halfLife
    return Math.exp(-decayRate * age)
  }

  /**
   * Calculate query relevance using keyword overlap
   */
  function calculateRelevance(content: string, query: string): number {
    if (!query.trim()) return 0.5 // No query = neutral relevance

    const queryWords = extractKeywords(query)
    if (queryWords.length === 0) return 0.5

    const contentWords = new Set(extractKeywords(content))
    const overlap = queryWords.filter((w) => contentWords.has(w)).length

    // Use Jaccard-like similarity but with query as reference
    return overlap / queryWords.length
  }

  /**
   * Extract meaningful keywords from text
   */
  function extractKeywords(text: string): string[] {
    const stopwords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
      "be", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "need",
      "this", "that", "these", "those", "it", "its", "they", "them",
      "their", "we", "us", "our", "you", "your", "he", "him", "his",
      "she", "her", "i", "me", "my", "what", "which", "when", "where",
    ])

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w))
  }

  /**
   * Get source priority from path or source name
   */
  function getSourcePriority(source: string, path?: string): number {
    // Check path first for more specific matching
    if (path) {
      for (const [key, priority] of Object.entries(SourcePriority)) {
        if (path.includes(`/${key}/`) || path.includes(`\\${key}\\`)) {
          return priority
        }
      }
    }

    // Fall back to source name
    const normalizedSource = source.toLowerCase()
    return SourcePriority[normalizedSource] ?? SourcePriority.default
  }

  /**
   * Calculate priority score for a context item
   */
  export function calculatePriority(
    item: ContextItem,
    query: string,
    config: PrioritizationConfig,
  ): ScoredContext {
    const cfg = { ...DEFAULT_CONFIG, ...config }

    // Calculate individual scores
    const recency = calculateRecencyScore(item.timestamp, cfg.recencyHalfLife)
    const sourcePriority = getSourcePriority(item.source, item.path)
    const relevance = calculateRelevance(item.content, query)
    const utilization = item.previousUtilization ?? 0.5 // Default to neutral
    const boost = Math.max(-0.5, Math.min(0.5, item.priorityBoost ?? 0))

    // Weighted combination
    const priority =
      recency * cfg.recencyWeight +
      sourcePriority * cfg.sourceWeight +
      relevance * cfg.relevanceWeight +
      utilization * cfg.utilizationWeight +
      boost

    // Normalize to 0-1 range (weights sum to 1, boost can add up to 0.5)
    const normalizedPriority = Math.max(0, Math.min(1, priority))

    return {
      ...item,
      priority: normalizedPriority,
      tokens: estimateTokens(item.content),
      breakdown: {
        recency,
        sourcePriority,
        relevance,
        utilization,
        boost,
      },
    }
  }

  /**
   * Prioritize and select context within token budget
   *
   * This is the main entry point for the Context Constructor
   */
  export function prioritizeContext(input: {
    availableContext: ContextItem[]
    query: string
    config: PrioritizationConfig
  }): SelectionResult {
    const { availableContext, query, config } = input
    const cfg = { ...DEFAULT_CONFIG, ...config }

    // Score all items
    const scored = availableContext.map((item) => calculatePriority(item, query, config))

    // Sort by priority (highest first)
    scored.sort((a, b) => b.priority - a.priority)

    // Select within budget
    const selected: ScoredContext[] = []
    const excluded: ScoredContext[] = []
    let totalTokens = 0

    for (const item of scored) {
      if (item.priority < cfg.minPriority) {
        excluded.push(item)
        continue
      }

      if (totalTokens + item.tokens <= config.maxTokens) {
        selected.push(item)
        totalTokens += item.tokens
      } else {
        excluded.push(item)
      }
    }

    // Calculate metrics
    const averagePriority = selected.length > 0
      ? selected.reduce((sum, s) => sum + s.priority, 0) / selected.length
      : 0

    const sourceDistribution: Record<string, number> = {}
    for (const item of selected) {
      sourceDistribution[item.source] = (sourceDistribution[item.source] ?? 0) + 1
    }

    const recencyScore = selected.length > 0
      ? selected.reduce((sum, s) => sum + s.breakdown.recency, 0) / selected.length
      : 0

    return {
      selected,
      excluded,
      totalTokens,
      budgetRemaining: config.maxTokens - totalTokens,
      metrics: {
        averagePriority,
        sourceDistribution,
        recencyScore,
      },
    }
  }

  /**
   * Re-prioritize based on utilization feedback
   *
   * Call this after evaluating context utilization to improve future selection
   */
  export function updatePrioritiesFromFeedback(
    items: ContextItem[],
    feedback: {
      utilized: string[] // Paths/sources that were used
      underutilized: string[] // Paths/sources with low utilization
    },
  ): ContextItem[] {
    return items.map((item) => {
      let boost = item.priorityBoost ?? 0

      // Check if this item was utilized
      const wasUtilized = feedback.utilized.some(
        (u) => item.path?.includes(u) || item.source === u,
      )
      const wasUnderutilized = feedback.underutilized.some(
        (u) => item.path?.includes(u) || item.source === u,
      )

      if (wasUtilized) {
        boost = Math.min(0.5, boost + 0.1) // Boost utilized context
      }
      if (wasUnderutilized) {
        boost = Math.max(-0.5, boost - 0.1) // Reduce underutilized context
      }

      return { ...item, priorityBoost: boost }
    })
  }

  /**
   * Create a context window with system message structure
   *
   * Formats selected context into a coherent system message
   */
  export function formatContextWindow(
    selected: ScoredContext[],
    options?: {
      includeMetadata?: boolean
      groupBySource?: boolean
    },
  ): string {
    const { includeMetadata = false, groupBySource = true } = options ?? {}

    if (selected.length === 0) {
      return ""
    }

    const parts: string[] = []

    if (groupBySource) {
      // Group by source
      const grouped: Record<string, ScoredContext[]> = {}
      for (const item of selected) {
        const source = item.source
        if (!grouped[source]) grouped[source] = []
        grouped[source].push(item)
      }

      // Output in source priority order
      const sources = Object.keys(grouped).sort(
        (a, b) => (SourcePriority[b] ?? 0.5) - (SourcePriority[a] ?? 0.5),
      )

      for (const source of sources) {
        parts.push(`\n## Context from ${source}\n`)

        for (const item of grouped[source]) {
          if (includeMetadata) {
            parts.push(
              `<!-- priority: ${item.priority.toFixed(2)}, tokens: ${item.tokens} -->`,
            )
          }
          parts.push(item.content)
          parts.push("") // Blank line separator
        }
      }
    } else {
      // Output in priority order
      for (const item of selected) {
        if (includeMetadata) {
          parts.push(`<!-- source: ${item.source}, priority: ${item.priority.toFixed(2)} -->`)
        }
        parts.push(item.content)
        parts.push("")
      }
    }

    return parts.join("\n").trim()
  }

  /**
   * Recommend context pruning based on session analysis
   */
  export function recommendPruning(
    selected: ScoredContext[],
    targetReduction: number,
  ): {
    keep: ScoredContext[]
    prune: ScoredContext[]
    tokensSaved: number
  } {
    // Sort by priority (lowest first for pruning candidates)
    const sorted = [...selected].sort((a, b) => a.priority - b.priority)

    const prune: ScoredContext[] = []
    const keep: ScoredContext[] = []
    let tokensSaved = 0

    for (const item of sorted) {
      if (tokensSaved < targetReduction) {
        prune.push(item)
        tokensSaved += item.tokens
      } else {
        keep.push(item)
      }
    }

    // Re-sort keep by original priority order
    keep.sort((a, b) => b.priority - a.priority)

    return { keep, prune, tokensSaved }
  }

  /**
   * Analyze context selection for debugging/optimization
   */
  export function analyzeSelection(result: SelectionResult): {
    summary: string
    issues: string[]
    suggestions: string[]
  } {
    const issues: string[] = []
    const suggestions: string[] = []

    // Check for low priority selections
    const lowPriorityCount = result.selected.filter((s) => s.priority < 0.4).length
    if (lowPriorityCount > 0) {
      issues.push(
        `${lowPriorityCount} low-priority items selected (priority < 0.4)`,
      )
      suggestions.push("Consider reducing maxTokens or increasing minPriority threshold")
    }

    // Check for source imbalance
    const sources = Object.entries(result.metrics.sourceDistribution)
    if (sources.length === 1 && result.selected.length > 3) {
      issues.push(`All selected context from single source: ${sources[0][0]}`)
      suggestions.push("Consider diversifying context sources")
    }

    // Check for stale context
    if (result.metrics.recencyScore < 0.3) {
      issues.push("Low recency score indicates potentially stale context")
      suggestions.push("Refresh context or reduce recencyHalfLife")
    }

    // Check budget utilization
    const utilizationPercent = (result.totalTokens / (result.totalTokens + result.budgetRemaining)) * 100
    if (utilizationPercent < 50) {
      issues.push(`Low budget utilization (${utilizationPercent.toFixed(0)}%)`)
      suggestions.push("Consider reducing maxTokens or lowering minPriority")
    }

    const summary = [
      `Selected ${result.selected.length} items (${result.totalTokens} tokens)`,
      `Excluded ${result.excluded.length} items`,
      `Average priority: ${result.metrics.averagePriority.toFixed(2)}`,
      `Recency score: ${result.metrics.recencyScore.toFixed(2)}`,
      `Budget remaining: ${result.budgetRemaining} tokens`,
    ].join("\n")

    return { summary, issues, suggestions }
  }
}
