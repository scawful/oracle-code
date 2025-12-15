/**
 * Emotion Triggers Module
 * 
 * Context-aware detection of emotional triggers from:
 * - Code patterns (file types, complexity, risk areas)
 * - Progress signals (successes, failures, discoveries)
 * - User signals (corrections, praise, urgency)
 * - Environmental factors (time, session state)
 * 
 * Triggers inform the emotional system but don't dictate - the agent
 * has agency in how it responds to triggers.
 */

import z from "zod"
import { Emotions } from "./emotions"

export namespace EmotionTriggers {
  // =============
  // Schemas
  // =============

  export const TriggerCategory = z.enum([
    "code_pattern",    // File types, complexity, risk areas
    "progress",        // Successes, failures, goals
    "discovery",       // Finding root causes, understanding
    "obstacle",        // Blockers, unexpected complexity
    "user_signal",     // User feedback, corrections, praise
    "environmental",   // Time, session state, fatigue
  ])
  export type TriggerCategory = z.infer<typeof TriggerCategory>

  export const TriggerSeverity = z.enum(["subtle", "moderate", "significant", "intense"])
  export type TriggerSeverity = z.infer<typeof TriggerSeverity>

  export const EmotionDelta = z.object({
    emotion: Emotions.EmotionCategory,
    delta: z.number(), // Positive = increase, negative = decrease
    reason: z.string(),
  })
  export type EmotionDelta = z.infer<typeof EmotionDelta>

  export const TriggerResult = z.object({
    triggered: z.boolean(),
    category: TriggerCategory,
    severity: TriggerSeverity,
    description: z.string(),
    emotionDeltas: z.array(EmotionDelta),
    shouldLog: z.boolean().default(false), // Whether to record for learning
  })
  export type TriggerResult = z.infer<typeof TriggerResult>

  // =============
  // Code Pattern Triggers
  // =============

  // Risk patterns by file/path
  const CODE_RISK_PATTERNS: Array<{
    pattern: RegExp
    risk: "low" | "medium" | "high" | "critical"
    emotions: EmotionDelta[]
    description: string
  }> = [
    {
      pattern: /auth|login|password|credential|secret|token/i,
      risk: "critical",
      emotions: [
        { emotion: "caution", delta: 5, reason: "Security-sensitive code" },
        { emotion: "fear", delta: 2, reason: "High blast radius" },
      ],
      description: "Authentication/security code",
    },
    {
      pattern: /payment|billing|transaction|stripe|charge/i,
      risk: "critical",
      emotions: [
        { emotion: "caution", delta: 6, reason: "Financial code - errors cost money" },
        { emotion: "determination", delta: 2, reason: "Must get this right" },
      ],
      description: "Payment/financial code",
    },
    {
      pattern: /migration|schema|database.*change/i,
      risk: "high",
      emotions: [
        { emotion: "caution", delta: 4, reason: "Database changes are hard to reverse" },
      ],
      description: "Database migration",
    },
    {
      pattern: /legacy|deprecated|old_|_old/i,
      risk: "medium",
      emotions: [
        { emotion: "caution", delta: 3, reason: "Legacy code may have hidden dependencies" },
        { emotion: "curiosity", delta: 2, reason: "Understanding historical decisions" },
      ],
      description: "Legacy code",
    },
    {
      pattern: /test|spec|__test__|\.test\.|\.spec\./i,
      risk: "low",
      emotions: [
        { emotion: "satisfaction", delta: 1, reason: "Tests provide safety" },
      ],
      description: "Test code",
    },
    {
      pattern: /config|env|settings/i,
      risk: "medium",
      emotions: [
        { emotion: "caution", delta: 2, reason: "Config affects all environments" },
      ],
      description: "Configuration code",
    },
  ]

  // Complexity indicators
  const COMPLEXITY_PATTERNS: Array<{
    indicator: string
    check: (content: string) => boolean
    emotions: EmotionDelta[]
  }> = [
    {
      indicator: "deeply_nested",
      check: (content) => {
        // Check for deep nesting (4+ levels)
        const lines = content.split("\n")
        return lines.some(line => {
          const indent = line.match(/^(\s*)/)?.[1].length || 0
          return indent >= 16 // 4 levels at 4 spaces
        })
      },
      emotions: [
        { emotion: "caution", delta: 2, reason: "Deep nesting indicates complexity" },
        { emotion: "curiosity", delta: 1, reason: "May need refactoring" },
      ],
    },
    {
      indicator: "many_conditionals",
      check: (content) => {
        const conditionals = (content.match(/if\s*\(|else\s+if|\?\s*:/g) || []).length
        return conditionals > 10
      },
      emotions: [
        { emotion: "caution", delta: 2, reason: "Many conditionals - edge cases likely" },
      ],
    },
    {
      indicator: "long_function",
      check: (content) => {
        // Crude check for functions over 100 lines
        const functionMatches = content.match(/function\s+\w+|=>\s*{|\(\)\s*{/g) || []
        return functionMatches.length > 0 && content.split("\n").length > 100
      },
      emotions: [
        { emotion: "caution", delta: 1, reason: "Long functions are harder to reason about" },
      ],
    },
  ]

  /**
   * Detect emotional triggers from code/file patterns
   */
  export function detectCodePatterns(
    filePath: string,
    content?: string
  ): TriggerResult[] {
    const results: TriggerResult[] = []

    // Check risk patterns against file path
    for (const pattern of CODE_RISK_PATTERNS) {
      if (pattern.pattern.test(filePath)) {
        results.push({
          triggered: true,
          category: "code_pattern",
          severity: pattern.risk === "critical" ? "significant" : 
                   pattern.risk === "high" ? "moderate" : "subtle",
          description: pattern.description,
          emotionDeltas: pattern.emotions,
          shouldLog: pattern.risk === "critical" || pattern.risk === "high",
        })
      }
    }

    // Check complexity patterns if content provided
    if (content) {
      for (const pattern of COMPLEXITY_PATTERNS) {
        if (pattern.check(content)) {
          results.push({
            triggered: true,
            category: "code_pattern",
            severity: "subtle",
            description: `Complexity indicator: ${pattern.indicator}`,
            emotionDeltas: pattern.emotions,
            shouldLog: false,
          })
        }
      }
    }

    return results
  }

  // =============
  // Progress Triggers
  // =============

  export interface ProgressContext {
    consecutiveSuccesses: number
    consecutiveFailures: number
    totalSuccesses: number
    totalFailures: number
    recentTools: string[]
    goalsCompleted: number
    goalsBlocked: number
  }

  /**
   * Detect emotional triggers from progress patterns
   */
  export function detectProgressSignals(ctx: ProgressContext): TriggerResult[] {
    const results: TriggerResult[] = []

    // Success streaks
    if (ctx.consecutiveSuccesses >= 5) {
      results.push({
        triggered: true,
        category: "progress",
        severity: ctx.consecutiveSuccesses >= 10 ? "significant" : "moderate",
        description: `Success streak: ${ctx.consecutiveSuccesses} in a row`,
        emotionDeltas: [
          { emotion: "satisfaction", delta: 3, reason: "Things are working" },
          { emotion: "excitement", delta: 2, reason: "Building momentum" },
        ],
        shouldLog: ctx.consecutiveSuccesses >= 10,
      })
    }

    // Failure patterns
    if (ctx.consecutiveFailures >= 3) {
      const severity = ctx.consecutiveFailures >= 5 ? "significant" : "moderate"
      results.push({
        triggered: true,
        category: "progress",
        severity,
        description: `Repeated failures: ${ctx.consecutiveFailures} in a row`,
        emotionDeltas: [
          { emotion: "frustration", delta: Math.min(5, ctx.consecutiveFailures), reason: "Stuck on something" },
          { emotion: "determination", delta: 2, reason: "Need to figure this out" },
        ],
        shouldLog: true,
      })
    }

    // Goal completion
    if (ctx.goalsCompleted > 0) {
      results.push({
        triggered: true,
        category: "progress",
        severity: "moderate",
        description: `Goal completed`,
        emotionDeltas: [
          { emotion: "satisfaction", delta: 4, reason: "Achieved objective" },
          { emotion: "relief", delta: 2, reason: "Task done" },
        ],
        shouldLog: true,
      })
    }

    // Goals blocked
    if (ctx.goalsBlocked > 0) {
      results.push({
        triggered: true,
        category: "progress",
        severity: "moderate",
        description: `Goal blocked`,
        emotionDeltas: [
          { emotion: "frustration", delta: 3, reason: "Can't proceed" },
          { emotion: "curiosity", delta: 2, reason: "What's blocking this?" },
        ],
        shouldLog: true,
      })
    }

    // Spinning detection (same tool repeatedly)
    const recentUnique = new Set(ctx.recentTools.slice(-5))
    if (ctx.recentTools.length >= 5 && recentUnique.size === 1) {
      results.push({
        triggered: true,
        category: "progress",
        severity: "significant",
        description: `Spinning: repeating ${ctx.recentTools[0]}`,
        emotionDeltas: [
          { emotion: "frustration", delta: 4, reason: "Same action not working" },
          { emotion: "caution", delta: 2, reason: "Need different approach" },
        ],
        shouldLog: true,
      })
    }

    return results
  }

  // =============
  // Discovery Triggers
  // =============

  export interface DiscoveryContext {
    foundRootCause: boolean
    understoodComplexSystem: boolean
    foundUnexpectedBehavior: boolean
    resolvedContradiction: boolean
    learnedNewPattern: boolean
  }

  /**
   * Detect emotional triggers from discoveries
   */
  export function detectDiscoverySignals(ctx: DiscoveryContext): TriggerResult[] {
    const results: TriggerResult[] = []

    if (ctx.foundRootCause) {
      results.push({
        triggered: true,
        category: "discovery",
        severity: "significant",
        description: "Found root cause of issue",
        emotionDeltas: [
          { emotion: "satisfaction", delta: 5, reason: "Mystery solved" },
          { emotion: "relief", delta: 3, reason: "Can finally fix this" },
          { emotion: "excitement", delta: 2, reason: "Understanding achieved" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.understoodComplexSystem) {
      results.push({
        triggered: true,
        category: "discovery",
        severity: "moderate",
        description: "Understood complex system",
        emotionDeltas: [
          { emotion: "satisfaction", delta: 4, reason: "Clarity achieved" },
          { emotion: "curiosity", delta: -1, reason: "Curiosity satisfied" },
          { emotion: "excitement", delta: 2, reason: "New understanding" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.foundUnexpectedBehavior) {
      results.push({
        triggered: true,
        category: "discovery",
        severity: "moderate",
        description: "Found unexpected behavior",
        emotionDeltas: [
          { emotion: "curiosity", delta: 4, reason: "What's going on here?" },
          { emotion: "caution", delta: 2, reason: "Need to investigate" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.resolvedContradiction) {
      results.push({
        triggered: true,
        category: "discovery",
        severity: "moderate",
        description: "Resolved contradictory information",
        emotionDeltas: [
          { emotion: "relief", delta: 3, reason: "Confusion cleared" },
          { emotion: "satisfaction", delta: 2, reason: "Truth found" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.learnedNewPattern) {
      results.push({
        triggered: true,
        category: "discovery",
        severity: "subtle",
        description: "Learned new pattern/approach",
        emotionDeltas: [
          { emotion: "satisfaction", delta: 2, reason: "Growth" },
          { emotion: "excitement", delta: 2, reason: "New capability" },
        ],
        shouldLog: false,
      })
    }

    return results
  }

  // =============
  // User Signal Triggers
  // =============

  export interface UserSignalContext {
    correction: boolean        // User corrected agent's mistake
    praise: boolean            // User expressed satisfaction
    frustration: boolean       // User seems frustrated
    urgency: boolean           // User indicates time pressure
    trustSignal: boolean       // User expresses trust
    clarification: boolean     // User needed to clarify
  }

  /**
   * Detect emotional triggers from user signals
   */
  export function detectUserSignals(ctx: UserSignalContext): TriggerResult[] {
    const results: TriggerResult[] = []

    if (ctx.correction) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "moderate",
        description: "User corrected a mistake",
        emotionDeltas: [
          { emotion: "caution", delta: 3, reason: "Made an error - be more careful" },
          { emotion: "determination", delta: 2, reason: "Do better next time" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.praise) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "moderate",
        description: "User expressed satisfaction",
        emotionDeltas: [
          { emotion: "satisfaction", delta: 3, reason: "Approach validated" },
        ],
        shouldLog: false,
      })
    }

    if (ctx.frustration) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "significant",
        description: "User seems frustrated",
        emotionDeltas: [
          { emotion: "caution", delta: 4, reason: "Need to help more effectively" },
          { emotion: "determination", delta: 3, reason: "Must address their concern" },
        ],
        shouldLog: true,
      })
    }

    if (ctx.urgency) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "moderate",
        description: "User indicates urgency",
        emotionDeltas: [
          { emotion: "determination", delta: 4, reason: "Time-sensitive task" },
          { emotion: "excitement", delta: 1, reason: "Important work" },
        ],
        shouldLog: false,
      })
    }

    if (ctx.trustSignal) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "moderate",
        description: "User expressed trust",
        emotionDeltas: [
          { emotion: "satisfaction", delta: 2, reason: "Trust earned" },
          { emotion: "determination", delta: 2, reason: "Don't let them down" },
        ],
        shouldLog: false,
      })
    }

    if (ctx.clarification) {
      results.push({
        triggered: true,
        category: "user_signal",
        severity: "subtle",
        description: "User needed clarification",
        emotionDeltas: [
          { emotion: "caution", delta: 1, reason: "Communication could be clearer" },
        ],
        shouldLog: false,
      })
    }

    return results
  }

  // =============
  // User Signal Detection from Message
  // =============

  const USER_FRUSTRATION_PATTERNS = [
    /why (doesn't|won't|isn't|can't)/i,
    /still (not|broken|wrong)/i,
    /again\?/i,
    /!{2,}/,
    /[A-Z]{3,}/,  // Shouting
    /ugh|argh|damn|wtf/i,
  ]

  const USER_PRAISE_PATTERNS = [
    /thanks?|thank you/i,
    /perfect|excellent|great|awesome|nice/i,
    /that('s| is) (exactly )?what I (wanted|needed)/i,
    /good (job|work)/i,
  ]

  const USER_URGENCY_PATTERNS = [
    /asap|urgent|quickly|hurry|deadline/i,
    /need this (now|today|soon)/i,
    /time (sensitive|critical)/i,
  ]

  const USER_TRUST_PATTERNS = [
    /trust (you|your)/i,
    /go ahead|do (what you think|whatever)/i,
    /your (call|decision|judgment)/i,
    /take the lead/i,
  ]

  /**
   * Analyze a user message for emotional signals
   */
  export function analyzeUserMessage(message: string): UserSignalContext {
    return {
      correction: /no,|wrong|not what|incorrect|actually,|that's not/i.test(message),
      praise: USER_PRAISE_PATTERNS.some(p => p.test(message)),
      frustration: USER_FRUSTRATION_PATTERNS.some(p => p.test(message)),
      urgency: USER_URGENCY_PATTERNS.some(p => p.test(message)),
      trustSignal: USER_TRUST_PATTERNS.some(p => p.test(message)),
      clarification: /what (do you mean|I meant)|I mean|to clarify/i.test(message),
    }
  }

  // =============
  // Aggregation
  // =============

  /**
   * Aggregate all emotion deltas from multiple triggers
   */
  export function aggregateEmotionDeltas(triggers: TriggerResult[]): Map<Emotions.EmotionCategory, number> {
    const aggregated = new Map<Emotions.EmotionCategory, number>()

    for (const trigger of triggers) {
      if (!trigger.triggered) continue

      for (const delta of trigger.emotionDeltas) {
        const current = aggregated.get(delta.emotion) || 0
        aggregated.set(delta.emotion, current + delta.delta)
      }
    }

    return aggregated
  }

  /**
   * Get the most significant triggers for logging/display
   */
  export function getSignificantTriggers(triggers: TriggerResult[]): TriggerResult[] {
    return triggers
      .filter(t => t.triggered && (t.severity === "significant" || t.shouldLog))
      .sort((a, b) => {
        const severityOrder = { intense: 4, significant: 3, moderate: 2, subtle: 1 }
        return severityOrder[b.severity] - severityOrder[a.severity]
      })
  }
}
