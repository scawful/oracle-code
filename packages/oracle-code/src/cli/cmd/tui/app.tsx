import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack, ErrorBoundary, createSignal, onMount, batch, Show, on } from "solid-js"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel, useConnected } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider, useKeybind } from "@tui/context/keybind"
import { WhichKeyProvider, useWhichKey } from "@tui/context/which-key"
import { WhichKeyBar } from "@tui/component/which-key-bar"
import { PanesProvider } from "@tui/context/panes"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { MessagesProvider, useMessages } from "./context/messages"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { AFSProvider, useAFS } from "./context/afs"
import { AgentsProvider, useAgents } from "./context/agents"
import { MetricsProvider } from "./context/metrics"
import { ToMProvider } from "./context/tom"
import { CognitiveProvider } from "./context/cognitive"
import { DialogPlan } from "./component/dialog-plan"
import { DialogAgentsStatus } from "./component/dialog-agents-status"
import { DialogMetrics } from "./component/dialog-metrics"
import { DialogToMStatus } from "./component/dialog-tom-status"
import { DialogRouting } from "./component/dialog-routing"
import { DialogSessionTree } from "./component/dialog-session-tree"
import { DialogAFSBrowser } from "./component/dialog-afs-browser"
import { DialogAnalysisMode } from "./component/dialog-analysis-mode"
import { AnalysisModeProvider, useAnalysisMode } from "./context/analysis-mode"
import { ApprovalModeProvider, useApprovalMode } from "./context/approval-mode"
import { ToolWhitelistProvider } from "./context/tool-whitelist"
import { AnalysisGateProvider, useAnalysisGate } from "./context/analysis-gate"
import { KeyboardModeProvider } from "./context/keyboard-mode"
import { OrchestrationProvider } from "./context/orchestration"
import { DialogStateView } from "./component/dialog-state-view"
import { DialogStateEdit } from "./component/dialog-state-edit"
import { DialogConfirm } from "./ui/dialog-confirm"
import { DialogOrchestration } from "./component/dialog-orchestration"
import { DialogAgentLanes } from "./component/dialog-agent-lanes"
import { TaskOutcomeWatcher } from "./component/task-outcome-watcher"
import { LaneSplitViewController } from "./component/lane-split-view"
import { CognitiveActionsConnector } from "./component/cognitive-actions"
import {
  DialogWorkspaceSave,
  DialogWorkspaceLoad,
  DialogWorkspaceDelete,
  DialogWorkspaceRename,
  DialogWorkspaceList,
} from "./component/dialog-workspace"
import { DialogHivemind } from "./component/dialog-hivemind"
import { DialogBufferList } from "./component/dialog-buffer-list"
import { BufferProvider } from "./context/buffer"

async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
  // can't set raw mode if not a TTY
  if (!process.stdin.isTTY) return "dark"

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener("data", handler)
      clearTimeout(timeout)
    }

    const handler = (data: Buffer) => {
      const str = data.toString()
      const match = str.match(/\x1b]11;([^\x07\x1b]+)/)
      if (match) {
        cleanup()
        const color = match[1]
        // Parse RGB values from color string
        // Formats: rgb:RR/GG/BB or #RRGGBB or rgb(R,G,B)
        let r = 0,
          g = 0,
          b = 0

        if (color.startsWith("rgb:")) {
          const parts = color.substring(4).split("/")
          r = parseInt(parts[0], 16) >> 8 // Convert 16-bit to 8-bit
          g = parseInt(parts[1], 16) >> 8 // Convert 16-bit to 8-bit
          b = parseInt(parts[2], 16) >> 8 // Convert 16-bit to 8-bit
        } else if (color.startsWith("#")) {
          r = parseInt(color.substring(1, 3), 16)
          g = parseInt(color.substring(3, 5), 16)
          b = parseInt(color.substring(5, 7), 16)
        } else if (color.startsWith("rgb(")) {
          const parts = color.substring(4, color.length - 1).split(",")
          r = parseInt(parts[0])
          g = parseInt(parts[1])
          b = parseInt(parts[2])
        }

        // Calculate luminance using relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

        // Determine if dark or light based on luminance threshold
        resolve(luminance > 0.5 ? "light" : "dark")
      }
    }

    process.stdin.setRawMode(true)
    process.stdin.on("data", handler)
    process.stdout.write("\x1b]11;?\x07")

    timeout = setTimeout(() => {
      cleanup()
      resolve("dark")
    }, 1000)
  })
}

export function tui(input: { url: string; args: Args; onExit?: () => Promise<void> }) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const mode = await getTerminalBackgroundColor()
    const onExit = async () => {
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} />}>
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <MessagesProvider>
                    <ToastProvider>
                      <RouteProvider>
                        <SDKProvider url={input.url}>
                          <SyncProvider>
                            <BufferProvider>
                              <ThemeProvider mode={mode}>
                                <LocalProvider>
                                  <AFSProvider>
                                    <AgentsProvider>
                                      <MetricsProvider>
                                        <ToMProvider>
                                          <CognitiveProvider>
                                            <ApprovalModeProvider>
                                              <ToolWhitelistProvider>
                                                <AnalysisModeProvider>
                                                  <AnalysisGateProvider>
                                                    <OrchestrationProvider>
                                                      <KeybindProvider>
                                                        <WhichKeyProvider>
                                                          <PanesProvider>
                                                            <KeyboardModeProvider>
                                                              <DialogProvider>
                                                                <CommandProvider>
                                                                  <PromptHistoryProvider>
                                                                    <PromptRefProvider>
                                                                      <WhichKeyConnector />
                                                                      <CognitiveActionsConnector />
                                                                      <App />
                                                                    </PromptRefProvider>
                                                                  </PromptHistoryProvider>
                                                                </CommandProvider>
                                                              </DialogProvider>
                                                            </KeyboardModeProvider>
                                                          </PanesProvider>
                                                        </WhichKeyProvider>
                                                      </KeybindProvider>
                                                    </OrchestrationProvider>
                                                  </AnalysisGateProvider>
                                                </AnalysisModeProvider>
                                              </ToolWhitelistProvider>
                                            </ApprovalModeProvider>
                                          </CognitiveProvider>
                                        </ToMProvider>
                                      </MetricsProvider>
                                    </AgentsProvider>
                                  </AFSProvider>
                                </LocalProvider>
                              </ThemeProvider>
                            </BufferProvider>
                          </SyncProvider>
                        </SDKProvider>
                      </RouteProvider>
                    </ToastProvider>
                  </MessagesProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
      },
    )
  })
}

/**
 * WhichKeyConnector - Wires up which-key to the keybind system
 * This component doesn't render anything, just sets up the integration
 */
function WhichKeyConnector() {
  const keybind = useKeybind()
  const whichKey = useWhichKey()
  const command = useCommandDialog()
  const dialog = useDialog()
  const toast = useToast()

  onMount(() => {
    // Wire up which-key to keybind
    keybind.setWhichKeyHandler({
      onActivate: () => {
        whichKey.activate()
      },
      onDeactivate: () => {
        whichKey.deactivate()
      },
      onKey: (key: string) => {
        return whichKey.handleKey(key)
      },
      isActive: () => whichKey.active,
    })

    // Wire up which-key to command system for keybind triggers
    whichKey.setKeybindTrigger((key: string) => {
      // Special handling for command_list to directly show the command palette
      if (key === "command_list") {
        command.show()
      } else {
        command.trigger(key)
      }
    })

    // Register Buffer which-key action handlers
    whichKey.registerAction("buffer.list", () => {
      dialog.replace(() => <DialogBufferList />)
    })

    // Register Hivemind which-key action handlers
    whichKey.registerAction("hivemind.dashboard", () => {
      dialog.replace(() => <DialogHivemind />)
    })
    whichKey.registerAction("hivemind.fears", () => {
      dialog.replace(() => <DialogHivemind initialTab="fears" />)
    })
    whichKey.registerAction("hivemind.satisfactions", () => {
      dialog.replace(() => <DialogHivemind initialTab="satisfactions" />)
    })
    whichKey.registerAction("hivemind.knowledge", () => {
      dialog.replace(() => <DialogHivemind initialTab="knowledge" />)
    })
    whichKey.registerAction("hivemind.decisions", () => {
      dialog.replace(() => <DialogHivemind initialTab="decisions" />)
    })
    whichKey.registerAction("hivemind.preferences", () => {
      dialog.replace(() => <DialogHivemind initialTab="preferences" />)
    })
    whichKey.registerAction("hivemind.councils", () => {
      dialog.replace(() => <DialogHivemind initialTab="councils" />)
    })
    whichKey.registerAction("hivemind.refresh", () => {
      // Refresh will be handled by the dialog itself when opened
      dialog.replace(() => <DialogHivemind />)
    })

    // Register File action handlers (placeholders for now)
    whichKey.registerAction("file.find", () => {
      // TODO: Implement file finder dialog
      toast.show({ message: "File finder coming soon", variant: "info" })
    })
    whichKey.registerAction("file.recent", () => {
      // TODO: Implement recent files dialog
      toast.show({ message: "Recent files coming soon", variant: "info" })
    })
    whichKey.registerAction("file.save", () => {
      // TODO: Implement save functionality
      toast.show({ message: "Save coming soon", variant: "info" })
    })
    whichKey.registerAction("file.diff", () => {
      // TODO: Implement diff view
      toast.show({ message: "Diff view coming soon", variant: "info" })
    })

    // Register Session action handlers
    whichKey.registerAction("session.tree", () => {
      command.trigger("session.tree")
    })
    whichKey.registerAction("session.rename", () => {
      command.trigger("session.rename")
    })

    // Register Agent action handlers
    whichKey.registerAction("agent.status", () => {
      command.trigger("agents.status")
    })
  })

  return null
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const analysisMode = useAnalysisMode()
  const analysisGate = useAnalysisGate()
  const kv = useKV()
  const command = useCommandDialog()
  const { event } = useSDK()
  const toast = useToast()
  const { theme, mode, setMode } = useTheme()
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (route.data.type === "home") {
      renderer.setTerminalTitle("ocode")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("ocode")
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`OC | ${title}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || sync.status !== "complete" || !args.continue) return
    const match = sync.data.session.at(0)?.id
    if (match) {
      continued = true
      route.navigate({ type: "session", sessionID: match })
    }
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      suggested: sync.data.session.length > 0,
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "New session",
      suggested: route.data.type === "session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      onSelect: () => {
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      suggested: true,
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogModel />)
      },
    },
    {
      title: "Model cycle",
      disabled: true,
      value: "model.cycle_recent",
      keybind: "model_cycle_recent",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(1)
      },
    },
    {
      title: "Model cycle reverse",
      disabled: true,
      value: "model.cycle_recent_reverse",
      keybind: "model_cycle_recent_reverse",
      category: "Agent",
      onSelect: () => {
        local.model.cycle(-1)
      },
    },
    {
      title: "Switch agent",
      value: "agent.list",
      keybind: "agent_list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogAgent />)
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      onSelect: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
    {
      title: "Agent cycle",
      value: "agent.cycle",
      keybind: "agent_cycle",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(1)
      },
    },
    {
      title: "Agent cycle reverse",
      value: "agent.cycle.reverse",
      keybind: "agent_cycle_reverse",
      category: "Agent",
      disabled: true,
      onSelect: () => {
        local.agent.move(-1)
      },
    },
    {
      title: "Analysis mode",
      value: "analysis.mode",
      category: "Analysis",
      onSelect: () => {
        dialog.replace(() => <DialogAnalysisMode />)
      },
    },
    {
      title: "Analysis mode cycle",
      value: "analysis.cycle",
      keybind: "analysis_cycle" as any,
      category: "Analysis",
      disabled: true,
      onSelect: () => {
        analysisMode.cycle(1)
      },
    },
    {
      title: "Analysis mode cycle reverse",
      value: "analysis.cycle.reverse",
      keybind: "analysis_cycle_reverse" as any,
      category: "Analysis",
      disabled: true,
      onSelect: () => {
        analysisMode.cycle(-1)
      },
    },
    {
      title: "Toggle Eval mode",
      value: "analysis.eval",
      category: "Analysis",
      onSelect: () => {
        analysisMode.toggle("eval")
      },
    },
    {
      title: "Toggle ToM mode",
      value: "analysis.tom",
      category: "Analysis",
      onSelect: () => {
        analysisMode.toggle("tom")
      },
    },
    {
      title: "Toggle Metrics mode",
      value: "analysis.metrics",
      category: "Analysis",
      onSelect: () => {
        analysisMode.toggle("metrics")
      },
    },
    {
      title: "Toggle Critic mode",
      value: "analysis.critic",
      category: "Analysis",
      onSelect: () => {
        analysisMode.toggle("critic")
      },
    },
    {
      title: "Toggle Emotional mode",
      value: "analysis.emotional",
      category: "Analysis",
      onSelect: () => {
        analysisMode.toggle("emotional")
      },
    },
    // Cognitive Protocol commands
    {
      title: "Cognitive status",
      value: "cognitive.status",
      category: "Cognitive",
      onSelect: (dialog) => {
        // Show cognitive panel in sidebar or status
        toast.show({ message: "Cognitive status available in sidebar panel", variant: "info" })
        dialog.clear()
      },
    },
    {
      title: "Emotional state",
      value: "cognitive.emotions",
      category: "Cognitive",
      onSelect: (dialog) => {
        toast.show({ message: "Use /emotions command for detailed emotional state", variant: "info" })
        dialog.clear()
      },
    },
    {
      title: "Analysis triggers",
      value: "cognitive.triggers",
      category: "Cognitive",
      onSelect: (dialog) => {
        toast.show({ message: "Use /analysis triggers command to manage triggers", variant: "info" })
        dialog.clear()
      },
    },
    {
      title: "Analysis gate mode",
      value: "cognitive.gate.mode",
      category: "Cognitive",
      onSelect: (dialog) => {
        analysisGate.cycleMode()
        toast.show({ message: `Gate mode: ${analysisGate.modeLabel}`, variant: "info" })
        dialog.clear()
      },
    },
    {
      title: "Accept pending analysis",
      value: "cognitive.gate.accept",
      category: "Cognitive",
      disabled: !analysisGate.hasPending,
      onSelect: async (dialog) => {
        if (analysisGate.currentPending) {
          await analysisGate.accept(analysisGate.currentPending.id)
          toast.show({ message: "Analysis accepted", variant: "success" })
        }
        dialog.clear()
      },
    },
    {
      title: "Deny pending analysis",
      value: "cognitive.gate.deny",
      category: "Cognitive",
      disabled: !analysisGate.hasPending,
      onSelect: (dialog) => {
        if (analysisGate.currentPending) {
          analysisGate.deny(analysisGate.currentPending.id)
          toast.show({ message: "Analysis denied", variant: "info" })
        }
        dialog.clear()
      },
    },
    {
      title: "Orchestration",
      value: "orchestration.view",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogOrchestration />)
      },
    },
    {
      title: "Agent lanes",
      value: "agents.lanes",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogAgentLanes />)
      },
    },
    {
      title: "Agents status",
      value: "agents.status",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogAgentsStatus />)
      },
    },
    {
      title: "Coordination metrics",
      value: "metrics.view",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogMetrics />)
      },
    },
    {
      title: "Theory of Mind status",
      value: "tom.status",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogToMStatus />)
      },
    },
    {
      title: "Routing recommendation",
      value: "routing.recommend",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogRouting />)
      },
    },
    {
      title: "Session hierarchy",
      value: "session.tree",
      category: "Agents",
      onSelect: () => {
        dialog.replace(() => <DialogSessionTree />)
      },
    },
    {
      title: "AFS browser",
      value: "afs.browser",
      keybind: "afs_browser" as any,
      category: "AFS",
      onSelect: () => {
        dialog.replace(() => <DialogAFSBrowser />)
      },
    },
    {
      title: "View AFS plan",
      value: "afs.plan.view",
      category: "AFS",
      onSelect: () => {
        dialog.replace(() => <DialogPlan />)
      },
    },
    {
      title: "View shared state",
      value: "state.view",
      category: "State",
      onSelect: () => {
        dialog.replace(() => <DialogStateView />)
      },
    },
    {
      title: "Add state entry",
      value: "state.add",
      category: "State",
      onSelect: () => {
        dialog.replace(() => <DialogStateEdit mode="create" />)
      },
    },
    {
      title: "Clear all state",
      value: "state.clear",
      category: "State",
      onSelect: async () => {
        const confirmed = await DialogConfirm.show(
          dialog,
          "Clear State",
          "Are you sure you want to clear all shared state entries?",
        )
        if (confirmed) {
          await sync.state.clear()
          toast.show({ message: "State cleared", variant: "info" })
        }
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      suggested: !connected(),
      onSelect: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "opencode.status",
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "Switch theme",
      value: "theme.switch",
      onSelect: () => {
        dialog.replace(() => <DialogThemeList />)
      },
      category: "System",
    },
    {
      title: "Toggle appearance",
      value: "theme.switch_mode",
      onSelect: (dialog) => {
        setMode(mode() === "dark" ? "light" : "dark")
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        open("https://opencode.ai/docs").catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      onSelect: () => exit(),
      category: "System",
    },
    {
      title: "Toggle debug panel",
      category: "System",
      value: "app.debug",
      onSelect: (dialog) => {
        renderer.toggleDebugOverlay()
        dialog.clear()
      },
    },
    {
      title: "Toggle console",
      category: "System",
      value: "app.fps",
      onSelect: (dialog) => {
        renderer.console.toggle()
        dialog.clear()
      },
    },
    {
      title: "Suspend terminal",
      value: "terminal.suspend",
      keybind: "terminal_suspend",
      category: "System",
      onSelect: () => {
        process.once("SIGCONT", () => {
          renderer.resume()
        })

        renderer.suspend()
        // pid=0 means send the signal to all processes in the process group
        process.kill(0, "SIGTSTP")
      },
    },
    // Workspace management
    {
      title: "Save workspace",
      value: "workspace.save",
      keybind: "workspace_save",
      category: "Workspace",
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceSave />)
      },
    },
    {
      title: "Load workspace",
      value: "workspace.load",
      keybind: "workspace_load",
      category: "Workspace",
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceLoad />)
      },
    },
    {
      title: "Delete workspace",
      value: "workspace.delete",
      keybind: "workspace_delete",
      category: "Workspace",
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceDelete />)
      },
    },
    {
      title: "Rename workspace",
      value: "workspace.rename",
      keybind: "workspace_rename",
      category: "Workspace",
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceRename />)
      },
    },
    {
      title: "List workspaces",
      value: "workspace.list",
      keybind: "workspace_list",
      category: "Workspace",
      onSelect: () => {
        dialog.replace(() => <DialogWorkspaceList />)
      },
    },
    // Hivemind commands
    {
      title: "Hivemind dashboard",
      value: "hivemind.dashboard",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind />)
      },
    },
    {
      title: "Hivemind fears",
      value: "hivemind.fears",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="fears" />)
      },
    },
    {
      title: "Hivemind satisfactions",
      value: "hivemind.satisfactions",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="satisfactions" />)
      },
    },
    {
      title: "Hivemind knowledge",
      value: "hivemind.knowledge",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="knowledge" />)
      },
    },
    {
      title: "Hivemind decisions",
      value: "hivemind.decisions",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="decisions" />)
      },
    },
    {
      title: "Hivemind preferences",
      value: "hivemind.preferences",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="preferences" />)
      },
    },
    {
      title: "Hivemind councils",
      value: "hivemind.councils",
      category: "Hivemind",
      onSelect: () => {
        dialog.replace(() => <DialogHivemind initialTab="councils" />)
      },
    },
    // Buffer commands
    {
      title: "Buffer list",
      value: "buffer.list",
      keybind: "buffer_list",
      category: "Buffer",
      onSelect: () => {
        dialog.replace(() => <DialogBufferList />)
      },
    },
  ])

  createEffect(() => {
    const currentModel = local.model.current()
    if (!currentModel) return
    if (currentModel.providerID === "openrouter" && !kv.get("openrouter_warning", false)) {
      untrack(() => {
        DialogAlert.show(
          dialog,
          "Warning",
          "While openrouter is a convenient way to access LLMs your request will often be routed to subpar providers that do not work well in our testing.\n\nFor reliable access to models check out OpenCode Zen\nhttps://opencode.ai/zen",
        ).then(() => kv.set("openrouter_warning", true))
      })
    }
  })

  event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      dialog.clear()
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    const message = (() => {
      if (!error) return "An error occured"

      if (typeof error === "object") {
        const data = error.data
        if ("message" in data && typeof data.message === "string") {
          return data.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  event.on(Installation.Event.Updated.type, (evt) => {
    toast.show({
      variant: "success",
      title: "Update Complete",
      message: `Updated to v${evt.properties.version}`,
      duration: 5000,
    })
  })

  event.on(Installation.Event.UpdateAvailable.type, (evt) => {
    toast.show({
      variant: "info",
      title: "Update Available",
      message: `v${evt.properties.version} is available. Run 'ocode upgrade' to update.`,
      duration: 10000,
    })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
      onMouseUp={async () => {
        if (Flag.OCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) {
          renderer.clearSelection()
          return
        }
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          const base64 = Buffer.from(text).toString("base64")
          const osc52 = `\x1b]52;c;${base64}\x07`
          const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
          /* @ts-expect-error */
          renderer.writeOut(finalOsc52)
          await Clipboard.copy(text)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
          renderer.clearSelection()
        }
      }}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
      <TaskOutcomeWatcher />
      {/* Lane split view controller - monitors subagent spawns */}
      <LaneSplitViewController />
      {/* Which-key bottom bar */}
      <WhichKeyBar />
    </box>
  )
}

function ErrorComponent(props: { error: Error; reset: () => void; onExit: () => Promise<void> }) {
  const term = useTerminalDimensions()
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      props.onExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/scawful/oracle-code/issues/new?template=bug-report.yml")

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("opencode-version", Installation.VERSION)

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD}>Please report an issue.</text>
        <box onMouseUp={copyIssueURL} backgroundColor="#565f89" padding={1}>
          <text attributes={TextAttributes.BOLD}>Copy issue URL (exception info pre-filled)</text>
        </box>
        {copied() && <text>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor="#565f89" padding={1}>
          <text>Reset TUI</text>
        </box>
        <box onMouseUp={props.onExit} backgroundColor="#565f89" padding={1}>
          <text>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text>{props.error.stack}</text>
      </scrollbox>
      <text>{props.error.message}</text>
    </box>
  )
}
