import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useAFS } from "../context/afs"
import { Show, createMemo } from "solid-js"

export type DialogPlanProps = {}

export function DialogPlan() {
  const afs = useAFS()
  const { theme } = useTheme()

  const planLines = createMemo(() => {
    if (!afs.plan) return []
    return afs.plan.split("\n")
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          AFS Plan
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={!afs.exists}>
        <box gap={1}>
          <text fg={theme.warning}>AFS not initialized</text>
          <text fg={theme.textMuted}>Run 'codewizard afs init' to set up the Agentic File System</text>
        </box>
      </Show>

      <Show when={afs.exists && !afs.planExists}>
        <box gap={1}>
          <text fg={theme.textMuted}>No plan file exists</text>
          <text fg={theme.textMuted}>Use the plan_write tool to create a plan</text>
          <text fg={theme.textMuted}>Path: .context/scratchpad/plan.md</text>
        </box>
      </Show>

      <Show when={afs.planExists && afs.plan}>
        <box gap={1}>
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>📋 scratchpad/plan.md</text>
            <text fg={theme.textMuted}>({planLines().length} lines)</text>
          </box>

          <box
            backgroundColor={theme.backgroundElement}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            maxHeight={20}
          >
            <scrollbox>
              <Show
                when={planLines().length <= 50}
                fallback={
                  <box>
                    {planLines()
                      .slice(0, 50)
                      .map((line, i) => (
                        <text fg={theme.text} wrapMode="word">
                          {line || " "}
                        </text>
                      ))}
                    <text fg={theme.textMuted}>... ({planLines().length - 50} more lines)</text>
                  </box>
                }
              >
                {planLines().map((line) => (
                  <text fg={theme.text} wrapMode="word">
                    {line || " "}
                  </text>
                ))}
              </Show>
            </scrollbox>
          </box>

          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>Path: .context/scratchpad/plan.md</text>
          </box>
        </box>
      </Show>

      <Show when={afs.exists}>
        <box paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            AFS Root: {afs.root}
          </text>
        </box>
      </Show>
    </box>
  )
}
