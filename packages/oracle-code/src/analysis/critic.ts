/**
 * Adaptive Harsh Critic - Analysis mode for code criticism.
 *
 * Implements adaptive critic tone per PROTOCOL_SPEC.md Section 5.2.4,
 * based on "Mind Your Tone" findings (2510.04950v1).
 */

import { Log } from "@/util/log"
import type {
  CriticTone,
  CriticReview,
  AdaptiveCriticConfig,
  CriticState,
} from "./types"
import { TONE_PREFIXES } from "./types"

const log = Log.create({ service: "analysis.critic" })

/**
 * Default configuration for the adaptive critic.
 */
const DEFAULT_CONFIG: Required<AdaptiveCriticConfig> = {
  defaultTone: "harsh",
  anxietyThreshold: 0.7,
  anxietyDowngradeTo: "direct",
  frustrationCountThreshold: 3,
  frustrationDowngradeTo: "neutral",
  allowUserEscalation: true,
  allowUserOverride: true,
  stableIterationsForEscalation: 5,
  escalationPath: ["neutral", "direct", "challenging", "harsh"],
}

/**
 * Adaptive harsh critic with tone state machine.
 *
 * Tone State Machine (from PROTOCOL_SPEC.md):
 * ```
 * harsh ──(anxiety > 0.7)──► direct ──(frustrations >= 3)──► neutral
 *   ▲                          ▲                               │
 *   └──(stable × 5)────────────┴───────(stable × 5)───────────┘
 * ```
 */
export class AdaptiveCritic {
  private config: Required<AdaptiveCriticConfig>
  private state: CriticState

  constructor(config?: AdaptiveCriticConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      currentTone: this.config.defaultTone as CriticTone,
      stableIterations: 0,
      userOverride: undefined,
      lastAnxiety: 0,
      frustrationCount: 0,
    }
  }

  /**
   * Update critic state based on cognitive state.
   *
   * @param anxietyLevel - Current anxiety level (0-1)
   * @param frustrationCount - Number of consecutive frustrations
   * @param success - Whether the last interaction was successful
   * @returns The current tone after state update
   */
  updateState(
    anxietyLevel: number = 0,
    frustrationCount: number = 0,
    success: boolean = true
  ): CriticTone {
    // Check for user override
    if (this.state.userOverride) {
      return this.state.userOverride
    }

    const oldTone = this.state.currentTone
    let newTone = oldTone

    // Downgrade on high anxiety
    if (anxietyLevel > this.config.anxietyThreshold) {
      if (oldTone === "harsh") {
        newTone = this.config.anxietyDowngradeTo as CriticTone
        log.info("Downgrading tone due to high anxiety", {
          oldTone,
          newTone,
          anxiety: anxietyLevel,
        })
      }
      this.state.stableIterations = 0
    }

    // Downgrade on frustration accumulation
    if (frustrationCount >= this.config.frustrationCountThreshold) {
      newTone = this.config.frustrationDowngradeTo as CriticTone
      this.state.stableIterations = 0
      log.info("Downgrading tone due to frustrations", {
        oldTone,
        newTone,
        frustrationCount,
      })
    }

    // Track stability for potential escalation
    if (success && anxietyLevel < 0.5 && frustrationCount === 0) {
      this.state.stableIterations++
    } else {
      this.state.stableIterations = 0
    }

    // Escalate if stable enough
    if (this.state.stableIterations >= this.config.stableIterationsForEscalation) {
      const path = this.config.escalationPath as CriticTone[]
      const currentIndex = path.indexOf(newTone)
      if (currentIndex >= 0 && currentIndex < path.length - 1) {
        newTone = path[currentIndex + 1]
        log.info("Escalating tone after stable period", {
          oldTone,
          newTone,
          stableIterations: this.state.stableIterations,
        })
      }
      this.state.stableIterations = 0
    }

    // Update state
    this.state.currentTone = newTone
    this.state.lastAnxiety = anxietyLevel
    this.state.frustrationCount = frustrationCount

    return newTone
  }

  /**
   * Allow user to manually set tone.
   *
   * @param tone - The tone to force, or undefined to clear override
   */
  setUserOverride(tone: CriticTone | undefined): void {
    if (!this.config.allowUserOverride) {
      return
    }
    this.state.userOverride = tone
    log.info("User override set", { tone })
  }

  /**
   * Get the current tone prefix for prompts.
   */
  getPrefix(): string {
    const tone = this.state.userOverride ?? this.state.currentTone
    return TONE_PREFIXES[tone]
  }

  /**
   * Create a critic prompt with the appropriate tone prefix.
   *
   * @param content - The content to critique
   * @returns Prompt string with tone prefix
   */
  createPrompt(content: string): string {
    const prefix = this.getPrefix()
    if (prefix) {
      return `${prefix}\n\n${content}`
    }
    return content
  }

  /**
   * Get the current effective tone.
   */
  get currentTone(): CriticTone {
    return this.state.userOverride ?? this.state.currentTone
  }

  /**
   * Get the current state.
   */
  getState(): CriticState {
    return { ...this.state }
  }

  /**
   * Parse LLM response into structured reviews.
   *
   * This is a simple implementation that looks for severity markers.
   *
   * @param llmResponse - Raw LLM response text
   * @returns List of structured reviews
   */
  parseReviews(llmResponse: string): CriticReview[] {
    const reviews: CriticReview[] = []
    const lines = llmResponse.trim().split("\n")
    let currentReview: Partial<CriticReview> | null = null

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (currentReview && currentReview.issue) {
          reviews.push({
            severity: currentReview.severity ?? "minor",
            issue: currentReview.issue,
            suggestion: currentReview.suggestion,
            confidence: currentReview.confidence ?? 0.8,
            aspect: currentReview.aspect,
            location: currentReview.location,
          })
          currentReview = null
        }
        continue
      }

      const lineLower = trimmed.toLowerCase()

      // Check for severity markers
      if (lineLower.includes("critical:") || lineLower.includes("🔴")) {
        if (currentReview?.issue) {
          reviews.push({
            severity: currentReview.severity ?? "minor",
            issue: currentReview.issue,
            confidence: 0.8,
          })
        }
        currentReview = { severity: "critical", issue: trimmed }
      } else if (lineLower.includes("major:") || lineLower.includes("🟠")) {
        if (currentReview?.issue) {
          reviews.push({
            severity: currentReview.severity ?? "minor",
            issue: currentReview.issue,
            confidence: 0.8,
          })
        }
        currentReview = { severity: "major", issue: trimmed }
      } else if (lineLower.includes("minor:") || lineLower.includes("🟡")) {
        if (currentReview?.issue) {
          reviews.push({
            severity: currentReview.severity ?? "minor",
            issue: currentReview.issue,
            confidence: 0.8,
          })
        }
        currentReview = { severity: "minor", issue: trimmed }
      } else if (lineLower.includes("nit:") || lineLower.includes("nitpick:") || lineLower.includes("💬")) {
        if (currentReview?.issue) {
          reviews.push({
            severity: currentReview.severity ?? "minor",
            issue: currentReview.issue,
            confidence: 0.8,
          })
        }
        currentReview = { severity: "nitpick", issue: trimmed }
      } else if (currentReview) {
        // Append to current review
        if (lineLower.includes("suggest") && !currentReview.suggestion) {
          currentReview.suggestion = trimmed
        } else {
          currentReview.issue = (currentReview.issue ?? "") + " " + trimmed
        }
      }
    }

    // Don't forget the last review
    if (currentReview?.issue) {
      reviews.push({
        severity: currentReview.severity ?? "minor",
        issue: currentReview.issue,
        suggestion: currentReview.suggestion,
        confidence: 0.8,
      })
    }

    return reviews
  }
}

/**
 * Singleton critic instance for the application.
 */
let globalCritic: AdaptiveCritic | null = null

/**
 * Get or create the global critic instance.
 */
export function getCritic(config?: AdaptiveCriticConfig): AdaptiveCritic {
  if (!globalCritic) {
    globalCritic = new AdaptiveCritic(config)
  }
  return globalCritic
}

/**
 * Reset the global critic instance.
 */
export function resetCritic(): void {
  globalCritic = null
}
