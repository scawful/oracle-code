import { z } from "zod"

/**
 * Error Detection Module
 *
 * Implements algorithms for detecting various error types in agent outputs:
 * - Logical contradictions (Agent asserts both X and not-X)
 * - Numerical drift (Accumulated computational errors)
 * - Context omissions (Failure to reference established information)
 * - Coordination failures (MAS-specific issues)
 *
 * Based on the MAST taxonomy from research paper and practical heuristics.
 * Reference: "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
 */
export namespace ErrorDetection {
  /**
   * Error type enumeration
   */
  export type ErrorType =
    | "logical_contradiction"
    | "numerical_drift"
    | "context_omission"
    | "coordination_failure"

  /**
   * Detected error with evidence
   */
  export const DetectedError = z.object({
    type: z.enum(["logical_contradiction", "numerical_drift", "context_omission", "coordination_failure"]),
    severity: z.number().min(0).max(1),
    evidence: z.string(),
    timestamp: z.number(),
    agentID: z.string().optional(),
    sessionID: z.string().optional(),
    /** Location in output where error was detected */
    location: z.object({
      startIndex: z.number(),
      endIndex: z.number(),
    }).optional(),
  })
  export type DetectedError = z.infer<typeof DetectedError>

  /**
   * Analysis result for a piece of output
   */
  export interface AnalysisResult {
    errors: DetectedError[]
    totalSeverity: number
    errorRate: number
    dominant: ErrorType | null
  }

  /**
   * Common negation patterns for contradiction detection
   */
  const NEGATION_PATTERNS = [
    /\b(not|never|no|cannot|can't|won't|wouldn't|shouldn't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't)\b/i,
    /\b(false|incorrect|wrong|impossible|unable)\b/i,
    /\b(fail|failed|fails|failure)\b/i,
  ]

  /**
   * Assertion indicators
   */
  const ASSERTION_PATTERNS = [
    /\b(is|are|was|were|will|must|should|can|has|have|had)\b/i,
    /\b(always|definitely|certainly|clearly|obviously|necessarily)\b/i,
  ]

  /**
   * Extract declarative assertions from text
   *
   * Returns normalized assertions that can be compared for contradictions
   */
  export function extractAssertions(text: string): Array<{
    text: string
    normalized: string
    hasNegation: boolean
    subject: string
    predicate: string
    startIndex: number
    endIndex: number
  }> {
    const assertions: Array<{
      text: string
      normalized: string
      hasNegation: boolean
      subject: string
      predicate: string
      startIndex: number
      endIndex: number
    }> = []

    // Split into sentences
    const sentencePattern = /[^.!?]+[.!?]+/g
    let match

    while ((match = sentencePattern.exec(text)) !== null) {
      const sentence = match[0].trim()
      const startIndex = match.index
      const endIndex = startIndex + sentence.length

      // Check if it's an assertion
      const isAssertion = ASSERTION_PATTERNS.some((p) => p.test(sentence))
      if (!isAssertion) continue

      // Check for negation
      const hasNegation = NEGATION_PATTERNS.some((p) => p.test(sentence))

      // Extract subject (simplified: first noun phrase)
      const words = sentence.toLowerCase().split(/\s+/)
      const subjectWords: string[] = []
      const predicateWords: string[] = []

      let foundVerb = false
      for (const word of words) {
        const cleanWord = word.replace(/[^a-z]/g, "")
        if (!cleanWord) continue

        if (!foundVerb && /^(is|are|was|were|will|must|should|can|has|have|had)$/.test(cleanWord)) {
          foundVerb = true
          predicateWords.push(cleanWord)
        } else if (foundVerb) {
          predicateWords.push(cleanWord)
        } else {
          subjectWords.push(cleanWord)
        }
      }

      const subject = subjectWords.join(" ")
      const predicate = predicateWords.join(" ")

      // Normalize: remove stopwords, lowercase
      const stopwords = new Set(["the", "a", "an", "this", "that", "these", "those", "it", "its"])
      const normalizedWords = words
        .map((w) => w.replace(/[^a-z]/g, ""))
        .filter((w) => w.length > 2 && !stopwords.has(w))
      const normalized = normalizedWords.sort().join(" ")

      assertions.push({
        text: sentence,
        normalized,
        hasNegation,
        subject,
        predicate,
        startIndex,
        endIndex,
      })
    }

    return assertions
  }

  /**
   * Check if two assertions contradict each other
   */
  function assertionsContradict(
    a: ReturnType<typeof extractAssertions>[0],
    b: ReturnType<typeof extractAssertions>[0],
  ): boolean {
    // Same subject, different negation status
    if (a.subject === b.subject && a.subject.length > 0) {
      if (a.hasNegation !== b.hasNegation) {
        // Check if predicates overlap significantly
        const aWords = new Set(a.predicate.split(" "))
        const bWords = new Set(b.predicate.split(" "))
        const overlap = [...aWords].filter((w) => bWords.has(w)).length
        const maxLen = Math.max(aWords.size, bWords.size)
        if (maxLen > 0 && overlap / maxLen > 0.5) {
          return true
        }
      }
    }

    // Check normalized form similarity with opposite negation
    if (a.hasNegation !== b.hasNegation) {
      const aWords = new Set(a.normalized.split(" "))
      const bWords = new Set(b.normalized.split(" "))
      const intersection = [...aWords].filter((w) => bWords.has(w))
      const union = new Set([...aWords, ...bWords])
      const jaccard = intersection.length / union.size

      if (jaccard > 0.6) {
        return true
      }
    }

    return false
  }

  /**
   * Detect logical contradictions between current output and previous outputs
   */
  export function detectContradictions(
    currentOutput: string,
    previousOutputs: string[],
    options?: {
      agentID?: string
      sessionID?: string
    },
  ): DetectedError[] {
    const errors: DetectedError[] = []
    const currentAssertions = extractAssertions(currentOutput)

    // Check for internal contradictions first
    for (let i = 0; i < currentAssertions.length; i++) {
      for (let j = i + 1; j < currentAssertions.length; j++) {
        if (assertionsContradict(currentAssertions[i], currentAssertions[j])) {
          errors.push({
            type: "logical_contradiction",
            severity: 0.9, // Internal contradictions are severe
            evidence: `Internal contradiction: "${currentAssertions[i].text.substring(0, 50)}..." vs "${currentAssertions[j].text.substring(0, 50)}..."`,
            timestamp: Date.now(),
            agentID: options?.agentID,
            sessionID: options?.sessionID,
            location: {
              startIndex: currentAssertions[i].startIndex,
              endIndex: currentAssertions[j].endIndex,
            },
          })
        }
      }
    }

    // Check against previous outputs
    for (const prev of previousOutputs) {
      const prevAssertions = extractAssertions(prev)

      for (const curr of currentAssertions) {
        for (const prevA of prevAssertions) {
          if (assertionsContradict(curr, prevA)) {
            errors.push({
              type: "logical_contradiction",
              severity: 0.7, // Cross-output contradictions are less severe (context may have changed)
              evidence: `Contradicts previous output: "${curr.text.substring(0, 50)}..." vs "${prevA.text.substring(0, 50)}..."`,
              timestamp: Date.now(),
              agentID: options?.agentID,
              sessionID: options?.sessionID,
              location: {
                startIndex: curr.startIndex,
                endIndex: curr.endIndex,
              },
            })
          }
        }
      }
    }

    return errors
  }

  /**
   * Detect numerical drift in calculations
   *
   * Looks for:
   * - Inconsistent numbers referring to same entity
   * - Calculation errors
   * - Rounding inconsistencies
   */
  export function detectNumericalDrift(
    currentOutput: string,
    previousOutputs: string[],
    options?: {
      agentID?: string
      sessionID?: string
      tolerancePercent?: number
    },
  ): DetectedError[] {
    const errors: DetectedError[] = []
    const tolerance = options?.tolerancePercent ?? 1 // 1% tolerance by default

    // Extract numbers with context
    const numberPattern = /(\w+(?:\s+\w+)?)\s*[=:]\s*([\d,]+(?:\.\d+)?)\s*(%|dollars?|USD|\$|tokens?|bytes?|ms|seconds?|minutes?)?/gi

    interface NumberContext {
      label: string
      value: number
      unit: string
      text: string
      index: number
    }

    function extractNumbers(text: string): NumberContext[] {
      const numbers: NumberContext[] = []
      let match

      const pattern = new RegExp(numberPattern.source, numberPattern.flags)
      while ((match = pattern.exec(text)) !== null) {
        const label = match[1].toLowerCase().trim()
        const valueStr = match[2].replace(/,/g, "")
        const value = parseFloat(valueStr)
        const unit = (match[3] || "").toLowerCase()

        if (!isNaN(value)) {
          numbers.push({
            label,
            value,
            unit,
            text: match[0],
            index: match.index,
          })
        }
      }

      return numbers
    }

    const currentNumbers = extractNumbers(currentOutput)

    // Check for internal inconsistencies
    const numbersByLabel: Record<string, NumberContext[]> = {}
    for (const num of currentNumbers) {
      if (!numbersByLabel[num.label]) {
        numbersByLabel[num.label] = []
      }
      numbersByLabel[num.label].push(num)
    }

    for (const [label, nums] of Object.entries(numbersByLabel)) {
      if (nums.length > 1) {
        // Check if same label has different values
        const baseValue = nums[0].value
        for (let i = 1; i < nums.length; i++) {
          const diff = Math.abs(nums[i].value - baseValue)
          const percentDiff = (diff / Math.max(baseValue, 1)) * 100

          if (percentDiff > tolerance && nums[0].unit === nums[i].unit) {
            errors.push({
              type: "numerical_drift",
              severity: Math.min(0.9, percentDiff / 100),
              evidence: `Inconsistent values for "${label}": ${baseValue} vs ${nums[i].value} (${percentDiff.toFixed(1)}% difference)`,
              timestamp: Date.now(),
              agentID: options?.agentID,
              sessionID: options?.sessionID,
              location: {
                startIndex: nums[i].index,
                endIndex: nums[i].index + nums[i].text.length,
              },
            })
          }
        }
      }
    }

    // Check against previous outputs
    for (const prev of previousOutputs) {
      const prevNumbers = extractNumbers(prev)

      for (const curr of currentNumbers) {
        for (const prevNum of prevNumbers) {
          if (curr.label === prevNum.label && curr.unit === prevNum.unit) {
            const diff = Math.abs(curr.value - prevNum.value)
            const percentDiff = (diff / Math.max(prevNum.value, 1)) * 100

            if (percentDiff > tolerance * 2) {
              // More tolerance for cross-output
              errors.push({
                type: "numerical_drift",
                severity: Math.min(0.7, percentDiff / 200),
                evidence: `Value drift for "${curr.label}": was ${prevNum.value}, now ${curr.value} (${percentDiff.toFixed(1)}% change)`,
                timestamp: Date.now(),
                agentID: options?.agentID,
                sessionID: options?.sessionID,
                location: {
                  startIndex: curr.index,
                  endIndex: curr.index + curr.text.length,
                },
              })
            }
          }
        }
      }
    }

    return errors
  }

  /**
   * Detect context omissions
   *
   * Checks if output adequately references required context
   */
  export function detectOmissions(
    output: string,
    requiredContext: string[],
    options?: {
      agentID?: string
      sessionID?: string
      minCoverage?: number
    },
  ): DetectedError[] {
    const errors: DetectedError[] = []
    const minCoverage = options?.minCoverage ?? 0.3

    // Extract keywords from output
    const outputKeywords = extractKeywords(output)
    const outputWordSet = new Set(outputKeywords)

    for (const ctx of requiredContext) {
      const ctxKeywords = extractKeywords(ctx)
      if (ctxKeywords.length === 0) continue

      // Calculate coverage
      const covered = ctxKeywords.filter((k) => outputWordSet.has(k)).length
      const coverage = covered / ctxKeywords.length

      if (coverage < minCoverage) {
        // Find what's missing
        const missing = ctxKeywords.filter((k) => !outputWordSet.has(k)).slice(0, 5)

        errors.push({
          type: "context_omission",
          severity: 1 - coverage,
          evidence: `Missing reference to context (${(coverage * 100).toFixed(0)}% coverage). Missing keywords: ${missing.join(", ")}. Context: "${ctx.substring(0, 80)}..."`,
          timestamp: Date.now(),
          agentID: options?.agentID,
          sessionID: options?.sessionID,
        })
      }
    }

    return errors
  }

  /**
   * Detect coordination failures in multi-agent scenarios
   *
   * Looks for:
   * - Task conflicts (multiple agents claiming same work)
   * - Message misinterpretation indicators
   * - Handoff failures
   */
  export function detectCoordinationFailures(
    agentOutputs: Array<{
      agentID: string
      output: string
      timestamp: number
    }>,
    options?: {
      sessionID?: string
    },
  ): DetectedError[] {
    const errors: DetectedError[] = []

    if (agentOutputs.length < 2) {
      return errors // Need at least 2 agents for coordination issues
    }

    // Extract claimed tasks/actions from each agent
    const taskPatterns = [
      /I (?:will|am going to|shall) ([\w\s]+)/gi,
      /(?:Working on|Handling|Processing|Completing) ([\w\s]+)/gi,
      /(?:Let me|I'll) ([\w\s]+)/gi,
    ]

    const claimedTasks: Array<{
      agentID: string
      task: string
      timestamp: number
    }> = []

    for (const { agentID, output, timestamp } of agentOutputs) {
      for (const pattern of taskPatterns) {
        let match
        const p = new RegExp(pattern.source, pattern.flags)
        while ((match = p.exec(output)) !== null) {
          const task = match[1].toLowerCase().trim()
          if (task.length > 5 && task.length < 100) {
            claimedTasks.push({ agentID, task, timestamp })
          }
        }
      }
    }

    // Check for task conflicts (similar tasks claimed by different agents)
    for (let i = 0; i < claimedTasks.length; i++) {
      for (let j = i + 1; j < claimedTasks.length; j++) {
        if (claimedTasks[i].agentID !== claimedTasks[j].agentID) {
          const similarity = calculateSimilarity(claimedTasks[i].task, claimedTasks[j].task)

          if (similarity > 0.6) {
            errors.push({
              type: "coordination_failure",
              severity: similarity,
              evidence: `Task conflict between ${claimedTasks[i].agentID} and ${claimedTasks[j].agentID}: "${claimedTasks[i].task}" vs "${claimedTasks[j].task}" (${(similarity * 100).toFixed(0)}% similar)`,
              timestamp: Date.now(),
              sessionID: options?.sessionID,
            })
          }
        }
      }
    }

    // Check for handoff failures (references to non-existent agent outputs)
    const agentIDs = new Set(agentOutputs.map((a) => a.agentID))
    const handoffPattern = /(?:from|by|per|according to) (\w+(?:\s+agent)?)/gi

    for (const { agentID, output } of agentOutputs) {
      let match
      while ((match = handoffPattern.exec(output)) !== null) {
        const referencedAgent = match[1].toLowerCase()
        if (
          referencedAgent.includes("agent") &&
          !agentIDs.has(referencedAgent) &&
          ![...agentIDs].some((id) => referencedAgent.includes(id.toLowerCase()))
        ) {
          errors.push({
            type: "coordination_failure",
            severity: 0.6,
            evidence: `Agent ${agentID} references unknown agent "${referencedAgent}"`,
            timestamp: Date.now(),
            agentID,
            sessionID: options?.sessionID,
          })
        }
      }
    }

    return errors
  }

  /**
   * Run all error detection algorithms on an output
   */
  export function analyzeOutput(
    output: string,
    context: {
      previousOutputs?: string[]
      requiredContext?: string[]
      otherAgentOutputs?: Array<{ agentID: string; output: string; timestamp: number }>
      agentID?: string
      sessionID?: string
    },
  ): AnalysisResult {
    const errors: DetectedError[] = []

    // Contradiction detection
    if (context.previousOutputs?.length) {
      errors.push(...detectContradictions(output, context.previousOutputs, {
        agentID: context.agentID,
        sessionID: context.sessionID,
      }))
    }

    // Numerical drift
    if (context.previousOutputs?.length) {
      errors.push(...detectNumericalDrift(output, context.previousOutputs, {
        agentID: context.agentID,
        sessionID: context.sessionID,
      }))
    }

    // Context omissions
    if (context.requiredContext?.length) {
      errors.push(...detectOmissions(output, context.requiredContext, {
        agentID: context.agentID,
        sessionID: context.sessionID,
      }))
    }

    // Coordination failures
    if (context.otherAgentOutputs?.length) {
      errors.push(
        ...detectCoordinationFailures(
          [
            { agentID: context.agentID ?? "current", output, timestamp: Date.now() },
            ...context.otherAgentOutputs,
          ],
          { sessionID: context.sessionID },
        ),
      )
    }

    // Calculate summary statistics
    const totalSeverity = errors.reduce((sum, e) => sum + e.severity, 0)
    const errorRate = errors.length / Math.max(1, output.split(/\s+/).length / 100) // Errors per 100 words

    // Find dominant error type
    const typeCounts: Record<ErrorType, number> = {
      logical_contradiction: 0,
      numerical_drift: 0,
      context_omission: 0,
      coordination_failure: 0,
    }
    for (const e of errors) {
      typeCounts[e.type]++
    }

    let dominant: ErrorType | null = null
    let maxCount = 0
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > maxCount) {
        maxCount = count
        dominant = type as ErrorType
      }
    }

    return {
      errors,
      totalSeverity,
      errorRate,
      dominant: maxCount > 0 ? dominant : null,
    }
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
      "she", "her", "i", "me", "my", "who", "what", "which", "when",
      "where", "why", "how", "all", "each", "every", "both", "few",
      "more", "most", "other", "some", "such", "no", "not", "only",
      "same", "so", "than", "too", "very", "just", "also", "now",
    ])

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopwords.has(w))
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  function calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2))

    if (wordsA.size === 0 && wordsB.size === 0) return 0

    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length
    const union = new Set([...wordsA, ...wordsB]).size

    return union > 0 ? intersection / union : 0
  }
}
