import { Show, createMemo, createSignal, createResource, createEffect } from "solid-js"
import { useCognitive } from "../context/cognitive"
import { useToM } from "../context/tom"
import { useTheme } from "../context/theme"
import { usePanes } from "../context/panes"
import { useSync } from "../context/sync"
import { HivemindStore } from "@/cognitive/hivemind/store"

/**
 * Knowledge Panel - Compact summary of hivemind, epistemic facts, and ToM
 *
 * Shows at-a-glance:
 * - Hivemind entry counts (total, golden, decaying, contested)
 * - Epistemic facts (golden, working)
 * - Theory of Mind sync status
 */
export function KnowledgePanel() {
  const cognitive = useCognitive()
  const tom = useToM()
  const { theme } = useTheme()
  const panes = usePanes()
  const sync = useSync()

  const [expanded, setExpanded] = createSignal(true)

  // Track context root reactively
  const contextRoot = createMemo(() => {
    if (sync.data.status !== "complete") return null
    return sync.data.path.directory || sync.data.path.worktree || null
  })

  // Load hivemind state
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

  const hivemindDecaying = createMemo(() => {
    const state = hivemindState()
    if (!state) return 0
    return [
      ...state.fears,
      ...state.satisfactions,
      ...state.knowledge,
      ...state.decisions,
      ...state.preferences,
    ].filter((e) => e.status === "decaying").length
  })

  const hivemindContested = createMemo(() => {
    const state = hivemindState()
    if (!state) return 0
    return [
      ...state.fears,
      ...state.satisfactions,
      ...state.knowledge,
      ...state.decisions,
      ...state.preferences,
    ].filter((e) => e.status === "contested").length
  })

  const activeCouncils = createMemo(() => {
    const state = hivemindState()
    if (!state) return 0
    return state.councils.filter((c) => c.status === "voting" || c.status === "debating").length
  })

  // Navigation helper
  function openKnowledgeView() {
    panes.split("vertical", "knowledge")
  }

  // Show panel if we have any knowledge data
  const hasData = createMemo(() => {
    return (
      hivemindTotal() > 0 ||
      cognitive.goldenFactCount > 0 ||
      cognitive.workingFactCount > 0 ||
      tom.commonGround.sharedFacts.length > 0 ||
      Object.keys(tom.beliefStates).length > 1
    )
  })

  return (
    <Show when={hasData()}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Knowledge</b>
          </text>
          <Show when={!expanded() && hivemindTotal() > 0}>
            <text fg={theme.primary}>🧠{hivemindTotal()}</text>
            <Show when={hivemindGolden() > 0}>
              <text fg={theme.warning}>★{hivemindGolden()}</text>
            </Show>
          </Show>
          <Show when={hivemindDecaying() > 0 && !expanded()}>
            <text fg={theme.warning}>◐{hivemindDecaying()}</text>
          </Show>
        </box>

        <Show when={expanded()}>
          <box paddingLeft={2} flexDirection="column">
            {/* Hivemind Section */}
            <Show when={hivemindTotal() > 0}>
              <text fg={theme.textMuted}>─ Hivemind</text>
              <box paddingLeft={1} onMouseDown={openKnowledgeView}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.primary}>🧠 {hivemindTotal()} entries</text>
                  <Show when={hivemindGolden() > 0}>
                    <text fg={theme.warning}>★{hivemindGolden()}</text>
                  </Show>
                </box>
                <Show when={hivemindDecaying() > 0 || hivemindContested() > 0 || activeCouncils() > 0}>
                  <box flexDirection="row" gap={1} paddingLeft={1}>
                    <Show when={hivemindDecaying() > 0}>
                      <text fg={theme.warning}>◐{hivemindDecaying()} decaying</text>
                    </Show>
                    <Show when={hivemindContested() > 0}>
                      <text fg={theme.error}>⚡{hivemindContested()} contested</text>
                    </Show>
                    <Show when={activeCouncils() > 0}>
                      <text fg={theme.info}>⏳{activeCouncils()} councils</text>
                    </Show>
                  </box>
                </Show>
              </box>
            </Show>

            {/* Epistemic Facts Section */}
            <Show when={cognitive.goldenFactCount > 0 || cognitive.workingFactCount > 0}>
              <text fg={theme.textMuted} marginTop={1}>
                ─ Facts
              </text>
              <box paddingLeft={1} flexDirection="row" gap={2}>
                <Show when={cognitive.goldenFactCount > 0}>
                  <text fg={theme.warning}>★ {cognitive.goldenFactCount} golden</text>
                </Show>
                <Show when={cognitive.workingFactCount > 0}>
                  <text fg={theme.info}>○ {cognitive.workingFactCount} working</text>
                </Show>
              </box>
            </Show>

            {/* Theory of Mind Section */}
            <Show when={Object.keys(tom.beliefStates).length > 1 || tom.commonGround.sharedFacts.length > 0}>
              <text fg={theme.textMuted} marginTop={1}>
                ─ Theory of Mind
              </text>
              <box paddingLeft={1} onMouseDown={openKnowledgeView}>
                <box flexDirection="row" gap={1}>
                  <text fg={tom.syncStatus === "synchronized" ? theme.success : theme.warning}>
                    {tom.syncStatus === "synchronized" ? "●" : "◐"}
                  </text>
                  <Show
                    when={Object.keys(tom.beliefStates).length > 1}
                    fallback={<text fg={theme.textMuted}>single agent</text>}
                  >
                    <text fg={theme.text}>{Object.keys(tom.beliefStates).length} agents</text>
                  </Show>
                  <Show when={tom.divergenceCount > 0}>
                    <text fg={theme.warning}>Δ{tom.divergenceCount}</text>
                  </Show>
                </box>
                <Show when={tom.commonGround.sharedFacts.length > 0}>
                  <text fg={theme.success} paddingLeft={1}>
                    ⊕ {tom.commonGround.sharedFacts.length} shared facts
                  </text>
                </Show>
              </box>
            </Show>

            {/* Quick action */}
            <box paddingLeft={1} marginTop={1}>
              <box onMouseDown={openKnowledgeView}>
                <text fg={theme.info}>[Open Knowledge View]</text>
              </box>
            </box>
          </box>
        </Show>
      </box>
    </Show>
  )
}
