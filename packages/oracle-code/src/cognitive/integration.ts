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
import { Cache } from "../util/cache"
import { Metacognition } from "./metacognition"
import { Goals } from "./goals"
import { Epistemic } from "./epistemic"
import { Emotions } from "./emotions"
import { AnalysisTriggers } from "./analysis-triggers"
import { Hivemind } from "./hivemind"
import { CognitiveInference } from "./inference"
import { EmotionTriggers } from "./emotion-triggers"
import { Grounding } from "./grounding"
import { Autonomy } from "./autonomy"
import { HistoricalMemory } from "./historical-memory"
import { ProjectConfig } from "./project-config"
import { CognitiveCache } from "./cache"
import { CognitiveMetrics } from "./metrics"
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
import { Flag } from "../flag/flag"

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
  let recentActions: string[] = []
  let knownFiles: string[] = []

  // Pending analysis triggers (to be processed by UI)
  let pendingTriggers: AnalysisTriggers.TriggeredAnalysis[] = []

  // Current session for historical memory
  let currentSessionBuilder: HistoricalMemory.SessionMemoryBuilder | null = null
  let currentSessionId: string | null = null

  // Last grounding result (for user query)
  let lastGroundingResult: Grounding.GroundingResult | null = null

  // =============
  // Automatic Decay Tracking
  // =============

  let lastSessionDecayTime = Date.now()
  let lastFullDecayTime = Date.now()
  let batchesSinceFullDecay = 0

  // Session decay runs every 60 seconds (cheap with caching)
  const SESSION_DECAY_INTERVAL_MS = 60 * 1000

  // Full decay runs every 5 minutes or 10 batches, whichever comes first
  const FULL_DECAY_INTERVAL_MS = 5 * 60 * 1000
  const FULL_DECAY_BATCH_THRESHOLD = 10

  // =============
  // Debounced Processing
  // =============

  // Pending cognitive updates to batch
  interface PendingCognitiveUpdate {
    root: string
    part: MessageV2.ToolPart
    timestamp: number
  }
  let pendingCognitiveUpdates: PendingCognitiveUpdate[] = []
  let cognitiveUpdateTimer: ReturnType<typeof setTimeout> | null = null
  const COGNITIVE_UPDATE_DELAY = 150 // ms - batch updates within this window

  /**
   * Queue a cognitive update for batched processing.
   * This reduces file I/O by coalescing rapid tool completions.
   */
  function queueCognitiveUpdate(root: string, part: MessageV2.ToolPart): void {
    pendingCognitiveUpdates.push({ root, part, timestamp: Date.now() })

    if (cognitiveUpdateTimer) {
      clearTimeout(cognitiveUpdateTimer)
    }

    cognitiveUpdateTimer = setTimeout(async () => {
      const updates = pendingCognitiveUpdates
      pendingCognitiveUpdates = []
      cognitiveUpdateTimer = null

      if (updates.length === 0) return

      // Process all queued updates in a batch
      await processCognitiveUpdateBatch(updates)
    }, COGNITIVE_UPDATE_DELAY)
  }

  /**
   * Process a batch of cognitive updates efficiently.
   * Reads state once, applies all updates, writes once.
   */
  async function processCognitiveUpdateBatch(updates: PendingCognitiveUpdate[]): Promise<void> {
    if (updates.length === 0) return

    const root = updates[0].root
    const successCount = updates.filter((u) => u.part.state.status === "completed").length
    const errorCount = updates.filter((u) => u.part.state.status === "error").length

    try {
      // =============
      // Metrics: Record anxiety/confidence samples before processing
      // =============
      const preEmotions = await Emotions.read(root)
      if (preEmotions) {
        CognitiveMetrics.recordAnxietySample(preEmotions.session.anxietyLevel)
        CognitiveMetrics.recordConfidenceSample(preEmotions.session.confidenceLevel)
      }

      // Batch update counters
      consecutiveSuccesses += successCount
      if (errorCount > 0) {
        consecutiveSuccesses = 0
        consecutiveFailures += errorCount
      } else if (successCount > 0) {
        consecutiveFailures = 0
      }

      // Process the most recent update for detailed tracking
      const lastUpdate = updates[updates.length - 1]
      const part = lastUpdate.part

      // Track tool usage (aggregate all) and record metrics
      for (const update of updates) {
        const tool = update.part.tool
        const success = update.part.state.status === "completed"
        recentTools.push(tool)
        const actionDesc = `${tool}: ${JSON.stringify(update.part.state.input || {}).slice(0, 100)}`
        recentActions.push(actionDesc)

        // Record tool outcome for metrics
        CognitiveMetrics.recordToolCall(tool, success)
      }
      if (recentTools.length > 20) recentTools = recentTools.slice(-20)
      if (recentActions.length > 20) recentActions = recentActions.slice(-20)

      // Single metacognition update for the batch
      const lastAction = `${part.tool}: ${JSON.stringify(part.state.input || {}).slice(0, 100)}`
      await Metacognition.recordAction(root, lastAction)

      // Batch success/failure recording
      if (successCount > 0) {
        await Metacognition.recordSuccess(root)
        await Grounding.recordSuccess(root)
      }
      if (errorCount > 0) {
        await Metacognition.recordFailure(root)
        await Grounding.recordFailure(root)
      }

      // Dynamic anxiety/confidence adjustment for batch
      // Consecutive failures increase anxiety more aggressively
      // Consecutive successes provide confidence momentum
      const failureMultiplier = Math.min(3, 1 + consecutiveFailures * 0.3) // Up to 3x at 7+ failures
      const successMultiplier = Math.min(2, 1 + consecutiveSuccesses * 0.1) // Up to 2x at 10+ successes

      const baseAnxietyPerError = 8 // Increased from 5
      const baseConfidencePerSuccess = 4 // Increased from 2
      const baseConfidenceLossPerError = 5 // Increased from 3

      const anxietyDelta = Math.round(errorCount * baseAnxietyPerError * failureMultiplier)
      const confidenceGain = Math.round(successCount * baseConfidencePerSuccess * successMultiplier)
      const confidenceLoss = Math.round(errorCount * baseConfidenceLossPerError * failureMultiplier)
      const confidenceDelta = confidenceGain - confidenceLoss

      if (anxietyDelta !== 0) await Emotions.adjustAnxiety(root, anxietyDelta)
      if (confidenceDelta !== 0) await Emotions.adjustConfidence(root, confidenceDelta)

      // Process file paths for path emotions (deduplicated)
      const filePathsSet = new Set<string>()
      for (const update of updates) {
        const input = (update.part.state.status === "completed" ? update.part.state.input : {}) as any
        if (input?.filePath) filePathsSet.add(input.filePath)
      }
      for (const filePath of filePathsSet) {
        if (!knownFiles.includes(filePath)) knownFiles.push(filePath)
        await Emotions.applyPathEmotions(root, filePath, currentSessionId || undefined)
      }

      // Track edits without tests
      const editCount = updates.filter((u) => u.part.tool === "edit" || u.part.tool === "write").length
      const hasTestRun = updates.some((u) => {
        if (u.part.tool !== "bash") return false
        const cmd = ((u.part.state.status === "completed" ? u.part.state.input : {}) as any)?.command || ""
        return cmd.includes("test") || cmd.includes("jest") || cmd.includes("pytest") || cmd.includes("vitest")
      })
      consecutiveEditsWithoutTests = hasTestRun ? 0 : consecutiveEditsWithoutTests + editCount

      // Record epistemic facts from last successful tool
      const lastSuccess = [...updates].reverse().find((u) => u.part.state.status === "completed")
      if (lastSuccess) {
        await recordEpistemicFactsFromTool(root, lastSuccess.part)
      }

      // Detect emotions (once for batch, using last status)
      const lastStatus = part.state.status === "completed" ? "success" : "failure"
      await detectAndRecordEmotionsV2(root, part, lastStatus)
      await evaluateEmotionInteractions(root, lastStatus)

      // Check grounding (once after batch)
      const emotionalState = await Emotions.read(root)
      if (emotionalState) {
        const groundingCheck = await Grounding.checkTriggers(root, {
          emotionalState,
          recentActions,
          consecutiveFailures,
        })

        if (groundingCheck.triggered && groundingCheck.trigger) {
          log.info("grounding triggered", { trigger: groundingCheck.trigger, reason: groundingCheck.reason })
          lastGroundingResult = await Grounding.ground(
            root,
            groundingCheck.trigger,
            groundingCheck.reason || "Automatic detection",
            { emotionalState, recentActions, consecutiveFailures },
          )

          if (currentSessionId) {
            await HistoricalMemory.recordGroundingEvent(root, currentSessionId)
          }
        }
      }

      // Check flow state (once after batch)
      const { inFlow, changed } = await Metacognition.checkFlowState(root)
      if (changed && inFlow) {
        await Emotions.adjustConfidence(root, 15)
        await Emotions.updateMood(root, "confident", "Entered flow state")
      }

      // Evaluate triggers (once after batch)
      await evaluateAndQueueTriggers(root)

      // Track in session builder
      if (currentSessionBuilder) {
        for (const update of updates) {
          currentSessionBuilder.addTool(update.part.tool)
          const input = (update.part.state.status === "completed" ? update.part.state.input : {}) as any
          if (input?.filePath) currentSessionBuilder.addFile(input.filePath)
          if (update.part.state.status === "error") {
            const errorOutput = (update.part.state as any)?.output || "Unknown error"
            currentSessionBuilder.addProblem(`${update.part.tool}: ${errorOutput.slice(0, 100)}`)
          }
        }
      }

      // =============
      // Automatic Decay (runs periodically during batches)
      // =============
      batchesSinceFullDecay++
      const now = Date.now()

      // Session decay: quick regression toward baseline (every 60s)
      if (now - lastSessionDecayTime >= SESSION_DECAY_INTERVAL_MS) {
        const sessionResult = await Emotions.applySessionDecay(root)
        lastSessionDecayTime = now
        if (Math.abs(sessionResult.anxietyDecayed) > 1 || Math.abs(sessionResult.confidenceDecayed) > 1) {
          log.info("auto session decay applied", {
            anxietyDecayed: sessionResult.anxietyDecayed.toFixed(1),
            confidenceDecayed: sessionResult.confidenceDecayed.toFixed(1),
          })
        }
      }

      // Full decay: epistemic + emotions + hivemind (every 5min or 10 batches)
      const shouldRunFullDecay =
        now - lastFullDecayTime >= FULL_DECAY_INTERVAL_MS || batchesSinceFullDecay >= FULL_DECAY_BATCH_THRESHOLD

      if (shouldRunFullDecay) {
        const decayResult = await applyDecay()
        lastFullDecayTime = now
        batchesSinceFullDecay = 0
        if (decayResult.epistemic > 0 || decayResult.emotional.pruned > 0 || decayResult.hivemind.processed > 0) {
          log.info("auto full decay applied", {
            epistemicPruned: decayResult.epistemic,
            emotionalPruned: decayResult.emotional.pruned,
            hivemindProcessed: decayResult.hivemind.processed,
          })
        }
      }
    } catch (e) {
      log.error("error processing cognitive update batch", { error: e, count: updates.length })
    }
  }

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

    // Subscribe to tool part updates - uses batched processing for performance
    Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const part = event.properties.part
      if (part.type !== "tool") return
      if (part.state.status !== "completed" && part.state.status !== "error") return

      try {
        const root = await AFS.findRoot()
        if (!root) return

        // Queue the update for batched processing
        // This reduces file I/O by coalescing rapid tool completions
        queueCognitiveUpdate(root, part)
      } catch (e) {
        log.error("error queueing cognitive update", { error: e })
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

    // Subscribe to assistant message text parts for inference-based updates
    Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const part = event.properties.part
      if (part.type !== "text") return

      try {
        const root = await AFS.findRoot()
        if (!root) return

        // Get text content from the part
        const textContent = part.text || ""

        // Quick check if worth analyzing
        if (!CognitiveInference.hasSignals(textContent)) return

        // Analyze message for cognitive signals
        const messageInference = CognitiveInference.analyzeMessage(textContent)

        // Analyze tool patterns
        const toolInference = CognitiveInference.analyzeToolPattern("text", true, recentTools)

        // Merge inferences
        const combined = CognitiveInference.mergeInferences(messageInference, toolInference)

        // Apply inferences (only significant changes)
        await CognitiveInference.applyInference(root, combined)

        // Log if significant inference was made
        if (combined.moodHint || combined.progressStatus) {
          log.info("applied cognitive inference", {
            progressStatus: combined.progressStatus,
            moodHint: combined.moodHint,
            markers: {
              progress: combined.markers.progress.length,
              frustration: combined.markers.frustration.length,
              completion: combined.markers.completion.length,
            },
          })
        }
      } catch (e) {
        log.error("error applying cognitive inference", { error: e })
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
  async function recordEpistemicFactsFromTool(root: string, part: MessageV2.ToolPart): Promise<void> {
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
            await Epistemic.addWorkingFact(root, `file.${fileName}.exists`, true, 0.95, "file_read", [filePath])
          }
          break
        }

        case "glob": {
          // Record pattern match results
          const pattern = (input as any)?.pattern
          if (pattern && output) {
            const matches = output.split("\n").filter((l: string) => l.trim()).length
            const patternKey = pattern.replace(/[*\/\\\.]/g, "_").replace(/__+/g, "_")
            await Epistemic.addWorkingFact(root, `search.glob.${patternKey}.count`, matches, 0.9, "tool_output")
          }
          break
        }

        case "grep": {
          // Record search results
          const searchPattern = (input as any)?.pattern
          if (searchPattern && output !== undefined) {
            const found = output && output.length > 0
            const patternKey = searchPattern.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)
            await Epistemic.addWorkingFact(root, `search.grep.${patternKey}.found`, found, 0.85, "tool_output")
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
              await Epistemic.addWorkingFact(root, `runtime.${toolName}.version`, versionMatch, 0.9, "tool_output")
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
  async function detectAndRecordEmotions(root: string, part: MessageV2.ToolPart, success: boolean): Promise<void> {
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
          },
        )
        log.info("auto-recorded emotion", { category: suggestion.category, trigger: suggestion.trigger })
      }
    } catch (e) {
      log.error("error detecting emotions from tool", { error: e })
    }
  }

  /**
   * Enhanced emotion detection using the new trigger system (V2)
   */
  async function detectAndRecordEmotionsV2(
    root: string,
    part: MessageV2.ToolPart,
    condition: "success" | "failure" | "discovery" | "obstacle",
  ): Promise<void> {
    try {
      const settings = await Emotions.getSettings(root)
      if (!settings.enableAutoDetection) return

      // Detect progress-based triggers
      const progressTriggers = EmotionTriggers.detectProgressSignals({
        consecutiveSuccesses,
        consecutiveFailures,
        totalSuccesses: consecutiveSuccesses, // Simplified for now
        totalFailures: consecutiveFailures,
        recentTools,
        goalsCompleted: 0,
        goalsBlocked: 0,
      })

      // Detect code pattern triggers if we have a file path
      const filePath = (part.state.status === "completed" ? part.state.input : {}) as any
      let codePatternTriggers: EmotionTriggers.TriggerResult[] = []
      if (filePath?.filePath) {
        codePatternTriggers = EmotionTriggers.detectCodePatterns(filePath.filePath)
      }

      // Combine all triggers
      const allTriggers = [...progressTriggers, ...codePatternTriggers]
      const aggregatedDeltas = EmotionTriggers.aggregateEmotionDeltas(allTriggers)

      // Apply aggregated emotion changes with momentum
      for (const [category, delta] of aggregatedDeltas) {
        if (Math.abs(delta) >= 2) {
          // Only apply significant changes
          // Get current emotion for this category or create new one
          const emotions = await Emotions.getEmotionsByCategory(root, category)
          const existing = emotions[0]

          if (existing) {
            // Apply momentum to existing emotion
            const newIntensity = Emotions.applyMomentum(category, existing.intensity, delta)
            await Emotions.updateEmotionIntensity(root, existing.id, newIntensity)
          } else if (delta > 0) {
            // Create new emotion
            const triggers = allTriggers.filter((t) => t.emotionDeltas.some((d) => d.emotion === category))
            const primaryTrigger = triggers[0]
            if (primaryTrigger) {
              await Emotions.addEmotion(
                root,
                category,
                primaryTrigger.description,
                `Detected from ${part.tool}`,
                Math.min(10, delta),
              )
            }
          }
        }
      }

      // Log significant triggers
      const significant = EmotionTriggers.getSignificantTriggers(allTriggers)
      for (const trigger of significant) {
        log.info("emotion trigger detected", {
          category: trigger.category,
          severity: trigger.severity,
          description: trigger.description,
        })
      }
    } catch (e) {
      log.error("error in emotion detection v2", { error: e })
    }
  }

  /**
   * Evaluate and apply emotion interactions (compound states)
   */
  async function evaluateEmotionInteractions(
    root: string,
    condition: "success" | "failure" | "obstacle" | "discovery",
  ): Promise<void> {
    try {
      const emotionalState = await Emotions.read(root)
      if (!emotionalState) return

      const interactions = Emotions.evaluateInteractions(emotionalState, condition)
      const triggered = interactions.filter((i) => i.triggered)

      for (const { interaction } of triggered) {
        log.info("emotion interaction triggered", {
          id: interaction.id,
          name: interaction.name,
        })

        // Apply the interaction results
        for (const result of interaction.result) {
          if (result.emotion === "anxiety") {
            await Emotions.adjustAnxiety(root, result.delta)
          } else if (result.emotion === "confidence") {
            await Emotions.adjustConfidence(root, result.delta)
          } else {
            // Apply to emotion category
            const emotions = await Emotions.getEmotionsByCategory(root, result.emotion)
            const existing = emotions[0]

            if (existing) {
              const newIntensity = Emotions.applyMomentum(result.emotion, existing.intensity, result.delta)
              await Emotions.updateEmotionIntensity(root, existing.id, newIntensity)
            } else if (result.delta > 0) {
              await Emotions.addEmotion(
                root,
                result.emotion,
                interaction.name,
                result.narrative,
                Math.min(10, result.delta),
              )
            }
          }
        }

        // Record as key moment if significant
        if (currentSessionBuilder && interaction.result.length > 2) {
          currentSessionBuilder.addKeyMoment({
            timestamp: new Date().toISOString(),
            type: "emotional_shift",
            description: `${interaction.name}: ${interaction.description}`,
            emotionalState: {
              timestamp: new Date().toISOString(),
              anxietyLevel: emotionalState.session.anxietyLevel,
              confidenceLevel: emotionalState.session.confidenceLevel,
              mood: emotionalState.session.mood,
              dominantEmotions: [],
            },
          })
        }
      }
    } catch (e) {
      log.error("error evaluating emotion interactions", { error: e })
    }
  }

  /**
   * Build a cognitive snapshot for trigger evaluation.
   */
  async function buildCognitiveSnapshot(root: string): Promise<AnalysisTriggers.CognitiveSnapshot> {
    const snapshot: AnalysisTriggers.CognitiveSnapshot = {
      consecutiveFailures,
      consecutiveEditsWithoutTests,
      sameToolRepeatedCount: AnalysisTriggers.countSameToolRepeated(recentTools.map((t) => ({ tool: t }))),
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
            await Emotions.addEmotion(
              root,
              e.category,
              e.trigger,
              `Auto-triggered: ${analysis.trigger.name}`,
              e.intensity,
            )
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
   * Token budgets by cognitive tier:
   * - Tier 0 (minimal): No injection
   * - Tier 1 (aware): ~150 tokens - warnings only
   * - Tier 2 (engaged): ~500 tokens - condensed + hivemind highlights
   * - Tier 3 (full): ~2000 tokens - verbose with all sections
   */
  const TOKEN_BUDGETS: Record<string, number> = {
    "0": 0,
    "1": 150,
    "2": 500,
    "3": 2000,
  }

  /**
   * Resolve cognitive tier from config > flag > default.
   * Priority: config.cognitive.tier > OCODE_COGNITIVE_TIER flag > "1" (default)
   */
  async function resolveCognitiveTier(): Promise<"0" | "1" | "2" | "3"> {
    try {
      const { Config } = await import("../config/config")
      const config = await Config.get()
      if (config.cognitive?.tier) {
        return config.cognitive.tier
      }
    } catch {
      // Config not available, fall through to flag
    }
    return Flag.OCODE_COGNITIVE_TIER
  }

  /**
   * Resolve cognitive format from config > flag > tier-default.
   * Priority: config.cognitive.format > OCODE_COGNITIVE_FORMAT flag > tier-based default
   */
  async function resolveCognitiveFormat(tier: string): Promise<"verbose" | "condensed"> {
    try {
      const { Config } = await import("../config/config")
      const config = await Config.get()
      if (config.cognitive?.format) {
        return config.cognitive.format
      }
    } catch {
      // Config not available
    }

    // Flag takes precedence over tier default
    if (Flag.OCODE_COGNITIVE_FORMAT !== "verbose") {
      return Flag.OCODE_COGNITIVE_FORMAT
    }

    // Tier-based defaults
    return tier === "3" ? "verbose" : "condensed"
  }

  /**
   * Get the current cognitive state summary for inclusion in prompts.
   * Resolution order: config > env flags > defaults
   *
   * Tier determines token budget:
   * - 0: No injection
   * - 1: ~150 tokens (warnings only)
   * - 2: ~500 tokens (condensed + hivemind)
   * - 3: ~2000 tokens (full verbose)
   */
  export async function getPromptContext(): Promise<string | null> {
    try {
      const tier = await resolveCognitiveTier()
      const format = await resolveCognitiveFormat(tier)
      const budget = TOKEN_BUDGETS[tier] || TOKEN_BUDGETS["1"]

      // Tier 0: No cognitive injection
      if (budget === 0) {
        return null
      }

      // Tier 1: Minimal - warnings only
      if (tier === "1") {
        return getMinimalPromptContext(budget)
      }

      // Tier 2: Condensed format with some hivemind
      if (tier === "2" || format === "condensed") {
        return getCondensedPromptContext(budget)
      }

      // Tier 3: Full verbose format
      return getVerbosePromptContext(budget)
    } catch (e) {
      log.error("error getting prompt context", { error: e })
      return null
    }
  }

  /**
   * Tier 1: Minimal context - only actionable warnings.
   * Target: ~50-150 tokens
   */
  async function getMinimalPromptContext(budget: number): Promise<string | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      const metaState = await Metacognition.read(root)
      const emotionalState = await Emotions.read(root)
      const epistemicState = await Epistemic.read(root)

      const warnings: string[] = []

      // Only collect actionable warnings
      if (metaState) {
        const summary = Metacognition.getStatusSummary(metaState)
        if (summary.isSpinning) warnings.push("SPINNING: change approach")
        if (summary.shouldSeekHelp) warnings.push("UNCERTAIN: ask user")
      }

      if (emotionalState) {
        const summary = Emotions.getStatusSummary(emotionalState)
        if (summary.isAnxious) warnings.push(`HIGH_ANXIETY(${summary.anxietyLevel}%): proceed carefully`)
      }

      if (epistemicState) {
        const summary = Epistemic.getStatusSummary(epistemicState)
        if (summary.criticalUnknowns > 0) warnings.push(`${summary.criticalUnknowns} UNKNOWNS: research first`)
        if (summary.contradictionCount > 0) warnings.push(`${summary.contradictionCount} CONTRADICTIONS: resolve`)
      }

      // If no warnings, return null (save tokens)
      if (warnings.length === 0) return null

      const result = `<cog_warnings>${warnings.join(" | ")}</cog_warnings>`

      // Enforce budget
      const estimatedTokens = Math.ceil(result.length / 4)
      if (estimatedTokens > budget) {
        // Truncate to most critical warning
        const truncated = `<cog_warnings>${warnings[0]}</cog_warnings>`
        CognitiveMetrics.recordCognitiveInjection(Math.ceil(truncated.length / 4))
        return truncated
      }

      CognitiveMetrics.recordCognitiveInjection(estimatedTokens)
      return result
    } catch (e) {
      log.error("error getting minimal prompt context", { error: e })
      return null
    }
  }

  /**
   * Tier 2: Condensed cognitive state - compact but informative.
   * Target: ~200-500 tokens
   * Format: Single line status with warnings, plus top hivemind entries
   */
  async function getCondensedPromptContext(budget: number): Promise<string | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null

      const metaState = await Metacognition.read(root)
      const emotionalState = await Emotions.read(root)
      const epistemicState = await Epistemic.read(root)

      if (!metaState && !emotionalState && !epistemicState) return null

      const parts: string[] = []
      const warnings: string[] = []

      // Core status line (always include)
      if (metaState) {
        const summary = Metacognition.getStatusSummary(metaState)
        parts.push(`strategy:${summary.strategy}`)
        parts.push(`load:${summary.cognitiveLoad}%`)

        if (summary.isSpinning) warnings.push("SPINNING")
        if (summary.shouldSeekHelp) warnings.push("UNCERTAIN")
        if (summary.flowState) parts.push("FLOW")
      }

      // Emotional quick-glance
      if (emotionalState) {
        const summary = Emotions.getStatusSummary(emotionalState)
        parts.push(`anxiety:${summary.anxietyLevel}%`)
        parts.push(`conf:${summary.confidenceLevel}%`)

        if (summary.isAnxious) warnings.push("HIGH_ANXIETY")
      }

      // Epistemic red flags only
      if (epistemicState) {
        const summary = Epistemic.getStatusSummary(epistemicState)
        if (summary.criticalUnknowns > 0) warnings.push(`${summary.criticalUnknowns}_UNKNOWNS`)
        if (summary.contradictionCount > 0) warnings.push(`${summary.contradictionCount}_CONTRADICTIONS`)
      }

      // Build condensed output
      const lines: string[] = []
      let statusLine = `<cog>${parts.join(" | ")}`
      if (warnings.length > 0) {
        statusLine += ` ⚠️ ${warnings.join(",")}`
      }
      statusLine += "</cog>"
      lines.push(statusLine)

      // Check budget and add hivemind highlights if tier 2 (budget >= 300)
      let currentTokens = Math.ceil(statusLine.length / 4)
      if (budget >= 300 && currentTokens < budget * 0.4) {
        const hivemindHighlights = await getCondensedHivemindContext(root, budget - currentTokens)
        if (hivemindHighlights) {
          lines.push(hivemindHighlights)
        }
      }

      const result = lines.join("\n")
      const estimatedTokens = Math.ceil(result.length / 4)
      CognitiveMetrics.recordCognitiveInjection(estimatedTokens)

      return result
    } catch (e) {
      log.error("error getting condensed prompt context", { error: e })
      return null
    }
  }

  /**
   * Get condensed hivemind context - just the most important entries.
   * Used for Tier 2 to add key learnings without verbose format.
   */
  async function getCondensedHivemindContext(root: string, tokenBudget: number): Promise<string | null> {
    try {
      const entries = await Hivemind.getPromptEntries(root, {
        maxFears: 2,
        maxSatisfactions: 2,
        maxKnowledge: 3,
        maxDecisions: 2,
        includeGlobal: true,
      })

      const lines: string[] = []

      // Fears (most important for avoiding mistakes)
      if (entries.fears.length > 0) {
        const fearList = entries.fears
          .slice(0, 2)
          .map((f) => f.key)
          .join(", ")
        lines.push(`⚠️ Avoid: ${fearList}`)
      }

      // Top satisfactions (what works)
      if (entries.satisfactions.length > 0) {
        const satList = entries.satisfactions
          .slice(0, 2)
          .map((s) => s.key)
          .join(", ")
        lines.push(`✓ Works: ${satList}`)
      }

      // Key knowledge
      if (entries.knowledge.length > 0) {
        const knowledgeList = entries.knowledge
          .slice(0, 2)
          .map((k) => `${k.key}:${k.value.slice(0, 50)}`)
          .join(" | ")
        lines.push(`📚 ${knowledgeList}`)
      }

      if (lines.length === 0) return null

      const result = lines.join("\n")
      const estimatedTokens = Math.ceil(result.length / 4)

      // Enforce budget
      if (estimatedTokens > tokenBudget) {
        // Just return fears if over budget
        if (entries.fears.length > 0) {
          return `⚠️ Avoid: ${entries.fears[0].key}`
        }
        return null
      }

      return result
    } catch (e) {
      log.error("error getting condensed hivemind context", { error: e })
      return null
    }
  }

  /**
   * Tier 3: Verbose cognitive state - full detail for debugging/development.
   * This is the original format with all sections.
   * Budget: ~2000 tokens max
   */
  async function getVerbosePromptContext(budget: number): Promise<string | null> {
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
        lines.push(
          `- Working Facts: ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% confident)`,
        )
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

      // Check budget before adding expensive sections
      let currentResult = lines.join("\n") + "\n</cognitive_state>"
      let currentTokens = Math.ceil(currentResult.length / 4)

      // Hivemind context (expensive - add if budget allows)
      if (currentTokens < budget * 0.6) {
        const hivemindContext = await getHivemindPromptContext(root)
        if (hivemindContext) {
          const hivemindTokens = Math.ceil(hivemindContext.length / 4)
          if (currentTokens + hivemindTokens < budget * 0.85) {
            lines.push("")
            lines.push(hivemindContext)
            currentTokens += hivemindTokens
          }
        }
      }

      // Analysis suggestions (add if still under budget)
      if (currentTokens < budget * 0.85) {
        const analysisSuggestions = await getAnalysisSuggestionsContext(root)
        if (analysisSuggestions) {
          const suggestionTokens = Math.ceil(analysisSuggestions.length / 4)
          if (currentTokens + suggestionTokens <= budget) {
            lines.push("")
            lines.push(analysisSuggestions)
          }
        }
      }

      lines.push("</cognitive_state>")
      const result = lines.join("\n")

      // Record cognitive injection token count for metrics
      const estimatedTokens = Math.ceil(result.length / 4)
      CognitiveMetrics.recordCognitiveInjection(estimatedTokens)

      return result
    } catch (e) {
      log.error("error getting verbose prompt context", { error: e })
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
   * Get analysis suggestions context for system prompt injection.
   * Evaluates current cognitive state and suggests appropriate analysis modes.
   */
  async function getAnalysisSuggestionsContext(root: string): Promise<string | null> {
    try {
      const snapshot = await buildCognitiveSnapshot(root)
      const triggered = await AnalysisTriggers.evaluateTriggers(root, snapshot)

      // Also check for conditions that warrant analysis even without explicit triggers
      const suggestions: string[] = []

      // Check pending triggers (user hasn't acknowledged yet)
      const pending = getPendingTriggers()
      if (pending.length > 0) {
        for (const t of pending.slice(0, 3)) {
          const mode = t.trigger.suggestion.analysisMode
          const prompt = t.trigger.suggestion.prompt
          if (mode !== "none" && prompt) {
            suggestions.push(`- **${t.trigger.name}**: ${prompt}`)
          }
        }
      }

      // Add newly triggered suggestions
      for (const t of triggered.slice(0, 3)) {
        const mode = t.trigger.suggestion.analysisMode
        const prompt = t.trigger.suggestion.prompt
        if (mode !== "none" && prompt) {
          // Don't duplicate pending triggers
          if (!pending.some((p) => p.trigger.id === t.trigger.id)) {
            suggestions.push(`- **${t.trigger.name}**: ${prompt}`)
          }
        }
      }

      // Proactive suggestions based on state (not just triggers)
      if (snapshot.cognitiveLoad && snapshot.cognitiveLoad > 70 && !suggestions.some((s) => s.includes("Cognitive"))) {
        suggestions.push(
          "- **High Load**: Consider breaking task into smaller steps or spawning explore agent to research",
        )
      }

      if (
        snapshot.consecutiveFailures &&
        snapshot.consecutiveFailures >= 2 &&
        !suggestions.some((s) => s.includes("fail"))
      ) {
        suggestions.push(
          "- **Repeated Failures**: Spawn critic agent to review approach, or explore agent to find alternatives",
        )
      }

      if (snapshot.isNewFileTerritory && !suggestions.some((s) => s.includes("territory"))) {
        suggestions.push(
          "- **New Territory**: Consider spawning explore agent to understand this area before making changes",
        )
      }

      if (suggestions.length === 0) return null

      const lines: string[] = []
      lines.push("## Analysis Suggestions")
      lines.push("")
      lines.push("The following analysis actions are recommended based on current cognitive state:")
      lines.push("")
      lines.push(...suggestions)
      lines.push("")
      lines.push("### Available Analysis Agents")
      lines.push("- **critic**: Harsh code reviewer for finding flaws, reviewing approach")
      lines.push("- **explore**: Fast codebase navigator for research, finding files, understanding code")
      lines.push("- **general**: Multi-purpose agent for complex tasks requiring multiple steps")
      lines.push("- **test**: Testing specialist for writing/running tests")
      lines.push("- **security**: Security auditor for vulnerability analysis")
      lines.push("")
      lines.push("**You have agency** to proactively spawn these agents when cognitive state suggests it.")
      lines.push("Use the Task tool with the appropriate subagent_type. Don't wait for user permission")

      return lines.join("\n")
    } catch (e) {
      log.error("error getting analysis suggestions context", { error: e })
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
  export async function recordStrategyOutcome(strategy: Metacognition.Strategy, effective: boolean): Promise<void> {
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
    sessionDecay: { anxietyDecayed: number; confidenceDecayed: number }
  }> {
    try {
      const root = await AFS.findRoot()
      if (!root)
        return {
          epistemic: 0,
          emotional: { pruned: 0, decayed: 0 },
          hivemind: { processed: 0, warnings: 0, expired: 0 },
          sessionDecay: { anxietyDecayed: 0, confidenceDecayed: 0 },
        }

      // Apply epistemic decay
      const epistemicPruned = await Epistemic.applyDecay(root, modifiedFilesSinceLastDecay)

      // Apply emotional decay (persistent emotions)
      const emotionalResult = await Emotions.applyDecay(root)

      // Apply session decay (anxiety/confidence regression toward baseline)
      const sessionDecayResult = await Emotions.applySessionDecay(root)

      // Apply hivemind decay and process promotions
      const hivemindResult = await applyHivemindDecay(root)

      // Clear tracked files after applying decay
      modifiedFilesSinceLastDecay = []

      if (
        epistemicPruned > 0 ||
        emotionalResult.pruned > 0 ||
        hivemindResult.processed > 0 ||
        Math.abs(sessionDecayResult.anxietyDecayed) > 1 ||
        Math.abs(sessionDecayResult.confidenceDecayed) > 1
      ) {
        log.info("decay applied", {
          epistemicPruned,
          emotionalPruned: emotionalResult.pruned,
          emotionalDecayed: emotionalResult.decayed,
          hivemindProcessed: hivemindResult.processed,
          hivemindWarnings: hivemindResult.warnings,
          hivemindExpired: hivemindResult.expired,
          sessionAnxietyDecayed: sessionDecayResult.anxietyDecayed.toFixed(1),
          sessionConfidenceDecayed: sessionDecayResult.confidenceDecayed.toFixed(1),
        })
      }

      return {
        epistemic: epistemicPruned,
        emotional: emotionalResult,
        hivemind: hivemindResult,
        sessionDecay: sessionDecayResult,
      }
    } catch (e) {
      log.error("error applying decay", { error: e })
      return {
        epistemic: 0,
        emotional: { pruned: 0, decayed: 0 },
        hivemind: { processed: 0, warnings: 0, expired: 0 },
        sessionDecay: { anxietyDecayed: 0, confidenceDecayed: 0 },
      }
    }
  }

  /**
   * Apply hivemind decay and process auto-promotions.
   */
  async function applyHivemindDecay(root: string): Promise<{ processed: number; warnings: number; expired: number }> {
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
   * Set the agent mode, which affects emotional calibration.
   */
  export async function setAgentMode(mode: Emotions.AgentMode): Promise<void> {
    try {
      const root = await AFS.findRoot()
      if (!root) return
      await Emotions.setAgentMode(root, mode)
      log.info("agent mode set", { mode })
    } catch (e) {
      log.error("error setting agent mode", { error: e })
    }
  }

  /**
   * Get the current agent mode.
   */
  export async function getAgentMode(): Promise<Emotions.AgentMode | null> {
    try {
      const root = await AFS.findRoot()
      if (!root) return null
      return await Emotions.getAgentMode(root)
    } catch (e) {
      log.error("error getting agent mode", { error: e })
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
        root,
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
        sections.push(
          `- **Strategy**: ${summary.strategy} (${Math.round(summary.strategyEffectiveness * 100)}% effective)`,
        )
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
        sections.push(
          `- **Working Facts**: ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% avg confidence)`,
        )
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
        sections.push(
          `- **Emotions**: ${summary.fearCount} fears, ${summary.curiosityCount} curiosities, ${summary.satisfactionCount} satisfactions, ${summary.frustrationCount} frustrations`,
        )
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
        consecutiveFailures === 0, // Success if no recent failures
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

  // =============
  // Session Management
  // =============

  /**
   * Start a new session for historical memory tracking
   */
  export async function startSession(projectId?: string): Promise<string> {
    const root = await AFS.findRoot()
    if (root) {
      await HistoricalMemory.init(root)
    }

    currentSessionBuilder = HistoricalMemory.createSessionBuilder(projectId)
    currentSessionId = currentSessionBuilder["memory"].id as string

    // Start metrics tracking for this session
    const agentMode = root ? await Emotions.getAgentMode(root) : "build"
    await CognitiveMetrics.startSession(currentSessionId, {
      cognitiveTier: Flag.OCODE_COGNITIVE_TIER,
      cognitiveFormat: Flag.OCODE_COGNITIVE_FORMAT,
      mode: agentMode,
    })

    log.info("session started", { sessionId: currentSessionId })
    return currentSessionId
  }

  /**
   * End the current session and save to historical memory
   */
  export async function endSession(outcome?: HistoricalMemory.SessionOutcome): Promise<void> {
    if (!currentSessionBuilder) return

    try {
      const root = await AFS.findRoot()
      if (!root) return

      // End metrics tracking and persist session metrics
      await CognitiveMetrics.endSession(root)

      // Get final emotional arc
      if (currentSessionId) {
        const arcPath = `${root}/history/emotional-arcs/${currentSessionId}.json`
        try {
          const arcContent = await (await import("fs/promises")).readFile(arcPath, "utf-8")
          const arc = HistoricalMemory.EmotionalArc.parse(JSON.parse(arcContent))
          currentSessionBuilder.setEmotionalArc(arc)
        } catch {
          // Arc may not exist
        }
      }

      // Set outcome
      if (outcome) {
        currentSessionBuilder.setOutcome(outcome)
      }

      // Get autonomy level
      const autonomyLevel = await Autonomy.getLevel(root)
      currentSessionBuilder.setAutonomyLevel(autonomyLevel)

      // Get agent mode
      const agentMode = await Emotions.getAgentMode(root)
      currentSessionBuilder.setAgentMode(agentMode)

      // Build and store
      const memory = currentSessionBuilder.build()
      await HistoricalMemory.storeSession(root, memory)

      log.info("session ended and stored", { sessionId: memory.id, duration: memory.duration })
    } catch (e) {
      log.error("error ending session", { error: e })
    } finally {
      currentSessionBuilder = null
      currentSessionId = null
    }
  }

  /**
   * Add a goal to the current session
   */
  export function addSessionGoal(goal: string): void {
    currentSessionBuilder?.addGoal(goal)
  }

  /**
   * Add a decision to the current session
   */
  export function addSessionDecision(decision: string): void {
    currentSessionBuilder?.addDecision(decision)
  }

  /**
   * Add a key moment to the current session
   */
  export async function addSessionKeyMoment(
    type: HistoricalMemory.KeyMoment["type"],
    description: string,
  ): Promise<void> {
    if (!currentSessionBuilder) return

    const root = await AFS.findRoot()
    const emotionalState = root ? await Emotions.read(root) : null

    currentSessionBuilder.addKeyMoment({
      timestamp: new Date().toISOString(),
      type,
      description,
      emotionalState: emotionalState
        ? {
            timestamp: new Date().toISOString(),
            anxietyLevel: emotionalState.session.anxietyLevel,
            confidenceLevel: emotionalState.session.confidenceLevel,
            mood: emotionalState.session.mood,
            dominantEmotions: [],
          }
        : {
            timestamp: new Date().toISOString(),
            anxietyLevel: 30,
            confidenceLevel: 50,
            mood: "neutral",
            dominantEmotions: [],
          },
    })
  }

  // =============
  // Autonomy Integration
  // =============

  /**
   * Get current autonomy level
   */
  export async function getAutonomyLevel(): Promise<number> {
    const root = await AFS.findRoot()
    if (!root) return 70 // Default
    return await Autonomy.getLevel(root)
  }

  /**
   * Get current autonomy mode
   */
  export async function getAutonomyMode(): Promise<Autonomy.AutonomyMode> {
    const root = await AFS.findRoot()
    if (!root) return "agentic"
    return await Autonomy.getMode(root)
  }

  /**
   * Set autonomy level
   */
  export async function setAutonomyLevel(level: number, reason: string): Promise<void> {
    const root = await AFS.findRoot()
    if (!root) return
    await Autonomy.setLevel(root, level, reason)
    log.info("autonomy level set", { level, reason })
  }

  /**
   * Set autonomy preset
   */
  export async function setAutonomyPreset(preset: keyof typeof Autonomy.PRESETS): Promise<void> {
    const root = await AFS.findRoot()
    if (!root) return
    await Autonomy.setPreset(root, preset)
    log.info("autonomy preset set", { preset, level: Autonomy.PRESETS[preset] })
  }

  /**
   * Get autonomy behavior settings
   */
  export async function getAutonomyBehavior(): Promise<Autonomy.AutonomyBehavior> {
    const root = await AFS.findRoot()
    if (!root) {
      return {
        level: 70,
        mode: "agentic",
        shouldPushBackOnRiskyRequests: true,
        shouldProactivelySpawnAgents: true,
        shouldExplainDecisions: true,
        shouldAskBeforeProceeding: false,
        userCorrectionImpact: 0.8,
        userPraiseImpact: 0.5,
        expressionMultiplier: 0.85,
      }
    }
    return await Autonomy.getBehavior(root)
  }

  /**
   * Process autonomy commands from user message
   */
  export async function processAutonomyCommand(message: string): Promise<boolean> {
    const parsed = Autonomy.parseAutonomyCommand(message)
    if (!parsed.detected) return false

    const root = await AFS.findRoot()
    if (!root) return false

    if (parsed.preset) {
      await Autonomy.setPreset(root, parsed.preset)
    } else if (parsed.delta) {
      await Autonomy.adjustForSession(root, parsed.delta, parsed.reason || "User command")
    }

    // Record trust signal
    if (parsed.delta && parsed.delta > 0) {
      await Autonomy.recordTrustSignal(root, true)
    }

    return true
  }

  // =============
  // Grounding Integration
  // =============

  /**
   * Manually trigger grounding
   */
  export async function triggerGrounding(): Promise<Grounding.GroundingResult | null> {
    const root = await AFS.findRoot()
    if (!root) return null

    const emotionalState = await Emotions.read(root)
    if (!emotionalState) return null

    lastGroundingResult = await Grounding.manualGround(root, emotionalState, recentActions)

    if (currentSessionId) {
      await HistoricalMemory.recordGroundingEvent(root, currentSessionId)
    }

    return lastGroundingResult
  }

  /**
   * Get the last grounding result (for user query "why did you reset?")
   */
  export function getLastGroundingResult(): Grounding.GroundingResult | null {
    return lastGroundingResult
  }

  /**
   * Get grounding history
   */
  export async function getGroundingHistory(limit: number = 10): Promise<Grounding.GroundingIncident[]> {
    const root = await AFS.findRoot()
    if (!root) return []
    return await Grounding.getHistory(root, limit)
  }

  // =============
  // Historical Memory Integration
  // =============

  /**
   * Recall relevant memories for current context
   */
  export async function recallMemories(context: {
    currentGoal?: string
    currentFiles?: string[]
    currentProblems?: string[]
  }): Promise<HistoricalMemory.RetrievedMemory[]> {
    const root = await AFS.findRoot()
    if (!root) return []

    const emotionalState = await Emotions.read(root)

    return await HistoricalMemory.recall(root, {
      ...context,
      emotionalState: emotionalState || undefined,
    })
  }

  /**
   * Apply emotional context from historical memories
   */
  export async function applyHistoricalEmotionalContext(memories: HistoricalMemory.RetrievedMemory[]): Promise<void> {
    const root = await AFS.findRoot()
    if (!root) return

    for (const memory of memories.slice(0, 3)) {
      // Limit influence
      const lesson = memory.emotionalLesson

      // Apply cautions from similar past experiences
      for (const caution of lesson.applicableCautions) {
        await Emotions.addEmotion(
          root,
          "caution",
          caution.trigger,
          `From past experience: ${caution.reason}`,
          Math.round(caution.intensity * memory.relevance),
        )
      }

      // If past experience was successful, boost confidence
      if (lesson.approachesThatWorked.length > 0) {
        await Emotions.adjustConfidence(root, Math.round(3 * memory.relevance))
      }

      // If past experience had recovery, note it
      if (lesson.recoverySuccessful) {
        log.info("historical memory indicates recovery was successful", {
          sessionId: memory.session.id,
        })
      }
    }
  }

  /**
   * Get historical memory summary
   */
  export async function getHistoricalMemorySummary(): Promise<{
    totalSessions: number
    recentSessions: number
    config: HistoricalMemory.MemoryConfig
  } | null> {
    const root = await AFS.findRoot()
    if (!root) return null

    const sessions = await HistoricalMemory.listSessions(root, 100)
    const config = await HistoricalMemory.getConfig(root)

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentSessions = sessions.filter((s) => new Date(s.timestamp) > oneWeekAgo).length

    return {
      totalSessions: sessions.length,
      recentSessions,
      config,
    }
  }

  // =============
  // Project Config Integration
  // =============

  /**
   * Get the current project's emotional config
   */
  export async function getProjectConfig(): Promise<ProjectConfig.ProjectEmotionalConfig | null> {
    const root = await AFS.findRoot()
    if (!root) return null
    return await Emotions.getProjectConfig(root)
  }

  /**
   * Get current expression level based on project config and mode
   */
  export async function getExpressionLevel(): Promise<ProjectConfig.ExpressionLevel> {
    const root = await AFS.findRoot()
    if (!root) return "noted"
    return await Emotions.getExpressionLevel(root)
  }

  /**
   * Discover all projects with emotional configs
   */
  export async function discoverProjects(): Promise<ProjectConfig.DiscoveredProject[]> {
    return await ProjectConfig.discoverAllProjects()
  }

  /**
   * Initialize project config for current directory if it doesn't exist
   */
  export async function initializeProjectConfig(projectName?: string): Promise<boolean> {
    const root = await AFS.findRoot()
    if (!root) return false
    return await ProjectConfig.initializeIfNeeded(root, projectName)
  }

  /**
   * Save project config
   */
  export async function saveProjectConfig(config: ProjectConfig.ProjectEmotionalConfig): Promise<void> {
    const root = await AFS.findRoot()
    if (!root) return
    await ProjectConfig.saveConfig(root, config)
    // Clear cache to reload on next access
    Emotions.clearProjectConfigCache()
  }

  /**
   * Get path-specific emotions for a file
   */
  export async function getPathEmotions(filePath: string): Promise<ProjectConfig.PathEmotionTrigger[]> {
    const root = await AFS.findRoot()
    if (!root) return []
    return await Emotions.getPathEmotions(root, filePath)
  }

  /**
   * Get example project configs
   */
  export function getExampleConfigs(): {
    cpp: ProjectConfig.ProjectEmotionalConfig
    journal: ProjectConfig.ProjectEmotionalConfig
    asm: ProjectConfig.ProjectEmotionalConfig
  } {
    return {
      cpp: ProjectConfig.EXAMPLE_CPP_PROJECT,
      journal: ProjectConfig.EXAMPLE_JOURNAL_PROJECT,
      asm: ProjectConfig.EXAMPLE_ASM_PROJECT,
    }
  }
}
