/**
 * Lightweight Cognitive State Inference
 *
 * This module provides heuristics for inferring cognitive state from
 * message content and tool usage patterns without requiring explicit
 * agent tool calls. Used to keep the sidebar updated in real-time.
 *
 * Key features:
 * - Progress detection from message content
 * - Uncertainty markers for confidence tracking
 * - Frustration detection from retry patterns
 * - Goal completion hints
 */

import { Metacognition } from "./metacognition"
import { Emotions } from "./emotions"

export namespace CognitiveInference {
  /**
   * Inferred cognitive updates from message analysis
   */
  export interface InferredState {
    // Metacognition inferences
    progressStatus?: Metacognition.ProgressStatus
    cognitiveLoadDelta?: number // -1 to 1, relative change
    frustrationDelta?: number // -0.5 to 0.5

    // Emotional inferences
    moodHint?: Emotions.Mood
    anxietyDelta?: number // -20 to 20
    confidenceDelta?: number // -20 to 20

    // Pattern markers found
    markers: {
      progress: string[]
      uncertainty: string[]
      frustration: string[]
      completion: string[]
    }
  }

  // Progress indicator patterns
  const PROGRESS_PATTERNS = [
    /(?:done|completed|finished|fixed|resolved|working|success)/i,
    /(?:let me|i'll|i will|going to)/i,
    /(?:that (?:should|did|does) (?:work|fix))/i,
    /(?:looks good|seems correct|appears to be)/i,
  ]

  // Uncertainty marker patterns
  const UNCERTAINTY_PATTERNS = [
    /(?:i think|probably|maybe|might|could be|not sure|uncertain)/i,
    /(?:i'm not certain|i believe|it seems|appears to)/i,
    /(?:\?{2,}|hmm|let me (?:think|check|verify))/i,
    /(?:need to (?:investigate|research|look into))/i,
  ]

  // Frustration indicator patterns
  const FRUSTRATION_PATTERNS = [
    /(?:still|again|another|yet again|once more)/i,
    /(?:unfortunately|sadly|unable to|cannot|can't)/i,
    /(?:error|failed|failure|broken|doesn't work)/i,
    /(?:stuck|blocked|issue|problem persists)/i,
  ]

  // Completion indicator patterns
  const COMPLETION_PATTERNS = [
    /(?:all (?:done|complete|tests? pass))/i,
    /(?:successfully|success!|it works!)/i,
    /(?:task (?:completed|finished|done))/i,
    /(?:changes (?:are|have been) (?:applied|made|committed))/i,
  ]

  // Spinning patterns (same approach repeatedly)
  const SPINNING_PHRASES = [
    /(?:let me try (?:again|once more|another))/i,
    /(?:trying (?:again|another approach))/i,
    /(?:one more (?:time|attempt))/i,
  ]

  // High confidence patterns
  const CONFIDENCE_PATTERNS = [
    /(?:definitely|certainly|absolutely|clearly)/i,
    /(?:this will|this should|this does)/i,
    /(?:i know|i understand|i see)/i,
  ]

  // Cautious/anxious patterns
  const ANXIOUS_PATTERNS = [
    /(?:careful|cautious|risky|dangerous)/i,
    /(?:be sure|make sure|double check)/i,
    /(?:might break|could cause|watch out)/i,
  ]

  /**
   * Analyze message content for cognitive state hints
   */
  export function analyzeMessage(content: string): InferredState {
    const result: InferredState = {
      markers: {
        progress: [],
        uncertainty: [],
        frustration: [],
        completion: [],
      },
    }

    // Check progress patterns
    for (const pattern of PROGRESS_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        result.markers.progress.push(match[0])
      }
    }

    // Check uncertainty patterns
    for (const pattern of UNCERTAINTY_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        result.markers.uncertainty.push(match[0])
      }
    }

    // Check frustration patterns
    for (const pattern of FRUSTRATION_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        result.markers.frustration.push(match[0])
      }
    }

    // Check completion patterns
    for (const pattern of COMPLETION_PATTERNS) {
      const match = content.match(pattern)
      if (match) {
        result.markers.completion.push(match[0])
      }
    }

    // Infer progress status
    if (result.markers.completion.length > 0) {
      result.progressStatus = "making_progress"
      result.confidenceDelta = 10
      result.anxietyDelta = -5
    } else if (result.markers.frustration.length >= 2) {
      result.frustrationDelta = 0.1
      result.anxietyDelta = 5
      result.confidenceDelta = -5
    } else if (result.markers.progress.length > 0) {
      result.progressStatus = "making_progress"
    }

    // Check for spinning indicators
    for (const pattern of SPINNING_PHRASES) {
      if (pattern.test(content)) {
        result.progressStatus = "spinning"
        result.frustrationDelta = 0.15
        result.anxietyDelta = 10
        break
      }
    }

    // Infer confidence changes from uncertainty
    if (result.markers.uncertainty.length >= 2) {
      result.confidenceDelta = (result.confidenceDelta || 0) - 10
    } else if (result.markers.uncertainty.length === 0) {
      // Check for confidence patterns
      for (const pattern of CONFIDENCE_PATTERNS) {
        if (pattern.test(content)) {
          result.confidenceDelta = (result.confidenceDelta || 0) + 5
          break
        }
      }
    }

    // Check for anxious patterns
    for (const pattern of ANXIOUS_PATTERNS) {
      if (pattern.test(content)) {
        result.anxietyDelta = (result.anxietyDelta || 0) + 5
        break
      }
    }

    // Infer mood hints
    if (result.markers.completion.length > 0 && result.markers.frustration.length === 0) {
      result.moodHint = "confident"
    } else if (result.markers.frustration.length >= 2) {
      result.moodHint = "frustrated"
    } else if (result.markers.uncertainty.length >= 2) {
      result.moodHint = "curious"
    }

    // Estimate cognitive load change based on content length/complexity
    const wordCount = content.split(/\s+/).length
    if (wordCount > 500) {
      result.cognitiveLoadDelta = 0.1 // Long responses indicate high cognitive engagement
    } else if (wordCount < 50) {
      result.cognitiveLoadDelta = -0.1 // Short responses indicate lower load
    }

    return result
  }

  /**
   * Analyze tool usage patterns for cognitive hints
   */
  export function analyzeToolPattern(toolName: string, success: boolean, recentTools: string[]): InferredState {
    const result: InferredState = {
      markers: {
        progress: [],
        uncertainty: [],
        frustration: [],
        completion: [],
      },
    }

    // Check for repeated same tool (potential spinning)
    const last5 = recentTools.slice(-5)
    const sameToolCount = last5.filter((t) => t === toolName).length
    if (sameToolCount >= 4) {
      result.progressStatus = "spinning"
      result.frustrationDelta = 0.1
      result.anxietyDelta = 10
      result.markers.frustration.push(`Repeated ${toolName} calls`)
    }

    // Tool-specific inferences
    if (success) {
      if (toolName === "bash") {
        result.markers.progress.push("Command executed")
      } else if (toolName === "edit" || toolName === "write") {
        result.markers.progress.push("Code modified")
      } else if (toolName === "read" || toolName === "glob" || toolName === "grep") {
        // Research tools indicate exploration
        result.cognitiveLoadDelta = 0.05
      }
      result.confidenceDelta = 2
    } else {
      result.markers.frustration.push(`${toolName} failed`)
      result.confidenceDelta = -5
      result.anxietyDelta = 3
    }

    // Detect diverse tool usage (good exploration)
    const uniqueTools = new Set(last5).size
    if (uniqueTools >= 4 && last5.length >= 5) {
      result.moodHint = "curious"
      result.markers.progress.push("Diverse exploration")
    }

    return result
  }

  /**
   * Merge multiple inferred states
   */
  export function mergeInferences(...states: InferredState[]): InferredState {
    const result: InferredState = {
      markers: {
        progress: [],
        uncertainty: [],
        frustration: [],
        completion: [],
      },
    }

    for (const state of states) {
      // Merge markers
      result.markers.progress.push(...state.markers.progress)
      result.markers.uncertainty.push(...state.markers.uncertainty)
      result.markers.frustration.push(...state.markers.frustration)
      result.markers.completion.push(...state.markers.completion)

      // Use first defined values for discrete state
      if (!result.progressStatus && state.progressStatus) {
        result.progressStatus = state.progressStatus
      }
      if (!result.moodHint && state.moodHint) {
        result.moodHint = state.moodHint
      }

      // Sum deltas
      if (state.cognitiveLoadDelta) {
        result.cognitiveLoadDelta = (result.cognitiveLoadDelta || 0) + state.cognitiveLoadDelta
      }
      if (state.frustrationDelta) {
        result.frustrationDelta = (result.frustrationDelta || 0) + state.frustrationDelta
      }
      if (state.anxietyDelta) {
        result.anxietyDelta = (result.anxietyDelta || 0) + state.anxietyDelta
      }
      if (state.confidenceDelta) {
        result.confidenceDelta = (result.confidenceDelta || 0) + state.confidenceDelta
      }
    }

    // Clamp delta values
    if (result.cognitiveLoadDelta) {
      result.cognitiveLoadDelta = Math.max(-1, Math.min(1, result.cognitiveLoadDelta))
    }
    if (result.frustrationDelta) {
      result.frustrationDelta = Math.max(-0.5, Math.min(0.5, result.frustrationDelta))
    }
    if (result.anxietyDelta) {
      result.anxietyDelta = Math.max(-20, Math.min(20, result.anxietyDelta))
    }
    if (result.confidenceDelta) {
      result.confidenceDelta = Math.max(-20, Math.min(20, result.confidenceDelta))
    }

    return result
  }

  /**
   * Apply inferred state to cognitive modules
   * Only applies changes that meet minimum thresholds to avoid noise
   */
  export async function applyInference(root: string, inference: InferredState): Promise<void> {
    // Apply emotional deltas if significant
    if (inference.anxietyDelta && Math.abs(inference.anxietyDelta) >= 5) {
      await Emotions.adjustAnxiety(root, inference.anxietyDelta)
    }
    if (inference.confidenceDelta && Math.abs(inference.confidenceDelta) >= 5) {
      await Emotions.adjustConfidence(root, inference.confidenceDelta)
    }

    // Update mood if strongly indicated
    if (inference.moodHint && inference.markers.completion.length + inference.markers.frustration.length >= 2) {
      await Emotions.updateMood(root, inference.moodHint, "Auto-inferred from message patterns")
    }
  }

  /**
   * Quick check if content has any cognitive signals worth processing
   * Use this to avoid expensive analysis on trivial messages
   */
  export function hasSignals(content: string): boolean {
    if (content.length < 20) return false

    // Quick regex checks
    const quickPatterns = [
      /(?:done|completed|fixed|error|failed|try again|not sure)/i,
      /(?:unfortunately|successfully|let me|going to)/i,
    ]

    return quickPatterns.some((p) => p.test(content))
  }
}
