import { For, Show, createMemo, createSignal } from "solid-js"
import { useCognitive } from "../context/cognitive"
import { useToM } from "../context/tom"
import { useTheme } from "../context/theme"

/**
 * Cognitive Protocol panel for sidebar
 * Shows metacognition, goals, and theory of mind in a unified view
 */
export function CognitivePanel() {
  const cognitive = useCognitive()
  const tom = useToM()
  const { theme } = useTheme()

  const [expandedMeta, setExpandedMeta] = createSignal(true)
  const [expandedGoals, setExpandedGoals] = createSignal(true)
  const [expandedKnowledge, setExpandedKnowledge] = createSignal(true)
  const [expandedEmotional, setExpandedEmotional] = createSignal(true)
  const [expandedToM, setExpandedToM] = createSignal(false)

  // Determine if we have any data to show
  const hasAnyData = createMemo(() => {
    return (
      cognitive.hasData ||
      cognitive.hasEpistemicData ||
      cognitive.hasEmotionalData ||
      Object.keys(tom.beliefStates).length > 0 ||
      tom.userIntent.primaryIntent.length > 0 ||
      tom.data.lastUpdated > 0
    )
  })

  // Mood emoji mapping
  const moodEmoji = createMemo(() => {
    const emojis: Record<string, string> = {
      positive: "😊",
      neutral: "😐",
      negative: "😔",
      anxious: "😰",
      confident: "🎯",
      frustrated: "😤",
      curious: "🤔",
    }
    return emojis[cognitive.mood] || "😐"
  })

  // Anxiety color
  const anxietyColor = createMemo(() => {
    if (cognitive.anxietyLevel < 40) return theme.success
    if (cognitive.anxietyLevel < 70) return theme.warning
    return theme.error
  })

  // Confidence color
  const emotionalConfidenceColor = createMemo(() => {
    if (cognitive.confidenceLevel >= 70) return theme.success
    if (cognitive.confidenceLevel >= 40) return theme.warning
    return theme.error
  })

  // Confidence color for knowledge
  const confidenceColor = createMemo(() => {
    const conf = cognitive.avgConfidence
    if (conf >= 80) return theme.success
    if (conf >= 50) return theme.warning
    return theme.error
  })

  // Flow state color
  const flowColor = createMemo(() => {
    if (cognitive.flowState) return theme.success
    return theme.textMuted
  })

  // Cognitive load color
  const loadColor = createMemo(() => {
    const load = cognitive.cognitiveLoad
    if (load < 50) return theme.success
    if (load < 80) return theme.warning
    return theme.error
  })

  // Progress color
  const progressColor = createMemo(() => {
    const status = cognitive.progressStatus
    if (status === "making_progress") return theme.success
    if (status === "spinning") return theme.warning
    return theme.error
  })

  // ToM sync color
  const tomSyncColor = createMemo(() => {
    const status = tom.syncStatusColor
    return status === "success" ? theme.success : status === "warning" ? theme.warning : theme.error
  })

  const beliefStateCount = createMemo(() => Object.keys(tom.beliefStates).length)

  return (
    <box flexDirection="column">
      {/* Header */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <b>Cognitive Protocol</b>
        </text>
        <Show when={cognitive.flowState}>
          <text fg={theme.success}>⚡</text>
        </Show>
      </box>

      <Show
        when={hasAnyData()}
        fallback={
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.textMuted}>
              {cognitive.afsInitialized
                ? "No cognitive state yet. Start working to generate metrics."
                : "AFS not initialized."}
            </text>
          </box>
        }
      >
        {/* Metacognition Section */}
        <Show when={cognitive.metacognition}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setExpandedMeta(!expandedMeta())}>
              <text fg={theme.textMuted}>{expandedMeta() ? "▼" : "▶"}</text>
              <text fg={theme.text}>Metacognition</text>
              <Show when={cognitive.isSpinning}>
                <text fg={theme.warning}>⚠</text>
              </Show>
            </box>

            <Show when={expandedMeta()}>
              <box paddingLeft={2}>
                {/* Flow State */}
                <box flexDirection="row" gap={1}>
                  <text fg={flowColor()}>●</text>
                  <text fg={theme.textMuted}>
                    Flow: {cognitive.flowState ? "Active" : "Inactive"}
                  </text>
                </box>

                {/* Strategy */}
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>○</text>
                  <text fg={theme.textMuted}>Strategy: {cognitive.strategy}</text>
                  <text fg={theme.textMuted}>
                    ({cognitive.formatPercent(Math.round(cognitive.strategyEffectiveness * 100))})
                  </text>
                </box>

                {/* Progress */}
                <box flexDirection="row" gap={1}>
                  <text fg={progressColor()}>○</text>
                  <text fg={theme.textMuted}>Progress: {cognitive.progressStatus.replace("_", " ")}</text>
                </box>

                {/* Cognitive Load */}
                <box flexDirection="row" gap={1}>
                  <text fg={loadColor()}>○</text>
                  <text fg={theme.textMuted}>
                    Load: {cognitive.formatPercent(cognitive.cognitiveLoad)}
                  </text>
                </box>

                {/* Frustration (only if elevated) */}
                <Show when={cognitive.frustration > 30}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.warning}>○</text>
                    <text fg={theme.textMuted}>
                      Frustration: {cognitive.formatPercent(cognitive.frustration)}
                    </text>
                  </box>
                </Show>

                {/* Warnings */}
                <Show when={cognitive.isSpinning}>
                  <text fg={theme.warning} paddingLeft={1}>
                    ⚠ Spinning - change approach
                  </text>
                </Show>
                <Show when={cognitive.shouldSeekHelp}>
                  <text fg={theme.warning} paddingLeft={1}>
                    ⚠ Seek clarification
                  </text>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        {/* Goals Section */}
        <Show when={cognitive.goals?.primaryGoal}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setExpandedGoals(!expandedGoals())}>
              <text fg={theme.textMuted}>{expandedGoals() ? "▼" : "▶"}</text>
              <text fg={theme.text}>Goals</text>
              <Show when={cognitive.hasConflicts}>
                <text fg={theme.warning}>⚠</text>
              </Show>
            </box>

            <Show when={expandedGoals()}>
              <box paddingLeft={2}>
                {/* Primary Goal */}
                <box flexDirection="column">
                  <text fg={theme.textMuted}>
                    ◉ {cognitive.primaryGoal?.slice(0, 40)}
                    {(cognitive.primaryGoal?.length || 0) > 40 ? "..." : ""}
                  </text>
                  <box flexDirection="row" gap={1} paddingLeft={2}>
                    <text fg={theme.success}>
                      {cognitive.formatPercent(cognitive.primaryGoalProgress)}
                    </text>
                    <text fg={theme.textMuted}>complete</text>
                  </box>
                </box>

                {/* Subgoals summary */}
                <Show when={cognitive.totalSubgoals > 0}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>○</text>
                    <text fg={theme.textMuted}>
                      Subgoals: {cognitive.completedSubgoals}/{cognitive.totalSubgoals}
                    </text>
                    <Show when={cognitive.activeSubgoals > 0}>
                      <text fg={theme.info}>({cognitive.activeSubgoals} active)</text>
                    </Show>
                  </box>
                </Show>

                {/* Conflicts */}
                <Show when={cognitive.unresolvedConflicts > 0}>
                  <text fg={theme.warning} paddingLeft={1}>
                    ⚠ {cognitive.unresolvedConflicts} conflict(s)
                  </text>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        {/* Knowledge Section (Epistemic State) */}
        <Show when={cognitive.hasEpistemicData || cognitive.afsInitialized}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setExpandedKnowledge(!expandedKnowledge())}>
              <text fg={theme.textMuted}>{expandedKnowledge() ? "▼" : "▶"}</text>
              <text fg={theme.text}>Knowledge</text>
              <Show when={cognitive.contradictionCount > 0}>
                <text fg={theme.error}>⚠</text>
              </Show>
            </box>

            <Show when={expandedKnowledge()}>
              <box paddingLeft={2}>
                {/* Golden Facts */}
                <box flexDirection="row" gap={1}>
                  <text fg={theme.warning}>★</text>
                  <text fg={theme.textMuted}>
                    Golden: {cognitive.goldenFactCount}/{cognitive.maxGoldenFacts}
                  </text>
                </box>

                {/* Working Facts with confidence */}
                <box flexDirection="row" gap={1}>
                  <text fg={confidenceColor()}>●</text>
                  <text fg={theme.textMuted}>
                    Facts: {cognitive.workingFactCount}
                  </text>
                  <Show when={cognitive.workingFactCount > 0}>
                    <text fg={confidenceColor()}>
                      ({cognitive.formatPercent(cognitive.avgConfidence)} conf)
                    </text>
                  </Show>
                </box>

                {/* Assumptions */}
                <Show when={cognitive.assumptionCount > 0}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>○</text>
                    <text fg={theme.textMuted}>
                      Assumptions: {cognitive.assumptionCount}
                    </text>
                    <Show when={cognitive.unvalidatedAssumptions > 0}>
                      <text fg={theme.warning}>
                        ({cognitive.unvalidatedAssumptions} unvalidated)
                      </text>
                    </Show>
                  </box>
                </Show>

                {/* Unknowns */}
                <Show when={cognitive.unknownCount > 0}>
                  <box flexDirection="row" gap={1}>
                    <text fg={cognitive.criticalUnknowns > 0 ? theme.error : theme.textMuted}>?</text>
                    <text fg={theme.textMuted}>
                      Unknowns: {cognitive.unknownCount}
                    </text>
                    <Show when={cognitive.criticalUnknowns > 0}>
                      <text fg={theme.error}>
                        ({cognitive.criticalUnknowns} critical)
                      </text>
                    </Show>
                  </box>
                </Show>

                {/* Contradictions */}
                <Show when={cognitive.contradictionCount > 0}>
                  <text fg={theme.error} paddingLeft={1}>
                    ⚠ {cognitive.contradictionCount} contradiction(s)
                  </text>
                </Show>

                {/* Empty state */}
                <Show when={!cognitive.hasEpistemicData && cognitive.afsInitialized}>
                  <text fg={theme.textMuted}>No facts recorded yet</text>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        {/* Emotional State Section */}
        <Show when={cognitive.hasEmotionalData || cognitive.afsInitialized}>
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setExpandedEmotional(!expandedEmotional())}>
              <text fg={theme.textMuted}>{expandedEmotional() ? "▼" : "▶"}</text>
              <text fg={theme.text}>Emotional State</text>
              <text fg={theme.textMuted}>{moodEmoji()}</text>
              <Show when={cognitive.isAnxious}>
                <text fg={theme.warning}>⚠</text>
              </Show>
            </box>

            <Show when={expandedEmotional()}>
              <box paddingLeft={2}>
                {/* Mood */}
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>{moodEmoji()}</text>
                  <text fg={theme.textMuted}>
                    Mood: {cognitive.mood}
                  </text>
                </box>

                {/* Anxiety */}
                <box flexDirection="row" gap={1}>
                  <text fg={anxietyColor()}>○</text>
                  <text fg={theme.textMuted}>
                    Anxiety: {cognitive.anxietyLevel}%
                  </text>
                  <Show when={cognitive.isAnxious}>
                    <text fg={theme.warning}>(HIGH)</text>
                  </Show>
                </box>

                {/* Confidence */}
                <box flexDirection="row" gap={1}>
                  <text fg={emotionalConfidenceColor()}>○</text>
                  <text fg={theme.textMuted}>
                    Confidence: {cognitive.confidenceLevel}%
                  </text>
                  <Show when={cognitive.isConfident}>
                    <text fg={theme.success}>✓</text>
                  </Show>
                </box>

                {/* Emotion counts */}
                <Show when={cognitive.totalEmotionCount > 0}>
                  <box flexDirection="row" gap={1} marginTop={1}>
                    <text fg={theme.textMuted}>Emotions:</text>
                  </box>
                  <Show when={cognitive.fearCount > 0}>
                    <text fg={theme.textMuted} paddingLeft={1}>
                      • 😨 {cognitive.fearCount} fear{cognitive.fearCount !== 1 ? "s" : ""}
                    </text>
                  </Show>
                  <Show when={cognitive.curiosityCount > 0}>
                    <text fg={theme.textMuted} paddingLeft={1}>
                      • 🤔 {cognitive.curiosityCount} curiosit{cognitive.curiosityCount !== 1 ? "ies" : "y"}
                    </text>
                  </Show>
                  <Show when={cognitive.satisfactionCount > 0}>
                    <text fg={theme.success} paddingLeft={1}>
                      • ✓ {cognitive.satisfactionCount} satisfaction{cognitive.satisfactionCount !== 1 ? "s" : ""}
                    </text>
                  </Show>
                  <Show when={cognitive.frustrationCount > 0}>
                    <text fg={theme.warning} paddingLeft={1}>
                      • 😤 {cognitive.frustrationCount} frustration{cognitive.frustrationCount !== 1 ? "s" : ""}
                    </text>
                  </Show>
                </Show>

                {/* Empty state */}
                <Show when={!cognitive.hasEmotionalData && cognitive.afsInitialized}>
                  <text fg={theme.textMuted}>No emotions recorded yet</text>
                </Show>
              </box>
            </Show>
          </box>
        </Show>

        {/* Theory of Mind Section */}
        <Show
          when={
            beliefStateCount() > 0 ||
            tom.userIntent.primaryIntent.length > 0 ||
            tom.data.lastUpdated > 0
          }
        >
          <box marginTop={1}>
            <box flexDirection="row" gap={1} onMouseDown={() => setExpandedToM(!expandedToM())}>
              <text fg={theme.textMuted}>{expandedToM() ? "▼" : "▶"}</text>
              <text fg={theme.text}>Theory of Mind</text>
            </box>

            {/* Compact view (always shown when collapsed) */}
            <Show when={!expandedToM()}>
              <box paddingLeft={2}>
                <box flexDirection="row" gap={1}>
                  <text fg={tomSyncColor()}>●</text>
                  <text fg={theme.textMuted}>
                    {tom.syncStatus === "synchronized"
                      ? "Synced"
                      : tom.syncStatus === "divergent"
                        ? "Divergent"
                        : "Unknown"}
                  </text>
                  <Show when={tom.divergenceCount > 0}>
                    <text fg={theme.warning}>({tom.divergenceCount})</text>
                  </Show>
                </box>
              </box>
            </Show>

            {/* Expanded ToM view */}
            <Show when={expandedToM()}>
              <box paddingLeft={2}>
                {/* Sync status */}
                <box flexDirection="row" gap={1}>
                  <text fg={tomSyncColor()}>●</text>
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

                {/* User intent */}
                <Show when={tom.userIntent.primaryIntent}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>○</text>
                    <text fg={theme.textMuted}>
                      Intent: {tom.formatConfidence(tom.userIntent.confidence)}
                    </text>
                  </box>
                </Show>

                {/* High severity divergences */}
                <Show when={tom.highSeverityDivergences.length > 0}>
                  <box marginTop={1}>
                    <text fg={theme.warning}>
                      <b>Divergences</b>
                    </text>
                    <For each={tom.highSeverityDivergences.slice(0, 3)}>
                      {(div) => (
                        <box paddingLeft={1}>
                          <text fg={theme.textMuted}>• {div.key}</text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                {/* Shared facts */}
                <Show when={tom.commonGround.sharedFacts.length > 0}>
                  <box marginTop={1}>
                    <text fg={theme.textMuted}>
                      <b>Shared Facts</b> ({tom.commonGround.sharedFacts.length})
                    </text>
                    <For each={tom.commonGround.sharedFacts.slice(0, 3)}>
                      {(fact) => (
                        <text fg={theme.textMuted} paddingLeft={1}>
                          • {fact.key}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}
