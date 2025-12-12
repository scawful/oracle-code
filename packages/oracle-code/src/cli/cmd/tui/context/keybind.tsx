import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig } from "@oracle-code/sdk/v2"
import { TextareaRenderable, type ParsedKey, type Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

/**
 * Callback type for which-key integration
 */
export type WhichKeyHandler = {
  onActivate: () => void
  onDeactivate: () => void
  onKey: (key: string) => boolean // Returns true if handled
  isActive: () => boolean
}

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const sync = useSync()
    const keybinds = createMemo(() => {
      return pipe(
        sync.data.config.keybinds ?? {},
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    // Which-key handler (set by WhichKeyProvider)
    let whichKeyHandler: WhichKeyHandler | null = null

    let focus: Renderable | null
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        focus?.blur()

        // Notify which-key of activation
        whichKeyHandler?.onActivate()
        return
      }

      if (!active) {
        // Notify which-key of deactivation
        whichKeyHandler?.onDeactivate()

        if (focus && !renderer.currentFocusedRenderable) {
          focus.focus()
        }
        setStore("leader", false)
      }
    }

    useKeyboard(async (evt) => {
      if (evt.defaultPrevented) return
      if (!store.leader) {
        const leaderBindings = keybinds().leader ?? []
        const parsed = result.parse(evt)
        const normalized = { ...parsed, leader: false }
        const aliasNames = normalized.name === " "
          ? [" ", "space"]
          : normalized.name === "space"
            ? ["space", " "]
            : [normalized.name]

        const isLeaderKey = leaderBindings.some((binding) =>
          aliasNames.some((name) => Keybind.match(binding, { ...normalized, name })),
        )

        const focused = renderer.currentFocusedRenderable
        const isInputFocused = focused instanceof TextareaRenderable
        const isPlainSpaceLeader = leaderBindings.some((binding) => {
          if (binding.ctrl || binding.meta || binding.shift) return false
          return binding.name === "space" || binding.name === " "
        })
        const isPlainSpaceKey = !evt.ctrl && !evt.meta && !evt.shift && (evt.name === " " || evt.name === "space")

        if (isLeaderKey && !(isInputFocused && isPlainSpaceLeader && isPlainSpaceKey)) {
          leader(true)
          evt.preventDefault()
          return
        }
      }

      if (store.leader) {
        evt.preventDefault()
        const leaderBindings = keybinds().leader ?? []
        if (leaderBindings.length > 0) {
          const parsed = result.parse(evt)
          const normalized = { ...parsed, leader: false }
          const aliasNames = normalized.name === " "
            ? [" ", "space"]
            : normalized.name === "space"
              ? ["space", " "]
              : [normalized.name]

          const isLeaderAgain = leaderBindings.some((binding) =>
            aliasNames.some((name) => Keybind.match(binding, { ...normalized, name })),
          )

          if (isLeaderAgain) {
            leader(false)
            return
          }
        }
      }

      if (store.leader) {
        const keyName = evt.name ?? ""
        // If which-key is registered, let it handle the key
        const handler = whichKeyHandler
        if (handler) {
          const handled = handler.onKey(keyName)
          if (handled) {
            setImmediate(() => {
              if (!handler.isActive()) leader(false)
            })
            return
          }
        }

        // Fall back to original behavior - deactivate and restore focus
        setImmediate(() => {
          leader(false)
        })
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): Keybind.Info {
        if (evt.name === "\x1F")
          return {
            ctrl: true,
            name: "_",
            shift: false,
            leader: false,
            meta: false,
          }
        return {
          ctrl: evt.ctrl,
          name: evt.name,
          shift: evt.shift,
          leader: store.leader,
          meta: evt.meta,
        }
      },
      match(key: keyof KeybindsConfig, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const key of keybind) {
          if (Keybind.match(key, parsed)) {
            return true
          }
        }
      },
      print(key: keyof KeybindsConfig) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const result = Keybind.toString(first)
        return result.replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
      /**
       * Register which-key handler for leader key integration
       */
      setWhichKeyHandler(handler: WhichKeyHandler | null) {
        whichKeyHandler = handler
      },
      /**
       * Programmatically deactivate leader mode
       */
      deactivateLeader() {
        leader(false)
      },
    }
    return result
  },
})
