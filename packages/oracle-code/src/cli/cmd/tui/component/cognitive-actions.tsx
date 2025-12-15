import { onMount } from "solid-js"
import { registerWhichKeyAction } from "../context/which-key"
import { useAnalysisMode } from "../context/analysis-mode"
import { useAnalysisGate } from "../context/analysis-gate"
import { useKV } from "../context/kv"
import { useToast } from "../ui/toast"

/**
 * Cognitive Actions Connector
 *
 * Registers which-key action handlers for cognitive protocol commands.
 * This component doesn't render anything - it just sets up the handlers.
 *
 * Note: Most cognitive data is now displayed in dedicated buffer views:
 * - Cognitive buffer (ctrl+x b C) - full dashboard
 * - Hivemind buffer (ctrl+x b h) - cross-session learning
 * - State buffer (ctrl+x b s) - shared state editor
 */
export function CognitiveActionsConnector() {
  const analysisMode = useAnalysisMode()
  const analysisGate = useAnalysisGate()
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
      toast.show({
        message: `ToM mode: ${analysisMode.mode === "tom" ? "ON" : "OFF"}`,
        variant: "info",
        duration: 1500,
      })
    })

    registerWhichKeyAction("analysis.metrics", () => {
      analysisMode.toggle("metrics")
      toast.show({
        message: `Metrics mode: ${analysisMode.mode === "metrics" ? "ON" : "OFF"}`,
        variant: "info",
        duration: 1500,
      })
    })

    registerWhichKeyAction("analysis.eval", () => {
      analysisMode.toggle("eval")
      toast.show({
        message: `Eval mode: ${analysisMode.mode === "eval" ? "ON" : "OFF"}`,
        variant: "info",
        duration: 1500,
      })
    })

    registerWhichKeyAction("analysis.critic", () => {
      analysisMode.toggle("critic")
      toast.show({
        message: `Critic mode: ${analysisMode.mode === "critic" ? "ON" : "OFF"}`,
        variant: "info",
        duration: 1500,
      })
    })

    registerWhichKeyAction("analysis.emotional", () => {
      analysisMode.toggle("emotional")
      toast.show({
        message: `Emotional mode: ${analysisMode.mode === "emotional" ? "ON" : "OFF"}`,
        variant: "info",
        duration: 1500,
      })
    })

    registerWhichKeyAction("analysis.cycle", () => {
      analysisMode.cycle(1)
      toast.show({ message: `Analysis: ${analysisMode.modeInfo.name}`, variant: "info", duration: 1500 })
    })

    registerWhichKeyAction("analysis.gate", () => {
      analysisGate.cycleMode()
      toast.show({ message: `Gate: ${analysisGate.modeLabel}`, variant: "info", duration: 1500 })
    })

    // Direct agent spawn commands
    registerWhichKeyAction("agent.spawn.explore", async () => {
      toast.show({ message: "Spawning @explore agent...", variant: "info", duration: 1500 })
      const sessionId = await analysisGate.spawnSubagent(
        "explore",
        "Explore the codebase and report findings. Focus on understanding the structure and key patterns.",
        "Codebase Exploration",
      )
      if (sessionId) {
        toast.show({ message: "@explore agent spawned", variant: "success", duration: 2000 })
      } else {
        toast.show({ message: "Failed to spawn @explore agent", variant: "error", duration: 2000 })
      }
    })

    registerWhichKeyAction("agent.spawn.critic", async () => {
      toast.show({ message: "Spawning @critic agent...", variant: "info", duration: 1500 })
      const sessionId = await analysisGate.spawnSubagent(
        "critic",
        "Review the recent changes and provide harsh, constructive feedback. Look for bugs, anti-patterns, and areas for improvement.",
        "Code Review",
      )
      if (sessionId) {
        toast.show({ message: "@critic agent spawned", variant: "success", duration: 2000 })
      } else {
        toast.show({ message: "Failed to spawn @critic agent", variant: "error", duration: 2000 })
      }
    })

    registerWhichKeyAction("agent.spawn.general", async () => {
      toast.show({ message: "Spawning @general agent...", variant: "info", duration: 1500 })
      const sessionId = await analysisGate.spawnSubagent(
        "general",
        "Help with the current task. Provide assistance as needed.",
        "General Assistant",
      )
      if (sessionId) {
        toast.show({ message: "@general agent spawned", variant: "success", duration: 2000 })
      } else {
        toast.show({ message: "Failed to spawn @general agent", variant: "error", duration: 2000 })
      }
    })

    registerWhichKeyAction("agent.spawn.test", async () => {
      toast.show({ message: "Spawning @test agent...", variant: "info", duration: 1500 })
      const sessionId = await analysisGate.spawnSubagent(
        "test",
        "Analyze test coverage and suggest improvements. Write tests for uncovered code paths.",
        "Test Coverage Analysis",
      )
      if (sessionId) {
        toast.show({ message: "@test agent spawned", variant: "success", duration: 2000 })
      } else {
        toast.show({ message: "Failed to spawn @test agent", variant: "error", duration: 2000 })
      }
    })

    registerWhichKeyAction("agent.spawn.security", async () => {
      toast.show({ message: "Spawning @security agent...", variant: "info", duration: 1500 })
      const sessionId = await analysisGate.spawnSubagent(
        "security",
        "Review the codebase for security vulnerabilities. Look for injection risks, auth issues, and sensitive data exposure.",
        "Security Review",
      )
      if (sessionId) {
        toast.show({ message: "@security agent spawned", variant: "success", duration: 2000 })
      } else {
        toast.show({ message: "Failed to spawn @security agent", variant: "error", duration: 2000 })
      }
    })

    // Help (just directs to command palette)
    registerWhichKeyAction("help.show", () => {
      toast.show({ message: "Press ? or use command palette for help", variant: "info", duration: 2000 })
    })
  })

  return null
}
