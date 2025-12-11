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
        return { error: "AFS not initialized. Run 'codewizard afs init' first." }
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
        return { error: "AFS not initialized. Run 'codewizard afs init' first." }
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
        output: `Export session as ${format}. Use 'codewizard export ${ctx.sessionID}' from terminal.`,
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
}
