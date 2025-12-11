import { createMemo } from "solid-js"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { Keybind } from "@/util/keybind"
import { DialogStateEdit } from "./dialog-state-edit"
import { DialogConfirm } from "../ui/dialog-confirm"

export function DialogStateView() {
  const sync = useSync()
  const dialog = useDialog()

  const options = createMemo(() => {
    const entries = sync.data.state?.entries ?? []
    return entries.map((entry) => ({
      value: entry.key,
      title: entry.key,
      description: entry.value.length > 40 ? entry.value.slice(0, 40) + "..." : entry.value,
      category: entry.section.charAt(0).toUpperCase() + entry.section.slice(1),
      footer: entry.timestamp,
    }))
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("e")[0],
      title: "edit",
      onTrigger: async (option: { value: string }) => {
        const entry = sync.data.state?.entries.find((e) => e.key === option.value)
        if (!entry) return
        dialog.replace(() => (
          <DialogStateEdit
            mode="edit"
            initialKey={entry.key}
            initialValue={entry.value}
            initialSection={entry.section}
          />
        ))
      },
    },
    {
      keybind: Keybind.parse("d")[0],
      title: "delete",
      onTrigger: async (option: { value: string }) => {
        const confirmed = await DialogConfirm.show(
          dialog,
          "Delete Entry",
          `Are you sure you want to delete "${option.value}"?`,
        )
        if (confirmed) {
          await sync.state.remove(option.value)
        }
      },
    },
    {
      keybind: Keybind.parse("n")[0],
      title: "new",
      onTrigger: () => {
        dialog.replace(() => <DialogStateEdit mode="create" />)
      },
    },
  ])

  return (
    <DialogSelect
      title="Shared State"
      placeholder="Search state entries..."
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        // View full entry - edit on select
        const entry = sync.data.state?.entries.find((e) => e.key === option.value)
        if (!entry) return
        dialog.replace(() => (
          <DialogStateEdit
            mode="edit"
            initialKey={entry.key}
            initialValue={entry.value}
            initialSection={entry.section}
          />
        ))
      }}
    />
  )
}
