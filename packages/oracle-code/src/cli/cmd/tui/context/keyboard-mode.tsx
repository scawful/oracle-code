import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { onMount, onCleanup } from "solid-js"
import { useKeyboard } from "@opentui/solid"

/**
 * Keyboard modes for different interaction contexts
 */
export type KeyboardMode = "normal" | "vim-navigation" | "input"

/**
 * A keyboard owner is a component that wants exclusive keyboard control
 */
export interface KeyboardOwner {
  id: string
  mode: KeyboardMode
  onKey: (evt: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) => boolean // return true if handled
  priority: number // higher = wins conflicts
}

export interface KeyboardModeContextData {
  owners: KeyboardOwner[]
  activeOwner: string | null
}

export const { use: useKeyboardMode, provider: KeyboardModeProvider } = createSimpleContext({
  name: "KeyboardMode",
  init: () => {
    const [store, setStore] = createStore<KeyboardModeContextData>({
      owners: [],
      activeOwner: null,
    })

    // Global keyboard listener that dispatches to active owner
    useKeyboard((evt) => {
      if (store.activeOwner) {
        const owner = store.owners.find((o) => o.id === store.activeOwner)
        if (owner) {
          owner.onKey({
            name: evt.name,
            ctrl: evt.ctrl,
            shift: evt.shift,
            meta: evt.meta,
          })
        }
      }
    })

    return {
      ready: true,

      /**
       * Register as keyboard owner - component claims exclusive keyboard input
       */
      acquire(id: string, config: Omit<KeyboardOwner, "id">) {
        const owner: KeyboardOwner = { id, ...config }
        setStore("owners", [...store.owners, owner])
        setStore("activeOwner", id)
      },

      /**
       * Release keyboard ownership - returns control to previous owner or null
       */
      release(id: string) {
        const filtered = store.owners.filter((o) => o.id !== id)
        setStore("owners", filtered)
        const next = filtered[filtered.length - 1]
        setStore("activeOwner", next?.id ?? null)
      },

      /**
       * Check if a specific component owns the keyboard
       */
      isOwner(id: string) {
        return store.activeOwner === id
      },

      /**
       * Get current keyboard owner ID (null if no owner)
       */
      get owner() {
        return store.activeOwner
      },

      /**
       * Get current keyboard mode
       */
      get mode(): KeyboardMode | null {
        const owner = store.owners.find((o) => o.id === store.activeOwner)
        return owner?.mode ?? null
      },

      /**
       * Check if keyboard is currently owned by any component
       */
      get isOwned() {
        return store.activeOwner !== null
      },

      /**
       * Dispatch a key event to the current owner
       * Returns true if the event was handled
       */
      dispatch(evt: { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean }): boolean {
        const owner = store.owners.find((o) => o.id === store.activeOwner)
        if (!owner) return false
        return owner.onKey(evt)
      },

      /**
       * Get all current owners (for debugging)
       */
      get owners() {
        return store.owners
      },
    }
  },
})

/**
 * Hook to acquire keyboard on mount and release on cleanup
 * IMPORTANT: Uses onMount to ensure proper SolidJS lifecycle timing
 */
export function useKeyboardOwnership(
  id: string,
  config: Omit<KeyboardOwner, "id">,
  keyboard: ReturnType<typeof useKeyboardMode>,
) {
  onMount(() => {
    keyboard.acquire(id, config)
  })
  onCleanup(() => keyboard.release(id))
}
