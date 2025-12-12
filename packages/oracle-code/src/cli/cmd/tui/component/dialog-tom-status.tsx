import { createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToM } from "../context/tom"
import { ToM } from "@/tom"

/**
 * Full Theory of Mind status dialog
 * Shows detailed belief states, common ground, and divergences
 */
export function DialogToMStatus() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const tom = useToM()

  // Set dialog to large size
  dialog.setSize("large")

  const beliefStatesList = createMemo(() => {
    return Object.values(tom.beliefStates).sort(
      (a, b) => b.lastUpdated - a.lastUpdated
    )
  })

  const syncColor = createMemo(() => {
    const status = tom.syncStatusColor
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const severityColor = (severity: "low" | "medium" | "high") => {
    return ToM.getDivergenceSeverityColor(severity) === "success"
      ? theme.success
      : ToM.getDivergenceSeverityColor(severity) === "warning"
        ? theme.warning
        : theme.error
  }

  // Handle keyboard input
  useKeyboard((evt) => {
    if (evt.name === "q") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box marginBottom={1}>
        <text fg={theme.text}>
          <b>Theory of Mind Status</b>
        </text>
        <text fg={theme.textMuted}>Agent belief states and shared understanding</text>
      </box>

      {/* Common Ground Overview */}
      <box marginBottom={1}>
        <text fg={theme.text}>
          <b>Common Ground</b>
        </text>
        <box flexDirection="row" gap={1}>
          <text fg={syncColor()}>●</text>
          <text fg={theme.text}>
            Status: {tom.syncStatus === "synchronized" ? "Synchronized" : tom.syncStatus === "divergent" ? "Divergent" : "Unknown"}
          </text>
        </box>
        <text fg={theme.textMuted}>
          {tom.commonGround.agentCount} agent{tom.commonGround.agentCount !== 1 ? "s" : ""} |{" "}
          {tom.commonGround.sharedFacts.length} shared fact{tom.commonGround.sharedFacts.length !== 1 ? "s" : ""} |{" "}
          {tom.divergenceCount} divergence{tom.divergenceCount !== 1 ? "s" : ""}
        </text>
      </box>

      {/* Divergences */}
      <Show when={tom.commonGround.divergences.length > 0}>
        <box marginBottom={1}>
          <text fg={theme.warning}>
            <b>Belief Divergences</b>
          </text>
          <For each={tom.commonGround.divergences.slice(0, 5)}>
            {(div) => (
              <box marginTop={1} paddingLeft={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={severityColor(div.severity)}>●</text>
                  <text fg={theme.text}>
                    <b>{div.key}</b>
                  </text>
                  <text fg={theme.textMuted}>({div.severity} severity)</text>
                </box>
                <For each={div.values}>
                  {(v) => (
                    <box flexDirection="row" gap={1} paddingLeft={2}>
                      <text fg={theme.textMuted}>@{v.agentName}:</text>
                      <text fg={theme.text}>{String(v.value).slice(0, 40)}</text>
                      <text fg={theme.textMuted}>({tom.formatConfidence(v.confidence)} conf)</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
          <Show when={tom.commonGround.divergences.length > 5}>
            <text fg={theme.textMuted} marginTop={1}>
              ... and {tom.commonGround.divergences.length - 5} more divergences
            </text>
          </Show>
        </box>
      </Show>

      {/* Shared Facts */}
      <Show when={tom.commonGround.sharedFacts.length > 0}>
        <box marginBottom={1}>
          <text fg={theme.success}>
            <b>Shared Facts</b> ({tom.commonGround.sharedFacts.length})
          </text>
          <For each={tom.commonGround.sharedFacts.slice(0, 6)}>
            {(fact) => (
              <box paddingLeft={1} marginTop={1}>
                <text fg={theme.text}>
                  <b>{fact.key}</b>
                </text>
                <text fg={theme.textMuted}>{String(fact.value).slice(0, 50)}</text>
                <text fg={theme.textMuted}>
                  Acknowledged by: {fact.acknowledgedBy.length} agent{fact.acknowledgedBy.length !== 1 ? "s" : ""}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* User Intent */}
      <Show when={tom.userIntent.primaryIntent}>
        <box marginBottom={1}>
          <text fg={theme.text}>
            <b>User Intent Model</b>
          </text>
          <box paddingLeft={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>Primary:</text>
              <text fg={theme.text}>{tom.userIntent.primaryIntent.slice(0, 60)}...</text>
            </box>
            <text fg={theme.textMuted}>Confidence: {tom.formatConfidence(tom.userIntent.confidence)}</text>
            <Show when={tom.userIntent.constraints.length > 0}>
              <text fg={theme.textMuted}>Constraints:</text>
              <For each={tom.userIntent.constraints}>
                {(constraint) => (
                  <text fg={theme.textMuted} paddingLeft={1}>
                    - {constraint.slice(0, 50)}
                  </text>
                )}
              </For>
            </Show>
          </box>
        </box>
      </Show>

      {/* Per-Agent Belief States */}
      <Show when={beliefStatesList().length > 0}>
        <box marginTop={1}>
          <text fg={theme.text}>
            <b>Agent Belief States</b> ({beliefStatesList().length})
          </text>
          <For each={beliefStatesList().slice(0, 5)}>
            {(state) => (
              <box paddingLeft={1} marginTop={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.info}>@{state.agentName}</text>
                  <text fg={theme.textMuted}>({state.sessionID.slice(0, 8)}...)</text>
                </box>
                <text fg={theme.textMuted} paddingLeft={1}>
                  {state.knowledge.length} knowledge item{state.knowledge.length !== 1 ? "s" : ""}
                </text>
                <Show when={state.goals.filter((g) => g.status === "active").length > 0}>
                  <text fg={theme.textMuted} paddingLeft={1}>
                    Active goals: {state.goals.filter((g) => g.status === "active").length}
                  </text>
                  <For each={state.goals.filter((g) => g.status === "active").slice(0, 2)}>
                    {(goal) => (
                      <text fg={theme.textMuted} paddingLeft={2}>
                        - {goal.description.slice(0, 40)}
                      </text>
                    )}
                  </For>
                </Show>
              </box>
            )}
          </For>
          <Show when={beliefStatesList().length > 5}>
            <text fg={theme.textMuted} marginTop={1}>
              ... and {beliefStatesList().length - 5} more agents
            </text>
          </Show>
        </box>
      </Show>

      {/* Empty state */}
      <Show when={beliefStatesList().length === 0 && tom.commonGround.sharedFacts.length === 0}>
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            No active subagent sessions. Start a multi-agent task to see ToM tracking.
          </text>
        </box>
      </Show>

      {/* Footer */}
      <box marginTop={1}>
        <text fg={theme.textMuted}>
          Press <b>ESC</b> or <b>q</b> to close
        </text>
      </box>
    </box>
  )
}
