import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useAnalysisMode, ANALYSIS_MODES } from "../context/analysis-mode"
import { useKeybind } from "../context/keybind"

/**
 * Compact analysis mode indicator for the prompt area
 * Shows current mode and allows cycling through modes
 */
export function AnalysisModeIndicator() {
  const { theme } = useTheme()
  const analysisMode = useAnalysisMode()
  const keybind = useKeybind()

  const modeColor = createMemo(() => {
    switch (analysisMode.mode) {
      case "eval":
        return theme.warning
      case "tom":
        return theme.info
      case "metrics":
        return theme.success
      default:
        return theme.textMuted
    }
  })

  return (
    <box
      flexDirection="row"
      gap={1}
      onMouseDown={() => analysisMode.cycle(1)}
    >
      <Show when={analysisMode.isActive}>
        <text fg={modeColor()}>
          [{analysisMode.modeInfo.shortName}]
        </text>
      </Show>
      <Show when={!analysisMode.isActive}>
        <text fg={theme.textMuted}>
          [STD]
        </text>
      </Show>
    </box>
  )
}

/**
 * Expanded analysis mode selector for dialogs/menus
 */
export function AnalysisModeSelector() {
  const { theme } = useTheme()
  const analysisMode = useAnalysisMode()

  const getModeColor = (modeId: string) => {
    switch (modeId) {
      case "eval":
        return theme.warning
      case "tom":
        return theme.info
      case "metrics":
        return theme.success
      default:
        return theme.textMuted
    }
  }

  return (
    <box>
      <text fg={theme.text}>
        <b>Analysis Mode</b>
      </text>
      <box paddingLeft={1} marginTop={1}>
        {ANALYSIS_MODES.map((mode) => (
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => analysisMode.setMode(mode.id)}
          >
            <text fg={analysisMode.mode === mode.id ? getModeColor(mode.id) : theme.textMuted}>
              {analysisMode.mode === mode.id ? "●" : "○"}
            </text>
            <text fg={analysisMode.mode === mode.id ? theme.text : theme.textMuted}>
              {mode.name}
            </text>
            <text fg={theme.textMuted}>- {mode.description}</text>
          </box>
        ))}
      </box>
    </box>
  )
}
