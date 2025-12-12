import { For, Show, createMemo, createSignal } from "solid-js"
import { useToM } from "../../context/tom"
import { useTheme } from "../../context/theme"

/**
 * ToMView - Theory of Mind pane view
 *
 * Displays belief state synchronization across agents.
 * Adapted from panel-tom.tsx for pane embedding.
 */

export interface ToMViewProps {
  /** Whether this pane is currently active/focused */
  isActive?: boolean
}

export function ToMView(props: ToMViewProps) {
  const tom = useToM()
  const { theme } = useTheme()

  const [showDivergences, setShowDivergences] = createSignal(true)
  const [showFacts, setShowFacts] = createSignal(true)
  const [showConstraints, setShowConstraints] = createSignal(false)

  const syncColor = createMemo(() => {
    const status = tom.syncStatusColor
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const beliefStateCount = createMemo(() => Object.keys(tom.beliefStates).length)

  const hasData = createMemo(() => {
    return beliefStateCount() > 0 || tom.userIntent.primaryIntent.length > 0 || tom.data.lastUpdated > 0
  })

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden">
      <Show
        when={hasData()}
        fallback={
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={theme.textMuted}>No belief state data yet.</text>
            <text fg={theme.textMuted} marginTop={1}>
              Theory of Mind tracks agent beliefs during multi-agent coordination.
            </text>
          </box>
        }
      >
        <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
          {/* Sync Status Section */}
          <box marginBottom={1}>
            <text fg={theme.text}>
              <b>Synchronization</b>
            </text>
            <box flexDirection="row" gap={2} marginTop={1}>
              <box flexDirection="row" gap={1}>
                <text fg={syncColor()}>●</text>
                <text fg={theme.text}>
                  {tom.syncStatus === "synchronized"
                    ? "Synchronized"
                    : tom.syncStatus === "divergent"
                      ? "Divergent"
                      : "Unknown"}
                </text>
              </box>
              <Show when={tom.divergenceCount > 0}>
                <text fg={theme.warning}>({tom.divergenceCount} divergences)</text>
              </Show>
            </box>
          </box>

          {/* Agent Beliefs Section */}
          <box marginBottom={1}>
            <text fg={theme.text}>
              <b>Agent Beliefs</b>
            </text>
            <box marginTop={1}>
              <text fg={theme.textMuted}>
                {beliefStateCount()} agent belief state{beliefStateCount() !== 1 ? "s" : ""} tracked
              </text>
              <For each={Object.entries(tom.beliefStates)}>
                {([agentId, state]) => (
                  <box marginTop={1} paddingLeft={1}>
                    <text fg={theme.info}>@{state.agentName || agentId}</text>
                    <text fg={theme.textMuted} paddingLeft={1}>
                      {state.knowledge?.length || 0} knowledge items,{" "}
                      {state.goals?.length || 0} goals
                    </text>
                  </box>
                )}
              </For>
            </box>
          </box>

          {/* User Intent Section */}
          <Show when={tom.userIntent.primaryIntent}>
            <box marginBottom={1}>
              <text fg={theme.text}>
                <b>User Intent</b>
              </text>
              <box marginTop={1}>
                <text fg={theme.textMuted}>
                  Primary: {tom.userIntent.primaryIntent || "Not detected"}
                </text>
                <text fg={theme.textMuted}>Confidence: {tom.formatConfidence(tom.userIntent.confidence)}</text>
              </box>
            </box>
          </Show>

          {/* Divergences Section */}
          <Show when={tom.highSeverityDivergences.length > 0}>
            <box marginBottom={1}>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => setShowDivergences(!showDivergences())}
              >
                <text fg={theme.text}>{showDivergences() ? "▼" : "▶"}</text>
                <text fg={theme.warning}>
                  <b>Divergences</b> ({tom.highSeverityDivergences.length})
                </text>
              </box>
              <Show when={showDivergences()}>
                <box marginTop={1} paddingLeft={2}>
                  <For each={tom.highSeverityDivergences}>
                    {(div) => (
                      <box marginBottom={1}>
                        <text fg={theme.text}>• {div.key}</text>
                        <For each={div.values}>
                          {(v) => (
                            <text fg={theme.textMuted} paddingLeft={2}>
                              @{v.agentName}: {String(v.value).slice(0, 50)}
                              {String(v.value).length > 50 ? "..." : ""}
                            </text>
                          )}
                        </For>
                      </box>
                    )}
                  </For>
                </box>
              </Show>
            </box>
          </Show>

          {/* Shared Facts Section */}
          <Show when={tom.commonGround.sharedFacts.length > 0}>
            <box marginBottom={1}>
              <box flexDirection="row" gap={1} onMouseDown={() => setShowFacts(!showFacts())}>
                <text fg={theme.text}>{showFacts() ? "▼" : "▶"}</text>
                <text fg={theme.success}>
                  <b>Shared Facts</b> ({tom.commonGround.sharedFacts.length})
                </text>
              </box>
              <Show when={showFacts()}>
                <box marginTop={1} paddingLeft={2}>
                  <For each={tom.commonGround.sharedFacts}>
                    {(fact) => (
                      <text fg={theme.textMuted}>
                        • {fact.key}: {String(fact.value).slice(0, 50)}
                        {String(fact.value).length > 50 ? "..." : ""}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
            </box>
          </Show>

          {/* User Constraints Section */}
          <Show when={tom.userIntent.constraints.length > 0}>
            <box marginBottom={1}>
              <box flexDirection="row" gap={1} onMouseDown={() => setShowConstraints(!showConstraints())}>
                <text fg={theme.text}>{showConstraints() ? "▼" : "▶"}</text>
                <text fg={theme.info}>
                  <b>Constraints</b> ({tom.userIntent.constraints.length})
                </text>
              </box>
              <Show when={showConstraints()}>
                <box marginTop={1} paddingLeft={2}>
                  <For each={tom.userIntent.constraints}>
                    {(constraint) => (
                      <text fg={theme.textMuted}>
                        • {constraint.slice(0, 60)}
                        {constraint.length > 60 ? "..." : ""}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
            </box>
          </Show>

          {/* Last Updated */}
          <Show when={tom.data.lastUpdated > 0}>
            <box marginTop={1}>
              <text fg={theme.textMuted}>
                Last updated: {new Date(tom.data.lastUpdated).toLocaleTimeString()}
              </text>
            </box>
          </Show>
        </scrollbox>
      </Show>
    </box>
  )
}
