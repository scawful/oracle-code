import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "@/global"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { AFS } from "../../afs"
import { TaskTracking } from "../../metrics/tracking"
import { ErrorDetection } from "../../metrics/errors"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"

const MetricsRecordCommand = cmd({
  command: "record <sessionID>",
  describe: "record a task outcome for IRT fitting",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        type: "string",
        demandOption: true,
      })
      .option("success", {
        type: "boolean",
        default: true,
        describe: "mark the task as successful",
      })
      .option("task", {
        type: "string",
        describe: "task identifier (default: sessionID)",
      })
      .option("agent", {
        type: "string",
        describe: "agent id/name (default: parsed from session title)",
      })
      .option("partners", {
        type: "string",
        describe: "comma-separated partner agent IDs",
      })
      .option("description", {
        type: "string",
        describe: "optional task description",
      })
  },
  handler: async (args) => {
    await bootstrap(Global.cwd(), async () => {
      const sessionID = String(args.sessionID)
      const session = await Session.get(sessionID)

      if (!session) {
        UI.error(`Session not found: ${sessionID}`)
        return
      }

      const messages = await Session.messages({ sessionID })
      const tokens = messages.reduce((sum, msg) => {
        if (msg.info.role !== "assistant") return sum
        const usage = msg.info.tokens
        if (!usage) return sum
        const input = usage.input ?? 0
        const output = usage.output ?? 0
        const reasoning = usage.reasoning ?? 0
        return sum + input + output + reasoning
      }, 0)

      const archivedAt = session.time.archived
      const duration = archivedAt ? archivedAt - session.time.created : session.time.updated - session.time.created

      const match = session.title.match(/@(\w+)/)
      const inferredAgent = match?.[1] ?? "unknown"
      const agentID = typeof args.agent === "string" && args.agent.trim() ? args.agent.trim() : inferredAgent

      const partnersRaw = typeof args.partners === "string" ? args.partners : ""
      const partnerIDs = partnersRaw
        ? partnersRaw
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        : undefined

      const contextRoot = await AFS.getRoot().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        UI.error(msg)
        return null
      })
      if (!contextRoot) return

      const taskID = typeof args.task === "string" && args.task.trim() ? args.task.trim() : sessionID
      const success = !!args.success
      const description = typeof args.description === "string" ? args.description : undefined

      const assistantTexts = messages
        .filter((m) => m.info.role === "assistant")
        .map((m) =>
          m.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic && !p.ignored)
            .map((p) => p.text)
            .join("\n")
            .trim(),
        )
        .filter((t) => t.length > 0)

      const lastText = assistantTexts[assistantTexts.length - 1]
      const previousOutputs = assistantTexts.slice(0, -1)
      const errors = lastText
        ? ErrorDetection.analyzeOutput(lastText, { previousOutputs, agentID, sessionID }).errors
        : []

      const outcome = TaskTracking.createTrackedOutcome({
        sessionID,
        taskID,
        agentID,
        agentName: agentID,
        partnerIDs: partnerIDs,
        success,
        tokens,
        duration,
        errors,
        taskDescription: description,
      })

      await TaskTracking.recordOutcome(contextRoot, outcome)
      UI.println(`${UI.Style.TEXT_SUCCESS}Recorded outcome.${UI.Style.TEXT_NORMAL}`)
    })
  },
})

const MetricsFitCommand = cmd({
  command: "fit",
  describe: "fit or update the IRT model from recorded outcomes",
  builder: (yargs: Argv) => {
    return yargs
      .option("min-outcomes", {
        type: "number",
        describe: "minimum outcomes required to fit (default: 10)",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "force refit even if model is recent",
      })
  },
  handler: async (args) => {
    await bootstrap(Global.cwd(), async () => {
      const contextRoot = await AFS.getRoot().catch(() => null)
      if (!contextRoot) {
        UI.error("AFS not initialized. Run 'ocode afs init' first.")
        return
      }

      const minOutcomes = typeof args.minOutcomes === "number" ? args.minOutcomes : undefined
      const forceRefit = !!args.force

      const result = await TaskTracking.fitModel(contextRoot, {
        minOutcomes,
        forceRefit,
      })

      UI.println(result.message)
    })
  },
})

const MetricsExportCommand = cmd({
  command: "export",
  describe: "export recorded outcomes",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      type: "string",
      choices: ["json", "csv"],
      default: "json",
      describe: "output format",
    })
  },
  handler: async (args) => {
    await bootstrap(Global.cwd(), async () => {
      const contextRoot = await AFS.getRoot().catch(() => null)
      if (!contextRoot) {
        UI.error("AFS not initialized. Run 'ocode afs init' first.")
        return
      }

      const format = args.format === "csv" ? "csv" : "json"
      const out = await TaskTracking.exportOutcomes(contextRoot, format)
      UI.println(out)
    })
  },
})

export const MetricsCommand = cmd({
  command: "metrics",
  describe: "metrics and scientific-rigor tools",
  builder: (yargs: Argv) =>
    yargs.command(MetricsRecordCommand).command(MetricsFitCommand).command(MetricsExportCommand).demandCommand(),
  async handler() {},
})
