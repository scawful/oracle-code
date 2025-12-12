/**
 * Cognitive Protocol Integration
 *
 * This module integrates the cognitive protocol with oracle-code's
 * session and tool processing. It:
 *
 * 1. Subscribes to tool execution events for spin detection
 * 2. Subscribes to message events for goal tracking
 * 3. Subscribes to file watcher for epistemic decay
 * 4. Provides hooks for system prompt enhancement
 * 5. Manages flow state notifications
 * 6. Auto-records epistemic facts from tool outputs
 * 7. Tracks emotional state and auto-detects emotions
 * 8. Evaluates analysis triggers based on cognitive state
 */

import { Bus } from "../bus"
import { AFS } from "../afs"
import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"
import { Metacognition } from "./metacognition"
import { Goals } from "./goals"
import { Epistemic } from "./epistemic"
import { Emotions } from "./emotions"
import { AnalysisTriggers } from "./analysis-triggers"
import { Hivemind } from "./hivemind"
import type {
  HivemindState,
  HivemindEntry,
  HivemindCategory,
  HivemindScope,
  DecayResult,
  CouncilSession,
} from "./hivemind"
import { Instance } from "../project/instance"
import { FileWatcher } from "../file/watcher"
import { AdaptiveCritic, getCritic, type CriticTone, type CriticReview } from "../analysis"

export namespace CognitiveIntegration {
  const log = Log.create({ service: "cognitive" })

  // Track if we've already initialized
  let initialized = false
  
  // Track modified files since last decay check (for epistemic decay)
  let modifiedFilesSinceLastDecay: string[] = []

  // Track consecutive successes/failures for emotional detection
  let consecutiveSuccesses = 0
  let consecutiveFailures = 0
  let consecutiveEditsWithoutTests = 0
  let recentTools: string[] = []
  let knownFiles: string[] = []

  // Pending analysis triggers (to be processed by UI)
  let pendingTriggers: AnalysisTriggers.TriggeredAnalysis[] = []

  /**
   * Initialize the cognitive integration.
   * Call this once during application startup.
   */
  export async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    log.info("initializing cognitive integration")

    // Initialize Hivemind system
    try {
      const root = await AFS.findRoot()
      if (root) {
        await Hivemind.init(root)
        log.info("hivemind initialized")
      }
    } catch (e) {
      log.error("error initializing hivemind", { error: e })
    }

    // Subscribe to tool part updates for spin detection and epistemic recording
    Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const part = event.properties.part
      if (part.type !== "tool") return
      if (part.state.status !== "completed" && part.state.status !== "error") return

      try {
        const root = await AFS.findRoot()
        if (!root) return

        // Record the action for spin detection
        const actionDescription = `${part.tool}: ${JSON.stringify(part.state.input).slice(0, 100)}`
        await Metacognition.recordAction(root, actionDescription)

        // Track tool usage patterns
        recentTools.push(part.tool)
        if (recentTools.length > 20) {
          recentTools = recentTools.slice(-20)
        }

        // Track edits without tests
        if (part.tool === "edit" || part.tool === "write") {
          consecutiveEditsWithoutTests++
          // Track files being edited
          const filePath = (part.state.status === "completed" ? part.state.input : {}) as any
          if (filePath?.filePath && !knownFiles.includes(filePath.filePath)) {
            knownFiles.push(filePath.filePath)
          }
        } else if (part.tool === "bash") {
          // Check if it's a test command
          const cmd = ((part.state.status === "completed" ? part.state.input : {}) as any)?.command || ""
          if (cmd.includes("test") || cmd.includes("jest") || cmd.includes("pytest") || cmd.includes("vitest")) {
            consecutiveEditsWithoutTests = 0
          }
        }

        // Record success or failure with emotional tracking
        if (part.state.status === "completed") {
          await Metacognition.recordSuccess(root)
          consecutiveSuccesses++
          consecutiveFailures = 0
          
          // Boost confidence on success
          await Emotions.adjustConfidence(root, 2)
          
          // Auto-record epistemic facts from tool outputs
          await recordEpistemicFactsFromTool(root, part)
          
          // Detect emotions from tool patterns
          await detectAndRecordEmotions(root, part, true)
        } else if (part.state.status === "error") {
          await Metacognition.recordFailure(root)
          consecutiveFailures++
          consecutiveSuccesses = 0
          
          // Increase anxiety on failure
          await Emotions.adjustAnxiety(root, 5)
          await Emotions.adjustConfidence(root, -3)
          
          // Detect emotions from tool patterns
          await detectAndRecordEmotions(root, part, false)
        }

        // Check and update flow state
        const { inFlow, changed } = await Metacognition.checkFlowState(root)
        if (changed) {
          log.info("flow state changed", { inFlow })
          // Record satisfaction when entering flow state
          if (inFlow) {
            await Emotions.adjustConfidence(root, 15)
            await Emotions.updateMood(root, "confident", "Entered flow state")
            await Emotions.addEmotion(root, "satisfaction", "Achieved flow state", "Operating smoothly with high effectiveness", 7)
          }
        }

        // Evaluate triggers after each tool execution
        await evaluateAndQueueTriggers(root)
      } catch (e) {
        log.error("error updating metacognition", { error: e })
      }
    })

    // Subscribe to user messages for potential goal updates
    Bus.subscribe(MessageV2.Event.Updated, async (event) => {
      const msg = event.properties.info
      if (msg.role !== "user") return

      try {
        const root = await AFS.findRoot()
        if (!root) return

        // Update cognitive load based on active context
        // For now, just set a moderate load - actual content comes from parts
        // The message parts would need to be fetched separately for word counting
        const itemsInFocus = 3 // Default moderate cognitive load
        await Metacognition.updateCognitiveLoad(root, itemsInFocus)
      } catch (e) {
        log.error("error updating cognitive load", { error: e })
      }
    })

    // Subscribe to file watcher for epistemic decay tracking
    Bus.subscribe(FileWatcher.Event.Updated, async (event) => {
      try {
        // Track modified files for decay acceleration
        const filePath = event.properties.file
        if (!modifiedFilesSinceLastDecay.includes(filePath)) {
          modifiedFilesSinceLastDecay.push(filePath)
        }
      } catch (e) {
        // Ignore file watcher errors
      }
    })

    log.info("cognitive integration initialized")
  }

  /**
   * Record epistemic facts from tool execution output.
   * Called when a tool completes successfully.
   */
  async function recordEpistemicFactsFromTool(
    root: string,
    part: MessageV2.ToolPart
  ): Promise<void> {
    try {
      const settings = await Epistemic.getSettings(root)
      if (!settings.autoRecordFromTools) return

      const tool = part.tool
      const input = part.state.status === "completed" ? part.state.input : {}
      const output = part.state.status === "completed" ? part.state.output : ""

      switch (tool) {
        case "read": {
          // Record file existence
          const filePath = (input as any)?.filePath
          if (filePath) {
            const fileName = filePath.replace(/[\/\\]/g, "_").replace(/\./g, "_")
            await Epistemic.addWorkingFact(
              root,
              `file.${fileName}.exists`,
              true,
              0.95,
              "file_read",
              [filePath]
            )
          }
          break
        }

        case "glob": {
          // Record pattern match results
          const pattern = (input as any)?.pattern
          if (pattern && output) {
            const matches = output.split("\n").filter((l: string) => l.trim()).length
            const patternKey = pattern.replace(/[*\/\\\.]/g, "_").replace(/__+/g, "_")
            await Epistemic.addWorkingFact(
              root,
              `search.glob.${patternKey}.count`,
              matches,
              0.9,
              "tool_output"
            )
          }
          break
        }

        case "grep": {
          // Record search results
          const searchPattern = (input as any)?.pattern
          if (searchPattern && output !== undefined) {
            const found = output && output.length > 0
            const patternKey = searchPattern.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)
            await Epistemic.addWorkingFact(
              root,
              `search.grep.${patternKey}.found`,
              found,
              0.85,
              "tool_output"
            )
          }
          break
        }

        case "bash": {
          // Try to extract version information from common commands
          const command = (input as any)?.command || ""
          
          // Detect version commands
          if (command.includes("--version") || command.includes("-v")) {
            const versionMatch = output?.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1]
            if (versionMatch) {
              // Extract tool name from command
              const toolName = command.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "_")
              await Epistemic.addWorkingFact(
                root,
                `runtime.${toolName}.version`,
                versionMatch,
                0.9,
                "tool_output"
              )
            }
          }
          break
        }
      }
    } catch (e) {
      log.error("error recording epistemic facts from tool", { error: e, tool: part.tool })
    }
  }

  /**
   * Detect and record emotions from tool execution patterns.
   */
  async function detectAndRecordEmotions(
    root: string,
    part: MessageV2.ToolPart,
    success: boolean
  ): Promise<void> {
    try {
      const settings = await Emotions.getSettings(root)
      if (!settings.enableAutoDetection) return

      // Detect emotions from tool result
      const suggestion = Emotions.detectEmotionFromToolResult(part.tool, success, {
        consecutiveFailures,
        consecutiveSuccesses,
      })

      if (suggestion) {
        await Emotions.addEmotion(
          root,
          suggestion.category,
          suggestion.trigger,
          suggestion.context,
          suggestion.intensity,
          {
            tags: suggestion.tags,
            relatedFiles: suggestion.relatedFiles,
          }
        )
        log.info("auto-recorded emotion", { category: suggestion.category, trigger: suggestion.trigger })
      }
    } catch (e) {
      log.error("error detecting emotions from tool", { error: e })
    }
  }

  /**
   * Build a cognitive snapshot for trigger evaluation.
   */
  async function buildCognitiveSnapshot(root: string): Promise<AnalysisTriggers.CognitiveSnapshot> {
    const snapshot: AnalysisTriggers.CognitiveSnapshot = {
      consecutiveFailures,
      consecutiveEditsWithoutTests,
      sameToolRepeatedCount: AnalysisTriggers.countSameToolRepeated(
        recentTools.map((t) => ({ tool: t }))
      ),
      knownFiles,
    }

    // Add metacognition data
    const metaState = await Metacognition.read(root)
    if (metaState) {
      const summary = Metacognition.getStatusSummary(metaState)
      snapshot.isSpinning = summary.isSpinning
      snapshot.cognitiveLoad = summary.cognitiveLoad
      snapshot.frustration = Math.round(summary.frustration * 100)
      snapshot.inFlowState = summary.flowState
      snapshot.strategyEffectiveness = Math.round(summary.strategyEffectiveness * 100)
    }

    // Add epistemic data
    const epistemicState = await Epistemic.read(root)
    if (epistemicState) {
      const summary = Epistemic.getStatusSummary(epistemicState)
      snapshot.contradictionCount = summary.contradictionCount
      snapshot.criticalUnknowns = summary.criticalUnknowns
      snapshot.unvalidatedAssumptions = summary.unvalidatedCount
    }

    // Add emotional data
    const emotionalState = await Emotions.read(root)
    if (emotionalState) {
      const summary = Emotions.getStatusSummary(emotionalState)
      snapshot.anxietyLevel = summary.anxietyLevel
      snapshot.confidenceLevel = summary.confidenceLevel
      snapshot.recentFearCount = summary.fearCount
      snapshot.currentMood = summary.mood
    }

    return snapshot
  }

  /**
   * Evaluate triggers and queue any that fire.
   */
  async function evaluateAndQueueTriggers(root: string): Promise<void> {
    try {
      const snapshot = await buildCognitiveSnapshot(root)
      const triggered = await AnalysisTriggers.evaluateTriggers(root, snapshot)

      for (const analysis of triggered) {
        // Record that trigger fired
        await AnalysisTriggers.recordTriggerFired(root, analysis.trigger.id, analysis.trigger.autoAccept)

        // Handle auto-accept triggers (like emotion recording)
        if (analysis.trigger.autoAccept) {
          // If there's an emotion to record, record it
          if (analysis.trigger.suggestion.emotionToRecord) {
            const e = analysis.trigger.suggestion.emotionToRecord
            await Emotions.addEmotion(root, e.category, e.trigger, `Auto-triggered: ${analysis.trigger.name}`, e.intensity)
          }
          log.info("auto-accepted trigger", { trigger: analysis.trigger.name })
        } else {
          // Queue for user confirmation
          pendingTriggers.push(analysis)
          log.info("queued trigger for confirmation", { trigger: analysis.trigger.name })
        }
      }
    } catch (e) {
      log.error("error evaluating triggers", { error: e })
    }
  }

  /**
   * Get pending analysis triggers (for UI to display).
   */
  export function getPendingTriggers(): AnalysisTriggers.TriggeredAnalysis[] {
    return [...pendingTriggers]
  }

  /**
   * Clear a pending trigger (after user accepts/denies).
   */
  export function clearPendingTrigger(triggerId: string): boolean {
    const index = pendingTriggers.findIndex((t) => t.trigger.id === triggerId)
    if (index === -1) return false
    pendingTriggers.splice(index, 1)
    return true
  }

  /**
   * Clear all pending triggers.
   */
  export function clearAllPendingTriggers(): void {
    pendingTriggers = []
  }

  /**
   * Get the current cognitive state summary for inclusion in prompts.
   */
  export async function getPromptContext(): Promise<string | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      const metaState = await Metacognition.read(root)
      const goalHierarchy = await Goals.read(root)
      const epistemicState = await Epistemic.read(root)
      const emotionalState = await Emotions.read(root)

      if (!metaState && !goalHierarchy && !epistemicState && !emotionalState) return null

      const lines: string[] = ["<cognitive_state>"]

      if (metaState) {
        const summary = Metacognition.getStatusSummary(metaState)
        lines.push("## Metacognition")
        lines.push(`- Strategy: ${summary.strategy}`)
        lines.push(`- Progress: ${summary.progress}`)
        lines.push(`- Cognitive Load: ${summary.cognitiveLoad}%`)
        if (summary.isSpinning) {
          lines.push(`- WARNING: Spinning detected - consider changing approach`)
        }
        if (summary.shouldSeekHelp) {
          lines.push(`- NOTE: High uncertainty - consider asking user for clarification`)
        }
        if (summary.flowState) {
          lines.push(`- Flow State: Active - operating autonomously`)
        }
      }

      if (goalHierarchy?.primaryGoal) {
        const summary = Goals.getStatusSummary(goalHierarchy)
        lines.push("")
        lines.push("## Current Goals")
        lines.push(`- Primary: ${summary.primaryGoal}`)
        lines.push(`- Progress: ${summary.completionPercentage.toFixed(0)}%`)
        if (summary.currentFocus && summary.currentFocus !== summary.primaryGoal) {
          lines.push(`- Current Focus: ${summary.currentFocus}`)
        }
        if (summary.unresolvedConflicts > 0) {
          lines.push(`- WARNING: ${summary.unresolvedConflicts} unresolved goal conflict(s)`)
        }
      }

      if (epistemicState) {
        const summary = Epistemic.getStatusSummary(epistemicState)
        lines.push("")
        lines.push("## Knowledge State")
        lines.push(`- Golden Facts: ${summary.goldenFactCount}/${summary.maxGoldenFacts}`)
        lines.push(`- Working Facts: ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% confident)`)
        if (summary.unvalidatedCount > 0) {
          lines.push(`- Assumptions: ${summary.assumptionCount} (${summary.unvalidatedCount} unvalidated)`)
        }
        if (summary.criticalUnknowns > 0) {
          lines.push(`- WARNING: ${summary.criticalUnknowns} critical unknown(s) - consider research_first strategy`)
          const critical = Epistemic.getCriticalUnknowns(epistemicState)
          for (const u of critical.slice(0, 3)) {
            lines.push(`  - ${u.topic}`)
          }
        }
        if (summary.contradictionCount > 0) {
          lines.push(`- WARNING: ${summary.contradictionCount} unresolved contradiction(s)`)
        }
      }

      // Emotional state
      if (emotionalState) {
        const summary = Emotions.getStatusSummary(emotionalState)
        const moodEmoji: Record<string, string> = {
          positive: "😊",
          neutral: "😐",
          negative: "😔",
          anxious: "😰",
          confident: "🎯",
          frustrated: "😤",
          curious: "🤔",
        }
        lines.push("")
        lines.push("## Emotional State")
        lines.push(`- Mood: ${moodEmoji[summary.mood] || ""} ${summary.mood}`)
        lines.push(`- Anxiety: ${summary.anxietyLevel}%${summary.isAnxious ? " (HIGH)" : ""}`)
        lines.push(`- Confidence: ${summary.confidenceLevel}%${summary.isConfident ? " (HIGH)" : ""}`)
        if (summary.fearCount > 0) {
          lines.push(`- Active Fears: ${summary.fearCount}`)
        }
        if (summary.isAnxious) {
          lines.push("- NOTE: Anxiety is elevated - consider cautious approach")
        }
      }

      // Hivemind context
      const hivemindContext = await getHivemindPromptContext(root)
      if (hivemindContext) {
        lines.push("")
        lines.push(hivemindContext)
      }

      lines.push("</cognitive_state>")
      return lines.join("\n")
    } catch (e) {
      log.error("error getting prompt context", { error: e })
      return null
    }
  }

  /**
   * Get hivemind context for system prompt injection.
   * Returns relevant entries from the hivemind for inclusion in prompts.
   */
  async function getHivemindPromptContext(root: string): Promise<string | null> {
    try {
      const entries = await Hivemind.getPromptEntries(root, {
        maxFears: 3,
        maxSatisfactions: 3,
        maxKnowledge: 5,
        maxDecisions: 5,
        includeGlobal: true,
      })

      const lines: string[] = []

      // Only add section if we have entries
      const hasEntries =
        entries.fears.length > 0 ||
        entries.satisfactions.length > 0 ||
        entries.knowledge.length > 0 ||
        entries.decisions.length > 0 ||
        entries.preferences.length > 0

      if (!hasEntries) return null

      lines.push("## Hivemind (Cross-Session Learning)")

      // Fears - things to watch out for
      if (entries.fears.length > 0) {
        lines.push("")
        lines.push("### Known Pitfalls")
        for (const fear of entries.fears) {
          const badge = fear.status === "golden" ? " [GOLDEN]" : ""
          lines.push(`- ${fear.key}${badge}: ${fear.value}`)
        }
      }

      // Satisfactions - what works well
      if (entries.satisfactions.length > 0) {
        lines.push("")
        lines.push("### What Works Well")
        for (const sat of entries.satisfactions) {
          const badge = sat.status === "golden" ? " [GOLDEN]" : ""
          lines.push(`- ${sat.key}${badge}: ${sat.value}`)
        }
      }

      // Knowledge - established facts
      if (entries.knowledge.length > 0) {
        lines.push("")
        lines.push("### Established Knowledge")
        for (const k of entries.knowledge) {
          const badge = k.status === "golden" ? " [GOLDEN]" : ""
          lines.push(`- ${k.key}${badge}: ${k.value}`)
        }
      }

      // Decisions - past decisions to respect
      if (entries.decisions.length > 0) {
        lines.push("")
        lines.push("### Past Decisions")
        for (const d of entries.decisions) {
          const badge = d.status === "golden" ? " [GOLDEN]" : ""
          lines.push(`- ${d.key}${badge}: ${d.value}`)
        }
      }

      // Preferences - user/project preferences
      if (entries.preferences.length > 0) {
        lines.push("")
        lines.push("### Preferences")
        for (const p of entries.preferences) {
          lines.push(`- ${p.key}: ${p.value}`)
        }
      }

      return lines.join("\n")
    } catch (e) {
      log.error("error getting hivemind prompt context", { error: e })
      return null
    }
  }

  /**
   * Parse a user message to potentially extract goal information.
   * Returns suggested goal updates based on message content.
   */
  export function parseGoalIntent(message: string): {
    isPrimaryGoal: boolean
    description: string | null
    keywords: string[]
  } {
    const lowerMessage = message.toLowerCase()

    // Keywords that suggest a new primary goal
    const goalKeywords = [
      "implement",
      "create",
      "build",
      "add",
      "fix",
      "refactor",
      "update",
      "change",
      "modify",
      "remove",
      "delete",
      "migrate",
      "upgrade",
      "setup",
      "configure",
    ]

    const foundKeywords = goalKeywords.filter((kw) => lowerMessage.includes(kw))

    // Simple heuristic: if message starts with an action verb, it's likely a goal
    const isPrimaryGoal = foundKeywords.length > 0 && message.length > 10

    return {
      isPrimaryGoal,
      description: isPrimaryGoal ? message : null,
      keywords: foundKeywords,
    }
  }

  /**
   * Record that a strategy was used and whether it was effective.
   */
  export async function recordStrategyOutcome(
    strategy: Metacognition.Strategy,
    effective: boolean,
  ): Promise<void> {
    try {
      const root = await AFS.findRoot()
      if (!root) return

      await Metacognition.setStrategy(root, strategy)
      const delta = effective ? 0.1 : -0.15
      await Metacognition.updateStrategyEffectiveness(root, delta)
    } catch (e) {
      log.error("error recording strategy outcome", { error: e })
    }
  }

  /**
   * Set a primary goal from user input.
   */
  export async function setGoalFromMessage(
    message: string,
    options: {
      successCriteria?: string[]
      constraints?: string[]
    } = {},
  ): Promise<Goals.GoalHierarchy | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      return await Goals.setPrimaryGoal(root, message, {
        userStated: message,
        successCriteria: options.successCriteria,
        constraints: options.constraints,
      })
    } catch (e) {
      log.error("error setting goal", { error: e })
      return null
    }
  }

  /**
   * Get recommendations based on current cognitive state.
   */
  export async function getRecommendations(): Promise<string[]> {
    const recommendations: string[] = []

    try {
      const root = await AFS.findRoot()
      if (!root) return recommendations

      const metaState = await Metacognition.read(root)
      const epistemicState = await Epistemic.read(root)

      if (metaState) {
        const summary = Metacognition.getStatusSummary(metaState)

        if (summary.isSpinning) {
          recommendations.push("Consider changing your approach - similar actions are being repeated")
          recommendations.push(`Try a different strategy like '${suggestAlternativeStrategy(summary.strategy)}'`)
        }

        if (summary.cognitiveLoad > 70) {
          recommendations.push("Cognitive load is high - consider breaking the task into smaller steps")
        }

        if (summary.shouldSeekHelp) {
          recommendations.push("Uncertainty is high - consider asking the user for clarification")
        }

        if (summary.strategyEffectiveness < 0.4) {
          recommendations.push(`Current strategy '${summary.strategy}' has low effectiveness - consider switching`)
        }

        if (summary.frustration > 0.5) {
          recommendations.push("Frustration level is elevated - take a step back and reassess")
        }
      }

      // Epistemic-based recommendations
      if (epistemicState) {
        const criticalUnknowns = Epistemic.getCriticalUnknowns(epistemicState)
        if (criticalUnknowns.length > 0) {
          recommendations.push(`${criticalUnknowns.length} critical unknown(s) - consider research_first strategy`)
          recommendations.push("Use /knowledge unknowns to see what information is missing")
        }

        const unvalidated = Epistemic.getUnvalidatedAssumptions(epistemicState)
        if (unvalidated.length >= 3) {
          recommendations.push(`${unvalidated.length} unvalidated assumptions - consider validating before proceeding`)
        }

        const contradictions = Epistemic.getUnresolvedContradictions(epistemicState)
        if (contradictions.length > 0) {
          recommendations.push(`${contradictions.length} unresolved contradiction(s) - resolve before continuing`)
          recommendations.push("Use /knowledge contradictions to see conflicting information")
        }
      }

      // Emotional-based recommendations
      const emotionalState = await Emotions.read(root)
      if (emotionalState) {
        const summary = Emotions.getStatusSummary(emotionalState)

        if (summary.isAnxious) {
          recommendations.push("Anxiety is elevated - consider taking a more cautious approach")
          recommendations.push("Use /emotions status to review emotional state")
        }

        if (summary.confidenceLevel < 30) {
          recommendations.push("Confidence is low - consider gathering more information before proceeding")
        }

        if (summary.frustrationCount > 3) {
          recommendations.push(`Multiple frustrations recorded - review with /emotions list frustration`)
        }

        if (summary.fearCount > 0) {
          const fears = await Emotions.getEmotionsByCategory(root, "fear")
          const topFear = fears[0]
          if (topFear && topFear.intensity >= 7) {
            recommendations.push(`High-intensity fear: "${topFear.trigger}" - proceed with caution`)
          }
        }
      }
    } catch (e) {
      log.error("error getting recommendations", { error: e })
    }

    return recommendations
  }

  function suggestAlternativeStrategy(current: string): string {
    const alternatives: Record<string, string> = {
      incremental: "divide_and_conquer",
      divide_and_conquer: "breadth_first",
      depth_first: "breadth_first",
      breadth_first: "research_first",
      research_first: "prototype",
      prototype: "incremental",
    }
    return alternatives[current] || "incremental"
  }

  /**
   * Reset cognitive state (useful for new sessions).
   */
  export async function reset(): Promise<void> {
    try {
      const root = await AFS.findRoot()
      if (!root) return

      await Metacognition.reset(root)
      await Goals.reset(root)
      await Epistemic.reset(root, "working") // Keep golden facts
      await Emotions.resetSessionEmotions(root) // Reset session, keep persistent emotions
      
      // Reset tracking variables
      consecutiveSuccesses = 0
      consecutiveFailures = 0
      consecutiveEditsWithoutTests = 0
      recentTools = []
      pendingTriggers = []
      
      log.info("cognitive state reset")
    } catch (e) {
      log.error("error resetting cognitive state", { error: e })
    }
  }

  /**
   * Apply decay to both epistemic and emotional state. Call at turn boundaries.
   * Uses tracked modified files to accelerate decay for related facts.
   */
  export async function applyDecay(): Promise<{
    epistemic: number
    emotional: { pruned: number; decayed: number }
    hivemind: { processed: number; warnings: number; expired: number }
  }> {
    try {
      const root = await AFS.findRoot()
      if (!root)
        return {
          epistemic: 0,
          emotional: { pruned: 0, decayed: 0 },
          hivemind: { processed: 0, warnings: 0, expired: 0 },
        }

      // Apply epistemic decay
      const epistemicPruned = await Epistemic.applyDecay(root, modifiedFilesSinceLastDecay)

      // Apply emotional decay
      const emotionalResult = await Emotions.applyDecay(root)

      // Apply hivemind decay and process promotions
      const hivemindResult = await applyHivemindDecay(root)

      // Clear tracked files after applying decay
      modifiedFilesSinceLastDecay = []

      if (epistemicPruned > 0 || emotionalResult.pruned > 0 || hivemindResult.processed > 0) {
        log.info("decay applied", {
          epistemicPruned,
          emotionalPruned: emotionalResult.pruned,
          emotionalDecayed: emotionalResult.decayed,
          hivemindProcessed: hivemindResult.processed,
          hivemindWarnings: hivemindResult.warnings,
          hivemindExpired: hivemindResult.expired,
        })
      }

      return { epistemic: epistemicPruned, emotional: emotionalResult, hivemind: hivemindResult }
    } catch (e) {
      log.error("error applying decay", { error: e })
      return {
        epistemic: 0,
        emotional: { pruned: 0, decayed: 0 },
        hivemind: { processed: 0, warnings: 0, expired: 0 },
      }
    }
  }

  /**
   * Apply hivemind decay and process auto-promotions.
   */
  async function applyHivemindDecay(
    root: string
  ): Promise<{ processed: number; warnings: number; expired: number }> {
    try {
      // Process decay for all entries - this handles both warnings and expiry
      const decayResult = await Hivemind.Decay.processDecay(root, "project")

      // Log warnings for decaying entries
      for (const entry of decayResult.warned) {
        log.info("hivemind entry decay warning", {
          entryId: entry.id,
          key: entry.key,
        })
      }

      // Note: Auto-promotions are processed when entries are added, not during decay
      // The processAutoPromotions function requires specific entries to check

      return {
        processed: decayResult.expired.length + decayResult.warned.length,
        warnings: decayResult.warned.length,
        expired: decayResult.expired.length,
      }
    } catch (e) {
      log.error("error applying hivemind decay", { error: e })
      return { processed: 0, warnings: 0, expired: 0 }
    }
  }

  /**
   * @deprecated Use applyDecay() instead
   */
  export async function applyEpistemicDecay(): Promise<number> {
    const result = await applyDecay()
    return result.epistemic
  }

  /**
   * Get the current epistemic state for UI display.
   */
  export async function getEpistemicState(): Promise<Epistemic.EpistemicState | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await Epistemic.read(root)
    } catch (e) {
      log.error("error getting epistemic state", { error: e })
      return null
    }
  }

  /**
   * Get the current emotional state for UI display.
   */
  export async function getEmotionalState(): Promise<Emotions.EmotionalState | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await Emotions.read(root)
    } catch (e) {
      log.error("error getting emotional state", { error: e })
      return null
    }
  }

  /**
   * Get a complete cognitive snapshot for trigger evaluation.
   */
  export async function getCognitiveSnapshot(): Promise<AnalysisTriggers.CognitiveSnapshot | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await buildCognitiveSnapshot(root)
    } catch (e) {
      log.error("error getting cognitive snapshot", { error: e })
      return null
    }
  }

  /**
   * Get the current hivemind state for UI display.
   */
  export async function getHivemindState(): Promise<HivemindState | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await Hivemind.getState(root)
    } catch (e) {
      log.error("error getting hivemind state", { error: e })
      return null
    }
  }

  /**
   * Get the hivemind summary for UI display.
   */
  export async function getHivemindSummary(): Promise<{
    project: {
      total: number
      golden: number
      decaying: number
      contested: number
      pending: number
      councils: number
    }
    global: { enabled: boolean; total: number } | null
  } | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await Hivemind.getSummary(root)
    } catch (e) {
      log.error("error getting hivemind summary", { error: e })
      return null
    }
  }

  /**
   * Get decay warnings for hivemind entries.
   */
  export async function getHivemindDecayWarnings(): Promise<HivemindEntry[]> {
    try {
      const root = await AFS.findRoot()
      if (!root) return []
      return await Hivemind.Decay.getDecayWarnings(root)
    } catch (e) {
      log.error("error getting hivemind decay warnings", { error: e })
      return []
    }
  }

  /**
   * Get pending council sessions.
   */
  export async function getActiveCouncils(): Promise<CouncilSession[]> {
    try {
      const root = await AFS.findRoot()
      if (!root) return []
      return await Hivemind.getActiveCouncils(root)
    } catch (e) {
      log.error("error getting active councils", { error: e })
      return []
    }
  }

  /**
   * Manually promote an emotion or knowledge entry to the hivemind.
   */
  export async function promoteToHivemind(options: {
    category: HivemindCategory
    key: string
    value: string
    confidence: number
    reason: string
    scope?: HivemindScope
    originalEntryId?: string
  }): Promise<HivemindEntry | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      // Add entry to hivemind
      const entry = await Hivemind.addEntry(
        {
          category: options.category,
          scope: options.scope || "project",
          key: options.key,
          value: options.value,
          confidence: options.confidence,
          status: "active",
          source: {
            sessionId: "manual",
            agentRole: "primary",
            timestamp: new Date().toISOString(),
            promotionReason: options.reason,
          },
          decay: {
            lastAccessed: new Date().toISOString(),
            accessCount: 0,
            decayRate: 0.1,
          },
          metadata: {
            originalEntryId: options.originalEntryId,
          },
        },
        root
      )

      log.info("promoted entry to hivemind", {
        entryId: entry.id,
        category: options.category,
        key: options.key,
      })

      return entry
    } catch (e) {
      log.error("error promoting to hivemind", { error: e })
      return null
    }
  }

  /**
   * Export cognitive state summary for inclusion in state.md
   * Returns a markdown section that can be appended to state.md
   */
  export async function getStateMdExport(): Promise<string | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      const sections: string[] = []

      // Metacognition section
      const metaState = await Metacognition.read(root)
      if (metaState) {
        const summary = Metacognition.getStatusSummary(metaState)
        sections.push("## Cognitive")
        sections.push("")
        sections.push(`- **Strategy**: ${summary.strategy} (${Math.round(summary.strategyEffectiveness * 100)}% effective)`)
        sections.push(`- **Progress**: ${summary.progress.replace("_", " ")}`)
        sections.push(`- **Cognitive Load**: ${summary.cognitiveLoad}%`)
        sections.push(`- **Flow State**: ${summary.flowState ? "Active" : "Inactive"}`)
        if (summary.isSpinning) {
          sections.push(`- **WARNING**: Spinning detected`)
        }
        sections.push("")
      }

      // Goals section
      const goalHierarchy = await Goals.read(root)
      if (goalHierarchy?.primaryGoal) {
        const summary = Goals.getStatusSummary(goalHierarchy)
        sections.push("## Goals")
        sections.push("")
        sections.push(`- **Primary**: ${summary.primaryGoal}`)
        sections.push(`- **Progress**: ${summary.completionPercentage.toFixed(0)}%`)
        sections.push(`- **Subgoals**: ${summary.completedSubgoals}/${summary.totalSubgoals} complete`)
        if (summary.currentFocus && summary.currentFocus !== summary.primaryGoal) {
          sections.push(`- **Focus**: ${summary.currentFocus}`)
        }
        if (summary.unresolvedConflicts > 0) {
          sections.push(`- **Conflicts**: ${summary.unresolvedConflicts} unresolved`)
        }
        sections.push("")
      }

      // Epistemic/Knowledge section
      const epistemicState = await Epistemic.read(root)
      if (epistemicState) {
        const summary = Epistemic.getStatusSummary(epistemicState)
        sections.push("## Knowledge")
        sections.push("")
        sections.push(`- **Golden Facts**: ${summary.goldenFactCount}/${summary.maxGoldenFacts}`)
        sections.push(`- **Working Facts**: ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% avg confidence)`)
        if (summary.assumptionCount > 0) {
          sections.push(`- **Assumptions**: ${summary.assumptionCount} (${summary.unvalidatedCount} unvalidated)`)
        }
        if (summary.unknownCount > 0) {
          sections.push(`- **Unknowns**: ${summary.unknownCount} (${summary.criticalUnknowns} critical)`)
        }
        if (summary.contradictionCount > 0) {
          sections.push(`- **Contradictions**: ${summary.contradictionCount} unresolved`)
        }
        sections.push("")
        sections.push("_See `.context/scratchpad/epistemic.json` for full details_")
        sections.push("")
      }

      // Emotional state section
      const emotionalState = await Emotions.read(root)
      if (emotionalState) {
        const summary = Emotions.getStatusSummary(emotionalState)
        const moodEmoji: Record<string, string> = {
          positive: "😊",
          neutral: "😐",
          negative: "😔",
          anxious: "😰",
          confident: "🎯",
          frustrated: "😤",
          curious: "🤔",
        }
        sections.push("## Emotional State")
        sections.push("")
        sections.push(`- **Mood**: ${moodEmoji[summary.mood] || ""} ${summary.mood}`)
        sections.push(`- **Anxiety**: ${summary.anxietyLevel}%`)
        sections.push(`- **Confidence**: ${summary.confidenceLevel}%`)
        sections.push(`- **Emotions**: ${summary.fearCount} fears, ${summary.curiosityCount} curiosities, ${summary.satisfactionCount} satisfactions, ${summary.frustrationCount} frustrations`)
        sections.push("")
        sections.push("_See `.context/scratchpad/emotions.json` for full details_")
        sections.push("")
      }

      // Hivemind section
      try {
        const hivemindSummary = await Hivemind.getSummary(root)
        sections.push("## Hivemind")
        sections.push("")
        sections.push(`- **Entries**: ${hivemindSummary.project.total} (${hivemindSummary.project.golden} golden)`)
        if (hivemindSummary.project.decaying > 0) {
          sections.push(`- **Decaying**: ${hivemindSummary.project.decaying} entries`)
        }
        if (hivemindSummary.project.contested > 0) {
          sections.push(`- **Contested**: ${hivemindSummary.project.contested} entries`)
        }
        if (hivemindSummary.project.pending > 0) {
          sections.push(`- **Pending Promotions**: ${hivemindSummary.project.pending}`)
        }
        if (hivemindSummary.project.councils > 0) {
          sections.push(`- **Active Councils**: ${hivemindSummary.project.councils}`)
        }
        if (hivemindSummary.global) {
          sections.push(`- **Global**: ${hivemindSummary.global.total} entries`)
        }
        sections.push("")
        sections.push("_See `.context/hivemind/` for full details_")
        sections.push("")
      } catch {
        // Hivemind may not be initialized
      }

      if (sections.length === 0) return null
      return sections.join("\n")
    } catch (e) {
      log.error("error generating state.md export", { error: e })
      return null
    }
  }

  // =============
  // Adaptive Critic Integration
  // =============

  /**
   * Update the adaptive critic state based on current emotional state.
   * Call this before requesting a critic review to ensure appropriate tone.
   */
  export async function updateCriticState(): Promise<CriticTone> {
    try {
      const root = await AFS.findRoot()
      const critic = getCritic()

      if (!root) {
        return critic.currentTone
      }

      const emotionalState = await Emotions.read(root)
      if (!emotionalState) {
        return critic.currentTone
      }

      const summary = Emotions.getStatusSummary(emotionalState)
      
      // Update critic state with emotional context
      const newTone = critic.updateState(
        summary.anxietyLevel / 100, // Normalize to 0-1
        summary.frustrationCount,
        consecutiveFailures === 0 // Success if no recent failures
      )

      log.info("critic state updated", {
        tone: newTone,
        anxiety: summary.anxietyLevel,
        frustrations: summary.frustrationCount,
      })

      return newTone
    } catch (e) {
      log.error("error updating critic state", { error: e })
      return getCritic().currentTone
    }
  }

  /**
   * Get a critic prompt with the appropriate tone based on current state.
   * Automatically updates critic state before generating prompt.
   *
   * @param content - The content to critique
   * @returns Prompt string with appropriate tone prefix
   */
  export async function getCriticPrompt(content: string): Promise<string> {
    await updateCriticState()
    return getCritic().createPrompt(content)
  }

  /**
   * Get the current critic tone.
   */
  export function getCurrentCriticTone(): CriticTone {
    return getCritic().currentTone
  }

  /**
   * Allow user to override the critic tone.
   *
   * @param tone - The tone to force, or undefined to clear override
   */
  export function setCriticToneOverride(tone: CriticTone | undefined): void {
    getCritic().setUserOverride(tone)
    log.info("critic tone override set", { tone })
  }

  /**
   * Parse a critic LLM response into structured reviews.
   *
   * @param llmResponse - Raw LLM response text
   * @returns Array of structured review findings
   */
  export function parseCriticReviews(llmResponse: string): CriticReview[] {
    return getCritic().parseReviews(llmResponse)
  }

  /**
   * Get the full critic state for debugging/display.
   */
  export function getCriticState(): {
    currentTone: CriticTone
    stableIterations: number
    userOverride?: CriticTone
    lastAnxiety: number
    frustrationCount: number
  } {
    return getCritic().getState()
  }
}
