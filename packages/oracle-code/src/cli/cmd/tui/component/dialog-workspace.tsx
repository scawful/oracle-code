import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { usePanes } from "@tui/context/panes"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { Keybind } from "@/util/keybind"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { Locale } from "@/util/locale"

/**
 * DialogWorkspaceSave - Prompt for workspace name and save
 */
export function DialogWorkspaceSave() {
  const dialog = useDialog()
  const panes = usePanes()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <DialogPrompt
      title="Save Workspace"
      placeholder="Enter workspace name"
      value={panes.currentWorkspace || ""}
      description={() => (
        <text fg={theme.textMuted}>
          Save the current pane layout as a named workspace.
        </text>
      )}
      onConfirm={(name) => {
        if (name.trim()) {
          panes.saveWorkspace(name.trim())
        }
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}

/**
 * DialogWorkspaceLoad - List workspaces to load
 */
export function DialogWorkspaceLoad() {
  const dialog = useDialog()
  const panes = usePanes()
  const { theme } = useTheme()

  const [toDelete, setToDelete] = createSignal<string>()

  const options = createMemo(() => {
    return panes.workspaces
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map((w) => {
        const isDeleting = toDelete() === w.name
        const isCurrent = panes.currentWorkspace === w.name
        return {
          title: isDeleting
            ? `Press ctrl+d again to confirm delete`
            : w.name + (isCurrent ? " (current)" : ""),
          bg: isDeleting ? theme.error : undefined,
          value: w.name,
          category: "Workspaces",
          footer: w.description || Locale.time(w.updatedAt),
        }
      })
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <Show
      when={options().length > 0}
      fallback={
        <box padding={2} flexDirection="column" gap={1}>
          <text attributes={TextAttributes.BOLD}>Load Workspace</text>
          <text fg={theme.textMuted}>No workspaces saved yet.</text>
          <text fg={theme.textMuted}>Use SPC W s to save the current layout.</text>
        </box>
      }
    >
      <DialogSelect
        title="Load Workspace"
        options={options()}
        current={panes.currentWorkspace ?? undefined}
        onSelect={(option) => {
          panes.loadWorkspace(option.value)
          dialog.clear()
        }}
        keybind={[
          {
            keybind: Keybind.parse("ctrl+d")[0],
            title: "delete",
            onTrigger: (option) => {
              if (toDelete() === option.value) {
                panes.deleteWorkspace(option.value)
                setToDelete(undefined)
              } else {
                setToDelete(option.value)
              }
            },
          },
        ]}
        onMove={() => setToDelete(undefined)}
      />
    </Show>
  )
}

/**
 * DialogWorkspaceDelete - List workspaces to delete
 */
export function DialogWorkspaceDelete() {
  const dialog = useDialog()
  const panes = usePanes()
  const { theme } = useTheme()

  const [toDelete, setToDelete] = createSignal<string>()

  const options = createMemo(() => {
    return panes.workspaces
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map((w) => {
        const isDeleting = toDelete() === w.name
        return {
          title: isDeleting
            ? `Press enter again to confirm delete "${w.name}"`
            : w.name,
          bg: isDeleting ? theme.error : undefined,
          value: w.name,
          category: "Workspaces",
          footer: Locale.time(w.updatedAt),
        }
      })
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <Show
      when={options().length > 0}
      fallback={
        <box padding={2} flexDirection="column" gap={1}>
          <text attributes={TextAttributes.BOLD}>Delete Workspace</text>
          <text fg={theme.textMuted}>No workspaces to delete.</text>
        </box>
      }
    >
      <DialogSelect
        title="Delete Workspace"
        options={options()}
        onSelect={(option) => {
          if (toDelete() === option.value) {
            panes.deleteWorkspace(option.value)
            setToDelete(undefined)
            if (panes.workspaces.length === 0) {
              dialog.clear()
            }
          } else {
            setToDelete(option.value)
          }
        }}
        onMove={() => setToDelete(undefined)}
      />
    </Show>
  )
}

/**
 * DialogWorkspaceRename - Select workspace then prompt for new name
 */
export function DialogWorkspaceRename() {
  const dialog = useDialog()
  const panes = usePanes()
  const { theme } = useTheme()

  const options = createMemo(() => {
    return panes.workspaces
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map((w) => ({
        title: w.name,
        value: w.name,
        category: "Workspaces",
        footer: Locale.time(w.updatedAt),
      }))
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <Show
      when={options().length > 0}
      fallback={
        <box padding={2} flexDirection="column" gap={1}>
          <text attributes={TextAttributes.BOLD}>Rename Workspace</text>
          <text fg={theme.textMuted}>No workspaces to rename.</text>
        </box>
      }
    >
      <DialogSelect
        title="Rename Workspace"
        options={options()}
        onSelect={(option) => {
          // Show rename prompt
          dialog.replace(() => (
            <DialogPrompt
              title="Rename Workspace"
              placeholder="Enter new name"
              value={option.value}
              description={() => (
                <text fg={theme.textMuted}>
                  Rename workspace "{option.value}"
                </text>
              )}
              onConfirm={(newName) => {
                if (newName.trim() && newName.trim() !== option.value) {
                  panes.renameWorkspace(option.value, newName.trim())
                }
                dialog.clear()
              }}
              onCancel={() => dialog.clear()}
            />
          ))
        }}
      />
    </Show>
  )
}

/**
 * DialogWorkspaceList - Display all workspaces with info
 */
export function DialogWorkspaceList() {
  const dialog = useDialog()
  const panes = usePanes()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("medium")
  })

  const sortedWorkspaces = createMemo(() =>
    panes.workspaces.toSorted((a, b) => b.updatedAt - a.updatedAt)
  )

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>Workspaces</text>
        <text fg={theme.textMuted}>{panes.workspaces.length} saved</text>
      </box>

      <Show
        when={sortedWorkspaces().length > 0}
        fallback={
          <text fg={theme.textMuted}>No workspaces saved yet.</text>
        }
      >
        <box flexDirection="column" gap={0} overflow="scroll">
          {sortedWorkspaces().map((w, i) => (
            <box flexDirection="row" gap={2}>
              <text fg={theme.primary} width={2}>{i + 1}.</text>
              <text
                fg={panes.currentWorkspace === w.name ? theme.success : theme.text}
                attributes={panes.currentWorkspace === w.name ? TextAttributes.BOLD : undefined}
              >
                {w.name}
                {panes.currentWorkspace === w.name ? " ●" : ""}
              </text>
              <text fg={theme.textMuted}>{Locale.time(w.updatedAt)}</text>
            </box>
          ))}
        </box>
      </Show>

      <box marginTop={1} flexDirection="column" gap={0}>
        <text fg={theme.textMuted}>
          SPC W 1-4 quick-load • SPC W s save • SPC W l load
        </text>
        <text fg={theme.textMuted}>
          Press esc to close
        </text>
      </box>
    </box>
  )
}
