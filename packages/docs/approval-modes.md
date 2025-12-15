# Approval Modes

Control how Oracle Code handles tool permission requests during AI sessions.

## Quick Reference

| Mode          | Symbol | Auto-Approves   | Best For                |
| ------------- | ------ | --------------- | ----------------------- |
| **Manual**    | ○      | Nothing         | Learning, critical work |
| **Auto-Edit** | ✓      | File operations | Daily coding            |
| **YOLO**      | !      | Everything      | Trusted automation      |

**Switch modes:** Press `Ctrl+A` to cycle through modes.

---

## Manual Approval (○)

**Default mode** - Safest option

Every tool requires your approval:

- Press `Enter` to approve once
- Press `a` to approve always
- Press `d` to deny
- Press `Esc` to deny

**Use when:**

- Learning how Oracle Code works
- Working on critical code
- You want maximum control

**Example:**

```
User: "Fix the bug in auth.ts"
AI: Wants to use 'edit' tool
You: Press Enter ✓
AI: Wants to use 'bash' tool
You: Press Enter ✓
```

---

## Auto-Edit Mode (✓)

**Recommended** - Balanced automation

Automatically approves **file operations** while requiring approval for potentially dangerous actions.

**Auto-approved tools:**

- `edit` - Edit existing files
- `write` - Create new files
- `patch` - Apply patches
- `todowrite` - Update todos

**Still requires approval:**

- `bash` - Shell commands
- `webfetch` - Web requests
- `task` - Subagents
- Other tools

**Use when:**

- Daily coding work
- Refactoring multiple files
- You trust the AI but want safety rails

**Example:**

```
User: "Refactor the auth module"
AI: Edits auth.ts
Toast: "Auto-approved edit" ✓
AI: Edits auth-types.ts
Toast: "Auto-approved edit" ✓
AI: Wants to run tests
You: Press Enter ✓
```

---

## YOLO Mode (!)

**⚠️ Dangerous** - Full automation

Automatically approves **ALL** tools without prompting.

**Use when:**

- Fully trusted workflows
- Sandbox/test environments only
- You accept all risks

**Do NOT use:**

- ❌ On production code
- ❌ With untrusted prompts
- ❌ Without Git backup

**Example:**

```
User: "Set up the testing infrastructure"
AI: Runs npm install
Toast: "Auto-approved bash" ✓
AI: Creates config files
Toast: "Auto-approved write" ✓
[Everything happens automatically]
```

---

## How to Switch Modes

### Keyboard Shortcut

Press **Ctrl+A** to cycle:

```
Manual → Auto-Edit → YOLO → Manual → ...
```

### Command Palette

1. Press **Ctrl+P**
2. Type "approval"
3. Select "Toggle Approval Mode"

### Visual Indicator

Current mode is shown in the footer (bottom right):

```
○ Manual Approval
✓ Auto-Edit
! YOLO Mode
```

---

## Best Practices

### 1. Start with Manual

Learn which tools the AI uses most frequently.

### 2. Use Auto-Edit for Daily Work

Strikes the right balance between speed and safety.

### 3. Always Use Git

File edits are reversible with version control.

### 4. Reserve YOLO for Sandboxes

Only use in disposable test environments.

### 5. Watch the Toasts

Even in auto-approval modes, notifications show what's happening.

### 6. Review Before Committing

Auto-approved edits still need your review before git commit.

---

## Common Scenarios

### Learning Oracle Code

**Mode:** Manual (○)  
See every tool request to understand AI behavior.

### Implementing a Feature

**Mode:** Auto-Edit (✓)  
File edits auto-approved, manual control over commands.

### Large Refactor

**Mode:** Auto-Edit (✓)  
Reduce interruptions across many files.

### Automated Setup

**Mode:** YOLO (!) in sandbox  
Fully hands-off automation.

### Production Hotfix

**Mode:** Manual (○)  
Maximum safety for critical changes.

---

## Security Notes

### Manual Mode

- ✅ No unexpected actions
- ✅ Full visibility
- ✅ Maximum security

### Auto-Edit Mode

- ✅ File changes are reversible (Git)
- ✅ No code execution without approval
- ⚠️ Could create many files quickly

### YOLO Mode

- ❌ Can run arbitrary commands
- ❌ Can delete files
- ❌ Can spawn expensive operations
- ⚠️ **Use ONLY in isolated environments**

---

## Troubleshooting

**Q: Ctrl+A doesn't work**  
A: Press `Esc` first to ensure you're not in a text input.

**Q: Tools still ask in Auto-Edit mode**  
A: Only file operations auto-approve. Shell commands (`bash`) still need approval.

**Q: How do I disable YOLO mode?**  
A: It's not locked - just press `Ctrl+A` to cycle back to Manual.

**Q: Does mode persist between sessions?**  
A: No, resets to Manual on restart for safety.

---

## Summary

Choose your approval mode based on trust and risk:

- **Manual (○)** - Safe but slow
- **Auto-Edit (✓)** - Balanced ⭐ **Recommended**
- **YOLO (!)** - Fast but dangerous

**Pro tip:** Most users should use **Auto-Edit mode** for daily coding and only switch to Manual when working on critical code or YOLO for throwaway experiments.

---

## Tool Whitelist

In addition to approval modes, you can permanently whitelist specific tools to auto-approve them across all sessions.

### Default Whitelist

These safe, read-only tools are whitelisted by default:
- `list` - Directory listing
- `read` - File reading
- `glob` - Pattern matching
- `grep` - Content search
- `todoread` - Read todos

### How Whitelist Works

**Whitelisted tools:**
- ✅ Auto-approved across ALL sessions
- ✅ Auto-approved in ANY approval mode
- ✅ Use `always` permission (permanent)
- ✅ Show "Whitelisted: toolname" toast

**Non-whitelisted tools:**
- Behavior depends on approval mode
- Manual mode: requires approval
- Auto-Edit mode: may auto-approve edits
- YOLO mode: auto-approves everything

### Configuration

#### Global Whitelist
Add to `~/.config/oracle-code/config.json`:
```json
{
  "permission": {
    "whitelist": {
      "global": ["list", "read", "glob", "grep", "bash"]
    }
  }
}
```

#### Project Whitelist
Add to `.oracle-code/config.json` or `opencode.json`:
```json
{
  "permission": {
    "whitelist": {
      "project": ["write", "edit", "patch"]
    }
  }
}
```

#### Clear Whitelist
To disable default whitelist:
```json
{
  "permission": {
    "whitelist": {
      "global": []
    }
  }
}
```

### Visual Indicator

The footer shows whitelisted tool count:
```
○ Manual Approval    ✓ 5 Whitelisted    • 2 LSP    ⊙ 3 MCP
```

### Whitelist + Approval Modes

The whitelist is **additive** - it works alongside approval modes:

**Manual Mode + Whitelist:**
- Whitelisted tools: Auto-approved ✓
- Other tools: Manual approval required

**Auto-Edit Mode + Whitelist:**
- Whitelisted tools: Auto-approved ✓
- Edit tools: Auto-approved ✓
- Other tools: Manual approval required

**YOLO Mode + Whitelist:**
- All tools auto-approved
- Whitelist has no additional effect

### Best Practices

**Safe to whitelist:**
- Read-only tools: `list`, `read`, `glob`, `grep`
- Informational tools: `todoread`, `state_read`

**Use caution:**
- `bash` - Can run arbitrary commands
- `write`, `edit`, `patch` - Modify files
- `webfetch` - External network access

**Recommendation:**
- Keep global whitelist minimal (read-only tools)
- Use project whitelist for project-specific needs
- Don't whitelist dangerous tools globally

### Example Use Cases

**Scenario 1: Data Analysis Project**
```json
{
  "permission": {
    "whitelist": {
      "project": ["bash"]
    }
  }
}
```
Whitelist `bash` for this project to run data processing commands.

**Scenario 2: Documentation Project**
```json
{
  "permission": {
    "whitelist": {
      "project": ["write"]
    }
  }
}
```
Whitelist `write` to create new documentation files without prompting.

**Scenario 3: Read-Only Review**
```json
{
  "permission": {
    "whitelist": {
      "global": ["list", "read", "glob", "grep"],
      "project": []
    }
  }
}
```
Only allow read operations, no modifications.

