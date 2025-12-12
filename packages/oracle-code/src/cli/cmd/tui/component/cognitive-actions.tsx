import { onMount } from "solid-js"
import { registerWhichKeyAction } from "../context/which-key"
import { useAnalysisMode } from "../context/analysis-mode"
import { useAnalysisGate } from "../context/analysis-gate"
import { useCognitive } from "../context/cognitive"
import { useKV } from "../context/kv"
import { useToast } from "../ui/toast"

/**
 * Cognitive Actions Connector
 * 
 * Registers which-key action handlers for cognitive protocol commands.
 * This component doesn't render anything - it just sets up the handlers.
 */
export function CognitiveActionsConnector() {
  const analysisMode = useAnalysisMode()
  const analysisGate = useAnalysisGate()
  const cognitive = useCognitive()
  const kv = useKV()
  const toast = useToast()

  onMount(() => {
    // Lane split (subagent panes) settings
    registerWhichKeyAction("window.lanes.toggle", () => {
      const current = Boolean(kv.get("tui.lanes.auto_split", true))
      const next = !current
      kv.set("tui.lanes.auto_split", next)
      toast.show({
        message: `Subagent panes: ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    registerWhichKeyAction("window.lanes.autoclose.toggle", () => {
      const current = Boolean(kv.get("tui.lanes.auto_collapse", true))
      const next = !current
      kv.set("tui.lanes.auto_collapse", next)
      toast.show({
        message: `Subagent auto-close: ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    // Outcomes / heuristic UX settings
    registerWhichKeyAction("outcomes.toast_chain_issues.toggle", () => {
      const current = Boolean(kv.get("tui.outcomes.toast_chain_issues", true))
      const next = !current
      kv.set("tui.outcomes.toast_chain_issues", next)
      toast.show({
        message: `Chain toasts (issues): ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    registerWhichKeyAction("outcomes.toast_chain_success.toggle", () => {
      const current = Boolean(kv.get("tui.outcomes.toast_chain_success", false))
      const next = !current
      kv.set("tui.outcomes.toast_chain_success", next)
      toast.show({
        message: `Chain toasts (success): ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    registerWhichKeyAction("outcomes.record_chain_issues.toggle", () => {
      const current = Boolean(kv.get("tui.outcomes.record_chain_issues", true))
      const next = !current
      kv.set("tui.outcomes.record_chain_issues", next)
      toast.show({
        message: `Record chains (issues): ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    registerWhichKeyAction("outcomes.record_chain_success.toggle", () => {
      const current = Boolean(kv.get("tui.outcomes.record_chain_success", false))
      const next = !current
      kv.set("tui.outcomes.record_chain_success", next)
      toast.show({
        message: `Record chains (success): ${next ? "ON" : "OFF"}`,
        variant: next ? "success" : "info",
        duration: 2000,
      })
    })

    // Analysis mode toggles
    registerWhichKeyAction("analysis.tom", () => {
      analysisMode.toggle("tom")
      toast.show({ message: `ToM mode: ${analysisMode.mode === "tom" ? "ON" : "OFF"}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.metrics", () => {
      analysisMode.toggle("metrics")
      toast.show({ message: `Metrics mode: ${analysisMode.mode === "metrics" ? "ON" : "OFF"}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.eval", () => {
      analysisMode.toggle("eval")
      toast.show({ message: `Eval mode: ${analysisMode.mode === "eval" ? "ON" : "OFF"}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.critic", () => {
      analysisMode.toggle("critic")
      toast.show({ message: `Critic mode: ${analysisMode.mode === "critic" ? "ON" : "OFF"}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.emotional", () => {
      analysisMode.toggle("emotional")
      toast.show({ message: `Emotional mode: ${analysisMode.mode === "emotional" ? "ON" : "OFF"}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.cycle", () => {
      analysisMode.cycle(1)
      toast.show({ message: `Analysis: ${analysisMode.modeInfo.name}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.gate", () => {
      analysisGate.cycleMode()
      toast.show({ message: `Gate: ${analysisGate.modeLabel}`, variant: "info", duration: 1500 })
    })

    // Cognitive status/info
    registerWhichKeyAction("cognitive.status", () => {
      const status = cognitive.hasData
        ? `Strategy: ${cognitive.strategy} | Load: ${cognitive.cognitiveLoad}% | Flow: ${cognitive.flowState ? "Yes" : "No"}`
        : "No cognitive data available"
      toast.show({ message: status, variant: "info", duration: 3000 })
    })

    registerWhichKeyAction("cognitive.emotions", () => {
      const status = cognitive.hasEmotionalData
        ? `Mood: ${cognitive.mood} | Anxiety: ${cognitive.anxietyLevel}% | Confidence: ${cognitive.confidenceLevel}%`
        : "No emotional data available"
      toast.show({ message: status, variant: "info", duration: 3000 })
    })

    registerWhichKeyAction("cognitive.knowledge", () => {
      const status = cognitive.hasEpistemicData
        ? `Facts: ${cognitive.goldenFactCount}/${cognitive.maxGoldenFacts} golden, ${cognitive.workingFactCount} working | Confidence: ${cognitive.avgConfidence}%`
        : "No epistemic data available"
      toast.show({ message: status, variant: "info", duration: 3000 })
    })

    registerWhichKeyAction("cognitive.goals", () => {
      const status = cognitive.primaryGoal
        ? `Goal: ${cognitive.primaryGoal} (${cognitive.primaryGoalProgress}%) | ${cognitive.completedSubgoals}/${cognitive.totalSubgoals} subgoals done`
        : "No active goal"
      toast.show({ message: status, variant: "info", duration: 3000 })
    })

    registerWhichKeyAction("cognitive.strategy", () => {
      toast.show({
        message: `Strategy: ${cognitive.strategy} (${Math.round(cognitive.strategyEffectiveness * 100)}% effective)`,
        variant: "info",
        duration: 2000,
      })
    })

    registerWhichKeyAction("cognitive.mood.set", () => {
      toast.show({ message: "Use /emotions mood <mood> to set mood", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("cognitive.mood.history", () => {
      toast.show({ message: "Use /emotions history to view mood history", variant: "info", duration: 2000 })
    })

    // Emotion recording shortcuts
    registerWhichKeyAction("cognitive.record.fear", () => {
      toast.show({ message: "Use /emotions record fear <description>", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("cognitive.record.satisfaction", () => {
      toast.show({ message: "Use /emotions record satisfaction <description>", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("cognitive.record.curiosity", () => {
      toast.show({ message: "Use /emotions record curiosity <description>", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("cognitive.record.frustration", () => {
      toast.show({ message: "Use /emotions record frustration <description>", variant: "info", duration: 2000 })
    })

    // Analysis triggers
    registerWhichKeyAction("cognitive.triggers.list", () => {
      toast.show({ message: "Use /analysis triggers list to view triggers", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("cognitive.triggers.gate", () => {
      analysisGate.cycleMode()
      toast.show({ message: `Gate mode: ${analysisGate.modeLabel}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("cognitive.triggers.pending", () => {
      if (analysisGate.hasPending) {
        toast.show({
          message: `${analysisGate.pendingCount} pending: ${analysisGate.currentPending?.trigger.name || ""}`,
          variant: "warning",
          duration: 3000,
        })
      } else {
        toast.show({ message: "No pending triggers", variant: "info", duration: 1500 })
      }
    })

    // Agent status
    registerWhichKeyAction("agent.status", () => {
      toast.show({ message: "Use command palette -> Agents -> Status for agent info", variant: "info", duration: 2000 })
    })

    // Help
    registerWhichKeyAction("help.show", () => {
      toast.show({ message: "Press ? or use command palette for help", variant: "info", duration: 2000 })
    })

    // Session actions
    registerWhichKeyAction("session.rename", () => {
      toast.show({ message: "Use command palette -> Session -> Rename", variant: "info", duration: 2000 })
    })

    registerWhichKeyAction("session.tree", () => {
      toast.show({ message: "Use command palette -> Agents -> Session hierarchy", variant: "info", duration: 2000 })
    })

    // File actions (placeholders for future implementation)
    registerWhichKeyAction("file.find", () => {
      toast.show({ message: "File finder not yet implemented", variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("file.recent", () => {
      toast.show({ message: "Recent files not yet implemented", variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("file.save", () => {
      toast.show({ message: "File operations handled by agent", variant: "info", duration: 1500 })
    })

    // Git actions (placeholders for future implementation)
    registerWhichKeyAction("git.status", () => {
      toast.show({ message: "Use terminal or agent for git operations", variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("git.diff", () => {
      toast.show({ message: "Use terminal or agent for git operations", variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("git.log", () => {
      toast.show({ message: "Use terminal or agent for git operations", variant: "info", duration: 1500 })
    })
  })

  return null
}
