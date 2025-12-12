import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useAnalysisMode, ANALYSIS_MODES, type AnalysisMode } from "../context/analysis-mode"

/**
 * Dialog for selecting and configuring analysis modes
 */
export function DialogAnalysisMode() {
  const { theme } = useTheme()
  const dialog = useDialog()
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

  // Handle keyboard
  useKeyboard((evt) => {
    if (evt.name === "q" || evt.name === "escape") {
      dialog.clear()
    }
    // Number keys for quick selection
    if (evt.name === "1") analysisMode.setMode("none")
    if (evt.name === "2") analysisMode.setMode("eval")
    if (evt.name === "3") analysisMode.setMode("tom")
    if (evt.name === "4") analysisMode.setMode("metrics")
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Analysis Mode
        </text>
        <text fg={theme.textMuted}>q to close</text>
      </box>

      <text fg={theme.textMuted} marginBottom={1}>
        Select an analysis mode to enable enhanced insights during agent collaboration.
      </text>

      {/* Mode Selection */}
      <box marginBottom={1}>
        <For each={ANALYSIS_MODES}>
          {(mode, index) => (
            <box
              flexDirection="row"
              gap={1}
              marginTop={1}
              onMouseDown={() => analysisMode.setMode(mode.id)}
            >
              <text fg={theme.textMuted}>{index() + 1}.</text>
              <text fg={analysisMode.mode === mode.id ? getModeColor(mode.id) : theme.textMuted}>
                {analysisMode.mode === mode.id ? "●" : "○"}
              </text>
              <text
                fg={analysisMode.mode === mode.id ? theme.text : theme.textMuted}
                attributes={analysisMode.mode === mode.id ? TextAttributes.BOLD : undefined}
              >
                {mode.name}
              </text>
              <text fg={getModeColor(mode.id)}>[{mode.shortName}]</text>
            </box>
          )}
        </For>
      </box>

      {/* Mode-specific settings */}
      <Show when={analysisMode.mode === "eval"}>
        <box marginTop={1}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            Evaluation Mode Settings
          </text>
          <text fg={theme.textMuted} marginTop={1}>
            Analyzes prompt and response quality metrics:
          </text>
          <box paddingLeft={2} marginTop={1}>
            <ToggleSetting
              label="Prompt Analysis"
              description="Analyze input prompt structure and clarity"
              enabled={analysisMode.evalSettings.showPromptAnalysis}
              onToggle={() =>
                analysisMode.updateEvalSettings({
                  showPromptAnalysis: !analysisMode.evalSettings.showPromptAnalysis,
                })
              }
            />
            <ToggleSetting
              label="Response Quality"
              description="Evaluate response completeness and accuracy"
              enabled={analysisMode.evalSettings.showResponseQuality}
              onToggle={() =>
                analysisMode.updateEvalSettings({
                  showResponseQuality: !analysisMode.evalSettings.showResponseQuality,
                })
              }
            />
            <ToggleSetting
              label="Token Breakdown"
              description="Show detailed token usage statistics"
              enabled={analysisMode.evalSettings.showTokenBreakdown}
              onToggle={() =>
                analysisMode.updateEvalSettings({
                  showTokenBreakdown: !analysisMode.evalSettings.showTokenBreakdown,
                })
              }
            />
            <ToggleSetting
              label="Information Gain"
              description="Measure information gain per turn"
              enabled={analysisMode.evalSettings.showInformationGain}
              onToggle={() =>
                analysisMode.updateEvalSettings({
                  showInformationGain: !analysisMode.evalSettings.showInformationGain,
                })
              }
            />
          </box>
        </box>
      </Show>

      <Show when={analysisMode.mode === "tom"}>
        <box marginTop={1}>
          <text fg={theme.info} attributes={TextAttributes.BOLD}>
            Theory of Mind Settings
          </text>
          <text fg={theme.textMuted} marginTop={1}>
            Track agent beliefs and shared understanding:
          </text>
          <box paddingLeft={2} marginTop={1}>
            <ToggleSetting
              label="Belief States"
              description="Show per-agent knowledge and goals"
              enabled={analysisMode.tomSettings.showBeliefStates}
              onToggle={() =>
                analysisMode.updateToMSettings({
                  showBeliefStates: !analysisMode.tomSettings.showBeliefStates,
                })
              }
            />
            <ToggleSetting
              label="Common Ground"
              description="Display shared facts across agents"
              enabled={analysisMode.tomSettings.showCommonGround}
              onToggle={() =>
                analysisMode.updateToMSettings({
                  showCommonGround: !analysisMode.tomSettings.showCommonGround,
                })
              }
            />
            <ToggleSetting
              label="Divergences"
              description="Highlight belief conflicts between agents"
              enabled={analysisMode.tomSettings.showDivergences}
              onToggle={() =>
                analysisMode.updateToMSettings({
                  showDivergences: !analysisMode.tomSettings.showDivergences,
                })
              }
            />
            <ToggleSetting
              label="User Intent"
              description="Model and track user intent"
              enabled={analysisMode.tomSettings.showUserIntent}
              onToggle={() =>
                analysisMode.updateToMSettings({
                  showUserIntent: !analysisMode.tomSettings.showUserIntent,
                })
              }
            />
          </box>
        </box>
      </Show>

      <Show when={analysisMode.mode === "metrics"}>
        <box marginTop={1}>
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            Metrics Mode Settings
          </text>
          <text fg={theme.textMuted} marginTop={1}>
            Display coordination metrics from research paper:
          </text>
          <box paddingLeft={2} marginTop={1}>
            <ToggleSetting
              label="Coordination Efficiency"
              description="Show Ec metric (SAS baseline: 46.6%)"
              enabled={analysisMode.metricsSettings.showEfficiency}
              onToggle={() =>
                analysisMode.updateMetricsSettings({
                  showEfficiency: !analysisMode.metricsSettings.showEfficiency,
                })
              }
            />
            <ToggleSetting
              label="Error Amplification"
              description="Show Ae metric (warning at >4.4x)"
              enabled={analysisMode.metricsSettings.showErrorAmplification}
              onToggle={() =>
                analysisMode.updateMetricsSettings({
                  showErrorAmplification: !analysisMode.metricsSettings.showErrorAmplification,
                })
              }
            />
            <ToggleSetting
              label="Overhead"
              description="Show coordination overhead percentage"
              enabled={analysisMode.metricsSettings.showOverhead}
              onToggle={() =>
                analysisMode.updateMetricsSettings({
                  showOverhead: !analysisMode.metricsSettings.showOverhead,
                })
              }
            />
            <ToggleSetting
              label="Agent Count"
              description="Show active agents (optimal: 3-4)"
              enabled={analysisMode.metricsSettings.showAgentCount}
              onToggle={() =>
                analysisMode.updateMetricsSettings({
                  showAgentCount: !analysisMode.metricsSettings.showAgentCount,
                })
              }
            />
          </box>
        </box>
      </Show>

      {/* Footer */}
      <box marginTop={1}>
        <text fg={theme.textMuted}>
          Press 1-4 to select mode | Click toggles to configure
        </text>
      </box>
    </box>
  )
}

function ToggleSetting(props: {
  label: string
  description: string
  enabled: boolean
  onToggle: () => void
}) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={1} marginTop={1} onMouseDown={props.onToggle}>
      <text fg={props.enabled ? theme.success : theme.textMuted}>
        {props.enabled ? "☑" : "☐"}
      </text>
      <text fg={props.enabled ? theme.text : theme.textMuted}>{props.label}</text>
      <text fg={theme.textMuted}>- {props.description}</text>
    </box>
  )
}
