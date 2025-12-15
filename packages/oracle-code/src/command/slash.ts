import z from "zod"
import path from "path"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { AFS } from "../afs"
import { State } from "../state"
import { Agent } from "../agent/agent"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { Todo } from "../session/todo"
import { Vcs } from "../project/vcs"
import { Config } from "../config/config"
import { CognitiveIntegration, Metacognition, Goals, Epistemic, Emotions, AnalysisTriggers } from "../cognitive"

export namespace SlashCommand {
  export const Event = {
    Executed: BusEvent.define(
      "slash.executed",
      z.object({
        command: z.string(),
        args: z.string(),
        sessionID: z.string(),
        result: z.string().optional(),
      }),
    ),
  }

  export interface SlashContext {
    sessionID: string
    args: string[]
    rawArgs: string
  }

  export interface SlashResult {
    output?: string
    error?: string
    parts?: any[]
  }

  interface CommandHandler {
    description: string
    usage?: string
    handler: (ctx: SlashContext) => Promise<SlashResult>
  }

  // Regex to match /command at start of input
  const SLASH_REGEX = /^\/([a-zA-Z_]+)(?:\s+(.*))?$/

  const commands = new Map<string, CommandHandler>()

  export function register(
    name: string,
    description: string,
    handler: (ctx: SlashContext) => Promise<SlashResult>,
    usage?: string,
  ) {
    commands.set(name, { description, usage, handler })
  }

  export function list() {
    return Array.from(commands.entries()).map(([name, info]) => ({
      name,
      description: info.description,
      usage: info.usage,
    }))
  }

  export function parse(input: string): { command: string; args: string } | null {
    const match = input.trim().match(SLASH_REGEX)
    if (!match) return null
    return {
      command: match[1],
      args: match[2] || "",
    }
  }

  export async function execute(sessionID: string, input: string): Promise<SlashResult | null> {
    const parsed = parse(input)
    if (!parsed) return null

    const cmd = commands.get(parsed.command)
    if (!cmd) {
      return {
        error: `Unknown slash command: /${parsed.command}\nType /help for available commands.`,
      }
    }

    const args = parsed.args.split(/\s+/).filter(Boolean)
    const result = await cmd.handler({
      sessionID,
      args,
      rawArgs: parsed.args,
    })

    Bus.publish(Event.Executed, {
      command: parsed.command,
      args: parsed.args,
      sessionID,
      result: result.output || result.error,
    })

    return result
  }

  // ==========================================
  // Built-in Slash Commands
  // ==========================================

  // /help - Show available commands
  register(
    "help",
    "Show available slash commands",
    async () => {
      const cmds = list()
      let output = "**Available Slash Commands:**\n\n"
      for (const cmd of cmds) {
        output += `\`/${cmd.name}\` - ${cmd.description}\n`
        if (cmd.usage) {
          output += `  Usage: ${cmd.usage}\n`
        }
      }
      return { output }
    },
    "/help",
  )

  // /plan [view|edit|append] - Manage plan.md
  register(
    "plan",
    "Manage plan.md in AFS scratchpad",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      const action = ctx.args[0] || "view"
      const planPath = AFS.getPlanPath(root)

      switch (action) {
        case "view": {
          const content = await AFS.readPlan(root)
          return {
            output: content || "_No plan.md found. Create one with `/plan edit`_",
          }
        }
        case "edit": {
          const content = await AFS.readPlan(root)
          return {
            output: `Plan file: ${planPath}\n\n${content || "(empty)"}`,
            parts: [
              {
                type: "text",
                text: `Please help me edit the plan at ${planPath}. Current content:\n\n${content || "(empty)"}\n\nWhat changes would you like to make?`,
              },
            ],
          }
        }
        case "append": {
          const content = ctx.args.slice(1).join(" ")
          if (!content) {
            return { error: "Usage: /plan append <content>" }
          }
          return {
            output: `Appending to plan: ${content}`,
            parts: [
              {
                type: "text",
                text: `Append the following to plan.md using the plan_write tool with append=true:\n\n${content}`,
              },
            ],
          }
        }
        default:
          return { error: `Unknown plan action: ${action}. Use view, edit, or append.` }
      }
    },
    "/plan [view|edit|append] [content]",
  )

  // /context load [file] - Load context file into prompt
  register(
    "context",
    "Load context file into prompt",
    async (ctx) => {
      const action = ctx.args[0]
      const file = ctx.args[1]

      if (action !== "load" || !file) {
        return { error: "Usage: /context load <file>" }
      }

      const resolvedPath = path.resolve(Instance.directory, file)
      return {
        output: `Loading context from ${file}`,
        parts: [
          {
            type: "file",
            url: `file://${resolvedPath}`,
            filename: file,
            mime: "text/plain",
          },
        ],
      }
    },
    "/context load <file>",
  )

  // /state [key] [value] - Read/write shared state
  register(
    "state",
    "Read/write shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key) {
        // Show all state
        const state = await State.read(root)
        return { output: state || "_No shared state. Use /state <key> <value> to set._" }
      }

      if (!value) {
        // Read specific key
        const val = await State.get(root, key)
        return { output: val ? `**${key}:** ${val}` : `_Key '${key}' not found_` }
      }

      // Write key-value
      await State.set(root, key, value)
      return { output: `Set **${key}** = ${value}` }
    },
    "/state [key] [value]",
  )

  // /agent [@name] - Switch active agent
  register(
    "agent",
    "List or switch agents",
    async (ctx) => {
      const name = ctx.args[0]?.replace(/^@/, "")

      if (!name) {
        const agents = await Agent.list()
        return {
          output:
            "**Available agents:**\n" +
            agents.map((a) => `- @${a.name} (${a.mode})${a.description ? `: ${a.description}` : ""}`).join("\n"),
        }
      }

      const agent = await Agent.get(name)
      if (!agent) {
        return { error: `Unknown agent: @${name}` }
      }

      return {
        output: `Switching to @${name}`,
        parts: [
          {
            type: "agent",
            name: agent.name,
          },
        ],
      }
    },
    "/agent [@name]",
  )

  // /memory [search] - Search memory directory
  register(
    "memory",
    "Search memory directory",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const query = ctx.rawArgs.trim()
      const files = await AFS.listDirectory(root, "memory", true)

      if (!query) {
        if (files.length === 0) {
          return { output: "_No files in memory/_" }
        }
        return {
          output: "**Memory files:**\n" + files.map((f) => `- ${f.relativePath}`).join("\n"),
        }
      }

      // Simple search in filenames
      const matches = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))

      return {
        output: matches.length
          ? `**Matching files:**\n${matches.map((f) => `- ${f.relativePath}`).join("\n")}`
          : `_No files matching '${query}'_`,
      }
    },
    "/memory [search]",
  )

  // /scratchpad [list|clear] - Manage scratchpad
  register(
    "scratchpad",
    "Manage scratchpad",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const action = ctx.args[0] || "list"

      switch (action) {
        case "list": {
          const files = await AFS.listDirectory(root, "scratchpad", false)
          return {
            output: files.length
              ? "**Scratchpad files:**\n" + files.map((f) => `- ${f.name}`).join("\n")
              : "_Scratchpad is empty_",
          }
        }
        case "clear": {
          return {
            output: "Use the agent to clear scratchpad files selectively.",
            parts: [
              {
                type: "text",
                text: "Please help me clear the scratchpad directory. Which files should be removed?",
              },
            ],
          }
        }
        default:
          return { error: `Unknown action: ${action}` }
      }
    },
    "/scratchpad [list|clear]",
  )

  // /sync [push|pull] - Sync understanding
  register(
    "sync",
    "Sync shared understanding",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const action = ctx.args[0] || "status"

      switch (action) {
        case "push":
          await State.sync(root)
          return { output: "State synced to state.md" }
        case "pull": {
          const state = await State.read(root)
          return { output: state || "_No state to pull_" }
        }
        default: {
          const current = await State.read(root)
          return {
            output: current ? `**Current state:**\n\n${current}` : "_No shared state. Use /sync push to save._",
          }
        }
      }
    },
    "/sync [push|pull]",
  )

  // /knowledge [search] - Search knowledge directory
  register(
    "knowledge",
    "Search knowledge directory",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const query = ctx.rawArgs.trim()
      const files = await AFS.listDirectory(root, "knowledge", true)

      if (!query) {
        if (files.length === 0) {
          return { output: "_No files in knowledge/_" }
        }
        return {
          output: "**Knowledge files:**\n" + files.map((f) => `- ${f.relativePath}`).join("\n"),
        }
      }

      const matches = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))

      return {
        output: matches.length
          ? `**Matching files:**\n${matches.map((f) => `- ${f.relativePath}`).join("\n")}`
          : `_No files matching '${query}'_`,
      }
    },
    "/knowledge [search]",
  )

  // /afs - Show AFS status
  register(
    "afs",
    "Show AFS status",
    async () => {
      const status = await AFS.getStatus()
      if (!status.exists) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      let output = `**AFS Root:** ${status.root}\n\n`
      for (const dir of status.directories) {
        const policyIcon = dir.policy === "writable" ? "[W]" : dir.policy === "executable" ? "[X]" : "[R]"
        output += `${policyIcon} **${dir.name}/** - ${dir.fileCount} files\n`
      }

      return { output }
    },
    "/afs",
  )

  // /clear - Clear the conversation
  register(
    "clear",
    "Start a new session",
    async (ctx) => {
      return {
        output: "Starting new session...",
        parts: [
          {
            type: "action",
            action: "new_session",
          },
        ],
      }
    },
    "/clear",
  )

  // /session [info|list|rename] - Session management
  register(
    "session",
    "Manage current session",
    async (ctx) => {
      const action = ctx.args[0] || "info"

      switch (action) {
        case "info": {
          const session = await Session.get(ctx.sessionID)
          if (!session) {
            return { error: "Session not found" }
          }
          return {
            output: [
              `**Session:** ${session.title}`,
              `**ID:** ${session.id}`,
              `**Created:** ${new Date(session.time.created).toLocaleString()}`,
              session.time.archived ? `**Archived:** ${new Date(session.time.archived).toLocaleString()}` : null,
              session.share?.url ? `**Share URL:** ${session.share.url}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          }
        }
        case "list": {
          const sessions: Session.Info[] = []
          for await (const s of Session.list()) {
            if (s) sessions.push(s)
          }
          const recent = sessions.slice(0, 10)
          return {
            output:
              "**Recent sessions:**\n" +
              recent.map((s) => `- ${s.title} (${s.id.slice(0, 8)}...)`).join("\n") +
              (sessions.length > 10 ? `\n\n_...and ${sessions.length - 10} more_` : ""),
          }
        }
        case "rename": {
          const newTitle = ctx.args.slice(1).join(" ")
          if (!newTitle) {
            return { error: "Usage: /session rename <new title>" }
          }
          await Session.update(ctx.sessionID, (s) => {
            s.title = newTitle
          })
          return { output: `Session renamed to: ${newTitle}` }
        }
        case "share": {
          await Session.share(ctx.sessionID)
          const session = await Session.get(ctx.sessionID)
          return {
            output: session?.share?.url
              ? `**Share URL:** ${session.share.url}`
              : "Session shared successfully",
          }
        }
        default:
          return { error: `Unknown action: ${action}. Use info, list, rename, or share.` }
      }
    },
    "/session [info|list|rename|share] [args]",
  )

  // /todo [list|add|clear] - Manage todos
  register(
    "todo",
    "Manage session todos",
    async (ctx) => {
      const action = ctx.args[0] || "list"

      switch (action) {
        case "list": {
          const todos = await Todo.get(ctx.sessionID)
          if (!todos || todos.length === 0) {
            return { output: "_No todos in this session_" }
          }
          return {
            output:
              "**Todos:**\n" +
              todos
                .map((t) => {
                  const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : "○"
                  return `[${icon}] ${t.content}`
                })
                .join("\n"),
          }
        }
        case "add": {
          const content = ctx.args.slice(1).join(" ")
          if (!content) {
            return { error: "Usage: /todo add <task description>" }
          }
          return {
            output: `Adding todo: ${content}`,
            parts: [
              {
                type: "text",
                text: `Please add this to the todo list: ${content}`,
              },
            ],
          }
        }
        case "clear": {
          return {
            output: "Clearing completed todos...",
            parts: [
              {
                type: "text",
                text: "Please clear all completed todos from the list.",
              },
            ],
          }
        }
        default:
          return { error: `Unknown action: ${action}. Use list, add, or clear.` }
      }
    },
    "/todo [list|add|clear] [task]",
  )

  // /diff - Show file changes in session
  register(
    "diff",
    "Show file changes in current session",
    async (ctx) => {
      const diff = await Session.diff(ctx.sessionID)
      if (!diff || diff.length === 0) {
        return { output: "_No file changes in this session_" }
      }

      let output = "**Modified files:**\n"
      for (const file of diff) {
        const adds = file.additions ? `+${file.additions}` : ""
        const dels = file.deletions ? `-${file.deletions}` : ""
        output += `- ${file.file} ${adds} ${dels}\n`
      }
      return { output }
    },
    "/diff",
  )

  // /git [status|branch] - Git information
  register(
    "git",
    "Show git status and info",
    async (ctx) => {
      const action = ctx.args[0] || "branch"
      const branch = await Vcs.branch()

      switch (action) {
        case "status":
        case "branch": {
          if (!branch) {
            return { error: "Not a git repository" }
          }
          return {
            output: `**Current branch:** ${branch}`,
          }
        }
        default:
          return { error: `Unknown git action: ${action}. Use status or branch.` }
      }
    },
    "/git [status|branch]",
  )

  // /config [key] - View configuration
  register(
    "config",
    "View configuration",
    async (ctx) => {
      const key = ctx.args[0]
      const config = await Config.get()

      if (!key) {
        return {
          output: "**Current configuration:**\n```json\n" + JSON.stringify(config, null, 2) + "\n```",
        }
      }

      const value = (config as any)[key]
      if (value === undefined) {
        return { error: `Config key '${key}' not found` }
      }

      return {
        output: `**${key}:** ${typeof value === "object" ? JSON.stringify(value, null, 2) : value}`,
      }
    },
    "/config [key]",
  )

  // /model - Show current model info
  register(
    "model",
    "Show current model info",
    async () => {
      return {
        output: "Use the command palette (Ctrl+K) to switch models.",
        parts: [
          {
            type: "action",
            action: "show_models",
          },
        ],
      }
    },
    "/model",
  )

  // /compact - Trigger context compaction
  register(
    "compact",
    "Trigger context compaction",
    async (ctx) => {
      return {
        output: "Requesting context compaction...",
        parts: [
          {
            type: "action",
            action: "compact",
            sessionID: ctx.sessionID,
          },
        ],
      }
    },
    "/compact",
  )

  // /export - Export session
  register(
    "export",
    "Export session to file",
    async (ctx) => {
      const format = ctx.args[0] || "md"
      return {
        output: `Export session as ${format}. Use 'ocode export ${ctx.sessionID}' from terminal.`,
      }
    },
    "/export [format]",
  )

  // /undo - Undo last message
  register(
    "undo",
    "Undo last message",
    async (ctx) => {
      return {
        output: "Undoing last message...",
        parts: [
          {
            type: "action",
            action: "undo",
            sessionID: ctx.sessionID,
          },
        ],
      }
    },
    "/undo",
  )

  // /retry - Retry last message
  register(
    "retry",
    "Retry last message with different response",
    async (ctx) => {
      return {
        output: "Retrying last message...",
        parts: [
          {
            type: "action",
            action: "retry",
            sessionID: ctx.sessionID,
          },
        ],
      }
    },
    "/retry",
  )

  // /focus [file] - Focus on specific file
  register(
    "focus",
    "Focus conversation on specific file",
    async (ctx) => {
      const file = ctx.rawArgs.trim()
      if (!file) {
        return { error: "Usage: /focus <file path>" }
      }

      const resolvedPath = path.resolve(Instance.directory, file)
      return {
        output: `Focusing on ${file}`,
        parts: [
          {
            type: "text",
            text: `Please read and focus on this file: ${resolvedPath}`,
          },
        ],
      }
    },
    "/focus <file>",
  )

  // /search [query] - Search codebase
  register(
    "search",
    "Search codebase for pattern",
    async (ctx) => {
      const query = ctx.rawArgs.trim()
      if (!query) {
        return { error: "Usage: /search <pattern>" }
      }

      return {
        output: `Searching for: ${query}`,
        parts: [
          {
            type: "text",
            text: `Please search the codebase for "${query}" and show me the relevant results.`,
          },
        ],
      }
    },
    "/search <pattern>",
  )

  // /note [content] - Add note to scratchpad
  register(
    "note",
    "Add note to scratchpad",
    async (ctx) => {
      const content = ctx.rawArgs.trim()
      if (!content) {
        return { error: "Usage: /note <content>" }
      }

      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      return {
        output: `Adding note: ${content}`,
        parts: [
          {
            type: "text",
            text: `Please add the following note to a file in the scratchpad directory:\n\n${content}`,
          },
        ],
      }
    },
    "/note <content>",
  )

  // /fact [key] [value] - Add fact to shared state
  register(
    "fact",
    "Add fact to shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key || !value) {
        return { error: "Usage: /fact <key> <value>" }
      }

      await State.set(root, key, value, "facts")
      return { output: `Added fact: **${key}** = ${value}` }
    },
    "/fact <key> <value>",
  )

  // /assumption [key] [value] - Add assumption to shared state
  register(
    "assumption",
    "Add assumption to shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key || !value) {
        return { error: "Usage: /assumption <key> <value>" }
      }

      await State.set(root, key, value, "assumptions")
      return { output: `Added assumption: **${key}** = ${value}` }
    },
    "/assumption <key> <value>",
  )

  // /goal [key] [value] - Add goal to shared state
  register(
    "goal",
    "Add goal to shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key || !value) {
        return { error: "Usage: /goal <key> <value>" }
      }

      await State.set(root, key, value, "goals")
      return { output: `Added goal: **${key}** = ${value}` }
    },
    "/goal <key> <value>",
  )

  // /decision [key] [value] - Add decision to shared state
  register(
    "decision",
    "Add decision to shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key || !value) {
        return { error: "Usage: /decision <key> <value>" }
      }

      await State.set(root, key, value, "decisions")
      return { output: `Added decision: **${key}** = ${value}` }
    },
    "/decision <key> <value>",
  )

  // /uncertainty [key] [value] - Add uncertainty to shared state
  register(
    "uncertainty",
    "Add uncertainty/question to shared state",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized" }
      }

      const key = ctx.args[0]
      const value = ctx.args.slice(1).join(" ")

      if (!key || !value) {
        return { error: "Usage: /uncertainty <key> <value>" }
      }

      await State.set(root, key, value, "uncertainties")
      return { output: `Added uncertainty: **${key}** = ${value}` }
    },
    "/uncertainty <key> <value>",
  )

  // /whoami - Show current agent and model
  register(
    "whoami",
    "Show current agent and model info",
    async () => {
      const agents = await Agent.list()
      const primary = agents.find((a) => a.mode === "primary")
      return {
        output: [
          `**Current Agent:** @${primary?.name || "default"}`,
          primary?.description ? `**Description:** ${primary.description}` : null,
          `**Available Agents:** ${agents.map((a) => `@${a.name}`).join(", ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      }
    },
    "/whoami",
  )

  // /workspace - Show workspace info
  register(
    "workspace",
    "Show workspace information",
    async () => {
      const branch = await Vcs.branch()
      const afs = await AFS.getStatus()

      return {
        output: [
          `**Directory:** ${Instance.directory}`,
          branch ? `**Git Branch:** ${branch}` : null,
          afs.exists ? `**AFS:** Initialized (${afs.directories.length} directories)` : "**AFS:** Not initialized",
        ]
          .filter(Boolean)
          .join("\n"),
      }
    },
    "/workspace",
  )

  // /cognitive [status|reset|goal|strategy] - Manage cognitive protocol state
  register(
    "cognitive",
    "View and manage cognitive protocol state (metacognition + goals)",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      const action = ctx.args[0] || "status"

      switch (action) {
        case "status": {
          const metaState = await Metacognition.read(root)
          const goalHierarchy = await Goals.read(root)

          if (!metaState && !goalHierarchy) {
            return { output: "_No cognitive state recorded yet. Start working to generate metrics._" }
          }

          let output = "**Cognitive Protocol Status**\n\n"

          if (metaState) {
            const summary = Metacognition.getStatusSummary(metaState)
            output += "## Metacognition\n"
            output += `- **Strategy:** ${summary.strategy}\n`
            output += `- **Progress:** ${summary.progress}\n`
            output += `- **Cognitive Load:** ${summary.cognitiveLoad}%\n`
            output += `- **Strategy Effectiveness:** ${(summary.strategyEffectiveness * 100).toFixed(0)}%\n`
            output += `- **Flow State:** ${summary.flowState ? "Active" : "Inactive"}\n`
            output += `- **Frustration Level:** ${(summary.frustration * 100).toFixed(0)}%\n`

            if (summary.isSpinning) {
              output += `\n⚠️ **Warning:** Spinning detected - consider changing approach\n`
            }
            if (summary.shouldSeekHelp) {
              output += `\n⚠️ **Note:** High uncertainty - consider asking for clarification\n`
            }
          }

          if (goalHierarchy?.primaryGoal) {
            const goalSummary = Goals.getStatusSummary(goalHierarchy)
            const activeSubgoals = goalHierarchy.subgoals.filter((g) => g.status === "in_progress").length
            output += "\n## Goals\n"
            output += `- **Primary Goal:** ${goalSummary.primaryGoal}\n`
            output += `- **Progress:** ${goalSummary.completionPercentage.toFixed(0)}%\n`
            output += `- **Active Subgoals:** ${activeSubgoals}\n`
            output += `- **Completed:** ${goalSummary.completedSubgoals}\n`
            if (goalSummary.currentFocus && goalSummary.currentFocus !== goalSummary.primaryGoal) {
              output += `- **Current Focus:** ${goalSummary.currentFocus}\n`
            }
            if (goalSummary.unresolvedConflicts > 0) {
              output += `\n⚠️ **Warning:** ${goalSummary.unresolvedConflicts} unresolved goal conflict(s)\n`
            }
          }

          // Show recommendations
          const recommendations = await CognitiveIntegration.getRecommendations()
          if (recommendations.length > 0) {
            output += "\n## Recommendations\n"
            for (const rec of recommendations) {
              output += `- ${rec}\n`
            }
          }

          return { output }
        }

        case "reset": {
          await CognitiveIntegration.reset()
          return { output: "Cognitive state has been reset." }
        }

        case "goal": {
          const goalText = ctx.args.slice(1).join(" ")
          if (!goalText) {
            // Show current goal
            const goalHierarchy = await Goals.read(root)
            if (!goalHierarchy?.primaryGoal) {
              return { output: "_No primary goal set. Use `/cognitive goal <description>` to set one._" }
            }
            return {
              output: `**Current Goal:** ${goalHierarchy.primaryGoal.description}\n**Progress:** ${(goalHierarchy.primaryGoal.progress * 100).toFixed(0)}%`,
            }
          }

          // Set new goal
          await CognitiveIntegration.setGoalFromMessage(goalText)
          return { output: `Primary goal set: ${goalText}` }
        }

        case "strategy": {
          const strategyName = ctx.args[1] as Metacognition.Strategy | undefined
          const validStrategies: Metacognition.Strategy[] = [
            "incremental",
            "divide_and_conquer",
            "depth_first",
            "breadth_first",
            "research_first",
            "prototype",
          ]

          if (!strategyName) {
            // Show current strategy
            const metaState = await Metacognition.read(root)
            if (!metaState) {
              return { output: "_No metacognition state. Available strategies: " + validStrategies.join(", ") }
            }
            return {
              output: `**Current Strategy:** ${metaState.currentStrategy}\n**Effectiveness:** ${(metaState.strategyEffectiveness * 100).toFixed(0)}%\n\nAvailable: ${validStrategies.join(", ")}`,
            }
          }

          if (!validStrategies.includes(strategyName)) {
            return { error: `Invalid strategy. Available: ${validStrategies.join(", ")}` }
          }

          await Metacognition.setStrategy(root, strategyName)
          return { output: `Strategy changed to: ${strategyName}` }
        }

        case "flow": {
          const metaState = await Metacognition.read(root)
          if (!metaState) {
            return { output: "_No metacognition state recorded yet._" }
          }

          const { inFlow } = await Metacognition.checkFlowState(root)
          return {
            output: inFlow
              ? "**Flow State:** Active\n\nOperating autonomously with high effectiveness."
              : "**Flow State:** Inactive\n\nConditions for flow not met. Check cognitive load and progress.",
          }
        }

        default:
          return { error: `Unknown action: ${action}. Use status, reset, goal, strategy, or flow.` }
      }
    },
    "/cognitive [status|reset|goal|strategy|flow] [args]",
  )

  // /knowledge - Epistemic state management (facts, assumptions, unknowns)
  register(
    "knowledge",
    "View and manage knowledge state (facts, assumptions, unknowns, contradictions)",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      const action = ctx.args[0] || "status"

      switch (action) {
        case "status": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state recorded yet._" }
          }

          const summary = Epistemic.getStatusSummary(state)
          let output = "**Knowledge State**\n\n"

          output += `## Facts\n`
          output += `- **Golden:** ${summary.goldenFactCount}/${summary.maxGoldenFacts} (essential, persistent)\n`
          output += `- **Working:** ${summary.workingFactCount}/${summary.maxWorkingFacts} (${summary.avgConfidence}% avg confidence)\n`

          output += `\n## Assumptions\n`
          output += `- **Total:** ${summary.assumptionCount}\n`
          if (summary.unvalidatedCount > 0) {
            output += `- **Unvalidated:** ${summary.unvalidatedCount} (need verification)\n`
          }

          output += `\n## Unknowns\n`
          output += `- **Total:** ${summary.unknownCount}\n`
          if (summary.criticalUnknowns > 0) {
            output += `- **Critical:** ${summary.criticalUnknowns} (blocking progress)\n`
          }

          if (summary.contradictionCount > 0) {
            output += `\n⚠️ **Contradictions:** ${summary.contradictionCount} unresolved\n`
          }

          return { output }
        }

        case "facts": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          const tier = ctx.args[1] // "golden" or "working" or undefined
          const filter = ctx.args[2] // optional pattern filter

          let output = ""

          if (!tier || tier === "golden") {
            const goldenFacts = Object.values(state.goldenFacts)
            output += `**Golden Facts (${goldenFacts.length}/${state.settings.maxGoldenFacts}):**\n`
            if (goldenFacts.length === 0) {
              output += "_None_\n"
            } else {
              for (const fact of goldenFacts) {
                if (filter && !fact.key.includes(filter)) continue
                output += `- ★ \`${fact.key}\` = ${JSON.stringify(fact.value)} [${fact.category}]\n`
              }
            }
          }

          if (!tier || tier === "working") {
            const workingFacts = Object.values(state.workingFacts)
            if (output) output += "\n"
            output += `**Working Facts (${workingFacts.length}/${state.settings.maxWorkingFacts}):**\n`
            if (workingFacts.length === 0) {
              output += "_None_\n"
            } else {
              // Sort by confidence descending
              workingFacts.sort((a, b) => b.confidence - a.confidence)
              for (const fact of workingFacts.slice(0, 20)) {
                if (filter && !fact.key.includes(filter)) continue
                const conf = Math.round(fact.confidence * 100)
                output += `- \`${fact.key}\` = ${JSON.stringify(fact.value)} (${conf}%)\n`
              }
              if (workingFacts.length > 20) {
                output += `\n_...and ${workingFacts.length - 20} more_\n`
              }
            }
          }

          return { output }
        }

        case "assumptions": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          const assumptions = Object.values(state.assumptions)
          if (assumptions.length === 0) {
            return { output: "_No assumptions recorded._" }
          }

          let output = `**Assumptions (${assumptions.length}):**\n\n`
          for (const a of assumptions) {
            const status = a.needsValidation ? "⚠️ unvalidated" : "✓ validated"
            output += `- \`${a.key}\` = ${JSON.stringify(a.value)}\n`
            output += `  Basis: ${a.basis} | ${status}\n`
          }

          return { output }
        }

        case "unknowns": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          if (state.unknowns.length === 0) {
            return { output: "_No unknowns recorded._" }
          }

          let output = `**Unknowns (${state.unknowns.length}):**\n\n`
          const importanceIcons = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" }
          for (const u of state.unknowns) {
            output += `${importanceIcons[u.importance]} **${u.topic}** [${u.importance}]\n`
            if (u.suggestedResolution) {
              output += `  Suggestion: ${u.suggestedResolution}\n`
            }
          }

          return { output }
        }

        case "contradictions": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          const unresolved = Epistemic.getUnresolvedContradictions(state)
          if (unresolved.length === 0) {
            return { output: "✓ No unresolved contradictions." }
          }

          let output = `**Unresolved Contradictions (${unresolved.length}):**\n\n`
          for (const c of unresolved) {
            output += `- **${c.description}** [${c.severity}]\n`
            output += `  Facts: ${c.factKeys.join(", ")}\n`
            output += `  ID: ${c.id}\n`
          }

          return { output }
        }

        case "fact": {
          // /knowledge fact <key> <value> [confidence] [source]
          const key = ctx.args[1]
          const valueStr = ctx.args[2]
          const confidenceStr = ctx.args[3]
          const sourceStr = ctx.args[4] as Epistemic.KnowledgeSource | undefined

          if (!key || !valueStr) {
            return { error: "Usage: /knowledge fact <key> <value> [confidence] [source]\n\nKey format: category.subcategory.name (e.g., config.typescript.strict)" }
          }

          // Parse value (try JSON, fallback to string)
          let value: unknown
          try {
            value = JSON.parse(valueStr)
          } catch {
            value = valueStr
          }

          const confidence = confidenceStr ? parseFloat(confidenceStr) : 0.8
          const source = sourceStr || "user_stated"

          await Epistemic.addWorkingFact(root, key, value, confidence, source as Epistemic.KnowledgeSource)
          return { output: `Added working fact: \`${key}\` = ${JSON.stringify(value)} (${Math.round(confidence * 100)}%)` }
        }

        case "golden": {
          // /knowledge golden <key> <value> <category> <reason>
          const key = ctx.args[1]
          const valueStr = ctx.args[2]
          const category = ctx.args[3] as Epistemic.GoldenCategory | undefined
          const reason = ctx.args.slice(4).join(" ")

          if (!key || !valueStr || !category || !reason) {
            return { error: "Usage: /knowledge golden <key> <value> <category> <reason>\n\nCategories: architecture, constraints, user_preference, project_identity" }
          }

          const validCategories = ["architecture", "constraints", "user_preference", "project_identity"]
          if (!validCategories.includes(category)) {
            return { error: `Invalid category. Must be one of: ${validCategories.join(", ")}` }
          }

          let value: unknown
          try {
            value = JSON.parse(valueStr)
          } catch {
            value = valueStr
          }

          await Epistemic.addGoldenFactDirect(root, key, value, category, reason)
          return { output: `Added golden fact: ★ \`${key}\` = ${JSON.stringify(value)} [${category}]` }
        }

        case "assume": {
          // /knowledge assume <key> <value> <basis>
          const key = ctx.args[1]
          const valueStr = ctx.args[2]
          const basis = ctx.args.slice(3).join(" ")

          if (!key || !valueStr || !basis) {
            return { error: "Usage: /knowledge assume <key> <value> <basis>" }
          }

          let value: unknown
          try {
            value = JSON.parse(valueStr)
          } catch {
            value = valueStr
          }

          await Epistemic.addAssumption(root, key, value, basis)
          return { output: `Added assumption: \`${key}\` = ${JSON.stringify(value)}\nBasis: ${basis}` }
        }

        case "unknown": {
          // /knowledge unknown <topic> [importance]
          const topic = ctx.args[1]
          const importance = (ctx.args[2] || "medium") as Epistemic.Importance

          if (!topic) {
            return { error: "Usage: /knowledge unknown <topic> [critical|high|medium|low]" }
          }

          const validImportance = ["critical", "high", "medium", "low"]
          if (!validImportance.includes(importance)) {
            return { error: `Invalid importance. Must be one of: ${validImportance.join(", ")}` }
          }

          await Epistemic.addUnknown(root, topic, importance)
          return { output: `Added unknown: **${topic}** [${importance}]` }
        }

        case "promote": {
          // /knowledge promote <key> <category> <reason>
          const key = ctx.args[1]
          const category = ctx.args[2] as Epistemic.GoldenCategory | undefined
          const reason = ctx.args.slice(3).join(" ")

          if (!key || !category || !reason) {
            return { error: "Usage: /knowledge promote <key> <category> <reason>" }
          }

          try {
            await Epistemic.promoteToGolden(root, key, category, reason)
            return { output: `Promoted to golden: ★ \`${key}\` [${category}]` }
          } catch (e) {
            return { error: (e as Error).message }
          }
        }

        case "demote": {
          // /knowledge demote <key>
          const key = ctx.args[1]
          if (!key) {
            return { error: "Usage: /knowledge demote <key>" }
          }

          try {
            await Epistemic.demoteFromGolden(root, key)
            return { output: `Demoted from golden: \`${key}\` (now working fact)` }
          } catch (e) {
            return { error: (e as Error).message }
          }
        }

        case "validate": {
          // /knowledge validate <key>
          const key = ctx.args[1]
          if (!key) {
            return { error: "Usage: /knowledge validate <assumption-key>" }
          }

          try {
            await Epistemic.validateAssumption(root, key)
            return { output: `Validated assumption: \`${key}\` (promoted to working fact)` }
          } catch (e) {
            return { error: (e as Error).message }
          }
        }

        case "invalidate": {
          // /knowledge invalidate <key>
          const key = ctx.args[1]
          if (!key) {
            return { error: "Usage: /knowledge invalidate <key>" }
          }

          const state = await Epistemic.read(root)
          if (!state) {
            return { error: "No knowledge state" }
          }

          // Try to remove from assumptions first, then working facts
          if (await Epistemic.invalidateAssumption(root, key)) {
            return { output: `Invalidated assumption: \`${key}\`` }
          }
          if (await Epistemic.removeWorkingFact(root, key)) {
            return { output: `Removed working fact: \`${key}\`` }
          }

          return { error: `Key '${key}' not found in assumptions or working facts` }
        }

        case "resolve": {
          // /knowledge resolve <topic-or-id> <resolution>
          const target = ctx.args[1]
          const resolution = ctx.args.slice(2).join(" ")

          if (!target || !resolution) {
            return { error: "Usage: /knowledge resolve <unknown-topic|contradiction-id> <resolution>" }
          }

          // Try resolving as unknown first
          if (await Epistemic.resolveUnknown(root, target, resolution)) {
            return { output: `Resolved unknown: **${target}**\nResolution: ${resolution}` }
          }

          // Try resolving as contradiction
          if (await Epistemic.resolveContradiction(root, target, resolution)) {
            return { output: `Resolved contradiction: ${target}\nResolution: ${resolution}` }
          }

          return { error: `Unknown or contradiction '${target}' not found` }
        }

        case "prune": {
          const pruned = await Epistemic.pruneWorkingFacts(root)
          return { output: `Pruned ${pruned} low-confidence facts.` }
        }

        case "decay": {
          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          const workingFacts = Object.values(state.workingFacts)
          if (workingFacts.length === 0) {
            return { output: "_No working facts to decay._" }
          }

          // Show facts sorted by confidence (lowest first = most decayed)
          workingFacts.sort((a, b) => a.confidence - b.confidence)

          let output = "**Decay Status (lowest confidence first):**\n\n"
          for (const fact of workingFacts.slice(0, 10)) {
            const conf = Math.round(fact.confidence * 100)
            const lastValidated = new Date(fact.lastValidated)
            const hoursAgo = Math.round((Date.now() - lastValidated.getTime()) / (1000 * 60 * 60) * 10) / 10
            output += `- \`${fact.key}\` (${conf}%) - validated ${hoursAgo}h ago\n`
          }

          if (workingFacts.length > 10) {
            output += `\n_...and ${workingFacts.length - 10} more_\n`
          }

          output += `\nDecay rate: ${state.settings.decayRatePerHour * 100}% per hour`
          output += `\nPrune threshold: ${state.settings.pruneThreshold * 100}%`

          return { output }
        }

        case "settings": {
          const key = ctx.args[1]
          const value = ctx.args[2]

          const state = await Epistemic.read(root)
          if (!state) {
            return { output: "_No knowledge state._" }
          }

          if (!key) {
            // Show current settings
            let output = "**Epistemic Settings:**\n\n"
            output += `- autoRecordFromTools: ${state.settings.autoRecordFromTools}\n`
            output += `- autoDetectContradictions: ${state.settings.autoDetectContradictions}\n`
            output += `- minConfidenceForAutoRecord: ${state.settings.minConfidenceForAutoRecord}\n`
            output += `- decayRatePerHour: ${state.settings.decayRatePerHour}\n`
            output += `- pruneThreshold: ${state.settings.pruneThreshold}\n`
            output += `- maxGoldenFacts: ${state.settings.maxGoldenFacts}\n`
            output += `- maxWorkingFacts: ${state.settings.maxWorkingFacts}\n`
            return { output }
          }

          // Update setting
          const validKeys = ["autoRecordFromTools", "autoDetectContradictions", "minConfidenceForAutoRecord", "decayRatePerHour", "pruneThreshold"]
          if (!validKeys.includes(key)) {
            return { error: `Invalid setting. Valid: ${validKeys.join(", ")}` }
          }

          let parsedValue: boolean | number
          if (value === "true" || value === "on") {
            parsedValue = true
          } else if (value === "false" || value === "off") {
            parsedValue = false
          } else {
            parsedValue = parseFloat(value)
            if (isNaN(parsedValue)) {
              return { error: "Value must be true/false/on/off or a number" }
            }
          }

          await Epistemic.updateSettings(root, { [key]: parsedValue })
          return { output: `Updated setting: ${key} = ${parsedValue}` }
        }

        case "reset": {
          const scope = (ctx.args[1] || "all") as "golden" | "working" | "all"
          const validScopes = ["golden", "working", "all"]
          
          if (!validScopes.includes(scope)) {
            return { error: `Invalid scope. Must be one of: ${validScopes.join(", ")}` }
          }

          await Epistemic.reset(root, scope)
          return { output: `Reset epistemic state (scope: ${scope})` }
        }

        default:
          return {
            error: `Unknown action: ${action}\n\nAvailable actions:\n` +
              `- status: Show summary\n` +
              `- facts [golden|working] [filter]: List facts\n` +
              `- assumptions: List assumptions\n` +
              `- unknowns: List unknowns\n` +
              `- contradictions: Show contradictions\n` +
              `- fact <key> <value> [confidence] [source]: Add working fact\n` +
              `- golden <key> <value> <category> <reason>: Add golden fact\n` +
              `- assume <key> <value> <basis>: Add assumption\n` +
              `- unknown <topic> [importance]: Add unknown\n` +
              `- promote <key> <category> <reason>: Promote to golden\n` +
              `- demote <key>: Demote from golden\n` +
              `- validate <key>: Validate assumption\n` +
              `- invalidate <key>: Remove fact/assumption\n` +
              `- resolve <topic|id> <resolution>: Resolve unknown/contradiction\n` +
              `- prune: Remove low-confidence facts\n` +
              `- decay: Show decay status\n` +
              `- settings [key] [value]: View/modify settings\n` +
              `- reset [golden|working|all]: Clear state`,
          }
      }
    },
    "/knowledge [action] [args]",
  )

  // /emotions - Emotional valence management
  register(
    "emotions",
    "View and manage emotional state (fears, curiosities, satisfactions, frustrations)",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      const action = ctx.args[0] || "status"

      // Mood emoji mapping
      const moodEmoji: Record<Emotions.Mood, string> = {
        positive: "😊",
        neutral: "😐",
        negative: "😔",
        anxious: "😰",
        confident: "🎯",
        frustrated: "😤",
        curious: "🤔",
        excited: "✨",
        determined: "💪",
        cautious: "🔍",
        relieved: "😌",
      }

      // Category emoji mapping
      const categoryEmoji: Record<Emotions.EmotionCategory, string> = {
        fear: "😨",
        curiosity: "🤔",
        satisfaction: "✓",
        frustration: "😤",
        excitement: "✨",
        determination: "💪",
        caution: "🔍",
        relief: "😌",
      }

      switch (action) {
        case "status": {
          const state = await Emotions.read(root)
          if (!state) {
            return { output: "_No emotional state recorded yet. Emotions will be detected automatically during work._" }
          }

          const summary = Emotions.getStatusSummary(state)
          let output = "**Emotional State**\n\n"

          output += `## Session\n`
          output += `- **Mood:** ${moodEmoji[summary.mood]} ${summary.mood}\n`
          output += `- **Anxiety:** ${summary.anxietyLevel}%${summary.isAnxious ? " ⚠️ HIGH" : ""}\n`
          output += `- **Confidence:** ${summary.confidenceLevel}%${summary.isConfident ? " ✓" : ""}\n`

          output += `\n## Emotions\n`
          output += `- **Fears:** ${summary.fearCount}\n`
          output += `- **Curiosities:** ${summary.curiosityCount}\n`
          output += `- **Satisfactions:** ${summary.satisfactionCount}\n`
          output += `- **Frustrations:** ${summary.frustrationCount}\n`

          if (summary.recentEmotionCount > 0) {
            output += `\n_${summary.recentEmotionCount} emotions recorded this session_\n`
          }

          return { output }
        }

        case "mood": {
          const moodArg = ctx.args[1]
          
          if (moodArg === "history") {
            const history = await Emotions.getMoodHistory(root)
            if (history.length === 0) {
              return { output: "_No mood history yet._" }
            }
            
            let output = "**Mood History:**\n\n"
            for (const entry of history.slice(0, 20)) {
              const time = new Date(entry.timestamp).toLocaleTimeString()
              output += `- ${moodEmoji[entry.mood]} ${entry.mood} @ ${time}`
              if (entry.trigger) {
                output += ` (${entry.trigger})`
              }
              output += "\n"
            }
            return { output }
          }

          if (!moodArg) {
            const state = await Emotions.read(root)
            if (!state) {
              return { output: "_No emotional state._" }
            }
            return { output: `**Current Mood:** ${moodEmoji[state.session.mood]} ${state.session.mood}` }
          }

          const validMoods = Emotions.Mood.options
          if (!validMoods.includes(moodArg as Emotions.Mood)) {
            return { error: `Invalid mood. Valid moods: ${validMoods.join(", ")}` }
          }

          const trigger = ctx.args.slice(2).join(" ") || undefined
          await Emotions.updateMood(root, moodArg as Emotions.Mood, trigger)
          return { output: `Mood updated: ${moodEmoji[moodArg as Emotions.Mood]} ${moodArg}` }
        }

        case "anxiety": {
          const delta = parseFloat(ctx.args[1] || "0")
          if (isNaN(delta)) {
            const state = await Emotions.read(root)
            return { output: `**Anxiety Level:** ${state?.session.anxietyLevel || 30}%` }
          }
          const newLevel = await Emotions.adjustAnxiety(root, delta)
          return { output: `Anxiety ${delta >= 0 ? "increased" : "decreased"}: ${newLevel}%` }
        }

        case "confidence": {
          const delta = parseFloat(ctx.args[1] || "0")
          if (isNaN(delta)) {
            const state = await Emotions.read(root)
            return { output: `**Confidence Level:** ${state?.session.confidenceLevel || 50}%` }
          }
          const newLevel = await Emotions.adjustConfidence(root, delta)
          return { output: `Confidence ${delta >= 0 ? "increased" : "decreased"}: ${newLevel}%` }
        }

        case "record": {
          const category = ctx.args[1] as Emotions.EmotionCategory
          const trigger = ctx.args.slice(2, -1).join(" ")
          const intensityArg = ctx.args[ctx.args.length - 1]
          
          // Check if last arg is a number (intensity) or part of trigger
          let intensity = parseInt(intensityArg)
          let fullTrigger = trigger
          if (isNaN(intensity)) {
            intensity = 5 // default
            fullTrigger = ctx.args.slice(2).join(" ")
          }

          if (!category || !fullTrigger) {
            return { error: "Usage: /emotions record <fear|curiosity|satisfaction|frustration> <description> [intensity]" }
          }

          const validCategories = Emotions.EmotionCategory.options
          if (!validCategories.includes(category)) {
            return { error: `Invalid category. Valid: ${validCategories.join(", ")}` }
          }

          const emotion = await Emotions.addEmotion(root, category, fullTrigger, "Manual recording", intensity)
          return { output: `${categoryEmoji[category]} Recorded ${category}: "${fullTrigger}" (intensity: ${intensity})` }
        }

        case "list": {
          const category = ctx.args[1] as Emotions.EmotionCategory | undefined
          const state = await Emotions.read(root)
          if (!state) {
            return { output: "_No emotional state._" }
          }

          const validCategories = Emotions.EmotionCategory.options
          if (category && !validCategories.includes(category)) {
            return { error: `Invalid category. Valid: ${validCategories.join(", ")}, or omit for all` }
          }

          const categoriesToShow = category ? [category] : validCategories
          let output = ""

          for (const cat of categoriesToShow) {
            const emotions = await Emotions.getEmotionsByCategory(root, cat)
            if (emotions.length === 0) continue

            output += `\n**${categoryEmoji[cat]} ${cat.charAt(0).toUpperCase() + cat.slice(1)}s:**\n`
            for (const emotion of emotions.slice(0, 10)) {
              const age = Math.round((Date.now() - new Date(emotion.timestamp).getTime()) / (1000 * 60 * 60))
              output += `- [${emotion.intensity}/10] ${emotion.trigger}`
              if (age > 0) {
                output += ` (${age}h ago)`
              }
              output += "\n"
              if (emotion.relatedEmotionIds?.length) {
                output += `  ↳ linked to ${emotion.relatedEmotionIds.length} other emotion(s)\n`
              }
            }
            if (emotions.length > 10) {
              output += `  _...and ${emotions.length - 10} more_\n`
            }
          }

          return { output: output || "_No emotions recorded._" }
        }

        case "recent": {
          const limit = parseInt(ctx.args[1] || "10")
          const emotions = await Emotions.getRecentEmotions(root, limit)
          
          if (emotions.length === 0) {
            return { output: "_No recent emotions._" }
          }

          let output = "**Recent Emotions:**\n\n"
          for (const emotion of emotions) {
            const time = new Date(emotion.timestamp).toLocaleString()
            output += `- ${categoryEmoji[emotion.category]} [${emotion.intensity}/10] ${emotion.trigger}\n`
            output += `  ${time}\n`
          }
          return { output }
        }

        case "adjust": {
          const id = ctx.args[1]
          const intensity = parseInt(ctx.args[2])

          if (!id || isNaN(intensity)) {
            return { error: "Usage: /emotions adjust <id> <intensity>" }
          }

          if (intensity < 1 || intensity > 10) {
            return { error: "Intensity must be between 1 and 10" }
          }

          const success = await Emotions.updateEmotionIntensity(root, id, intensity)
          if (!success) {
            return { error: `Emotion with ID '${id}' not found` }
          }
          return { output: `Updated emotion intensity to ${intensity}` }
        }

        case "remove": {
          const id = ctx.args[1]
          if (!id) {
            return { error: "Usage: /emotions remove <id>" }
          }

          const success = await Emotions.removeEmotion(root, id)
          if (!success) {
            return { error: `Emotion with ID '${id}' not found` }
          }
          return { output: "Emotion removed" }
        }

        case "link": {
          const sourceId = ctx.args[1]
          const targetId = ctx.args[2]
          
          if (!sourceId || !targetId) {
            return { error: "Usage: /emotions link <source-id> <target-id>" }
          }

          const success = await Emotions.linkEmotions(root, sourceId, targetId)
          if (!success) {
            return { error: "Failed to link emotions. Check that source ID exists." }
          }
          return { output: "Emotions linked successfully" }
        }

        case "search": {
          const searchText = ctx.args.slice(1).join(" ")
          if (!searchText) {
            return { error: "Usage: /emotions search <text>" }
          }

          const results = await Emotions.searchByTrigger(root, searchText)
          if (results.length === 0) {
            return { output: `_No emotions found matching "${searchText}"_` }
          }

          let output = `**Search results for "${searchText}":**\n\n`
          for (const emotion of results.slice(0, 10)) {
            output += `- ${categoryEmoji[emotion.category]} [${emotion.intensity}/10] ${emotion.trigger}\n`
            output += `  ID: ${emotion.id}\n`
          }
          return { output }
        }

        case "decay": {
          const result = await Emotions.applyDecay(root)
          return { output: `Decay applied: ${result.decayed} emotions decayed, ${result.pruned} pruned` }
        }

        case "settings": {
          const key = ctx.args[1]
          const value = ctx.args[2]

          const settings = await Emotions.getSettings(root)

          if (!key) {
            let output = "**Emotional Settings:**\n\n"
            output += `- enableAutoDetection: ${settings.enableAutoDetection}\n`
            output += `- anxietyThreshold: ${settings.anxietyThreshold}\n`
            output += `- confidenceThreshold: ${settings.confidenceThreshold}\n`
            output += `- maxPerCategory: ${settings.maxPerCategory}\n`
            output += `- maxMoodHistory: ${settings.maxMoodHistory}\n`
            output += `\nDecay rates (per hour):\n`
            output += `- fear: ${settings.decayRates.fear}\n`
            output += `- curiosity: ${settings.decayRates.curiosity}\n`
            output += `- satisfaction: ${settings.decayRates.satisfaction}\n`
            output += `- frustration: ${settings.decayRates.frustration}\n`
            return { output }
          }

          const validKeys = ["enableAutoDetection", "anxietyThreshold", "confidenceThreshold", "maxPerCategory"]
          if (!validKeys.includes(key)) {
            return { error: `Invalid setting. Valid: ${validKeys.join(", ")}` }
          }

          let parsedValue: boolean | number
          if (value === "true" || value === "on") {
            parsedValue = true
          } else if (value === "false" || value === "off") {
            parsedValue = false
          } else {
            parsedValue = parseFloat(value)
            if (isNaN(parsedValue)) {
              return { error: "Value must be true/false/on/off or a number" }
            }
          }

          await Emotions.updateSettings(root, { [key]: parsedValue })
          return { output: `Updated setting: ${key} = ${parsedValue}` }
        }

        case "reset": {
          const scope = ctx.args[1] as Emotions.EmotionCategory | "all" | "session" | undefined

          if (scope && !["all", "session", ...Emotions.EmotionCategory.options].includes(scope)) {
            return { error: `Invalid scope. Valid: all, session, ${Emotions.EmotionCategory.options.join(", ")}` }
          }

          await Emotions.reset(root, scope || "session")
          return { output: `Reset emotional state (scope: ${scope || "session"})` }
        }

        default:
          return {
            error: `Unknown action: ${action}\n\nAvailable actions:\n` +
              `- status: Show emotional state summary\n` +
              `- mood [mood] [trigger]: Get/set current mood\n` +
              `- mood history: Show mood history\n` +
              `- anxiety [+/-delta]: Get/adjust anxiety level\n` +
              `- confidence [+/-delta]: Get/adjust confidence level\n` +
              `- record <category> <description> [intensity]: Record emotion\n` +
              `- list [category]: List emotions\n` +
              `- recent [limit]: Show recent emotions\n` +
              `- adjust <id> <intensity>: Adjust emotion intensity\n` +
              `- remove <id>: Remove emotion\n` +
              `- link <source-id> <target-id>: Link related emotions\n` +
              `- search <text>: Search emotions by trigger\n` +
              `- decay: Manually trigger decay\n` +
              `- settings [key] [value]: View/modify settings\n` +
              `- reset [all|session|category]: Reset emotional state`,
          }
      }
    },
    "/emotions [action] [args]",
  )

  // /analysis - Analysis triggers management
  register(
    "analysis",
    "Manage analysis triggers for automatic subagent invocation",
    async (ctx) => {
      const root = await AFS.findRoot()
      if (!root) {
        return { error: "AFS not initialized. Run 'ocode afs init' first." }
      }

      const action = ctx.args[0] || "triggers"

      switch (action) {
        case "triggers": {
          const subAction = ctx.args[1] || "list"

          switch (subAction) {
            case "list": {
              const triggers = await AnalysisTriggers.getTriggers(root)
              if (triggers.length === 0) {
                return { output: "_No triggers configured. Use `/analysis triggers reset` to load defaults._" }
              }

              let output = "**Analysis Triggers:**\n\n"
              for (const trigger of triggers) {
                const status = trigger.enabled ? "✓" : "✗"
                const auto = trigger.autoAccept ? " [auto]" : ""
                output += `${status} **${trigger.name}**${auto}\n`
                output += `  ID: \`${trigger.id}\`\n`
                output += `  ${trigger.description}\n`
                output += `  Priority: ${trigger.priority} | Cooldown: ${trigger.cooldownMinutes}min\n`
                if (trigger.lastTriggered) {
                  const ago = Math.round((Date.now() - new Date(trigger.lastTriggered).getTime()) / 60000)
                  output += `  Last triggered: ${ago}min ago\n`
                }
                output += "\n"
              }
              return { output }
            }

            case "enable": {
              const triggerId = ctx.args[2]
              if (!triggerId) {
                return { error: "Usage: /analysis triggers enable <trigger-id>" }
              }
              const success = await AnalysisTriggers.enableTrigger(root, triggerId)
              if (!success) {
                return { error: `Trigger '${triggerId}' not found` }
              }
              return { output: `Enabled trigger: ${triggerId}` }
            }

            case "disable": {
              const triggerId = ctx.args[2]
              if (!triggerId) {
                return { error: "Usage: /analysis triggers disable <trigger-id>" }
              }
              const success = await AnalysisTriggers.disableTrigger(root, triggerId)
              if (!success) {
                return { error: `Trigger '${triggerId}' not found` }
              }
              return { output: `Disabled trigger: ${triggerId}` }
            }

            case "cooldown": {
              const triggerId = ctx.args[2]
              const cooldown = parseInt(ctx.args[3])
              if (!triggerId || isNaN(cooldown)) {
                return { error: "Usage: /analysis triggers cooldown <trigger-id> <minutes>" }
              }
              const success = await AnalysisTriggers.setCooldown(root, triggerId, cooldown)
              if (!success) {
                return { error: `Trigger '${triggerId}' not found` }
              }
              return { output: `Set cooldown for ${triggerId}: ${cooldown}min` }
            }

            case "auto": {
              const triggerId = ctx.args[2]
              const autoAccept = ctx.args[3] === "on" || ctx.args[3] === "true"
              if (!triggerId || !ctx.args[3]) {
                return { error: "Usage: /analysis triggers auto <trigger-id> <on|off>" }
              }
              const success = await AnalysisTriggers.setAutoAccept(root, triggerId, autoAccept)
              if (!success) {
                return { error: `Trigger '${triggerId}' not found` }
              }
              return { output: `Set auto-accept for ${triggerId}: ${autoAccept ? "on" : "off"}` }
            }

            case "reset": {
              await AnalysisTriggers.resetToDefaults(root)
              return { output: "Reset triggers to defaults" }
            }

            case "info": {
              const triggerId = ctx.args[2]
              if (!triggerId) {
                return { error: "Usage: /analysis triggers info <trigger-id>" }
              }
              const trigger = await AnalysisTriggers.getTrigger(root, triggerId)
              if (!trigger) {
                return { error: `Trigger '${triggerId}' not found` }
              }

              let output = `**Trigger: ${trigger.name}**\n\n`
              output += `ID: \`${trigger.id}\`\n`
              output += `Description: ${trigger.description}\n`
              output += `Enabled: ${trigger.enabled}\n`
              output += `Auto-accept: ${trigger.autoAccept}\n`
              output += `Priority: ${trigger.priority}\n`
              output += `Cooldown: ${trigger.cooldownMinutes}min\n`
              
              output += `\n**Conditions:**\n`
              for (const [key, value] of Object.entries(trigger.conditions)) {
                if (value !== undefined) {
                  output += `- ${key}: ${value}\n`
                }
              }
              
              output += `\n**Suggestion:**\n`
              output += `- Mode: ${trigger.suggestion.analysisMode}\n`
              if (trigger.suggestion.subagentType) {
                output += `- Subagent: ${trigger.suggestion.subagentType}\n`
              }
              if (trigger.suggestion.prompt) {
                output += `- Prompt: ${trigger.suggestion.prompt.slice(0, 100)}...\n`
              }
              if (trigger.suggestion.emotionToRecord) {
                const e = trigger.suggestion.emotionToRecord
                output += `- Records: ${e.category} (intensity ${e.intensity})\n`
              }

              return { output }
            }

            default:
              return {
                error: `Unknown triggers action: ${subAction}\n\nAvailable:\n` +
                  `- list: List all triggers\n` +
                  `- enable <id>: Enable a trigger\n` +
                  `- disable <id>: Disable a trigger\n` +
                  `- cooldown <id> <minutes>: Set cooldown\n` +
                  `- auto <id> <on|off>: Set auto-accept\n` +
                  `- info <id>: Show trigger details\n` +
                  `- reset: Reset to defaults`,
              }
          }
        }

        case "global": {
          const enabled = ctx.args[1]
          if (!enabled) {
            const settings = await AnalysisTriggers.getSettings(root)
            return { output: `Global triggers: ${settings.globalEnabled ? "enabled" : "disabled"}` }
          }
          const isEnabled = enabled === "on" || enabled === "true" || enabled === "enable"
          await AnalysisTriggers.setGlobalEnabled(root, isEnabled)
          return { output: `Global triggers ${isEnabled ? "enabled" : "disabled"}` }
        }

        case "evaluate": {
          // Manual evaluation for testing - show what would trigger
          // This would need the full cognitive state, so simplified here
          const triggers = await AnalysisTriggers.getTriggers(root)
          const enabled = triggers.filter((t) => t.enabled)
          
          let output = `**${enabled.length} triggers enabled**\n\n`
          output += "Use cognitive state to evaluate triggers.\n"
          output += "Triggers fire automatically based on conditions.\n"
          
          return { output }
        }

        default:
          return {
            error: `Unknown action: ${action}\n\nAvailable actions:\n` +
              `- triggers [list|enable|disable|cooldown|auto|info|reset]: Manage triggers\n` +
              `- global [on|off]: Enable/disable all triggers\n` +
              `- evaluate: Show evaluation status`,
          }
      }
    },
    "/analysis [action] [args]",
  )
}
