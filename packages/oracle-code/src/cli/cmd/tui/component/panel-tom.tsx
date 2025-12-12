import { For, Show, createMemo, createSignal } from "solid-js"
import { useToM } from "../context/tom"
import { useTheme } from "../context/theme"

/**
 * Theory of Mind panel for sidebar
 * Shows compact indicators for belief state sync and divergences
 */
export function ToMPanel() {
  const tom = useToM()
  const { theme } = useTheme()

  const [expanded, setExpanded] = createSignal(false)

  const syncColor = createMemo(() => {
    const status = tom.syncStatusColor
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const beliefStateCount = createMemo(() => Object.keys(tom.beliefStates).length)

  // Always show ToM panel when there's any data or the analysis is active
  // This provides visibility into the ToM system even for single-agent sessions
  const shouldShow = createMemo(() => {
    // Show if there are belief states, user intent, or if the context has been refreshed
    return (
      beliefStateCount() > 0 ||
      tom.userIntent.primaryIntent.length > 0 ||
      tom.data.lastUpdated > 0
    )
  })

  return (
    <Show when={shouldShow()}>
      <box marginTop={1}>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
          <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme.text}>
            <b>Theory of Mind</b>
          </text>
        </box>

        {/* Compact view (always shown) */}
        <box paddingLeft={2} marginTop={1}>
          {/* Sync status */}
          <box flexDirection="row" gap={1}>
            <text fg={syncColor()}>●</text>
            <text fg={theme.textMuted}>
              {tom.syncStatus === "synchronized"
                ? "Synced"
                : tom.syncStatus === "divergent"
                  ? "Divergent"
                  : "Unknown"}
            </text>
            <Show when={tom.divergenceCount > 0}>
              <text fg={theme.warning}>({tom.divergenceCount} divergences)</text>
            </Show>
          </box>

          {/* Agent belief count */}
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>○</text>
            <text fg={theme.textMuted}>
              {beliefStateCount()} agent belief{beliefStateCount() !== 1 ? "s" : ""}
            </text>
          </box>

          {/* User intent (truncated) */}
          <Show when={tom.userIntent.primaryIntent}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>○</text>
              <text fg={theme.textMuted}>
                Intent: {tom.formatConfidence(tom.userIntent.confidence)}
              </text>
            </box>
          </Show>
        </box>

        {/* Expanded view */}
        <Show when={expanded()}>
          {/* High severity divergences */}
          <Show when={tom.highSeverityDivergences.length > 0}>
            <box paddingLeft={2} marginTop={1}>
              <text fg={theme.warning}>
                <b>Divergences</b>
              </text>
              <For each={tom.highSeverityDivergences.slice(0, 3)}>
                {(div) => (
                  <box paddingLeft={1}>
                    <text fg={theme.textMuted}>• {div.key}</text>
                    <For each={div.values.slice(0, 2)}>
                      {(v) => (
                        <text fg={theme.textMuted} paddingLeft={1}>
                          @{v.agentName}: {String(v.value).slice(0, 20)}
                        </text>
                      )}
                    </For>
                  </box>
                )}
              </For>
            </box>
          </Show>

          {/* Shared facts */}
          <Show when={tom.commonGround.sharedFacts.length > 0}>
            <box paddingLeft={2} marginTop={1}>
              <text fg={theme.textMuted}>
                <b>Shared Facts</b> ({tom.commonGround.sharedFacts.length})
              </text>
              <For each={tom.commonGround.sharedFacts.slice(0, 3)}>
                {(fact) => (
                  <text fg={theme.textMuted} paddingLeft={1}>
                    • {fact.key}: {String(fact.value).slice(0, 30)}
                  </text>
                )}
              </For>
            </box>
          </Show>

          {/* User constraints */}
          <Show when={tom.userIntent.constraints.length > 0}>
            <box paddingLeft={2} marginTop={1}>
              <text fg={theme.textMuted}>
                <b>Constraints</b>
              </text>
              <For each={tom.userIntent.constraints.slice(0, 3)}>
                {(constraint) => (
                  <text fg={theme.textMuted} paddingLeft={1}>
                    • {constraint.slice(0, 40)}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
