import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { useCognitive } from "../context/cognitive"
import { useTheme } from "../context/theme"
import type { Emotions } from "@/cognitive"

/**
 * Mood Indicator Component
 * 
 * Displays a visual indicator of the current emotional state.
 * Can be used in:
 * - Chat messages (shows only on mood change)
 * - Sidebar panel (always visible)
 * - Status bar (compact view)
 */

// Map moods to display characters/colors
const MOOD_CONFIG: Record<Emotions.Mood, { icon: string; label: string; color: "success" | "warning" | "error" | "info" | "text" | "textMuted" }> = {
  positive: { icon: "●", label: "Positive", color: "success" },
  neutral: { icon: "○", label: "Neutral", color: "textMuted" },
  negative: { icon: "◐", label: "Negative", color: "warning" },
  anxious: { icon: "◉", label: "Anxious", color: "error" },
  confident: { icon: "◆", label: "Confident", color: "success" },
  frustrated: { icon: "◇", label: "Frustrated", color: "warning" },
  curious: { icon: "◈", label: "Curious", color: "info" },
}

// Anxiety level thresholds
const ANXIETY_LEVELS = {
  low: { max: 30, color: "success" as const, label: "Low" },
  moderate: { max: 60, color: "textMuted" as const, label: "Moderate" },
  elevated: { max: 80, color: "warning" as const, label: "Elevated" },
  high: { max: 100, color: "error" as const, label: "High" },
}

// Confidence level thresholds
const CONFIDENCE_LEVELS = {
  low: { max: 30, color: "error" as const, label: "Low" },
  moderate: { max: 60, color: "warning" as const, label: "Moderate" },
  good: { max: 80, color: "textMuted" as const, label: "Good" },
  high: { max: 100, color: "success" as const, label: "High" },
}

function getAnxietyLevel(level: number) {
  if (level <= ANXIETY_LEVELS.low.max) return ANXIETY_LEVELS.low
  if (level <= ANXIETY_LEVELS.moderate.max) return ANXIETY_LEVELS.moderate
  if (level <= ANXIETY_LEVELS.elevated.max) return ANXIETY_LEVELS.elevated
  return ANXIETY_LEVELS.high
}

function getConfidenceLevel(level: number) {
  if (level <= CONFIDENCE_LEVELS.low.max) return CONFIDENCE_LEVELS.low
  if (level <= CONFIDENCE_LEVELS.moderate.max) return CONFIDENCE_LEVELS.moderate
  if (level <= CONFIDENCE_LEVELS.good.max) return CONFIDENCE_LEVELS.good
  return CONFIDENCE_LEVELS.high
}

interface MoodIndicatorProps {
  /** Show full label or just icon */
  compact?: boolean
  /** Show anxiety/confidence bars */
  showBars?: boolean
  /** Show emotion counts */
  showCounts?: boolean
}

/**
 * Full mood indicator for sidebar/panel
 */
export function MoodIndicator(props: MoodIndicatorProps) {
  const cognitive = useCognitive()
  const { theme } = useTheme()

  const moodConfig = createMemo(() => {
    const mood = cognitive.mood as Emotions.Mood
    return MOOD_CONFIG[mood] || MOOD_CONFIG.neutral
  })

  const anxietyConfig = createMemo(() => getAnxietyLevel(cognitive.anxietyLevel))
  const confidenceConfig = createMemo(() => getConfidenceLevel(cognitive.confidenceLevel))

  const themeColor = (color: string) => {
    switch (color) {
      case "success": return theme.success
      case "warning": return theme.warning
      case "error": return theme.error
      case "info": return theme.info
      case "text": return theme.text
      case "textMuted": return theme.textMuted
      default: return theme.text
    }
  }

  return (
    <box flexDirection="column" gap={0}>
      {/* Mood line */}
      <box flexDirection="row" gap={1}>
        <text fg={themeColor(moodConfig().color)}>
          {moodConfig().icon}
        </text>
        <Show when={!props.compact}>
          <text fg={theme.text}>{moodConfig().label}</text>
        </Show>
      </box>

      {/* Anxiety/Confidence bars */}
      <Show when={props.showBars}>
        <box flexDirection="row" gap={1} marginTop={1}>
          <text fg={theme.textMuted}>Anx:</text>
          <text fg={themeColor(anxietyConfig().color)}>
            {cognitive.anxietyLevel}%
          </text>
          <text fg={theme.textMuted}>|</text>
          <text fg={theme.textMuted}>Conf:</text>
          <text fg={themeColor(confidenceConfig().color)}>
            {cognitive.confidenceLevel}%
          </text>
        </box>
      </Show>

      {/* Emotion counts */}
      <Show when={props.showCounts && cognitive.hasEmotionalData}>
        <box flexDirection="row" gap={1} marginTop={1}>
          <Show when={cognitive.fearCount > 0}>
            <text fg={theme.error}>⚠{cognitive.fearCount}</text>
          </Show>
          <Show when={cognitive.curiosityCount > 0}>
            <text fg={theme.info}>?{cognitive.curiosityCount}</text>
          </Show>
          <Show when={cognitive.satisfactionCount > 0}>
            <text fg={theme.success}>✓{cognitive.satisfactionCount}</text>
          </Show>
          <Show when={cognitive.frustrationCount > 0}>
            <text fg={theme.warning}>✗{cognitive.frustrationCount}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

/**
 * Compact mood badge for status bar
 */
export function MoodBadge() {
  const cognitive = useCognitive()
  const { theme } = useTheme()

  const moodConfig = createMemo(() => {
    const mood = cognitive.mood as Emotions.Mood
    return MOOD_CONFIG[mood] || MOOD_CONFIG.neutral
  })

  const themeColor = (color: string) => {
    switch (color) {
      case "success": return theme.success
      case "warning": return theme.warning
      case "error": return theme.error
      case "info": return theme.info
      case "text": return theme.text
      case "textMuted": return theme.textMuted
      default: return theme.text
    }
  }

  return (
    <text fg={themeColor(moodConfig().color)}>
      {moodConfig().icon}
    </text>
  )
}

/**
 * Hook for mood change detection (for chat indicators)
 * Returns true when mood changes, resets after a short delay
 */
export function useMoodChange() {
  const cognitive = useCognitive()
  const [showIndicator, setShowIndicator] = createSignal(false)
  const [previousMood, setPreviousMood] = createSignal<string | null>(null)

  createEffect(
    on(
      () => cognitive.mood,
      (currentMood, prevMood) => {
        if (prevMood && currentMood !== prevMood) {
          setShowIndicator(true)
          setPreviousMood(prevMood)
          // Hide after 3 seconds
          setTimeout(() => setShowIndicator(false), 3000)
        }
      },
    ),
  )

  return {
    showIndicator,
    previousMood,
    currentMood: () => cognitive.mood,
  }
}

/**
 * Mood change indicator for chat (shows only on mood transitions)
 */
export function ChatMoodIndicator() {
  const { showIndicator, currentMood } = useMoodChange()
  const { theme } = useTheme()

  const moodConfig = createMemo(() => {
    const mood = currentMood() as Emotions.Mood
    return MOOD_CONFIG[mood] || MOOD_CONFIG.neutral
  })

  const themeColor = (color: string) => {
    switch (color) {
      case "success": return theme.success
      case "warning": return theme.warning
      case "error": return theme.error
      case "info": return theme.info
      case "text": return theme.text
      case "textMuted": return theme.textMuted
      default: return theme.text
    }
  }

  return (
    <Show when={showIndicator()}>
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={3}
        marginTop={1}
        marginBottom={1}
      >
        <text fg={themeColor(moodConfig().color)}>
          {moodConfig().icon}
        </text>
        <text fg={theme.textMuted}>
          Mood: {moodConfig().label}
        </text>
      </box>
    </Show>
  )
}

/**
 * Anxiety warning indicator (shows when anxiety is elevated)
 */
export function AnxietyWarning() {
  const cognitive = useCognitive()
  const { theme } = useTheme()

  const showWarning = createMemo(() => cognitive.anxietyLevel >= 70)

  return (
    <Show when={showWarning()}>
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={3}
        backgroundColor={theme.backgroundElement}
      >
        <text fg={theme.warning}>◉</text>
        <text fg={theme.warning}>
          High anxiety ({cognitive.anxietyLevel}%) - consider pausing
        </text>
      </box>
    </Show>
  )
}

/**
 * Flow state indicator (shows when in flow)
 */
export function FlowStateIndicator() {
  const cognitive = useCognitive()
  const { theme } = useTheme()

  return (
    <Show when={cognitive.flowState}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.success}>◆</text>
        <text fg={theme.success}>Flow</text>
      </box>
    </Show>
  )
}
