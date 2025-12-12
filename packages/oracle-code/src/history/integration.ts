/**
 * History Integration - Hooks history logging into the session system.
 *
 * Uses the Bus event system to log operations without modifying
 * the core session processor.
 */

import { Bus } from "@/bus"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { HistoryStore } from "./store"
import { Log } from "@/util/log"

const log = Log.create({ service: "history.integration" })

/**
 * Initialize history integration.
 * Subscribes to session events and logs them to history.
 */
export async function initHistoryIntegration(): Promise<void> {
  log.info("Initializing history integration")

  // Log session creation
  Bus.subscribe(Session.Event.Created, async (event) => {
    await HistoryStore.logSystemEvent(
      "session_created",
      {
        sessionId: event.properties.info.id,
        projectId: event.properties.info.projectID,
        title: event.properties.info.title,
        parentId: event.properties.info.parentID,
      },
      event.properties.info.id
    )
    // Set the current session for logging
    await HistoryStore.setSessionId(event.properties.info.id)
  })

  // Log session updates
  Bus.subscribe(Session.Event.Updated, async (event) => {
    // Don't log every update - too noisy
    // Only log significant changes (title, summary, share)
    const info = event.properties.info
    if (info.summary) {
      await HistoryStore.logSystemEvent(
        "session_summary_updated",
        {
          sessionId: info.id,
          additions: info.summary.additions,
          deletions: info.summary.deletions,
          files: info.summary.files,
        },
        info.id
      )
    }
  })

  // Log session deletion
  Bus.subscribe(Session.Event.Deleted, async (event) => {
    await HistoryStore.logSystemEvent(
      "session_deleted",
      {
        sessionId: event.properties.info.id,
        title: event.properties.info.title,
      },
      event.properties.info.id
    )
  })

  // Log session errors
  Bus.subscribe(Session.Event.Error, async (event) => {
    await HistoryStore.logSystemEvent(
      "session_error",
      {
        sessionId: event.properties.sessionID,
        error: event.properties.error,
      },
      event.properties.sessionID
    )
  })

  // Log message creation
  Bus.subscribe(MessageV2.Event.Updated, async (event) => {
    const msg = event.properties.info
    if (msg.role === "user") {
      // Log user input
      const parts = await MessageV2.parts(msg.id)
      const textPart = parts.find((p) => p.type === "text") as
        | MessageV2.TextPart
        | undefined
      if (textPart?.text) {
        await HistoryStore.logUserInput(textPart.text, msg.sessionID)
      }
    }
  })

  // Log tool calls via part updates
  Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
    const part = event.properties.part

    if (part.type === "tool" && part.state.status === "completed") {
      // Log completed tool call
      await HistoryStore.logToolCall({
        name: part.tool,
        input: part.state.input ?? {},
        output: part.state.output,
        success: true,
        durationMs:
          part.state.time?.end && part.state.time?.start
            ? part.state.time.end - part.state.time.start
            : undefined,
        sessionId: part.sessionID,
        filesTouched: part.state.metadata?.files_touched as string[] | undefined,
      })
    } else if (part.type === "tool" && part.state.status === "error") {
      // Log failed tool call
      await HistoryStore.logToolCall({
        name: part.tool,
        input: part.state.input ?? {},
        success: false,
        error: part.state.error,
        durationMs:
          part.state.time?.end && part.state.time?.start
            ? part.state.time.end - part.state.time.start
            : undefined,
        sessionId: part.sessionID,
      })
    }
  })

  log.info("History integration initialized")
}

/**
 * Disable history integration.
 * Unsubscribes from all events.
 */
export function disableHistoryIntegration(): void {
  // Note: Bus doesn't expose unsubscribe, so this is a no-op for now
  // In practice, history integration stays active for the session lifetime
  log.info("History integration disabled (no-op)")
}
