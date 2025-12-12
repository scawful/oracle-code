import { z } from "zod"
import fs from "fs/promises"
import path from "path"

/**
 * Context evaluator for AFS.
 *
 * Inspired by "Everything is Context" (arXiv:2512.05470). Provides heuristic
 * validation of agent outputs against memory/knowledge and reports context
 * utilization. Promotion decisions are advisory and handled by callers.
 */
export namespace ContextEvaluator {
  /**
   * Issue severity levels
   */
  export type IssueSeverity = "low" | "medium" | "high"

  /**
   * Issue types that can be detected
   */
  export type IssueType = "contradiction" | "staleness" | "relevance" | "completeness" | "consistency"

  /**
   * A single validation issue
   */
  export const ValidationIssue = z.object({
    type: z.enum(["contradiction", "staleness", "relevance", "completeness", "consistency"]),
    severity: z.enum(["low", "medium", "high"]),
    description: z.string(),
    affectedPath: z.string().optional(),
    evidence: z.string().optional(),
    suggestedAction: z.string().optional(),
  })
  export type ValidationIssue = z.infer<typeof ValidationIssue>

  /**
   * Result of context validation
   */
  export interface ValidationResult {
    isValid: boolean
    confidence: number
    issues: ValidationIssue[]
    recommendations: string[]
    metrics: {
      contextUtilization: number
      factConsistency: number
      freshnessScore: number
      completenessScore: number
    }
    evaluatedAt: number
  }

  /**
   * A discovered fact that may be promoted to memory
   */
  export const Discovery = z.object({
    key: z.string(),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    source: z.enum(["inference", "explicit", "derived"]),
    evidence: z.string(),
    timestamp: z.number(),
  })
  export type Discovery = z.infer<typeof Discovery>

  /**
   * Memory promotion result
   */
  export interface PromotionResult {
    promoted: boolean
    reason: string
    targetPath?: string
    requiresReview: boolean
  }

  /**
   * Context utilization report
   */
  export interface UtilizationReport {
    totalContextSize: number
    usedContextSize: number
    utilizationPercent: number
    unusedSections: string[]
    overusedSections: string[]
    recommendations: string[]
  }

  /**
   * Configuration for the evaluator
   */
  export const Config = {
    /** Minimum confidence to promote to memory */
    promotionThreshold: 0.8,
    /** Maximum context age before staleness warning (ms) */
    stalenessThreshold: 5 * 60 * 1000, // 5 minutes
    /** Minimum utilization before relevance warning */
    minUtilization: 0.2,
    /** Contradiction detection sensitivity (0-1) */
    contradictionSensitivity: 0.7,
  } as const

  /**
   * Validate agent output against context and memory
   *
   * This is the core evaluation function that checks:
   * 1. Output doesn't contradict established memory facts
   * 2. Required context is being utilized
   * 3. Context freshness is adequate
   * 4. Output completeness matches task requirements
   */
  export async function validate(input: {
    output: string
    contextUsed: Array<{ content: string; source: string; timestamp: number }>
    memoryFacts: Array<{ key: string; value: unknown; path?: string }>
    knowledgeRefs: Array<{ content: string; path: string }>
    taskDescription?: string
  }): Promise<ValidationResult> {
    const issues: ValidationIssue[] = []
    const now = Date.now()

    // 1. Check for contradictions with memory facts
    for (const fact of input.memoryFacts) {
      const factStr = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)
      const contradiction = detectContradiction(input.output, factStr, fact.key)

      if (contradiction.isContradiction) {
        issues.push({
          type: "contradiction",
          severity: contradiction.severity,
          description: `Output may contradict memory fact: ${fact.key}`,
          affectedPath: fact.path ?? ".context/memory/",
          evidence: contradiction.evidence,
          suggestedAction: "Review memory facts for accuracy or clarify output",
        })
      }
    }

    // 2. Check context staleness
    for (const ctx of input.contextUsed) {
      const age = now - ctx.timestamp
      if (age > Config.stalenessThreshold) {
        const ageMinutes = Math.round(age / 60000)
        issues.push({
          type: "staleness",
          severity: age > Config.stalenessThreshold * 2 ? "high" : "medium",
          description: `Context from ${ctx.source} may be stale (${ageMinutes} min old)`,
          affectedPath: ctx.source,
          suggestedAction: "Refresh context from current session state",
        })
      }
    }

    // 3. Measure context utilization
    const utilization = measureUtilization(input.output, input.contextUsed)
    if (utilization.utilizationPercent < Config.minUtilization * 100) {
      issues.push({
        type: "relevance",
        severity: utilization.utilizationPercent < 10 ? "high" : "low",
        description: `Low context utilization (${utilization.utilizationPercent.toFixed(0)}%)`,
        suggestedAction: "Ensure context is being utilized in reasoning",
      })
    }

    // 4. Check completeness against task description
    let completenessScore = 1.0
    if (input.taskDescription) {
      const taskKeywords = extractKeywords(input.taskDescription)
      const outputKeywords = new Set(extractKeywords(input.output))
      const addressed = taskKeywords.filter((k) => outputKeywords.has(k)).length
      completenessScore = taskKeywords.length > 0 ? addressed / taskKeywords.length : 1.0

      if (completenessScore < 0.5) {
        issues.push({
          type: "completeness",
          severity: completenessScore < 0.3 ? "high" : "medium",
          description: `Output may not fully address task (${(completenessScore * 100).toFixed(0)}% keyword coverage)`,
          suggestedAction: "Review task requirements and ensure all aspects are addressed",
        })
      }
    }

    // 5. Check consistency with knowledge references
    let consistencyScore = 1.0
    const knowledgeIssues = checkKnowledgeConsistency(input.output, input.knowledgeRefs)
    consistencyScore = 1 - knowledgeIssues.length * 0.1
    issues.push(...knowledgeIssues)

    // Calculate freshness score
    const freshnessScore = calculateFreshnessScore(input.contextUsed)

    // Calculate fact consistency score
    const contradictionCount = issues.filter((i) => i.type === "contradiction").length
    const factConsistency = 1 - Math.min(1, contradictionCount * 0.3)

    // Overall validation
    const hasHighSeverity = issues.some((i) => i.severity === "high")
    const hasMediumSeverity = issues.some((i) => i.severity === "medium")

    return {
      isValid: !hasHighSeverity,
      confidence: Math.max(0, 1 - issues.length * 0.15),
      issues,
      recommendations: generateRecommendations(issues),
      metrics: {
        contextUtilization: utilization.utilizationPercent / 100,
        factConsistency,
        freshnessScore,
        completenessScore,
      },
      evaluatedAt: now,
    }
  }

  /**
   * Detect if output contradicts an established fact
   */
  function detectContradiction(
    output: string,
    fact: string,
    factKey: string,
  ): {
    isContradiction: boolean
    severity: IssueSeverity
    evidence: string
  } {
    const outputLower = output.toLowerCase()
    const factLower = fact.toLowerCase()

    // Direct negation patterns
    const negationPatterns = [
      new RegExp(`not\\s+${escapeRegex(factLower.substring(0, 30))}`, "i"),
      new RegExp(`isn't\\s+${escapeRegex(factLower.substring(0, 30))}`, "i"),
      new RegExp(`doesn't\\s+${escapeRegex(factLower.substring(0, 30))}`, "i"),
      new RegExp(`never\\s+${escapeRegex(factLower.substring(0, 30))}`, "i"),
      new RegExp(`${escapeRegex(factKey.toLowerCase())}.*\\b(not|never|isn't|doesn't|can't|won't)\\b`, "i"),
    ]

    for (const pattern of negationPatterns) {
      if (pattern.test(outputLower)) {
        return {
          isContradiction: true,
          severity: "high",
          evidence: `Output contains negation pattern matching fact key "${factKey}"`,
        }
      }
    }

    // Semantic contradiction check (simplified)
    const factKeywords = extractKeywords(fact)
    const outputKeywords = extractKeywords(output)

    // Check if fact keywords appear with negation
    for (const keyword of factKeywords.slice(0, 5)) {
      const negatedPattern = new RegExp(`\\b(not|no|never|isn't|doesn't|can't|won't)\\s+\\w*\\s*${escapeRegex(keyword)}`, "i")
      if (negatedPattern.test(output)) {
        return {
          isContradiction: true,
          severity: "medium",
          evidence: `Keyword "${keyword}" from fact appears negated in output`,
        }
      }
    }

    return {
      isContradiction: false,
      severity: "low",
      evidence: "",
    }
  }

  /**
   * Measure how much of the provided context is utilized in the output
   */
  export function measureUtilization(
    output: string,
    contexts: Array<{ content: string; source: string; timestamp: number }>,
  ): UtilizationReport {
    const outputWords = new Set(extractKeywords(output))
    const sectionUsage: Record<string, { total: number; used: number }> = {}

    let totalContextSize = 0
    let usedContextSize = 0

    for (const ctx of contexts) {
      const ctxKeywords = extractKeywords(ctx.content)
      const used = ctxKeywords.filter((k) => outputWords.has(k)).length

      totalContextSize += ctxKeywords.length
      usedContextSize += used

      const source = ctx.source || "unknown"
      if (!sectionUsage[source]) {
        sectionUsage[source] = { total: 0, used: 0 }
      }
      sectionUsage[source].total += ctxKeywords.length
      sectionUsage[source].used += used
    }

    // Identify under/over-utilized sections
    const unusedSections: string[] = []
    const overusedSections: string[] = []
    const recommendations: string[] = []

    for (const [source, usage] of Object.entries(sectionUsage)) {
      const utilPercent = usage.total > 0 ? (usage.used / usage.total) * 100 : 0

      if (utilPercent < 10 && usage.total > 20) {
        unusedSections.push(source)
        recommendations.push(`Consider removing ${source} from context if not needed`)
      }
      if (utilPercent > 80 && usage.total > 50) {
        overusedSections.push(source)
      }
    }

    return {
      totalContextSize,
      usedContextSize,
      utilizationPercent: totalContextSize > 0 ? (usedContextSize / totalContextSize) * 100 : 0,
      unusedSections,
      overusedSections,
      recommendations,
    }
  }

  /**
   * Check consistency with knowledge reference documents
   */
  function checkKnowledgeConsistency(
    output: string,
    knowledgeRefs: Array<{ content: string; path: string }>,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const ref of knowledgeRefs) {
      // Check if output claims something that contradicts reference
      // This is a simplified check; full implementation would use semantic analysis

      const refTerms = extractDefinitions(ref.content)
      const outputTerms = extractDefinitions(output)

      for (const [term, refDef] of Object.entries(refTerms)) {
        if (outputTerms[term] && outputTerms[term] !== refDef) {
          // Check if it's actually a contradiction vs just different phrasing
          const similarity = calculateSimilarity(outputTerms[term], refDef)
          if (similarity < 0.5) {
            issues.push({
              type: "consistency",
              severity: "medium",
              description: `Term "${term}" defined differently than in ${path.basename(ref.path)}`,
              affectedPath: ref.path,
              evidence: `Reference says: "${refDef.substring(0, 50)}...", Output says: "${outputTerms[term].substring(0, 50)}..."`,
              suggestedAction: "Verify definition consistency with knowledge base",
            })
          }
        }
      }
    }

    return issues
  }

  /**
   * Extract term definitions from text (simplified)
   */
  function extractDefinitions(text: string): Record<string, string> {
    const definitions: Record<string, string> = {}

    // Pattern: "X is Y" or "X: Y" or "X means Y"
    const patterns = [
      /(\w+(?:\s+\w+)?)\s+is\s+(?:a|an|the)?\s*([^.]+)/gi,
      /(\w+(?:\s+\w+)?):\s*([^.]+)/gi,
      /(\w+(?:\s+\w+)?)\s+means\s+([^.]+)/gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const term = match[1].toLowerCase().trim()
        const def = match[2].trim()
        if (term.length > 2 && def.length > 5 && def.length < 200) {
          definitions[term] = def
        }
      }
    }

    return definitions
  }

  /**
   * Calculate freshness score based on context timestamps
   */
  function calculateFreshnessScore(
    contexts: Array<{ content: string; source: string; timestamp: number }>,
  ): number {
    if (contexts.length === 0) return 1.0

    const now = Date.now()
    const ages = contexts.map((c) => now - c.timestamp)
    const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length

    // Exponential decay: fresh = 1.0, 5min = ~0.6, 30min = ~0.1
    const decayRate = 1 / (10 * 60 * 1000) // 10 minute half-life
    return Math.exp(-decayRate * avgAge)
  }

  /**
   * Generate actionable recommendations from issues
   */
  function generateRecommendations(issues: ValidationIssue[]): string[] {
    const recommendations: string[] = []
    const seenTypes = new Set<IssueType>()

    for (const issue of issues) {
      if (!seenTypes.has(issue.type)) {
        seenTypes.add(issue.type)

        switch (issue.type) {
          case "contradiction":
            recommendations.push("Review memory facts for accuracy or update output to align with established facts")
            break
          case "staleness":
            recommendations.push("Refresh context from current session state before proceeding")
            break
          case "relevance":
            recommendations.push("Ensure provided context is being utilized in reasoning; consider pruning irrelevant context")
            break
          case "completeness":
            recommendations.push("Review task requirements and ensure all aspects are addressed in output")
            break
          case "consistency":
            recommendations.push("Verify terminology and definitions match knowledge base references")
            break
        }
      }
    }

    return recommendations
  }

  /**
   * Promote a validated discovery to persistent memory
   *
   * Discoveries with high confidence can be added to the memory directory
   * for use in future sessions.
   */
  export async function promoteToMemory(input: {
    discovery: Discovery
    contextRoot: string
    targetFile?: string
  }): Promise<PromotionResult> {
    const { discovery, contextRoot, targetFile } = input

    // Check confidence threshold
    if (discovery.confidence < Config.promotionThreshold) {
      return {
        promoted: false,
        reason: `Confidence (${(discovery.confidence * 100).toFixed(0)}%) below threshold (${Config.promotionThreshold * 100}%)`,
        requiresReview: discovery.confidence > 0.6,
      }
    }

    // Determine target path
    const target = targetFile ?? `${contextRoot}/scratchpad/pending-facts.md`
    const memoryTarget = `${contextRoot}/memory/discovered-facts.md`

    try {
      // Format the discovery as markdown
      const entry = formatDiscoveryEntry(discovery)

      // Check if file exists
      const targetPath = discovery.confidence >= 0.9 ? memoryTarget : target
      let existingContent = ""

      try {
        existingContent = await fs.readFile(targetPath, "utf-8")
      } catch {
        // File doesn't exist, will create
      }

      // Append the new discovery
      const newContent = existingContent
        ? `${existingContent}\n\n${entry}`
        : `# Discovered Facts\n\nFacts discovered during agent sessions.\n\n${entry}`

      await fs.writeFile(targetPath, newContent, "utf-8")

      return {
        promoted: true,
        reason: discovery.confidence >= 0.9
          ? "High-confidence discovery promoted directly to memory"
          : "Discovery added to pending facts for review",
        targetPath,
        requiresReview: discovery.confidence < 0.9,
      }
    } catch (error) {
      return {
        promoted: false,
        reason: `Failed to write discovery: ${error instanceof Error ? error.message : "Unknown error"}`,
        requiresReview: true,
      }
    }
  }

  /**
   * Format a discovery as a markdown entry
   */
  function formatDiscoveryEntry(discovery: Discovery): string {
    const timestamp = new Date(discovery.timestamp).toISOString()
    const valueStr = typeof discovery.value === "string"
      ? discovery.value
      : JSON.stringify(discovery.value, null, 2)

    return `## ${discovery.key}

- **Value**: ${valueStr}
- **Confidence**: ${(discovery.confidence * 100).toFixed(0)}%
- **Source**: ${discovery.source}
- **Discovered**: ${timestamp}

**Evidence**: ${discovery.evidence}

---`
  }

  /**
   * Extract a discovery from agent output
   *
   * Looks for patterns that indicate new facts being established
   */
  export function extractDiscoveries(
    output: string,
    options?: {
      minConfidence?: number
      agentID?: string
    },
  ): Discovery[] {
    const discoveries: Discovery[] = []
    const minConfidence = options?.minConfidence ?? 0.6

    // Patterns that indicate discovered facts
    const patterns = [
      // "I found that X"
      /I found that ([^.]+)\./gi,
      // "The X is Y"
      /The (\w+(?:\s+\w+)?)\s+is\s+([^.]+)\./gi,
      // "X equals Y" or "X = Y"
      /(\w+(?:\s+\w+)?)\s*(?:equals|=)\s*([^.]+)/gi,
      // "It turns out that X"
      /It turns out that ([^.]+)\./gi,
      // "The answer is X"
      /The answer is ([^.]+)\./gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(output)) !== null) {
        const fullMatch = match[0]

        // Determine key and value based on pattern
        let key: string
        let value: unknown

        if (match[2]) {
          // Pattern with subject and predicate
          key = match[1].toLowerCase().trim()
          value = match[2].trim()
        } else {
          // Single-capture pattern
          key = `discovery_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          value = match[1].trim()
        }

        // Calculate confidence based on linguistic markers
        let confidence = 0.6 // Base confidence

        // Boost for certainty markers
        if (/\b(definitely|certainly|clearly|always|must)\b/i.test(fullMatch)) {
          confidence += 0.2
        }
        // Reduce for uncertainty markers
        if (/\b(maybe|perhaps|possibly|might|could)\b/i.test(fullMatch)) {
          confidence -= 0.2
        }
        // Boost for evidence markers
        if (/\b(because|since|due to|as shown|evidence)\b/i.test(output)) {
          confidence += 0.1
        }

        confidence = Math.max(0, Math.min(1, confidence))

        if (confidence >= minConfidence) {
          discoveries.push({
            key,
            value,
            confidence,
            source: "inference",
            evidence: fullMatch.substring(0, 100),
            timestamp: Date.now(),
          })
        }
      }
    }

    return discoveries
  }

  /**
   * Create feedback for the Context Constructor
   *
   * Based on evaluation results, provide guidance for improving context selection
   */
  export function createConstructorFeedback(result: ValidationResult): {
    shouldInclude: string[]
    shouldExclude: string[]
    priorityBoosts: Record<string, number>
    notes: string[]
  } {
    const feedback: ReturnType<typeof createConstructorFeedback> = {
      shouldInclude: [],
      shouldExclude: [],
      priorityBoosts: {},
      notes: [],
    }

    // Analyze issues to determine feedback
    for (const issue of result.issues) {
      switch (issue.type) {
        case "staleness":
          if (issue.affectedPath) {
            feedback.notes.push(`Context from ${issue.affectedPath} is stale - refresh before next use`)
          }
          break

        case "relevance":
          feedback.notes.push("Low context utilization - consider pruning unused sections")
          break

        case "contradiction":
          if (issue.affectedPath) {
            // Boost priority of contradicted facts for review
            feedback.priorityBoosts[issue.affectedPath] = 0.2
            feedback.notes.push(`Potential contradiction with ${issue.affectedPath} - include for reconciliation`)
          }
          break

        case "completeness":
          feedback.notes.push("Output may be incomplete - ensure task-relevant context is prioritized")
          break
      }
    }

    // Add metric-based feedback
    if (result.metrics.contextUtilization < 0.3) {
      feedback.notes.push("Consider using more focused context selection")
    }
    if (result.metrics.freshnessScore < 0.5) {
      feedback.notes.push("Context is aging - prioritize recent information")
    }

    return feedback
  }

  /**
   * Extract keywords from text
   */
  function extractKeywords(text: string): string[] {
    const stopwords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
      "be", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "need",
      "this", "that", "these", "those", "it", "its", "they", "them",
    ])

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopwords.has(w))
  }

  /**
   * Calculate similarity between two strings (Jaccard)
   */
  function calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(extractKeywords(a))
    const wordsB = new Set(extractKeywords(b))

    if (wordsA.size === 0 && wordsB.size === 0) return 1

    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size

    return union > 0 ? intersection / union : 0
  }

  /**
   * Escape special regex characters
   */
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}
