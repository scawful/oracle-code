import { Show, createMemo, createSignal, createResource, createEffect, For } from "solid-js"
import { useCognitive } from "../context/cognitive"
import { useToM } from "../context/tom"
import { useTheme } from "../context/theme"
import { usePanes } from "../context/panes"
import { useAnalysisMode } from "../context/analysis-mode"
import { HivemindStore } from "@/cognitive/hivemind/store"
import { useSync } from "../context/sync"

/**
 * Cognitive Protocol panel for sidebar (42 chars wide)
 *
 * Clean, scannable layout with subcategories.
 * Each line provides one piece of info at a glance.
 */
export function CognitivePanel() {
  const cognitive = useCognitive()
  const tom = useToM()
  const { theme } = useTheme()
  const panes = usePanes()
  const sync = useSync()
  const analysisMode = useAnalysisMode()

  const [expanded, setExpanded] = createSignal(true)

  // Track context root reactively - use sync status to ensure path is loaded
  // Access sync.data.status directly (not via getter) to ensure Solid tracks the dependency
  const contextRoot = createMemo(() => {
    // Access sync data directly to ensure we wait for bootstrap completion
    if (sync.data.status !== "complete") return null
    return sync.data.path.directory || sync.data.path.worktree || null
  })

  // Load hivemind state - use contextRoot as source so it re-fetches when path changes
  const [hivemindState, { refetch: refetchHivemind }] = createResource(contextRoot, async (root) => {
    try {
      if (!root) return null
      return await HivemindStore.getState(root, "project")
    } catch {
      return null
    }
  })

  // Refresh hivemind when cognitive updates
  createEffect(() => {
    if (cognitive.data.lastUpdated && contextRoot()) {
      refetchHivemind()
    }
  })

  // Hivemind counts
  const hivemindTotal = createMemo(() => {
    const state = hivemindState()
    if (!state) return 0
    return (
      state.fears.length +
      state.satisfactions.length +
      state.knowledge.length +
      state.decisions.length +
      state.preferences.length
    )
  })

  const hivemindGolden = createMemo(() => {
    const state = hivemindState()
    if (!state) return 0
    return [
      ...state.fears,
      ...state.satisfactions,
      ...state.knowledge,
      ...state.decisions,
      ...state.preferences,
    ].filter((e) => e.status === "golden").length
  })

  // Health status line
  const healthLine = createMemo(() => {
    const h = cognitive.overallHealth
    const s = cognitive.healthStatus
    const icon = s === "excellent" ? "✨" : s === "good" ? "●" : s === "moderate" ? "◐" : "○"
    return `${icon} ${h}% ${s}`
  })

  const healthColor = createMemo(() => {
    const s = cognitive.healthStatus
    if (s === "excellent" || s === "good") return theme.success
    if (s === "moderate") return theme.warning
    return theme.error
  })

  // Mood emoji map
  const moodEmoji: Record<string, string> = {
    positive: "😊",
    neutral: "😐",
    negative: "😔",
    anxious: "😰",
    confident: "🎯",
    frustrated: "😤",
    curious: "🤔",
  }

  // Warning indicators
  const warnings = createMemo(() => {
    const w: string[] = []
    if (cognitive.isSpinning) w.push("spinning")
    if (cognitive.shouldSeekHelp) w.push("stuck")
    if (cognitive.contradictionCount > 0) w.push(`${cognitive.contradictionCount} contradictions`)
    if (cognitive.criticalUnknowns > 0) w.push(`${cognitive.criticalUnknowns} critical unknowns`)
    return w
  })

  // Analysis mode indicator
  const analysisLine = createMemo(() => {
    if (!analysisMode.isActive) return null
    return `${analysisMode.modeInfo.shortName} mode active`
  })

  // Navigation helpers
  function openCognitive() {
    panes.split("vertical", "cognitive")
  }

  function openHivemind() {
    panes.split("vertical", "hivemind")
  }

  function openToM() {
    panes.split("vertical", "tom")
  }

  return (
    <box flexDirection="column">
      {/* Header */}
      <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
        <text fg={theme.textMuted}>{expanded() ? "▼" : "▶"}</text>
        <text fg={theme.text}>
          <b>Cognitive</b>
        </text>
        <Show when={cognitive.flowState}>
          <text fg={theme.success}>⚡</text>
        </Show>
        <Show when={warnings().length > 0}>
          <text fg={theme.warning}>⚠</text>
        </Show>
      </box>

      <Show when={!cognitive.afsInitialized && expanded()}>
        <text fg={theme.textMuted} paddingLeft={2}>
          AFS not initialized
        </text>
      </Show>

      <Show when={cognitive.afsInitialized && expanded()}>
        <box paddingLeft={2} flexDirection="column">
          {/* ─ Health ─ */}
          <text fg={theme.textMuted}>─ Health</text>
          <box paddingLeft={1}>
            <text fg={healthColor()} onMouseDown={openCognitive}>
              {healthLine()}
            </text>
          </box>

          {/* ─ State ─ */}
          <text fg={theme.textMuted} marginTop={1}>
            ─ State
          </text>
          <box paddingLeft={1} flexDirection="column">
            <text fg={theme.text}>
              {moodEmoji[cognitive.mood] || "😐"} {cognitive.mood}
            </text>
            <text fg={cognitive.isAnxious ? theme.warning : theme.textMuted}>anxiety: {cognitive.anxietyLevel}%</text>
            <text fg={cognitive.isConfident ? theme.success : theme.textMuted}>
              confidence: {cognitive.confidenceLevel}%
            </text>
            <Show when={cognitive.flowState}>
              <text fg={theme.success}>⚡ in flow</text>
            </Show>
            <Show when={cognitive.cognitiveLoad > 50}>
              <text fg={cognitive.cognitiveLoad > 70 ? theme.warning : theme.textMuted}>
                load: {cognitive.cognitiveLoad}%
              </text>
            </Show>
          </box>

          {/* ─ Warnings ─ */}
          <Show when={warnings().length > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Warnings
            </text>
            <box paddingLeft={1} flexDirection="column">
              <For each={warnings()}>{(w) => <text fg={theme.warning}>⚠ {w}</text>}</For>
            </box>
          </Show>

          {/* ─ Knowledge ─ */}
          <Show when={cognitive.hasEpistemicData || tom.commonGround.sharedFacts.length > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Knowledge
            </text>
            <box paddingLeft={1} flexDirection="column">
              <text fg={theme.warning}>★ {cognitive.goldenFactCount} golden</text>
              <text fg={theme.info}>○ {cognitive.workingFactCount} working</text>
              <Show when={tom.commonGround.sharedFacts.length > 0}>
                <text fg={theme.success}>⊕ {tom.commonGround.sharedFacts.length} shared</text>
              </Show>
            </box>
          </Show>

          {/* ─ Emotions ─ */}
          <Show when={cognitive.totalEmotionCount > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Emotions
            </text>
            <box paddingLeft={1} flexDirection="column">
              <Show when={cognitive.fearCount > 0}>
                <text fg={theme.error}>⚠ {cognitive.fearCount} fear(s)</text>
              </Show>
              <Show when={cognitive.satisfactionCount > 0}>
                <text fg={theme.success}>✓ {cognitive.satisfactionCount} satisfaction(s)</text>
              </Show>
              <Show when={cognitive.curiosityCount > 0}>
                <text fg={theme.info}>? {cognitive.curiosityCount} curiosit(ies)</text>
              </Show>
              <Show when={cognitive.frustrationCount > 0}>
                <text fg={theme.warning}>! {cognitive.frustrationCount} frustration(s)</text>
              </Show>
            </box>
          </Show>

          {/* ─ Hivemind ─ */}
          <Show when={hivemindTotal() > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Hivemind
            </text>
            <box paddingLeft={1} onMouseDown={openHivemind}>
              <text fg={theme.primary}>🧠 {hivemindTotal()} entries</text>
              <Show when={hivemindGolden() > 0}>
                <text fg={theme.warning}> (★{hivemindGolden()})</text>
              </Show>
            </box>
          </Show>

          {/* ─ Goals ─ */}
          <Show when={cognitive.primaryGoal}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Goals
            </text>
            <box paddingLeft={1} flexDirection="column">
              <text fg={theme.text}>
                {cognitive.primaryGoalProgress}% {(cognitive.primaryGoal || "").slice(0, 25)}
                {(cognitive.primaryGoal || "").length > 25 ? "…" : ""}
              </text>
              <Show when={cognitive.totalSubgoals > 0}>
                <text fg={theme.textMuted}>
                  {cognitive.completedSubgoals}/{cognitive.totalSubgoals} subgoals
                </text>
              </Show>
            </box>
          </Show>

          {/* ─ ToM ─ */}
          <Show when={Object.keys(tom.beliefStates).length > 1}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Theory of Mind
            </text>
            <box paddingLeft={1} onMouseDown={openToM}>
              <text fg={tom.syncStatus === "synchronized" ? theme.success : theme.warning}>
                {tom.syncStatus === "synchronized" ? "●" : "◐"} {Object.keys(tom.beliefStates).length} agents
              </text>
              <Show when={tom.divergenceCount > 0}>
                <text fg={theme.warning}> Δ{tom.divergenceCount}</text>
              </Show>
            </box>
          </Show>

          {/* ─ Analysis ─ */}
          <Show when={analysisLine()}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Analysis
            </text>
            <box paddingLeft={1}>
              <text fg={theme.info}>{analysisLine()}</text>
            </box>
          </Show>

          {/* ─ Tips ─ */}
          <Show when={cognitive.recommendedActions.length > 0}>
            <text fg={theme.textMuted} marginTop={1}>
              ─ Tips
            </text>
            <box paddingLeft={1} flexDirection="column">
              <For each={cognitive.recommendedActions.slice(0, 2)}>
                {(a) => (
                  <text fg={theme.info}>
                    → {a.slice(0, 35)}
                    {a.length > 35 ? "…" : ""}
                  </text>
                )}
              </For>
              <Show when={cognitive.recommendedActions.length > 2}>
                <text fg={theme.textMuted}>+{cognitive.recommendedActions.length - 2} more</text>
              </Show>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
