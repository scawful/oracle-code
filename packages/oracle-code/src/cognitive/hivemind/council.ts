/**
 * Hivemind Council Voting System
 *
 * Implements multi-agent consensus for resolving contested hivemind entries,
 * promoting decaying entries to golden status, and global promotion decisions.
 *
 * The council spawns configurable agents to vote on contested entries.
 * If votes are tied and debateOnTie is enabled, a structured debate round
 * is conducted before a final arbitration.
 */

import z from "zod"
import { ulid } from "ulid"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { Agent } from "../../agent/agent"
import { HivemindStore } from "./store"
import { HivemindDebate } from "./debate"
import { HivemindAudit } from "./audit"
import {
  CouncilSession,
  CouncilVote,
  CouncilPurpose,
  CouncilStatus,
  CouncilConfig,
  VoteChoice,
  HivemindEntry,
  type DebateInfo,
} from "./types"

export namespace HivemindCouncil {
  // =============
  // Bus Events
  // =============

  export const Event = {
    SessionCreated: BusEvent.define(
      "hivemind.council.session_created",
      z.object({
        sessionId: z.string(),
        purpose: CouncilPurpose,
        entryKey: z.string(),
      })
    ),
    VoteCast: BusEvent.define(
      "hivemind.council.vote_cast",
      z.object({
        sessionId: z.string(),
        agentRole: z.string(),
        vote: VoteChoice,
        confidence: z.number(),
      })
    ),
    SessionResolved: BusEvent.define(
      "hivemind.council.session_resolved",
      z.object({
        sessionId: z.string(),
        status: CouncilStatus,
        decision: z.enum(["approve", "reject"]).optional(),
      })
    ),
    DebateStarted: BusEvent.define(
      "hivemind.council.debate_started",
      z.object({
        sessionId: z.string(),
      })
    ),
  } as const

  // =============
  // Prompts
  // =============

  const VOTE_PROMPT = `You are a council member evaluating a contested hivemind entry.

## Context
- Entry Category: {category}
- Entry Key: {key}
- Purpose: {purpose}
- Contest Reason: {contestReason}

## Current Value
{currentValue}

## Proposed Value  
{proposedValue}

## Your Task
Analyze both values objectively. Consider:
1. Accuracy - Which is more factually correct?
2. Usefulness - Which provides more actionable guidance?
3. Consistency - Which aligns better with existing knowledge?
4. Impact - What are the consequences of each choice?

## Response Format
You MUST respond with ONLY a JSON object, no other text:
{
  "vote": "approve" | "reject" | "abstain",
  "confidence": 0.0-1.0,
  "rationale": "Brief explanation (1-2 sentences)"
}

If you lack sufficient context to judge, vote "abstain".
`

  // =============
  // Session Management
  // =============

  /**
   * Create a new council session
   */
  export async function createSession(
    purpose: CouncilPurpose,
    entryKey: string,
    contestReason: string,
    currentValue: string,
    proposedValue: string,
    config?: Partial<CouncilConfig>,
    contextRoot?: string
  ): Promise<CouncilSession> {
    const manifest = await HivemindStore.getManifest(contextRoot)
    const councilConfig = CouncilConfig.parse({
      ...manifest.council,
      ...config,
    })

    const session: CouncilSession = {
      id: ulid(),
      purpose,
      entryKey,
      contestReason,
      currentValue,
      proposedValue,
      votes: [],
      config: councilConfig,
      status: "voting",
      audit: {
        initiatedBy: "", // Will be set by caller
        initiatedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    }

    await HivemindStore.saveCouncilSession(session, contextRoot)

    Bus.publish(Event.SessionCreated, {
      sessionId: session.id,
      purpose,
      entryKey,
    })

    return session
  }

  /**
   * Get a council session by ID
   */
  export async function getSession(
    sessionId: string,
    contextRoot?: string
  ): Promise<CouncilSession | null> {
    const state = await HivemindStore.getState(contextRoot)
    return state.councils.find((c) => c.id === sessionId) || null
  }

  /**
   * Get all active council sessions
   */
  export async function getActiveSessions(contextRoot?: string): Promise<CouncilSession[]> {
    return HivemindStore.getActiveCouncils(contextRoot)
  }

  // =============
  // Voting
  // =============

  /**
   * Cast a vote in a council session
   */
  export async function castVote(
    sessionId: string,
    vote: CouncilVote,
    contextRoot?: string
  ): Promise<CouncilSession | null> {
    const session = await getSession(sessionId, contextRoot)
    if (!session) return null
    if (session.status !== "voting" && session.status !== "debating") return null

    // Check if this agent already voted
    const existingVoteIndex = session.votes.findIndex(
      (v) => v.agentRole === vote.agentRole
    )
    if (existingVoteIndex >= 0) {
      session.votes[existingVoteIndex] = vote
    } else {
      session.votes.push(vote)
    }

    await HivemindStore.saveCouncilSession(session, contextRoot)

    Bus.publish(Event.VoteCast, {
      sessionId,
      agentRole: vote.agentRole,
      vote: vote.vote,
      confidence: vote.confidence,
    })

    return session
  }

  /**
   * Check if quorum is reached
   */
  export function checkQuorum(session: CouncilSession): boolean {
    const validVotes = session.votes.filter((v) => v.vote !== "abstain")
    return validVotes.length >= session.config.quorum
  }

  /**
   * Calculate vote results
   */
  export function calculateResults(session: CouncilSession): {
    approvalRatio: number
    totalWeight: number
    approveWeight: number
    rejectWeight: number
    isTie: boolean
    hasQuorum: boolean
  } {
    const validVotes = session.votes.filter((v) => v.vote !== "abstain")
    const hasQuorum = validVotes.length >= session.config.quorum

    const approveVotes = validVotes.filter((v) => v.vote === "approve")
    const rejectVotes = validVotes.filter((v) => v.vote === "reject")

    const approveWeight = approveVotes.reduce((sum, v) => sum + v.confidence, 0)
    const rejectWeight = rejectVotes.reduce((sum, v) => sum + v.confidence, 0)
    const totalWeight = approveWeight + rejectWeight

    const approvalRatio = totalWeight > 0 ? approveWeight / totalWeight : 0.5

    // Tie if neither side reaches threshold
    const threshold = session.config.threshold
    const isTie =
      approvalRatio >= 1 - threshold &&
      approvalRatio <= threshold &&
      Math.abs(approveWeight - rejectWeight) < 0.1

    return {
      approvalRatio,
      totalWeight,
      approveWeight,
      rejectWeight,
      isTie,
      hasQuorum,
    }
  }

  // =============
  // Resolution
  // =============

  /**
   * Resolve a council session (determine outcome based on votes)
   */
  export async function resolveSession(
    sessionId: string,
    contextRoot?: string
  ): Promise<CouncilSession | null> {
    const session = await getSession(sessionId, contextRoot)
    if (!session) return null

    const results = calculateResults(session)

    if (!results.hasQuorum) {
      session.status = "rejected"
      session.result = {
        finalDecision: "reject",
        confidence: 0,
        rationale: "Insufficient votes to reach quorum",
      }
    } else if (results.isTie && session.config.debateOnTie) {
      session.status = "tie"
      // Caller should initiate debate
    } else if (results.approvalRatio >= session.config.threshold) {
      session.status = "approved"
      session.result = {
        finalDecision: "approve",
        confidence: results.approvalRatio,
        rationale: formatVoteRationale(session, "approve"),
      }
    } else if (results.approvalRatio <= 1 - session.config.threshold) {
      session.status = "rejected"
      session.result = {
        finalDecision: "reject",
        confidence: 1 - results.approvalRatio,
        rationale: formatVoteRationale(session, "reject"),
      }
    } else {
      // In the middle - default to reject if no clear majority
      session.status = "rejected"
      session.result = {
        finalDecision: "reject",
        confidence: 1 - results.approvalRatio,
        rationale: "No clear majority reached",
      }
    }

    if (session.status !== "tie") {
      session.audit.completedAt = new Date().toISOString()
    }
    await HivemindStore.saveCouncilSession(session, contextRoot)

    Bus.publish(Event.SessionResolved, {
      sessionId,
      status: session.status,
      decision: session.result?.finalDecision,
    })

    return session
  }

  function formatVoteRationale(session: CouncilSession, decision: "approve" | "reject"): string {
    const relevantVotes = session.votes.filter((v) => v.vote === decision)
    if (relevantVotes.length === 0) return `No ${decision} votes to cite`

    const topVote = relevantVotes.sort((a, b) => b.confidence - a.confidence)[0]
    return `${topVote.agentRole} (conf: ${topVote.confidence}): ${topVote.rationale}`
  }

  // =============
  // Agent Spawning
  // =============

  /**
   * Get the voting prompt for an agent
   */
  export function getVotingPrompt(
    session: CouncilSession,
    entry?: HivemindEntry
  ): string {
    return VOTE_PROMPT.replace("{category}", entry?.category || "unknown")
      .replace("{key}", session.entryKey)
      .replace("{purpose}", formatPurpose(session.purpose))
      .replace("{contestReason}", session.contestReason)
      .replace("{currentValue}", session.currentValue)
      .replace("{proposedValue}", session.proposedValue)
  }

  function formatPurpose(purpose: CouncilPurpose): string {
    switch (purpose) {
      case "conflict":
        return "Resolve conflict between two values"
      case "decay_promotion":
        return "Decide if decaying entry should be promoted to golden (permanent)"
      case "global_promotion":
        return "Decide if project entry should be promoted to global hivemind"
    }
  }

  /**
   * Spawn voting agents and collect votes
   */
  export async function spawnVotingAgents(
    session: CouncilSession,
    parentSessionId: string,
    contextRoot?: string
  ): Promise<CouncilSession> {
    const agentRoles = session.config.councilAgents
    const entry = await HivemindStore.search(session.entryKey, contextRoot).then(
      (results) => results[0]
    )
    const prompt = getVotingPrompt(session, entry)

    // Update session to show we're collecting votes
    session.audit.initiatedBy = parentSessionId
    await HivemindStore.saveCouncilSession(session, contextRoot)

    // Spawn agents in parallel
    const votePromises = agentRoles.map(async (agentRole) => {
      try {
        const vote = await spawnSingleVotingAgent(agentRole, prompt, parentSessionId)
        if (vote) {
          await castVote(session.id, vote, contextRoot)
        }
      } catch (error) {
        console.error(`Council vote failed for ${agentRole}:`, error)
        // Cast abstain on error
        await castVote(
          session.id,
          {
            agentRole,
            vote: "abstain",
            confidence: 0,
            rationale: `Agent error: ${error}`,
            timestamp: new Date().toISOString(),
          },
          contextRoot
        )
      }
    })

    await Promise.all(votePromises)

    // Get updated session with all votes
    const updated = await getSession(session.id, contextRoot)
    return updated || session
  }

  async function spawnSingleVotingAgent(
    agentRole: string,
    prompt: string,
    parentSessionId: string
  ): Promise<CouncilVote | null> {
    const agent = await Agent.get(agentRole)
    if (!agent) {
      console.warn(`Agent ${agentRole} not found, using general`)
      // Fallback to general if specific agent not found
      const generalAgent = await Agent.get("general")
      if (!generalAgent) return null
    }

    const agentToUse = agent || (await Agent.get("general"))
    if (!agentToUse) return null

    // Create a subagent session
    const councilSession = await Session.create({
      parentID: parentSessionId,
      title: `Council vote (@${agentRole})`,
    })

    try {
      const result = await SessionPrompt.prompt({
        sessionID: councilSession.id,
        model: agentToUse.model
          ? { modelID: agentToUse.model.modelID, providerID: agentToUse.model.providerID }
          : undefined,
        agent: agentToUse.name,
        tools: {
          // Disable most tools for voting - just need reasoning
          task: false,
          todowrite: false,
          todoread: false,
          edit: false,
          write: false,
          bash: false,
        },
        parts: [{ type: "text", text: prompt }],
      })

      // Parse the vote from the response
      const textPart = result.parts.find((p) => p.type === "text")
      if (!textPart || textPart.type !== "text") return null

      return parseVoteResponse(textPart.text, agentRole)
    } catch (error) {
      console.error(`Failed to get vote from ${agentRole}:`, error)
      return null
    }
  }

  function parseVoteResponse(text: string, agentRole: string): CouncilVote | null {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0])

      // Validate the vote
      const vote = VoteChoice.safeParse(parsed.vote)
      if (!vote.success) return null

      return {
        agentRole,
        vote: vote.data,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        rationale: parsed.rationale || "No rationale provided",
        timestamp: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }

  // =============
  // Apply Result
  // =============

  /**
   * Apply the council result to the hivemind
   */
  export async function applyResult(
    sessionId: string,
    contextRoot?: string
  ): Promise<{
    success: boolean
    action?: "created" | "updated" | "promoted_golden" | "promoted_global" | "rejected"
    entryId?: string
  }> {
    const session = await getSession(sessionId, contextRoot)
    if (!session || !session.result) {
      return { success: false }
    }

    if (session.result.finalDecision === "reject") {
      // Nothing to apply for rejection
      return { success: true, action: "rejected" }
    }

    // Handle based on purpose
    switch (session.purpose) {
      case "conflict": {
        // Find and update the entry
        const entries = await HivemindStore.search(session.entryKey, contextRoot)
        if (entries.length > 0) {
          await HivemindStore.updateEntry(
            entries[0].id,
            {
              value: session.proposedValue,
              status: "active",
              contested: undefined,
            },
            contextRoot
          )
          return { success: true, action: "updated", entryId: entries[0].id }
        }
        return { success: false }
      }

      case "decay_promotion": {
        // Find and promote to golden
        const entries = await HivemindStore.search(session.entryKey, contextRoot)
        if (entries.length > 0) {
          await HivemindStore.promoteToGolden(
            entries[0].id,
            "council",
            sessionId,
            contextRoot
          )
          return { success: true, action: "promoted_golden", entryId: entries[0].id }
        }
        return { success: false }
      }

      case "global_promotion": {
        // Find project entry and copy to global
        const entries = await HivemindStore.search(session.entryKey, contextRoot, "project")
        if (entries.length > 0) {
          const entry = entries[0]
          // Destructure to remove id before creating new entry
          const { id: _id, ...entryWithoutId } = entry
          const globalEntry = await HivemindStore.addEntry(
            {
              ...entryWithoutId,
              scope: "global",
              source: {
                ...entry.source,
                promotionReason: `Council-approved global promotion: ${session.result.rationale}`,
              },
            },
            contextRoot
          )
          return { success: true, action: "promoted_global", entryId: globalEntry.id }
        }
        return { success: false }
      }
    }
  }

  // =============
  // Full Council Flow
  // =============

  /**
   * Run a complete council vote (spawn agents, collect votes, resolve, apply)
   */
  export async function runCouncil(
    purpose: CouncilPurpose,
    entryKey: string,
    contestReason: string,
    currentValue: string,
    proposedValue: string,
    parentSessionId: string,
    config?: Partial<CouncilConfig>,
    contextRoot?: string
  ): Promise<{
    session: CouncilSession
    result: { success: boolean; action?: string; entryId?: string }
  }> {
    // Create session
    let session = await createSession(
      purpose,
      entryKey,
      contestReason,
      currentValue,
      proposedValue,
      config,
      contextRoot
    )

    // Spawn voting agents
    session = await spawnVotingAgents(session, parentSessionId, contextRoot)

    // Resolve votes
    session = (await resolveSession(session.id, contextRoot)) || session

    // Handle tie with debate if configured
    let debate: DebateInfo | undefined
    if (session.status === "tie" && session.config.debateOnTie) {
      Bus.publish(Event.DebateStarted, { sessionId: session.id })
      const debated = await HivemindDebate.startDebate(session.id, parentSessionId, contextRoot)
      if (debated) {
        session = debated.session
        debate = debated.debate
      } else {
        session.status = "rejected"
        session.result = {
          finalDecision: "reject",
          confidence: 0,
          rationale: "Debate failed to resolve tie",
        }
        session.audit.completedAt = new Date().toISOString()
        await HivemindStore.saveCouncilSession(session, contextRoot)
      }
    }

    // Apply result
    const result = await applyResult(session.id, contextRoot)
    if (session.result) {
      try {
        await HivemindAudit.logCouncilSession(
          session,
          {
            entryId: result.entryId || session.entryKey,
            action: result.action || "rejected",
            previousValue: result.action === "updated" ? session.currentValue : undefined,
            newValue: result.action === "updated" ? session.proposedValue : undefined,
          },
          debate,
          contextRoot
        )
      } catch (error) {
        console.error("Failed to write council audit log:", error)
      }
    }

    return { session, result }
  }
}
