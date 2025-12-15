import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { useWhichKey, type WhichKeyNode } from "@tui/context/which-key"
import { useApprovalMode } from "@tui/context/approval-mode"
import type { KeybindsConfig } from "@oracle-code/sdk/v2"

type Context = ReturnType<typeof init>
const ctx = createContext<Context>()

export type CommandOption = DialogSelectOption & {
  keybind?: keyof KeybindsConfig
  suggested?: boolean
}

function init() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()
  const whichKey = useWhichKey()
  const approval = useApprovalMode()

  // Flatten which-key tree into command options
  const whichKeyCommands = createMemo(() => {
    const commands: CommandOption[] = []

    function traverse(nodes: WhichKeyNode[], path: string[] = []) {
      for (const node of nodes) {
        if (node.children) {
          traverse(node.children, [...path, node.label.replace(/^\+/, "")])
        } else {
          // Leaf node - add as command
          const category =
            path.length > 0 ? path.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" > ") : "General"

          commands.push({
            title: node.label,
            category,
            value: node.action ?? node.keybind ?? `which-key.${path.join(".")}.${node.label}`,
            keybind: node.keybind as any,
            onSelect: (dialog) => {
              if (node.action) {
                whichKey.executeAction(node.action)
              }
              dialog.clear()
            },
          })
        }
      }
    }

    traverse(whichKey.tree)
    return commands
  })

  const options = createMemo(() => {
    const all = registrations().flatMap((x) => x())

    // Add Approval Mode toggle
    const approvalCommand: CommandOption = {
      title: `Toggle Approval Mode (Current: ${approval.modeInfo.name})`,
      category: "System",
      value: "approval.toggle",
      keybind: "analysis_cycle" as any, // Reusing Ctrl+A
      onSelect: (d) => {
        approval.cycle()
        d.clear()
      },
    }

    // Merge which-key commands
    // We need to deduplicate based on value/title to avoid double entries
    // since app.tsx registers many commands that are also in which-key
    const existingValues = new Set(all.map((x) => x.value))
    const uniqueWhichKeyCommands = whichKeyCommands().filter((x) => !existingValues.has(x.value))

    const suggested = all.filter((x) => x.suggested)

    return [
      ...suggested.map((x) => ({
        ...x,
        category: "Suggested",
        value: "suggested." + x.value,
      })),
      approvalCommand,
      ...all,
      ...uniqueWhichKeyCommands,
    ].map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  })
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    for (const option of options()) {
      if (option.keybind && keybind.match(option.keybind, evt)) {
        evt.preventDefault()
        option.onSelect?.(dialog)
        return
      }
    }
  })

  const result = {
    trigger(name: string, source?: "prompt") {
      for (const option of options()) {
        // Match by value or keybind name (for which-key integration)
        if (option.value === name || option.keybind === name) {
          option.onSelect?.(dialog, source)
          return
        }
      }
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => <DialogCommand options={options()} />)
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
    get options() {
      return options()
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = init()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      dialog.replace(() => <DialogCommand options={value.options} />)
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  return (
    <DialogSelect
      ref={(r) => (ref = r)}
      title="Commands"
      options={props.options.filter((x) => !ref?.filter || !x.value.startsWith("suggested."))}
    />
  )
}
