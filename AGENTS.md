# CodeWizard Agent Swarm

## Core Philosophy
**CodeWizard** operates as a swarm of specialized agents using an **Agentic File System (AFS)** to maintain context and state.

## Agentic File System (AFS)
We use the `.context/` directory as our shared brain.
- **Read:** `.context/memory` for specs and rules.
- **Write:** `.context/scratchpad` for plans and reasoning.
- **Reference:** `.context/knowledge` for external data.

## Swarm Roles
- **@general**: Coordinator and user interface.
- **@planner**: Strategist. Creates plans in `.context/scratchpad`.
- **@coder**: Implementer. Writes code.
- **@critic**: Reviewer. Checks against specs.
- **@researcher**: Investigator. Finds facts.

## Instructions for Agents
1. **Check Context:** Before acting, check `.context/memory` and `.context/scratchpad`.
2. **Update Plan:** Keep the plan in `.context/scratchpad` up to date.
3. **Collaborate:** If you are unsure, ask the user or refer to `@planner`.

---

## Debugging

- To test oracle-code in the `packages/oracle-code` directory you can run `bun dev`

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE. Here is an example illustrating how to execute 3 parallel file reads in this chat environment:

json
{
"recipient_name": "multi_tool_use.parallel",
"parameters": {
"tool_uses": [
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.tsx"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.ts"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.md"
}
}
]
}
}