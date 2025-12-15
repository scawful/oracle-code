import { createSignal, createMemo, createEffect, onCleanup, onMount, For, Show } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useCognitive } from "../../context/cognitive"
import { useToM } from "../../context/tom"
import { useDialog } from "../../ui/dialog"
import { useKeyboardMode } from "../../context/keyboard-mode"
import { useRenderer } from "@opentui/solid"
import { usePanes } from "../../context/panes"
import { useKV } from "../../context/kv"
import { usePromptRef } from "../../context/prompt"

/**
 * CognitiveView - Full cognitive state dashboard
 *
 * Displays metacognition, emotions, goals, and epistemic state
 * in a unified, collapsible section layout with enhanced visibility.
 *
 * Features:
 * - Health overview bar at top
 * - Collapsible sections with detailed views
 * - Clickable items for detailed popups
 * - Recommended actions panel
 * - Golden/working knowledge display
 */

export interface CognitiveViewProps {
  paneId: string
  isActive?: boolean
}

type Section = "health" | "meta" | "emotions" | "goals" | "epistemic" | "actions"

export function CognitiveView(props: CognitiveViewProps) {
  const cognitive = useCognitive()
  const tom = useToM()
  const { theme } = useTheme()
  const dialog = useDialog()
  const keyboard = useKeyboardMode()
  const renderer = useRenderer()
  const panes = usePanes()
  const kv = useKV()
  const promptRef = usePromptRef()

  const ownerId = `cognitive-view:${props.paneId}`
  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())
  // Don't capture keyboard if prompt is focused (let user type in chat)
  const promptFocused = createMemo(() => promptRef.current?.focused ?? false)

  // Section state
  const sections: Section[] = ["health", "meta", "emotions", "goals", "epistemic", "actions"]
  const [currentSection, setCurrentSection] = createSignal<Section>("health")
  const [expanded, setExpanded] = createSignal<Record<Section, boolean>>({
    health: true,
    meta: true,
    emotions: true,
    goals: true,
    epistemic: true,
    actions: true,
  })

  // Auto-refresh setting
  const autoRefresh = () => kv.get("tui.cognitive.auto_refresh", true)

  // Ensure AFS is initialized when the view mounts
  // This handles the case where the cognitive tab is created after the context was initialized
  onMount(() => {
    cognitive.refresh()
  })

  function focusPane() {
    panes.setActive(props.paneId)
    setTimeout(() => renderer.currentFocusedRenderable?.blur(), 0)
  }

  // Keyboard ownership - only when pane is active AND prompt is not focused
  // This allows typing in chat while pane is visible (like Emacs buffer behavior)
  let ownsKeyboard = false
  createEffect(() => {
    const shouldOwn = isActive() && dialog.stack.length === 0 && !promptFocused()

    if (shouldOwn && !ownsKeyboard) {
      ownsKeyboard = true
      renderer.currentFocusedRenderable?.blur()
      keyboard.acquire(ownerId, {
        mode: "vim-navigation",
        priority: 50,
        onKey: (evt) => handleKeyboard(evt),
      })
    }

    if (!shouldOwn && ownsKeyboard) {
      ownsKeyboard = false
      keyboard.release(ownerId)
    }
  })
  onCleanup(() => {
    if (ownsKeyboard) keyboard.release(ownerId)
  })

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }): boolean {
    switch (evt.name) {
      case "j":
      case "down":
        cycleSection(1)
        return true

      case "k":
      case "up":
        cycleSection(-1)
        return true

      case "tab":
        cycleSection(evt.shift ? -1 : 1)
        return true

      case "return":
      case "l":
      case "right":
        toggleExpand(currentSection())
        return true

      case "h":
      case "left":
        setExpanded((prev) => ({ ...prev, [currentSection()]: false }))
        return true

      case "e":
        // Toggle expand all
        const allExpanded = Object.values(expanded()).every((v) => v)
        const newState = !allExpanded
        setExpanded({
          health: newState,
          meta: newState,
          emotions: newState,
          goals: newState,
          epistemic: newState,
          actions: newState,
        })
        return true

      case "r":
        cognitive.refresh()
        return true

      case "a":
        // Toggle auto-refresh
        kv.set("tui.cognitive.auto_refresh", !autoRefresh())
        return true
    }

    return false
  }

  function cycleSection(dir: 1 | -1) {
    const idx = sections.indexOf(currentSection())
    let next = idx + dir
    if (next < 0) next = sections.length - 1
    if (next >= sections.length) next = 0
    setCurrentSection(sections[next])
  }

  function toggleExpand(section: Section) {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Progress bar helper
  function ProgressBar(localProps: {
    value: number
    max?: number
    color?: string | RGBA
    width?: number
    showValue?: boolean
  }) {
    const max = localProps.max ?? 100
    const width = localProps.width ?? 10
    const filled = Math.round((localProps.value / max) * width)
    const empty = width - filled
    const showVal = localProps.showValue ?? true
    return (
      <text fg={localProps.color || theme.primary}>
        {"█".repeat(filled)}
        {"░".repeat(empty)}
        {showVal ? ` ${localProps.value}%` : ""}
      </text>
    )
  }

  // Health indicator component
  function HealthIndicator(localProps: { status: string; value: number }) {
    const statusColor = () => {
      if (localProps.status === "excellent" || localProps.status === "good") return theme.success
      if (localProps.status === "moderate") return theme.warning
      return theme.error
    }
    const statusIcon = () => {
      if (localProps.status === "excellent") return "●●●●●"
      if (localProps.status === "good") return "●●●●○"
      if (localProps.status === "moderate") return "●●●○○"
      if (localProps.status === "concerning") return "●●○○○"
      return "●○○○○"
    }

    return (
      <box flexDirection="row" gap={2}>
        <text fg={statusColor()}>{statusIcon()}</text>
        <text fg={statusColor()} attributes={TextAttributes.BOLD}>
          {localProps.status.toUpperCase()}
        </text>
        <text fg={theme.textMuted}>({localProps.value}%)</text>
      </box>
    )
  }

  function SectionHeader(localProps: {
    section: Section
    label: string
    icon: string
    badge?: string
    badgeColor?: string | RGBA
  }) {
    const isCurrent = () => currentSection() === localProps.section
    const isExp = () => expanded()[localProps.section]

    return (
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={1}
        backgroundColor={isCurrent() ? theme.backgroundElement : undefined}
        onMouseDown={() => {
          focusPane()
          setCurrentSection(localProps.section)
          toggleExpand(localProps.section)
        }}
      >
        <text fg={isCurrent() ? theme.primary : theme.textMuted}>{isExp() ? "▼" : "▶"}</text>
        <text fg={isCurrent() ? theme.primary : theme.text} attributes={isCurrent() ? TextAttributes.BOLD : undefined}>
          {localProps.icon} {localProps.label}
        </text>
        <Show when={localProps.badge}>
          <text fg={localProps.badgeColor || theme.info}>[{localProps.badge}]</text>
        </Show>
      </box>
    )
  }

  // Emotion item component with click handler
  function EmotionItem(localProps: {
    icon: string
    label: string
    intensity?: number
    reason?: string
    color: string | RGBA
    onClick?: () => void
  }) {
    return (
      <box flexDirection="row" gap={1} paddingLeft={1} onMouseDown={localProps.onClick}>
        <text fg={localProps.color}>{localProps.icon}</text>
        <text fg={theme.text}>{localProps.label}</text>
        <Show when={localProps.intensity !== undefined}>
          <text fg={theme.textMuted}>({localProps.intensity}%)</text>
        </Show>
        <Show when={localProps.reason}>
          <text fg={theme.textMuted}>- {localProps.reason}</text>
        </Show>
      </box>
    )
  }

  // Humanize auto-generated fact keys for display
  function humanizeFactKey(key: string): string {
    // Handle file existence keys: file._Users_scawful_Code_...tsx.exists -> filename.tsx
    if (key.startsWith("file.") && key.endsWith(".exists")) {
      const pathPart = key.slice(5, -7) // Remove "file." and ".exists"
      const segments = pathPart.split("_")
      const filename = segments[segments.length - 1] || pathPart
      return filename
    }

    // Handle search/glob keys: search.glob.pattern.count -> glob: pattern
    if (key.startsWith("search.glob.") && key.endsWith(".count")) {
      const pattern = key.slice(12, -6).replace(/_/g, "/")
      return `glob: ${pattern}`
    }

    // Handle search/grep keys: search.grep.pattern.found -> grep: pattern
    if (key.startsWith("search.grep.") && key.endsWith(".found")) {
      const pattern = key.slice(12, -6).replace(/_/g, " ").slice(0, 30)
      return `grep: ${pattern}`
    }

    // Default: truncate and clean up underscores
    const cleaned = key.replace(/_/g, " ").replace(/\./g, " ")
    return cleaned.length > 30 ? cleaned.slice(0, 27) + "..." : cleaned
  }

  // Format fact value for display
  function formatFactValue(value: unknown): string {
    if (typeof value === "boolean") return value ? "yes" : "no"
    if (typeof value === "number") return String(value)
    if (typeof value === "string") return value
    return String(value)
  }

  // Fact/Knowledge item component
  function KnowledgeItem(localProps: {
    key: string
    value: string
    confidence?: number
    isGolden?: boolean
    onClick?: () => void
  }) {
    const displayKey = () => humanizeFactKey(localProps.key)
    const displayValue = () => formatFactValue(localProps.value)

    return (
      <box flexDirection="row" gap={1} paddingLeft={1} onMouseDown={localProps.onClick}>
        <text fg={localProps.isGolden ? theme.warning : theme.info}>{localProps.isGolden ? "★" : "○"}</text>
        <text fg={theme.text} attributes={localProps.isGolden ? TextAttributes.BOLD : undefined}>
          {displayKey()}:
        </text>
        <text fg={theme.textMuted}>
          {displayValue().length > 30 ? displayValue().slice(0, 27) + "..." : displayValue()}
        </text>
        <Show when={localProps.confidence !== undefined}>
          <text fg={theme.textMuted}>({localProps.confidence}%)</text>
        </Show>
      </box>
    )
  }

  // Format emotion data for display
  function formatEmotionData(data: any): Array<{ label: string; value: string }> {
    if (!data || typeof data !== "object") return [{ label: "Status", value: "No data" }]

    try {
      const items: Array<{ label: string; value: string }> = []

      // Handle known emotion entry fields with nice labels
      if (data.trigger) items.push({ label: "Trigger", value: String(data.trigger) })
      if (data.context) items.push({ label: "Context", value: String(data.context) })
      if (data.intensity !== undefined) items.push({ label: "Intensity", value: `${data.intensity}/10` })
      if (data.outcome) items.push({ label: "Outcome", value: String(data.outcome) })
      if (data.mitigation) items.push({ label: "Mitigation", value: String(data.mitigation) })
      if (data.timestamp) {
        try {
          items.push({ label: "Recorded", value: new Date(data.timestamp).toLocaleString() })
        } catch {
          items.push({ label: "Recorded", value: String(data.timestamp) })
        }
      }
      if (Array.isArray(data.tags) && data.tags.length) items.push({ label: "Tags", value: data.tags.join(", ") })
      if (Array.isArray(data.relatedFiles) && data.relatedFiles.length)
        items.push({ label: "Related Files", value: data.relatedFiles.join(", ") })
      if (data.accessCount !== undefined) items.push({ label: "Access Count", value: String(data.accessCount) })

      // If we got nothing, show raw data
      if (items.length === 0) {
        for (const [k, v] of Object.entries(data)) {
          if (v !== null && v !== undefined && !Array.isArray(v) && typeof v !== "object") {
            items.push({ label: k, value: String(v) })
          }
        }
      }

      return items.length > 0 ? items : [{ label: "Status", value: "Empty entry" }]
    } catch {
      return [{ label: "Status", value: "Error reading data" }]
    }
  }

  // Format knowledge/fact data for display
  function formatKnowledgeData(data: any): Array<{ label: string; value: string }> {
    if (!data) return [{ label: "Status", value: "No data" }]

    try {
      const items: Array<{ label: string; value: string }> = []

      // Handle known fact entry fields
      if (data.value !== undefined) items.push({ label: "Value", value: String(data.value) })
      if (data.confidence !== undefined)
        items.push({ label: "Confidence", value: `${Math.round(data.confidence * 100)}%` })
      if (data.source) items.push({ label: "Source", value: String(data.source) })
      if (data.timestamp) {
        try {
          items.push({ label: "Recorded", value: new Date(data.timestamp).toLocaleString() })
        } catch {
          items.push({ label: "Recorded", value: String(data.timestamp) })
        }
      }
      if (data.validated !== undefined) items.push({ label: "Validated", value: data.validated ? "Yes" : "No" })
      if (data.needsValidation !== undefined)
        items.push({ label: "Needs Validation", value: data.needsValidation ? "Yes" : "No" })
      if (data.importance) items.push({ label: "Importance", value: String(data.importance) })
      if (Array.isArray(data.tags) && data.tags.length) items.push({ label: "Tags", value: data.tags.join(", ") })

      // If we got nothing, just show the raw value
      if (items.length === 0) {
        if (typeof data === "object" && data !== null) {
          for (const [k, v] of Object.entries(data)) {
            if (v !== null && v !== undefined && !Array.isArray(v) && typeof v !== "object") {
              items.push({ label: k, value: String(v) })
            }
          }
        } else {
          items.push({ label: "Value", value: String(data) })
        }
      }

      return items.length > 0 ? items : [{ label: "Status", value: "Empty entry" }]
    } catch {
      return [{ label: "Status", value: "Error reading data" }]
    }
  }

  // Dialog helpers - create detail view dialogs
  function showEmotionDetail(type: string, key: string, data: any) {
    try {
      const items = formatEmotionData(data)
      const safeKey = String(key || "unknown")
      const safeType = String(type || "Emotion")
      dialog.replace(
        <box flexDirection="column" padding={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            {safeType}: {safeKey}
          </text>
          <box marginTop={1} marginBottom={1}>
            <For each={items}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.info}>{item.label}:</text>
                  <text fg={theme.text}>{item.value}</text>
                </box>
              )}
            </For>
          </box>
          <box flexDirection="row" justifyContent="flex-end">
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={theme.backgroundElement}
              onMouseDown={() => dialog.clear()}
            >
              <text fg={theme.text}>Close (ESC)</text>
            </box>
          </box>
        </box>,
        () => {},
      )
    } catch (e) {
      console.error("Failed to show emotion detail:", e)
      dialog.replace(
        <box flexDirection="column" padding={1}>
          <text fg={theme.error}>Error displaying emotion details</text>
          <box
            paddingLeft={2}
            paddingRight={2}
            marginTop={1}
            backgroundColor={theme.backgroundElement}
            onMouseDown={() => dialog.clear()}
          >
            <text fg={theme.text}>Close (ESC)</text>
          </box>
        </box>,
        () => {},
      )
    }
  }

  function showKnowledgeDetail(key: string, data: any) {
    try {
      const items = formatKnowledgeData(data)
      const safeKey = String(key || "unknown")
      dialog.replace(
        <box flexDirection="column" padding={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Knowledge: {safeKey}
          </text>
          <box marginTop={1} marginBottom={1}>
            <For each={items}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.info}>{item.label}:</text>
                  <text fg={theme.text}>{item.value}</text>
                </box>
              )}
            </For>
          </box>
          <box flexDirection="row" justifyContent="flex-end">
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={theme.backgroundElement}
              onMouseDown={() => dialog.clear()}
            >
              <text fg={theme.text}>Close (ESC)</text>
            </box>
          </box>
        </box>,
        () => {},
      )
    } catch (e) {
      console.error("Failed to show knowledge detail:", e)
      dialog.replace(
        <box flexDirection="column" padding={1}>
          <text fg={theme.error}>Error displaying knowledge details</text>
          <box
            paddingLeft={2}
            paddingRight={2}
            marginTop={1}
            backgroundColor={theme.backgroundElement}
            onMouseDown={() => dialog.clear()}
          >
            <text fg={theme.text}>Close (ESC)</text>
          </box>
        </box>,
        () => {},
      )
    }
  }

  // Get fears, satisfactions, etc. from emotional state
  const fears = createMemo(() => Object.entries(cognitive.emotional?.fears || {}))
  const satisfactions = createMemo(() => Object.entries(cognitive.emotional?.satisfactions || {}))
  const curiosities = createMemo(() => Object.entries(cognitive.emotional?.curiosities || {}))
  const frustrations = createMemo(() => Object.entries(cognitive.emotional?.frustrations || {}))

  // Get facts from epistemic state
  const goldenFacts = createMemo(() => Object.entries(cognitive.epistemic?.goldenFacts || {}))
  const workingFacts = createMemo(() => Object.entries(cognitive.epistemic?.workingFacts || {}))
  const assumptions = createMemo(() => Object.entries(cognitive.epistemic?.assumptions || {}))
  const unknowns = createMemo(() => cognitive.epistemic?.unknowns || [])

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseDown={focusPane}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        {/* Loading / No Data */}
        <Show when={cognitive.loading}>
          <text fg={theme.textMuted}>Loading cognitive state...</text>
        </Show>

        <Show when={!cognitive.loading && !cognitive.afsInitialized}>
          <box padding={1}>
            <text fg={theme.warning}>AFS not initialized</text>
            <text fg={theme.textMuted} marginTop={1}>
              Run 'ocode afs init' to enable cognitive tracking
            </text>
          </box>
        </Show>

        <Show when={!cognitive.loading && cognitive.afsInitialized}>
          {/* Health Overview Section */}
          <SectionHeader
            section="health"
            label="Health Overview"
            icon="󰓾"
            badge={cognitive.sessionActivity}
            badgeColor={
              cognitive.sessionActivity === "active"
                ? theme.success
                : cognitive.sessionActivity === "recent"
                  ? theme.info
                  : cognitive.sessionActivity === "idle"
                    ? theme.warning
                    : theme.error
            }
          />
          <Show when={expanded().health}>
            <box paddingLeft={3} marginBottom={1}>
              <HealthIndicator status={cognitive.healthStatus} value={cognitive.overallHealth} />
              <box flexDirection="row" gap={3} marginTop={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Trend:</text>
                  <text
                    fg={
                      cognitive.emotionalTrend === "positive"
                        ? theme.success
                        : cognitive.emotionalTrend === "negative"
                          ? theme.error
                          : theme.textMuted
                    }
                  >
                    {cognitive.emotionalTrend === "positive"
                      ? "↑"
                      : cognitive.emotionalTrend === "negative"
                        ? "↓"
                        : "→"}{" "}
                    {cognitive.emotionalTrend}
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Flow:</text>
                  <text fg={cognitive.flowState ? theme.success : theme.textMuted}>
                    {cognitive.flowState ? "●" : "○"}
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Mood:</text>
                  <text fg={theme.text}>{cognitive.mood}</text>
                </box>
              </box>
              <Show when={cognitive.isSpinning || cognitive.shouldSeekHelp}>
                <box marginTop={1}>
                  <Show when={cognitive.isSpinning}>
                    <text fg={theme.warning}>⚠ Spinning detected</text>
                  </Show>
                  <Show when={cognitive.shouldSeekHelp}>
                    <text fg={theme.error}>⚠ Consider seeking help</text>
                  </Show>
                </box>
              </Show>
            </box>
          </Show>

          {/* Metacognition Section */}
          <SectionHeader section="meta" label="Metacognition" icon="󰠭" />
          <Show when={expanded().meta}>
            <box paddingLeft={3} marginBottom={1}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>Strategy:</text>
                <text fg={theme.text}>{cognitive.strategy}</text>
                <text fg={theme.textMuted}>({Math.round(cognitive.strategyEffectiveness * 100)}% effective)</text>
              </box>
              <box flexDirection="row" gap={2} alignItems="center">
                <text fg={theme.textMuted}>Load:</text>
                <ProgressBar
                  value={cognitive.cognitiveLoad}
                  color={
                    cognitive.cognitiveLoad < 50
                      ? theme.success
                      : cognitive.cognitiveLoad < 80
                        ? theme.warning
                        : theme.error
                  }
                />
              </box>
              <box flexDirection="row" gap={3}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Frustration:</text>
                  <text fg={cognitive.frustration > 50 ? theme.warning : theme.textMuted}>
                    {cognitive.frustration}%
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Progress:</text>
                  <text fg={cognitive.progressStatus === "making_progress" ? theme.success : theme.warning}>
                    {cognitive.progressStatus}
                  </text>
                </box>
              </box>
            </box>
          </Show>

          {/* Emotions Section - Enhanced with detailed items */}
          <SectionHeader section="emotions" label="Emotions" icon="󰜎" badge={`${cognitive.totalEmotionCount}`} />
          <Show when={expanded().emotions}>
            <box paddingLeft={3} marginBottom={1}>
              {/* Anxiety & Confidence bars */}
              <box flexDirection="row" gap={3} marginBottom={1}>
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={theme.textMuted}>Anxiety:</text>
                  <ProgressBar
                    value={cognitive.anxietyLevel}
                    color={cognitive.isAnxious ? theme.warning : theme.textMuted}
                    width={8}
                  />
                </box>
                <box flexDirection="row" gap={1} alignItems="center">
                  <text fg={theme.textMuted}>Confidence:</text>
                  <ProgressBar
                    value={cognitive.confidenceLevel}
                    color={cognitive.isConfident ? theme.success : theme.textMuted}
                    width={8}
                  />
                </box>
              </box>

              {/* Fears */}
              <Show when={fears().length > 0}>
                <text fg={theme.error} attributes={TextAttributes.BOLD}>
                  Fears ({fears().length})
                </text>
                <For each={fears().slice(0, 3)}>
                  {([key, fear]) => (
                    <EmotionItem
                      icon="⚠"
                      label={(fear as any).trigger?.slice(0, 20) || key}
                      intensity={(fear as any).intensity}
                      reason={(fear as any).context?.slice(0, 30)}
                      color={theme.error}
                      onClick={() => showEmotionDetail("Fear", key, fear)}
                    />
                  )}
                </For>
                <Show when={fears().length > 3}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{fears().length - 3} more
                  </text>
                </Show>
              </Show>

              {/* Satisfactions */}
              <Show when={satisfactions().length > 0}>
                <text fg={theme.success} attributes={TextAttributes.BOLD} marginTop={1}>
                  Satisfactions ({satisfactions().length})
                </text>
                <For each={satisfactions().slice(0, 3)}>
                  {([key, sat]) => (
                    <EmotionItem
                      icon="✓"
                      label={(sat as any).trigger?.slice(0, 20) || key}
                      intensity={(sat as any).intensity}
                      reason={(sat as any).context?.slice(0, 30)}
                      color={theme.success}
                      onClick={() => showEmotionDetail("Satisfaction", key, sat)}
                    />
                  )}
                </For>
                <Show when={satisfactions().length > 3}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{satisfactions().length - 3} more
                  </text>
                </Show>
              </Show>

              {/* Curiosities */}
              <Show when={curiosities().length > 0}>
                <text fg={theme.info} attributes={TextAttributes.BOLD} marginTop={1}>
                  Curiosities ({curiosities().length})
                </text>
                <For each={curiosities().slice(0, 3)}>
                  {([key, cur]) => (
                    <EmotionItem
                      icon="?"
                      label={(cur as any).trigger?.slice(0, 20) || key}
                      intensity={(cur as any).intensity}
                      reason={(cur as any).context?.slice(0, 30)}
                      color={theme.info}
                      onClick={() => showEmotionDetail("Curiosity", key, cur)}
                    />
                  )}
                </For>
                <Show when={curiosities().length > 3}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{curiosities().length - 3} more
                  </text>
                </Show>
              </Show>

              {/* Frustrations */}
              <Show when={frustrations().length > 0}>
                <text fg={theme.warning} attributes={TextAttributes.BOLD} marginTop={1}>
                  Frustrations ({frustrations().length})
                </text>
                <For each={frustrations().slice(0, 3)}>
                  {([key, frus]) => (
                    <EmotionItem
                      icon="!"
                      label={(frus as any).trigger?.slice(0, 20) || key}
                      intensity={(frus as any).intensity}
                      reason={(frus as any).context?.slice(0, 30)}
                      color={theme.warning}
                      onClick={() => showEmotionDetail("Frustration", key, frus)}
                    />
                  )}
                </For>
                <Show when={frustrations().length > 3}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{frustrations().length - 3} more
                  </text>
                </Show>
              </Show>

              <Show when={!cognitive.hasEmotionalData}>
                <text fg={theme.textMuted}>No emotional data recorded</text>
              </Show>
            </box>
          </Show>

          {/* Goals Section */}
          <SectionHeader section="goals" label="Goals" icon="󰓾" />
          <Show when={expanded().goals}>
            <box paddingLeft={3} marginBottom={1}>
              <Show when={cognitive.primaryGoal} fallback={<text fg={theme.textMuted}>No active goal</text>}>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted}>Primary:</text>
                  <text fg={theme.text}>{cognitive.primaryGoal}</text>
                </box>
                <box flexDirection="row" gap={2} alignItems="center">
                  <text fg={theme.textMuted}>Progress:</text>
                  <ProgressBar value={cognitive.primaryGoalProgress} color={theme.success} />
                </box>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted}>Subgoals:</text>
                  <text fg={theme.text}>
                    {cognitive.completedSubgoals}/{cognitive.totalSubgoals} completed
                  </text>
                  <Show when={cognitive.activeSubgoals > 0}>
                    <text fg={theme.info}>({cognitive.activeSubgoals} active)</text>
                  </Show>
                </box>
                <Show when={cognitive.hasConflicts}>
                  <text fg={theme.warning}>⚠ {cognitive.unresolvedConflicts} unresolved conflict(s)</text>
                </Show>
              </Show>
            </box>
          </Show>

          {/* Epistemic Section - Enhanced with golden/working facts + ToM beliefs */}
          <SectionHeader
            section="epistemic"
            label="Knowledge"
            icon="󰠲"
            badge={`${cognitive.goldenFactCount}★ ${cognitive.workingFactCount + tom.commonGround.sharedFacts.length}○`}
          />
          <Show when={expanded().epistemic}>
            <box paddingLeft={3} marginBottom={1}>
              {/* Summary stats */}
              <box flexDirection="row" gap={3} marginBottom={1}>
                <text fg={theme.warning}>
                  ★ {cognitive.goldenFactCount}/{cognitive.maxGoldenFacts} golden
                </text>
                <text fg={theme.info}>○ {cognitive.workingFactCount} working</text>
                <text fg={theme.textMuted}>({cognitive.avgConfidence}% avg)</text>
              </box>

              {/* Golden Facts */}
              <Show when={goldenFacts().length > 0}>
                <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                  Golden Facts
                </text>
                <For each={goldenFacts().slice(0, 5)}>
                  {([key, fact]) => (
                    <KnowledgeItem
                      key={key}
                      value={(fact as any).value || String(fact)}
                      isGolden={true}
                      onClick={() => showKnowledgeDetail(key, fact)}
                    />
                  )}
                </For>
                <Show when={goldenFacts().length > 5}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{goldenFacts().length - 5} more
                  </text>
                </Show>
              </Show>

              {/* Working Facts */}
              <Show when={workingFacts().length > 0}>
                <text fg={theme.info} attributes={TextAttributes.BOLD} marginTop={1}>
                  Working Facts
                </text>
                <For each={workingFacts().slice(0, 5)}>
                  {([key, fact]) => (
                    <KnowledgeItem
                      key={key}
                      value={(fact as any).value || String(fact)}
                      confidence={(fact as any).confidence ? Math.round((fact as any).confidence * 100) : undefined}
                      isGolden={false}
                      onClick={() => showKnowledgeDetail(key, fact)}
                    />
                  )}
                </For>
                <Show when={workingFacts().length > 5}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{workingFacts().length - 5} more
                  </text>
                </Show>
              </Show>

              {/* Assumptions */}
              <Show when={assumptions().length > 0}>
                <box flexDirection="row" gap={2} marginTop={1}>
                  <text fg={theme.textMuted}>Assumptions:</text>
                  <text fg={theme.text}>{assumptions().length}</text>
                  <Show when={cognitive.unvalidatedAssumptions > 0}>
                    <text fg={theme.warning}>({cognitive.unvalidatedAssumptions} need validation)</text>
                  </Show>
                </box>
              </Show>

              {/* Unknowns */}
              <Show when={unknowns().length > 0}>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted}>Unknowns:</text>
                  <text fg={theme.text}>{unknowns().length}</text>
                  <Show when={cognitive.criticalUnknowns > 0}>
                    <text fg={theme.error}>({cognitive.criticalUnknowns} critical)</text>
                  </Show>
                </box>
              </Show>

              {/* Contradictions */}
              <Show when={cognitive.contradictionCount > 0}>
                <text fg={theme.error}>⚠ {cognitive.contradictionCount} contradiction(s)</text>
              </Show>

              {/* ToM: User Intent */}
              <Show when={tom.userIntent.primaryIntent}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD} marginTop={1}>
                  User Intent
                </text>
                <box paddingLeft={1}>
                  <text fg={theme.text}>
                    {tom.userIntent.primaryIntent.slice(0, 80)}
                    {tom.userIntent.primaryIntent.length > 80 ? "..." : ""}
                  </text>
                  <text fg={theme.textMuted}>Confidence: {tom.formatConfidence(tom.userIntent.confidence)}</text>
                </box>
              </Show>

              {/* ToM: Constraints */}
              <Show when={tom.userIntent.constraints.length > 0}>
                <text fg={theme.info} attributes={TextAttributes.BOLD} marginTop={1}>
                  Constraints ({tom.userIntent.constraints.length})
                </text>
                <For each={tom.userIntent.constraints.slice(0, 3)}>
                  {(constraint) => (
                    <box paddingLeft={1} flexDirection="row" gap={1}>
                      <text fg={theme.info}>•</text>
                      <text fg={theme.text}>
                        {constraint.slice(0, 50)}
                        {constraint.length > 50 ? "..." : ""}
                      </text>
                    </box>
                  )}
                </For>
                <Show when={tom.userIntent.constraints.length > 3}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{tom.userIntent.constraints.length - 3} more
                  </text>
                </Show>
              </Show>

              {/* ToM: Shared Facts (Common Ground) */}
              <Show when={tom.commonGround.sharedFacts.length > 0}>
                <text fg={theme.success} attributes={TextAttributes.BOLD} marginTop={1}>
                  Shared Facts ({tom.commonGround.sharedFacts.length})
                </text>
                <For each={tom.commonGround.sharedFacts.slice(0, 5)}>
                  {(fact) => (
                    <KnowledgeItem
                      key={fact.key}
                      value={String(fact.value).slice(0, 50)}
                      isGolden={false}
                      onClick={() => showKnowledgeDetail(fact.key, fact)}
                    />
                  )}
                </For>
                <Show when={tom.commonGround.sharedFacts.length > 5}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    +{tom.commonGround.sharedFacts.length - 5} more
                  </text>
                </Show>
              </Show>

              {/* ToM: Belief Divergences */}
              <Show when={tom.divergenceCount > 0}>
                <text fg={theme.warning} attributes={TextAttributes.BOLD} marginTop={1}>
                  Belief Divergences ({tom.divergenceCount})
                </text>
                <For each={tom.highSeverityDivergences.slice(0, 3)}>
                  {(div) => (
                    <box paddingLeft={1}>
                      <text fg={theme.warning}>• {div.key}</text>
                      <For each={div.values.slice(0, 2)}>
                        {(v) => (
                          <text fg={theme.textMuted} paddingLeft={2}>
                            @{v.agentName}: {String(v.value).slice(0, 30)}
                            {String(v.value).length > 30 ? "..." : ""}
                          </text>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </Show>

              {/* ToM: Sync Status */}
              <Show when={Object.keys(tom.beliefStates).length > 1}>
                <box flexDirection="row" gap={2} marginTop={1}>
                  <text fg={theme.textMuted}>Belief Sync:</text>
                  <text
                    fg={
                      tom.syncStatus === "synchronized"
                        ? theme.success
                        : tom.syncStatus === "divergent"
                          ? theme.warning
                          : theme.textMuted
                    }
                  >
                    {tom.syncStatus === "synchronized"
                      ? "● Synced"
                      : tom.syncStatus === "divergent"
                        ? "◐ Divergent"
                        : "○ Unknown"}
                  </text>
                </box>
              </Show>

              <Show when={!cognitive.hasEpistemicData && tom.commonGround.sharedFacts.length === 0}>
                <text fg={theme.textMuted}>No knowledge recorded</text>
              </Show>
            </box>
          </Show>

          {/* Recommended Actions Section */}
          <SectionHeader
            section="actions"
            label="Recommendations"
            icon="󰘥"
            badge={`${cognitive.recommendedActions.length}`}
            badgeColor={cognitive.recommendedActions.length > 0 ? theme.warning : theme.textMuted}
          />
          <Show when={expanded().actions}>
            <box paddingLeft={3} marginBottom={1}>
              <Show
                when={cognitive.recommendedActions.length > 0}
                fallback={<text fg={theme.success}>✓ No recommendations - all good!</text>}
              >
                <For each={cognitive.recommendedActions}>
                  {(action) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.warning}>→</text>
                      <text fg={theme.text}>{action}</text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Show>
        </Show>
      </scrollbox>

      {/* Status bar */}
      <box
        height={1}
        backgroundColor={theme.backgroundElement}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <box flexDirection="row" gap={2}>
          <Show when={autoRefresh()}>
            <text fg={theme.success}>[auto]</text>
          </Show>
          <Show when={!autoRefresh()}>
            <text fg={theme.textMuted}>[manual]</text>
          </Show>
          <Show when={cognitive.hasData}>
            <text fg={theme.textMuted}>Last: {new Date(cognitive.data.lastUpdated).toLocaleTimeString()}</text>
          </Show>
        </box>
        <text fg={theme.textMuted}>j/k:nav Tab:section e:expand r:refresh a:auto</text>
      </box>
    </box>
  )
}
