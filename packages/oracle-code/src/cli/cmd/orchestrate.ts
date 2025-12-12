import { Global } from "@/global"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { EOL } from "os"

/**
 * Orchestration strategies based on research paper (arXiv:2512.08296)
 */
type OrchestrationStrategy = "independent" | "centralized" | "decentralized" | "hierarchical" | "debate"

const STRATEGY_INFO: Record<OrchestrationStrategy, { name: string; improvement: string; errorAmp: string }> = {
  independent: { name: "Independent", improvement: "Variable", errorAmp: "17.2x" },
  centralized: { name: "Centralized", improvement: "+81% (parallelizable)", errorAmp: "4.4x" },
  decentralized: { name: "Decentralized", improvement: "+9.2% (dynamic)", errorAmp: "7.8x" },
  hierarchical: { name: "Hierarchical", improvement: "Variable", errorAmp: "~5x" },
  debate: { name: "Debate", improvement: "Quality-focused", errorAmp: "~3x" },
}

const OrchestrationStatusCommand = cmd({
  command: "status",
  describe: "show current orchestration state",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Orchestration Status${UI.Style.TEXT_NORMAL}${EOL}`)

        // Get active subagent sessions
        const sessions: Session.Info[] = []
        for await (const session of Session.list()) {
          if (session.parentID) {
            sessions.push(session)
          }
        }

        const activeSessions = sessions.filter((s) => {
          const hourAgo = Date.now() - 60 * 60 * 1000
          return new Date(s.time.updated).getTime() > hourAgo
        })

        if (activeSessions.length === 0) {
          UI.println(`  ${UI.Style.TEXT_DIM}No active subagent sessions${UI.Style.TEXT_NORMAL}`)
          return
        }

        // Count agents by type
        const agentCounts: Record<string, number> = {}
        for (const session of activeSessions) {
          const match = session.title.match(/@(\w+)/)
          const agentName = match?.[1] || "unknown"
          agentCounts[agentName] = (agentCounts[agentName] || 0) + 1
        }

        UI.println(`  ${UI.Style.TEXT_INFO}Active Agents:${UI.Style.TEXT_NORMAL}`)
        for (const [agent, count] of Object.entries(agentCounts)) {
          UI.println(`    @${agent}: ${count} session${count > 1 ? "s" : ""}`)
        }

        // Research paper insights
        const totalAgents = Object.keys(agentCounts).length
        if (totalAgents > 4) {
          UI.println(`${EOL}  ${UI.Style.TEXT_WARNING}⚠ ${totalAgents} agent types active${UI.Style.TEXT_NORMAL}`)
          UI.println(`    ${UI.Style.TEXT_DIM}Research: optimal is 3-4 agents${UI.Style.TEXT_NORMAL}`)
        }
      },
    })
  },
})

const OrchestrationStrategyCommand = cmd({
  command: "strategy [name]",
  describe: "view or set orchestration strategy",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "Strategy name (independent, centralized, decentralized, hierarchical, debate)",
      type: "string",
    }),
  async handler(args) {
    UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Orchestration Strategies${UI.Style.TEXT_NORMAL}${EOL}`)
    UI.println(`  ${UI.Style.TEXT_DIM}Based on "Towards a Science of Scaling Agent Systems" (arXiv:2512.08296)${UI.Style.TEXT_NORMAL}${EOL}`)

    for (const [key, info] of Object.entries(STRATEGY_INFO)) {
      const isSelected = args.name === key
      const marker = isSelected ? "▶" : " "
      const color = isSelected ? UI.Style.TEXT_INFO : UI.Style.TEXT_NORMAL

      UI.println(`  ${marker} ${color}${info.name.padEnd(15)}${UI.Style.TEXT_NORMAL}`)
      UI.println(`      ${UI.Style.TEXT_SUCCESS}Improvement: ${info.improvement}${UI.Style.TEXT_NORMAL}`)
      UI.println(`      ${UI.Style.TEXT_WARNING}Error Amp: ${info.errorAmp}${UI.Style.TEXT_NORMAL}`)
    }

    if (!args.name) {
      UI.println(`${EOL}  ${UI.Style.TEXT_DIM}Usage: ocode orchestrate strategy <name>${UI.Style.TEXT_NORMAL}`)
    }
  },
})

const OrchestrationAgentsCommand = cmd({
  command: "agents",
  describe: "list available agents for orchestration",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const agents = await Agent.list()
        const subagents = agents.filter((a) => a.mode === "subagent" || a.mode === "all")

        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Available Subagents${UI.Style.TEXT_NORMAL}${EOL}`)

        for (const agent of subagents) {
          const color = agent.name === "critic" ? UI.Style.TEXT_WARNING : UI.Style.TEXT_INFO
          UI.println(`  ${color}@${agent.name.padEnd(12)}${UI.Style.TEXT_NORMAL}`)
          if (agent.description) {
            UI.println(`    ${UI.Style.TEXT_DIM}${agent.description.slice(0, 70)}${agent.description.length > 70 ? "..." : ""}${UI.Style.TEXT_NORMAL}`)
          }
        }

        UI.println(`${EOL}  ${UI.Style.TEXT_DIM}Optimal agent count: 3-4 (per research)${UI.Style.TEXT_NORMAL}`)
      },
    })
  },
})

const OrchestrationDebateCommand = cmd({
  command: "debate <topic>",
  describe: "start an agent debate on a topic",
  builder: (yargs) =>
    yargs.positional("topic", {
      describe: "The topic for agents to debate",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Agent Debate${UI.Style.TEXT_NORMAL}${EOL}`)
    UI.println(`  Topic: ${args.topic}${EOL}`)
    UI.println(`  ${UI.Style.TEXT_DIM}Debate mode spawns multiple agents to argue different perspectives${UI.Style.TEXT_NORMAL}`)
    UI.println(`  ${UI.Style.TEXT_DIM}and synthesizes a consensus.${UI.Style.TEXT_NORMAL}${EOL}`)
    UI.println(`  ${UI.Style.TEXT_WARNING}Note: Debate mode is best used in the TUI.${UI.Style.TEXT_NORMAL}`)
    UI.println(`  ${UI.Style.TEXT_INFO}Run 'ocode' and use the Orchestration dialog.${UI.Style.TEXT_NORMAL}`)
  },
})

const OrchestrationRecommendCommand = cmd({
  command: "recommend",
  describe: "get architecture recommendation for current task",
  async handler() {
    UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Architecture Recommendation${UI.Style.TEXT_NORMAL}${EOL}`)
    UI.println(`  ${UI.Style.TEXT_DIM}Based on research paper findings:${UI.Style.TEXT_NORMAL}${EOL}`)

    UI.println(`  ${UI.Style.TEXT_INFO}Task Type → Recommended Strategy${UI.Style.TEXT_NORMAL}`)
    UI.println(`  ─────────────────────────────────────────`)
    UI.println(`  Parallelizable (finance)  → ${UI.Style.TEXT_SUCCESS}Centralized${UI.Style.TEXT_NORMAL} (+81%)`)
    UI.println(`  Dynamic exploration (web) → ${UI.Style.TEXT_SUCCESS}Decentralized${UI.Style.TEXT_NORMAL} (+9.2%)`)
    UI.println(`  Sequential reasoning      → ${UI.Style.TEXT_WARNING}Single Agent${UI.Style.TEXT_NORMAL} (MAS -39% to -70%)`)
    UI.println(`  Tool-heavy (>8 tools)     → ${UI.Style.TEXT_WARNING}Single Agent${UI.Style.TEXT_NORMAL} (overhead compounds)`)
    UI.println(`${EOL}`)

    UI.println(`  ${UI.Style.TEXT_WARNING}Critical Thresholds:${UI.Style.TEXT_NORMAL}`)
    UI.println(`  • Optimal agents: 3-4 (quality degrades beyond)`)
    UI.println(`  • SAS baseline >45%: MAS yields negative returns`)
    UI.println(`  • Message density: 0.39-0.41 msg/turn plateau`)
  },
})

export const OrchestrateCommand = cmd({
  command: "orchestrate",
  describe: "multi-agent orchestration controls",
  builder: (yargs) =>
    yargs
      .command(OrchestrationStatusCommand)
      .command(OrchestrationStrategyCommand)
      .command(OrchestrationAgentsCommand)
      .command(OrchestrationDebateCommand)
      .command(OrchestrationRecommendCommand)
      .demandCommand(),
  async handler() {},
})
