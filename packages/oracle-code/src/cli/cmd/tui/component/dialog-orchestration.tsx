import { createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useAgents } from "../context/agents"
import { useMetrics } from "../context/metrics"
import { useAnalysisMode } from "../context/analysis-mode"
import { useKeyboardMode, useKeyboardOwnership } from "../context/keyboard-mode"
import { useOrchestration, STRATEGY_INFO, type OrchestrationStrategy } from "../context/orchestration"

/**
 * Multi-agent orchestration control panel
 * Uses shared OrchestrationContext for state synchronization
 */
export function DialogOrchestration() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const agents = useAgents()
  const metrics = useMetrics()
  const analysisMode = useAnalysisMode()
  const keyboard = useKeyboardMode()
  const orchestration = useOrchestration()

  dialog.setSize("large")

  const [cursorIndex, setCursorIndex] = createSignal(0)
  const menuItems = ["strategy", "maxParallel", "enableCritic", "autoRoute", "parallelMode"] as const

  // Use the keyboard ownership helper
  useKeyboardOwnership(
    "orchestration-dialog",
    {
      mode: "vim-navigation",
      priority: 100,
      onKey: (evt) => handleKeyboard(evt),
    },
    keyboard,
  )

  function handleKeyboard(evt: { name: string; ctrl?: boolean; shift?: boolean }): boolean {
    switch (evt.name) {
      case "q":
      case "escape":
        dialog.clear()
        return true

      case "j":
      case "down":
        setCursorIndex((i) => Math.min(i + 1, menuItems.length - 1))
        return true

      case "k":
      case "up":
        setCursorIndex((i) => Math.max(i - 1, 0))
        return true

      case "l":
      case "right":
      case "return":
        handleSelect()
        return true

      case "h":
      case "left":
        handleDeselect()
        return true

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        // Quick jump to menu item
        const idx = parseInt(evt.name) - 1
        if (idx < menuItems.length) setCursorIndex(idx)
        return true
    }

    return false
  }

  function handleSelect() {
    const item = menuItems[cursorIndex()]
    switch (item) {
      case "strategy":
        orchestration.cycleStrategy(1)
        break
      case "maxParallel":
        orchestration.incrementMaxParallel()
        break
      case "enableCritic":
        const newState = orchestration.toggleCritic()
        // Sync with analysis mode
        if (newState) {
          analysisMode.setMode("critic")
        } else if (analysisMode.mode === "critic") {
          analysisMode.setMode("none")
        }
        break
      case "autoRoute":
        orchestration.toggleAutoRoute()
        break
      case "parallelMode":
        orchestration.toggleParallelMode()
        break
    }
  }

  function handleDeselect() {
    const item = menuItems[cursorIndex()]
    switch (item) {
      case "strategy":
        orchestration.cycleStrategy(-1)
        break
      case "maxParallel":
        orchestration.decrementMaxParallel()
        break
    }
  }

  const errorAmpWarning = createMemo(() => {
    const ae = metrics.metrics.errorAmplification
    if (ae > 10) return { level: "critical" as const, message: "Error amplification critical (>10x)" }
    if (ae > 5) return { level: "warning" as const, message: "Error amplification high (>5x)" }
    return null
  })

  // Sync critic state with analysis mode on mount
  const criticSynced = createMemo(() => {
    return orchestration.enableCritic === analysisMode.isCriticMode()
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Agent Orchestration
        </text>
        <text fg={theme.textMuted}>q:close j/k:nav l/h:adjust 1-5:jump</text>
      </box>

      {/* Strategy Section */}
      <box marginBottom={1}>
        <box
          flexDirection="row"
          gap={2}
          backgroundColor={cursorIndex() === 0 ? theme.backgroundElement : undefined}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.textMuted}>1.</text>
          <text fg={cursorIndex() === 0 ? theme.text : theme.textMuted}>Strategy:</text>
          <text fg={theme.info}>{orchestration.strategyInfo.name}</text>
          <text fg={theme.textMuted}>({orchestration.strategyInfo.errorAmp} err amp)</text>
        </box>
        <Show when={cursorIndex() === 0}>
          <box paddingLeft={3}>
            <text fg={theme.success}>+ {orchestration.strategyInfo.pros}</text>
            <text fg={theme.warning}>- {orchestration.strategyInfo.cons}</text>
            <text fg={theme.textMuted}>Typical: {orchestration.strategyInfo.improvement}</text>
          </box>
        </Show>
      </box>

      {/* Max Parallel Agents */}
      <box marginBottom={1}>
        <box
          flexDirection="row"
          gap={2}
          backgroundColor={cursorIndex() === 1 ? theme.backgroundElement : undefined}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.textMuted}>2.</text>
          <text fg={cursorIndex() === 1 ? theme.text : theme.textMuted}>Max Parallel:</text>
          <text fg={orchestration.isOptimalAgentCount ? theme.success : theme.warning}>
            {orchestration.maxParallel}
          </text>
          <text fg={theme.textMuted}>(optimal: 3-4)</text>
        </box>
        <Show when={orchestration.agentCountWarning && cursorIndex() === 1}>
          <box paddingLeft={3}>
            <text fg={theme.warning}>{orchestration.agentCountWarning}</text>
          </box>
        </Show>
      </box>

      {/* Enable Critic */}
      <box
        flexDirection="row"
        gap={2}
        marginBottom={1}
        backgroundColor={cursorIndex() === 2 ? theme.backgroundElement : undefined}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.textMuted}>3.</text>
        <text fg={cursorIndex() === 2 ? theme.text : theme.textMuted}>Critic Review:</text>
        <text fg={orchestration.enableCritic ? theme.error : theme.textMuted}>
          {orchestration.enableCritic ? "ON" : "OFF"}
        </text>
        <Show when={orchestration.enableCritic}>
          <text fg={theme.textMuted}>(harsh feedback mode)</text>
        </Show>
        <Show when={!criticSynced()}>
          <text fg={theme.warning}>[desync]</text>
        </Show>
      </box>

      {/* Auto Route */}
      <box
        flexDirection="row"
        gap={2}
        marginBottom={1}
        backgroundColor={cursorIndex() === 3 ? theme.backgroundElement : undefined}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.textMuted}>4.</text>
        <text fg={cursorIndex() === 3 ? theme.text : theme.textMuted}>Auto Route:</text>
        <text fg={orchestration.autoRoute ? theme.success : theme.textMuted}>
          {orchestration.autoRoute ? "ON" : "OFF"}
        </text>
        <Show when={orchestration.autoRoute}>
          <text fg={theme.textMuted}>(auto-select strategy based on task)</text>
        </Show>
      </box>

      {/* Parallel Mode */}
      <box
        flexDirection="row"
        gap={2}
        marginBottom={1}
        backgroundColor={cursorIndex() === 4 ? theme.backgroundElement : undefined}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.textMuted}>5.</text>
        <text fg={cursorIndex() === 4 ? theme.text : theme.textMuted}>Execution:</text>
        <text fg={orchestration.parallelMode === "concurrent" ? theme.info : theme.textMuted}>
          {orchestration.parallelMode === "concurrent" ? "Concurrent" : "Sequential"}
        </text>
      </box>

      {/* Divider */}
      <box marginTop={1} marginBottom={1}>
        <text fg={theme.textMuted}>────────────────────────────────────</text>
      </box>

      {/* Current Status */}
      <box>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Current Status
        </text>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.textMuted}>Active Agents:</text>
          <text fg={agents.activeAgents.length > 0 ? theme.success : theme.textMuted}>
            {agents.activeAgents.length}
          </text>
          <For each={agents.activeAgents.slice(0, 5)}>
            {(agent) => <text fg={theme.info}>@{agent}</text>}
          </For>
          <Show when={agents.activeAgents.length > 5}>
            <text fg={theme.textMuted}>+{agents.activeAgents.length - 5} more</text>
          </Show>
        </box>
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <text fg={theme.textMuted}>Subagent Sessions:</text>
          <text fg={theme.text}>{agents.subagentSessionCount}</text>
        </box>
        <Show when={errorAmpWarning()}>
          <box flexDirection="row" gap={1} paddingLeft={1} marginTop={1}>
            <text fg={errorAmpWarning()!.level === "critical" ? theme.error : theme.warning}>
              {errorAmpWarning()!.level === "critical" ? "⚠" : "●"}
            </text>
            <text fg={errorAmpWarning()!.level === "critical" ? theme.error : theme.warning}>
              {errorAmpWarning()!.message}
            </text>
          </box>
        </Show>
      </box>

      {/* Research Notes */}
      <box marginTop={1}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Based on "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)
        </text>
      </box>
    </box>
  )
}
