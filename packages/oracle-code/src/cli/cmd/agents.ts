import { Global } from "@/global"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { AFS } from "../../afs"
import { State } from "../../state"
import path from "path"
import { EOL } from "os"

const AgentsListCommand = cmd({
  command: "list",
  describe: "list agent roles",
  async handler() {
    UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Agent Roles${UI.Style.TEXT_NORMAL}`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@general${UI.Style.TEXT_NORMAL}    (Coordinator)`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@planner${UI.Style.TEXT_NORMAL}    (Strategy)`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@coder${UI.Style.TEXT_NORMAL}      (Implementation)`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@critic${UI.Style.TEXT_NORMAL}     (Review)`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@researcher${UI.Style.TEXT_NORMAL} (Investigation)`)
    UI.println(`  - ${UI.Style.TEXT_INFO}@maintenance${UI.Style.TEXT_NORMAL} (Parity & Deps)`)
  },
})

const AgentsConfigCommand = cmd({
  command: "config",
  describe: "show configured agents with descriptions",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const agents = await Agent.list()

        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Configured Agents${UI.Style.TEXT_NORMAL}${EOL}`)

        for (const agent of agents) {
          const modeColor = agent.mode === "primary" ? UI.Style.TEXT_INFO : UI.Style.TEXT_SUCCESS
          const modeLabel = agent.mode === "primary" ? "primary" : "subagent"

          UI.println(
            `  ${UI.Style.TEXT_INFO}@${agent.name.padEnd(12)}${UI.Style.TEXT_NORMAL} ` +
              `${modeColor}[${modeLabel}]${UI.Style.TEXT_NORMAL}`,
          )
          if (agent.description) {
            UI.println(`    ${UI.Style.TEXT_DIM}${agent.description}${UI.Style.TEXT_NORMAL}`)
          }
        }
      },
    })
  },
})

const AgentsStatusCommand = cmd({
  command: "status",
  describe: "show active subagent sessions",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Subagent Sessions${UI.Style.TEXT_NORMAL}${EOL}`)

        const sessions: Session.Info[] = []
        for await (const session of Session.list()) {
          if (session.parentID) {
            sessions.push(session)
          }
        }

        if (sessions.length === 0) {
          UI.println(`  ${UI.Style.TEXT_DIM}No active subagent sessions${UI.Style.TEXT_NORMAL}`)
          return
        }

        // Sort by most recent first
        sessions.sort((a, b) => new Date(b.time.updated).getTime() - new Date(a.time.updated).getTime())

        for (const session of sessions.slice(0, 10)) {
          const agentMatch = session.title.match(/@(\w+)/)
          const agentName = agentMatch?.[1] || "unknown"
          const timeAgo = getTimeAgo(new Date(session.time.updated))

          UI.println(
            `  ${UI.Style.TEXT_SUCCESS}@${agentName.padEnd(10)}${UI.Style.TEXT_NORMAL} ` +
              `${session.title.slice(0, 40)}${session.title.length > 40 ? "..." : ""}`,
          )
          UI.println(`    ${UI.Style.TEXT_DIM}${session.id.slice(0, 8)}... | ${timeAgo}${UI.Style.TEXT_NORMAL}`)
        }

        if (sessions.length > 10) {
          UI.println(`${EOL}  ${UI.Style.TEXT_DIM}... and ${sessions.length - 10} more${UI.Style.TEXT_NORMAL}`)
        }
      },
    })
  },
})

const AgentsPlanCommand = cmd({
  command: "plan",
  describe: "view current plan",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const root = await AFS.findRoot()
        if (!root) {
          UI.println(`${UI.Style.TEXT_DIM}AFS not initialized. Run 'ocode afs init'.${UI.Style.TEXT_NORMAL}`)
          return
        }
        const planPath = path.join(root, "scratchpad/plan.md")
        const plan = await Bun.file(planPath)
          .text()
          .catch(() => null)

        if (!plan) {
          UI.println(`${UI.Style.TEXT_DIM}No active plan found in .context/scratchpad/plan.md${UI.Style.TEXT_NORMAL}`)
          return
        }

        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Current Plan:${UI.Style.TEXT_NORMAL}${EOL}`)
        UI.println(plan)
      },
    })
  },
})

const AgentsSyncCommand = cmd({
  command: "sync",
  describe: "view or sync shared state",
  builder: (yargs) =>
    yargs
      .option("push", {
        describe: "Write current state to state.md",
        type: "boolean",
      })
      .option("pull", {
        describe: "Read state.md content",
        type: "boolean",
      }),
  async handler(args) {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const root = await AFS.findRoot()
        if (!root) {
          UI.error("AFS not initialized. Run 'ocode afs init' first.")
          return
        }

        const statePath = State.getStatePath(root)

        if (args.push) {
          await State.sync(root)
          UI.println(`${UI.Style.TEXT_SUCCESS}State synced to ${statePath}${UI.Style.TEXT_NORMAL}`)
          return
        }

        if (args.pull) {
          const content = await State.read(root)
          if (content) {
            UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Shared State:${UI.Style.TEXT_NORMAL}${EOL}`)
            UI.println(content)
          } else {
            UI.println(`${UI.Style.TEXT_DIM}No state.md found${UI.Style.TEXT_NORMAL}`)
          }
          return
        }

        // Default: display current state summary
        const data = await State.getData(root)
        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Shared State${UI.Style.TEXT_NORMAL}${EOL}`)

        if (!data || data.entries.length === 0) {
          UI.println(`  ${UI.Style.TEXT_DIM}No shared state entries${UI.Style.TEXT_NORMAL}`)
          UI.println(`  ${UI.Style.TEXT_DIM}Use --push to sync or --pull to read${UI.Style.TEXT_NORMAL}`)
          return
        }

        UI.println(`  ${UI.Style.TEXT_DIM}Last updated: ${data.lastUpdated}${UI.Style.TEXT_NORMAL}${EOL}`)

        // Group by section
        const sections = new Map<State.Section, State.StateEntry[]>()
        for (const entry of data.entries) {
          const list = sections.get(entry.section) || []
          list.push(entry)
          sections.set(entry.section, list)
        }

        for (const section of State.Section.options) {
          const entries = sections.get(section)
          if (!entries?.length) continue

          UI.println(`  ${UI.Style.TEXT_INFO}[${section}]${UI.Style.TEXT_NORMAL}`)
          for (const entry of entries) {
            UI.println(`    ${UI.Style.TEXT_HIGHLIGHT}${entry.key}${UI.Style.TEXT_NORMAL}: ${entry.value}`)
          }
        }
      },
    })
  },
})

export const AgentsCommand = cmd({
  command: "agents",
  describe: "manage agents",
  builder: (yargs) =>
    yargs
      .command(AgentsListCommand)
      .command(AgentsConfigCommand)
      .command(AgentsStatusCommand)
      .command(AgentsPlanCommand)
      .command(AgentsSyncCommand)
      .demandCommand(),
  async handler() {},
})

// Helper function to format time ago
function getTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}
