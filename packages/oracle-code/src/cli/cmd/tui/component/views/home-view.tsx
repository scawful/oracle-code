import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, onCleanup, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../logo"
import { Locale } from "@/util/locale"
import { useSync } from "../../context/sync"
import { useRoute } from "@tui/context/route"
import { usePanes } from "@tui/context/panes"
import { useDialog } from "../../ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { usePromptRef } from "../../context/prompt"
import { useSDK } from "../../context/sdk"

/**
 * HomeView - Fresh homepage view for pane embedding
 *
 * This is a standalone home view that can be displayed in any pane.
 * When the user submits a prompt, a new session is created and the
 * tab transforms from "home" to "chat" with the new sessionID.
 *
 * Use cases:
 * - Creating a new session in a split pane
 * - Having multiple "new session" prompts ready
 * - Emacs-style *home* buffer
 */

export interface HomeViewProps {
  /** The pane ID containing this view */
  paneId: string
  /** Whether this pane is currently active */
  isActive?: boolean
}

export function HomeView(props: HomeViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const route = useRoute()
  const panes = usePanes()
  const dialog = useDialog()
  const keybind = useKeybind()
  const promptRef = usePromptRef()

  const isPaneActive = createMemo(() => panes.activeId === props.paneId)
  const isActive = createMemo(() => props.isActive ?? isPaneActive())

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>*</span> mcp errors
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>*</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef

  // Sync prompt focus based on pane activity
  const syncPromptFocus = () => {
    if (!prompt) return
    if (dialog.stack.length > 0 || keybind.leader) {
      if (prompt.focused) prompt.blur()
      return
    }

    if (!isActive()) {
      if (prompt.focused) prompt.blur()
    } else {
      if (!prompt.focused) prompt.focus()
    }
  }

  createEffect(() => {
    isActive()
    dialog.stack.length
    keybind.leader
    syncPromptFocus()
  })

  // Listen for new session creation via SDK events
  // When a session is created while this pane has focus, transform to chat
  const unsubscribe = sdk.event.on("session.created", (evt) => {
    // Only handle if this pane is active
    if (!isActive()) return

    // Find the pane and check if it still exists and is a "home" view
    const pane = panes.leaves.find((l) => l.id === props.paneId)
    if (!pane) return

    const activeTab = panes.getActiveTab(pane)
    if (!activeTab || activeTab.viewType !== "home") return

    // Get the new session from the event
    const session = evt.properties.info
    if (!session?.id) return

    // Only handle top-level sessions (not subagent sessions)
    if (session.parentID) return

    // Transform this home tab into a session tab
    panes.setTabSession(props.paneId, session.id)

    // If this is the main pane, also navigate the route
    if (props.paneId === "main") {
      route.navigate({ type: "session", sessionID: session.id })
    }
  })

  // Cleanup subscription on unmount
  onCleanup(() => unsubscribe())

  return (
    <box flexGrow={1} flexDirection="column" overflow="hidden">
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        <Logo />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              // Only set global prompt ref if this is the active pane
              if (isActive()) {
                promptRef.set(r)
              }
              syncPromptFocus()
            }}
            hint={Hint}
          />
        </box>
      </box>

      {/* Status bar */}
      <box
        height={1}
        backgroundColor={theme.backgroundElement}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        flexShrink={0}
      >
        <text fg={theme.textMuted}>*home*</text>
        <text fg={theme.textMuted}>New session</text>
      </box>
    </box>
  )
}
