import { createMemo } from "solid-js"
import { useAgents } from "../context/agents"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"

export function DialogAgentsStatus() {
  const agents = useAgents()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const dialog = useDialog()

  const options = createMemo(() => {
    const sessions = agents.getSubagentSessions()
    const statuses = sync.data.session_status || {}

    return sessions.map((session) => {
      const status = statuses[session.id]
      const agentMatch = session.title.match(/@(\w+)/)
      const agentName = agentMatch?.[1] || "unknown"
      const isActive = status?.type === "busy"

      return {
        value: session.id,
        title: session.title,
        description: isActive ? "Running..." : "Idle",
        category: `@${agentName}`,
        footer: session.id.slice(0, 8) + "...",
      }
    })
  })

  return (
    <DialogSelect
      title="Agents Status"
      options={options()}
      onSelect={(option) => {
        // Navigate to the session
        route.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
      keybind={[]}
    />
  )
}
