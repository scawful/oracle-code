# Oracle Code TUI Architecture

Quick reference for the terminal user interface architecture.

## Provider Hierarchy

```
ArgsProvider
└── ExitProvider
    └── KVProvider
        └── ToastProvider
            └── RouteProvider
                └── SDKProvider
                    └── SyncProvider
                        └── ThemeProvider
                            └── LocalProvider
                                └── AFSProvider
                                    └── AgentsProvider
                                        └── MetricsProvider
                                            └── ToMProvider
                                                └── AnalysisModeProvider
                                                    └── OrchestrationProvider
                                                        └── KeybindProvider
                                                            └── WhichKeyProvider ← NEW
                                                                └── PanesProvider ← NEW
                                                                    └── KeyboardModeProvider
                                                                        └── DialogProvider
                                                                            └── CommandProvider
                                                                                └── PromptHistoryProvider
                                                                                    └── PromptRefProvider
                                                                                        └── App
```

## Key Context Files

| Context | File | Purpose |
|---------|------|---------|
| Route | `context/route.tsx` | Navigation between home/session |
| Sync | `context/sync.tsx` | Server state synchronization |
| Theme | `context/theme.tsx` | Color theming |
| Local | `context/local.tsx` | Local preferences (model, agent) |
| Keybind | `context/keybind.tsx` | Keyboard shortcuts |
| **WhichKey** | `context/which-key.tsx` | Spacemacs command tree |
| **Panes** | `context/panes.tsx` | Window management |
| Dialog | `ui/dialog.tsx` | Modal stack |
| Command | `component/dialog-command.tsx` | Command palette |

## Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `home` | `routes/home.tsx` | Initial view, new session |
| `session` | `routes/session/index.tsx` | Active session with messages |

## Component Patterns

### Context Creation

```typescript
// Use createSimpleContext helper
export const { use: useMyContext, provider: MyProvider } = createSimpleContext({
  name: "MyContext",
  init: () => {
    const [store, setStore] = createStore({ ... })
    return {
      ready: true,
      get value() { return store.value },
      action() { setStore(...) }
    }
  }
})
```

### Dialog Pattern

```typescript
const dialog = useDialog()
dialog.replace(() => <MyDialog />)  // Show dialog
dialog.clear()                       // Close dialog
```

### Command Registration

```typescript
const command = useCommandDialog()
command.register(() => [
  {
    title: "My Command",
    value: "my.command",
    keybind: "my_keybind",
    category: "Category",
    onSelect: () => { ... }
  }
])
```

## Which-Key Integration

```typescript
// Register actions from any context
import { registerWhichKeyAction } from "@tui/context/which-key"

onMount(() => {
  registerWhichKeyAction("my.action", () => {
    // Handle action
  })
})
```

## Pane System

```typescript
const panes = usePanes()

// Operations
panes.split("vertical")      // SPC w /
panes.split("horizontal")    // SPC w -
panes.close()                // SPC w d
panes.focus("left")          // SPC w h
panes.setView(id, "afs")     // SPC b a
panes.maximize()             // SPC w m
```

## Styling

Uses `@opentui/solid` with flexbox layout:

```tsx
<box
  flexDirection="row"
  flexGrow={1}
  backgroundColor={theme.background}
  borderColor={theme.border}
  border={["left", "right"]}
>
  <text fg={theme.text}>Content</text>
</box>
```

## File Organization

```
src/cli/cmd/tui/
├── app.tsx              # Main app, provider tree
├── event.ts             # TUI events
├── context/             # State providers
│   ├── which-key.tsx    # Which-key system
│   ├── panes.tsx        # Pane management
│   └── ...
├── component/           # Reusable components
│   ├── which-key-bar.tsx
│   ├── pane-container.tsx
│   ├── pane-view.tsx
│   └── ...
├── routes/              # Route views
│   ├── home.tsx
│   └── session/
└── ui/                  # Base UI components
    ├── dialog.tsx
    └── toast.tsx
```
