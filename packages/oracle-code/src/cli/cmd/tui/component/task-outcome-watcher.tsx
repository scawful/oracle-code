import { createEffect, createSignal, onMount } from "solid-js"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogTaskOutcome } from "./dialog-task-outcome"
import type { ToolPart, ToolStateCompleted, AssistantMessage, Message, Part, Session } from "@oracle-code/sdk/v2"
import { AFS } from "@/afs"
import { TaskTracking } from "@/metrics/tracking"
import { ErrorDetection } from "@/metrics/errors"

type QueuedTask =
  | { kind: "tool"; part: ToolPart }
  | { kind: "session"; session: Session }
  | { kind: "chain"; sessionID: string; message: Message }

type TextPart = Extract<Part, { type: "text" }>
type CompletedTaskPart = ToolPart & { state: ToolStateCompleted }

export function TaskOutcomeWatcher() {
  const sync = useSync()
  const dialog = useDialog()
  const [queue, setQueue] = createSignal<QueuedTask[]>([])
  const [busy, setBusy] = createSignal(false)
  const [recorded, setRecorded] = createSignal(new Set<string>())
  const [initializedSessions, setInitializedSessions] = createSignal(false)
  const [seenArchivedSessions, setSeenArchivedSessions] = createSignal(new Set<string>())
  const [initializedChains, setInitializedChains] = createSignal(false)
  const [seenChains, setSeenChains] = createSignal(new Set<string>())

  onMount(() => {
    AFS.findRoot(process.cwd())
      .then((root) => {
        if (!root) return null
        return TaskTracking.loadOutcomes(root).then((outcomes) => {
          setRecorded(new Set(outcomes.map((o) => o.taskID)))
        })
      })
      .catch(() => {})
  })

  function taskKey(task: QueuedTask): string {
    if (task.kind === "tool") return task.part.callID
    if (task.kind === "session") return `session:${task.session.id}`
    return `chain:${task.message.id}`
  }

  function enqueue(tasks: QueuedTask[]) {
    setQueue((prev) => {
      const existingIds = new Set(prev.map((p) => taskKey(p)))
      const next = tasks.filter((p) => !existingIds.has(taskKey(p)))
      if (next.length === 0) return prev
      return [...prev, ...next]
    })
  }

  function getCompletedTaskParts(): CompletedTaskPart[] {
    const parts = Object.values(sync.data.part).flatMap((list) => list)
    return parts.filter((part): part is CompletedTaskPart => {
      if (part.type !== "tool") return false
      if (part.tool !== "task") return false
      return part.state.status === "completed"
    })
  }

  function getTaskChildSessionID(part: CompletedTaskPart): string {
    const metadata = part.state.metadata as Record<string, unknown>
    const child = typeof metadata.sessionId === "string" ? metadata.sessionId : part.sessionID
    return child
  }

  function textFromParts(parts: Part[]): string {
    return parts
      .filter((p): p is TextPart => p.type === "text" && !p.synthetic && !p.ignored)
      .map((p) => p.text)
      .join("\n")
      .trim()
  }

  function collectAssistantTexts(sessionID: string): Array<{ id: string; text: string }> {
    const messages = sync.data.message[sessionID] ?? []
    return messages
      .filter((m) => m.role === "assistant")
      .map((m) => ({ id: m.id, text: textFromParts(sync.data.part[m.id] ?? []) }))
      .filter((x) => x.text.length > 0)
  }

  function analyzeErrorsForMessage(sessionID: string, messageID: string, agentID: string): ErrorDetection.DetectedError[] {
    const outputs = collectAssistantTexts(sessionID)
    const index = outputs.findIndex((o) => o.id === messageID)
    const currentText = index >= 0 ? outputs[index].text : textFromParts(sync.data.part[messageID] ?? [])
    if (!currentText) return []
    const previousOutputs = index > 0 ? outputs.slice(0, index).map((o) => o.text) : []
    return ErrorDetection.analyzeOutput(currentText, { previousOutputs, agentID, sessionID }).errors
  }

  function analyzeErrorsForSession(sessionID: string, agentID: string): ErrorDetection.DetectedError[] {
    const outputs = collectAssistantTexts(sessionID)
    const last = outputs[outputs.length - 1]
    if (!last) return []
    const previousOutputs = outputs.slice(0, -1).map((o) => o.text)
    return ErrorDetection.analyzeOutput(last.text, { previousOutputs, agentID, sessionID }).errors
  }

  createEffect(() => {
    const completed = getCompletedTaskParts()
    const seen = recorded()
    const fresh = completed.filter((p) => !seen.has(p.callID)).map((p) => ({ kind: "tool" as const, part: p }))
    if (fresh.length === 0) return

    enqueue(fresh)
  })

  createEffect(() => {
    const sessions = sync.data.session ?? []
    const archived = sessions.filter((s) => !!s.time.archived)
    if (!initializedSessions()) {
      setSeenArchivedSessions(new Set(archived.map((s) => s.id)))
      setInitializedSessions(true)
      return
    }

    const seen = seenArchivedSessions()
    const newlyArchived = archived.filter((s) => !seen.has(s.id))
    if (newlyArchived.length === 0) return

    setSeenArchivedSessions(new Set([...seen, ...newlyArchived.map((s) => s.id)]))

    const taskChildSessions = new Set(getCompletedTaskParts().map((p) => getTaskChildSessionID(p)))
    const queued = newlyArchived
      .filter((s) => !taskChildSessions.has(s.id))
      .filter((s) => !recorded().has(`session:${s.id}`))
      .map((s) => ({ kind: "session" as const, session: s }))

    if (queued.length === 0) return
    enqueue(queued)
  })

  // Simple tool chains that shouldn't trigger outcome dialogs
  const SIMPLE_TOOL_CHAINS = new Set([
    "read",
    "glob",
    "grep",
    "ls",
    "afs_read",
    "afs_list",
    "state_read",
    "hivemind_read",
    "todoread",
  ])

  function isSimpleToolChain(toolNames: string[]): boolean {
    // All tools are simple read-only operations
    if (toolNames.every((name) => SIMPLE_TOOL_CHAINS.has(name))) return true

    // Mixed read operations (e.g., glob + read, grep + read)
    const uniqueTools = new Set(toolNames)
    if (uniqueTools.size <= 2 && [...uniqueTools].every((t) => SIMPLE_TOOL_CHAINS.has(t))) return true

    return false
  }

  createEffect(() => {
    const messagesBySession = sync.data.message ?? {}
    const candidates: Array<{ sessionID: string; message: Message }> = []

    for (const sessionID of Object.keys(messagesBySession)) {
      const messages = messagesBySession[sessionID] ?? []
      for (const message of messages) {
        if (message.role !== "assistant") continue
        if (!message.time?.completed) continue

        const parts = sync.data.part[message.id] ?? []
        const toolParts = parts.filter((p): p is ToolPart => p.type === "tool" && p.tool !== "task")
        if (toolParts.length < 2) continue
        const done = toolParts.every((p) => p.state.status === "completed" || p.state.status === "error")
        if (!done) continue

        // Skip simple tool chains (multi-read, multi-glob, etc.)
        const toolNames = toolParts.map((p) => p.tool)
        if (isSimpleToolChain(toolNames)) continue

        candidates.push({ sessionID, message })
      }
    }

    if (!initializedChains()) {
      setSeenChains(new Set(candidates.map((c) => c.message.id)))
      setInitializedChains(true)
      return
    }

    const seen = seenChains()
    const fresh = candidates.filter((c) => !seen.has(c.message.id))
    if (fresh.length === 0) return

    setSeenChains(new Set([...seen, ...fresh.map((c) => c.message.id)]))

    const queued = fresh
      .filter((c) => !recorded().has(`chain:${c.message.id}`))
      .map((c) => ({ kind: "chain" as const, sessionID: c.sessionID, message: c.message }))

    if (queued.length === 0) return
    enqueue(queued)
  })

  async function processNext() {
    if (busy()) return
    if (dialog.stack.length > 0) return
    const q = queue()
    if (q.length === 0) return

    setBusy(true)
    const current = q[0]
    setQueue(q.slice(1))

    const root = await AFS.findRoot(process.cwd())
    if (!root) {
      const updated = new Set(recorded())
      updated.add(taskKey(current))
      setRecorded(updated)
      setBusy(false)
      return
    }

    if (current.kind === "tool") {
      const state = current.part.state
      if (state.status !== "completed") {
        const updated = new Set(recorded())
        updated.add(taskKey(current))
        setRecorded(updated)
        setBusy(false)
        return
      }

      const metadata = state.metadata as Record<string, unknown>
      const childSessionID = typeof metadata.sessionId === "string" ? metadata.sessionId : current.part.sessionID

      const childSession = sync.session.get(childSessionID)
      const childMessages = sync.data.message[childSessionID] ?? []

      const tokens = childMessages.reduce((sum, msg) => {
        if (msg.role !== "assistant") return sum
        const assistant = msg as AssistantMessage
        const usage = assistant.tokens
        if (!usage) return sum
        const input = usage.input ?? 0
        const output = usage.output ?? 0
        const reasoning = usage.reasoning ?? 0
        return sum + input + output + reasoning
      }, 0)

      const createdAt = childSession?.time.created ?? Date.now()
      const endedAt = childSession?.time.archived ?? childSession?.time.updated ?? createdAt
      const duration = Math.max(0, endedAt - createdAt)

      const match = childSession?.title.match(/@(\w+)/)
      const agentID = match?.[1] ?? "unknown"
      const title = state.title

      const errors = analyzeErrorsForSession(childSessionID, agentID)
      const success = await DialogTaskOutcome.show(dialog, {
        title: "Task complete",
        description: title,
        errors,
        tokens,
        durationMs: duration,
      })

      const outcome = TaskTracking.createTrackedOutcome({
        sessionID: childSessionID,
        taskID: current.part.callID,
        agentID,
        agentName: agentID,
        partnerIDs: undefined,
        success,
        tokens,
        duration,
        errors,
        taskDescription: title,
      })

      await TaskTracking.recordOutcome(root, outcome).catch(() => {})

      const updated = new Set(recorded())
      updated.add(taskKey(current))
      setRecorded(updated)
      setBusy(false)
      return
    }

    if (current.kind === "session") {
      const session = current.session
      const sessionID = session.id
      const messages = sync.data.message[sessionID] ?? []

      const tokens = messages.reduce((sum, msg) => {
        if (msg.role !== "assistant") return sum
        const assistant = msg as AssistantMessage
        const usage = assistant.tokens
        if (!usage) return sum
        const input = usage.input ?? 0
        const output = usage.output ?? 0
        const reasoning = usage.reasoning ?? 0
        return sum + input + output + reasoning
      }, 0)

      const createdAt = session.time.created ?? Date.now()
      const endedAt = session.time.archived ?? session.time.updated ?? createdAt
      const duration = Math.max(0, endedAt - createdAt)

      const match = session.title.match(/@(\w+)/)
      const agentID = match?.[1] ?? "unknown"

      const childAgents = sync.data.session
        .filter((s) => s.parentID === sessionID)
        .map((s) => s.title.match(/@(\w+)/)?.[1] ?? "unknown")
        .filter((id) => id !== "unknown")
      const partnerIDs = childAgents.length > 0 ? Array.from(new Set(childAgents)) : undefined

      const errors = analyzeErrorsForSession(sessionID, agentID)
      const success = await DialogTaskOutcome.show(dialog, {
        title: "Session complete",
        description: session.title,
        errors,
        tokens,
        durationMs: duration,
      })

      const outcome = TaskTracking.createTrackedOutcome({
        sessionID,
        taskID: `session:${sessionID}`,
        agentID,
        agentName: agentID,
        partnerIDs,
        success,
        tokens,
        duration,
        errors,
        taskDescription: session.title,
      })

      await TaskTracking.recordOutcome(root, outcome).catch(() => {})

      const updated = new Set(recorded())
      updated.add(taskKey(current))
      setRecorded(updated)
      setBusy(false)
      return
    }

    if (current.kind === "chain") {
      const message = current.message as AssistantMessage
      const sessionID = current.sessionID
      const session = sync.session.get(sessionID)
      const match = session?.title.match(/@(\w+)/)
      const agentID = match?.[1] ?? "unknown"

      const usage = message.tokens
      const tokens = (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.reasoning ?? 0)
      const createdAt = message.time?.created ?? Date.now()
      const endedAt = message.time?.completed ?? createdAt
      const duration = Math.max(0, endedAt - createdAt)

      const parts = sync.data.part[message.id] ?? []
      const toolNames = parts.filter((p): p is ToolPart => p.type === "tool").map((p) => p.tool)
      const label = toolNames.length > 0 ? toolNames.join(" → ") : "tool chain"

      const errors = analyzeErrorsForMessage(sessionID, message.id, agentID)
      const success = await DialogTaskOutcome.show(dialog, {
        title: "Tool chain complete",
        description: label,
        errors,
        tokens,
        durationMs: duration,
      })

      const outcome = TaskTracking.createTrackedOutcome({
        sessionID,
        taskID: `chain:${message.id}`,
        agentID,
        agentName: agentID,
        partnerIDs: undefined,
        success,
        tokens,
        duration,
        errors,
        taskDescription: label,
      })

      await TaskTracking.recordOutcome(root, outcome).catch(() => {})

      const updated = new Set(recorded())
      updated.add(taskKey(current))
      setRecorded(updated)
      setBusy(false)
      return
    }

    const updated = new Set(recorded())
    updated.add(taskKey(current))
    setRecorded(updated)
    setBusy(false)
  }

  createEffect(() => {
    void processNext()
  })

  return null
}
