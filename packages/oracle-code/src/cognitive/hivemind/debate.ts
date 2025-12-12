/**
 * Hivemind Debate System
 *
 * Handles structured debate rounds when council votes result in a tie.
 * Two agents argue for and against the proposed change, followed by
 * arbitration to reach a final decision.
 */

import z from "zod"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { Agent } from "../../agent/agent"
import { HivemindStore } from "./store"
import {
  CouncilSession,
  DebateRound,
  DebateInfo,
} from "./types"

export namespace HivemindDebate {
  // =============
  // Constants
  // =============

  const DEFAULT_DEBATE_ROUNDS = 2

  // =============
  // Bus Events
  // =============

  export const Event = {
    RoundCompleted: BusEvent.define(
      "hivemind.debate.round_completed",
      z.object({
        sessionId: z.string(),
        round: z.number(),
      })
    ),
    DebateCompleted: BusEvent.define(
      "hivemind.debate.completed",
      z.object({
        sessionId: z.string(),
        decision: z.enum(["approve", "reject"]),
      })
    ),
  } as const

  // =============
  // Prompts
  // =============

  const DEBATE_PRO_PROMPT = `You are debating a contested hivemind entry. You are arguing IN FAVOR of the proposed change.

## Entry Key: {key}
## Current Value
{currentValue}

## Proposed Value (you support this)
{proposedValue}

## Contest Reason
{contestReason}

{previousArgument}

Make your argument in 2-3 sentences. Be specific and provide evidence or reasoning.
Focus on why the proposed value is better than the current value.
Respond with ONLY your argument text, no JSON or formatting.
`

  const DEBATE_CON_PROMPT = `You are debating a contested hivemind entry. You are arguing AGAINST the proposed change (in favor of keeping the current value).

## Entry Key: {key}
## Current Value (you support this)
{currentValue}

## Proposed Value
{proposedValue}

## Contest Reason
{contestReason}

{previousArgument}

Make your argument in 2-3 sentences. Be specific and provide evidence or reasoning.
Focus on why the current value should be kept over the proposed change.
Respond with ONLY your argument text, no JSON or formatting.
`

  const ARBITRATOR_PROMPT = `You are the arbitrator for a hivemind debate. You must synthesize a final decision.

## Entry Key: {key}

## Current Value
{currentValue}

## Proposed Value
{proposedValue}

## Contest Reason
{contestReason}

## Initial Vote Results
{voteResults}

## Debate Rounds
{debateRounds}

Your task is to make the final decision based on:
1. The strength of arguments from both sides
2. The confidence levels of the initial votes
3. The evidence and reasoning presented

You MUST respond with ONLY a JSON object, no other text:
{
  "decision": "approve" | "reject",
  "confidence": 0.0-1.0,
  "rationale": "A synthesis explaining your decision (2-3 sentences)"
}
`

  // =============
  // Debate Management
  // =============

  /**
   * Start a debate for a tied council session
   */
  export async function startDebate(
    sessionId: string,
    parentSessionId: string,
    contextRoot?: string
  ): Promise<{ session: CouncilSession; debate: DebateInfo } | null> {
    const session = await getSession(sessionId, contextRoot)
    if (!session || session.status !== "tie") return null

    // Mark as debating
    session.status = "debating"
    await HivemindStore.saveCouncilSession(session, contextRoot)

    // Select pro and con agents from voters
    const proVote = session.votes.find((v) => v.vote === "approve")
    const conVote = session.votes.find((v) => v.vote === "reject")

    // Fallback to general agents if no clear pro/con voters
    const proAgent = proVote?.agentRole || "general"
    const conAgent = conVote?.agentRole || "critic"

    // Run debate rounds
    const debateInfo: DebateInfo = {
      rounds: [],
      arbitratorAgent: "general",
    }

    let previousProArgument = ""
    let previousConArgument = ""

    for (let round = 1; round <= DEFAULT_DEBATE_ROUNDS; round++) {
      // Pro argues
      const proArgument = await runDebateAgent(
        session,
        proAgent,
        "pro",
        previousConArgument ? `## Opponent's Last Argument\n${previousConArgument}` : "",
        parentSessionId
      )

      // Con responds
      const conArgument = await runDebateAgent(
        session,
        conAgent,
        "con",
        proArgument ? `## Opponent's Last Argument\n${proArgument}` : "",
        parentSessionId
      )

      debateInfo.rounds.push({
        round,
        proArgument: proArgument || "No argument provided",
        conArgument: conArgument || "No argument provided",
        proAgent,
        conAgent,
      })

      previousProArgument = proArgument || ""
      previousConArgument = conArgument || ""

      Bus.publish(Event.RoundCompleted, { sessionId, round })
    }

    // Run arbitration
    const arbitrationResult = await runArbitration(
      session,
      debateInfo,
      parentSessionId
    )

    // Update session with debate info and result
    session.result = arbitrationResult || {
      finalDecision: "reject",
      confidence: 0.5,
      rationale: "Arbitration failed, defaulting to reject",
    }
    session.status = session.result.finalDecision === "approve" ? "approved" : "rejected"
    session.audit.completedAt = new Date().toISOString()

    // Save debate info (we'll store it in the audit log)
    debateInfo.finalSynthesis = session.result.rationale
    debateInfo.arbitratorAgent = "general"

    await HivemindStore.saveCouncilSession(session, contextRoot)

    Bus.publish(Event.DebateCompleted, {
      sessionId,
      decision: session.result.finalDecision,
    })

    return { session, debate: debateInfo }
  }

  async function getSession(
    sessionId: string,
    contextRoot?: string
  ): Promise<CouncilSession | null> {
    const state = await HivemindStore.getState(contextRoot, "project")
    return state.councils.find((c) => c.id === sessionId) || null
  }

  /**
   * Run a single debate agent's turn
   */
  async function runDebateAgent(
    session: CouncilSession,
    agentRole: string,
    position: "pro" | "con",
    previousArgument: string,
    parentSessionId: string
  ): Promise<string | null> {
    const agent = await Agent.get(agentRole)
    if (!agent) {
      const fallback = await Agent.get("general")
      if (!fallback) return null
    }

    const agentToUse = agent || (await Agent.get("general"))
    if (!agentToUse) return null

    const prompt =
      position === "pro"
        ? DEBATE_PRO_PROMPT.replace("{key}", session.entryKey)
            .replace("{currentValue}", session.currentValue)
            .replace("{proposedValue}", session.proposedValue)
            .replace("{contestReason}", session.contestReason)
            .replace("{previousArgument}", previousArgument)
        : DEBATE_CON_PROMPT.replace("{key}", session.entryKey)
            .replace("{currentValue}", session.currentValue)
            .replace("{proposedValue}", session.proposedValue)
            .replace("{contestReason}", session.contestReason)
            .replace("{previousArgument}", previousArgument)

    const debateSession = await Session.create({
      parentID: parentSessionId,
      title: `Debate ${position} (@${agentRole})`,
    })

    try {
      const result = await SessionPrompt.prompt({
        sessionID: debateSession.id,
        model: agentToUse.model
          ? { modelID: agentToUse.model.modelID, providerID: agentToUse.model.providerID }
          : undefined,
        agent: agentToUse.name,
        tools: {
          task: false,
          todowrite: false,
          todoread: false,
          edit: false,
          write: false,
          bash: false,
        },
        parts: [{ type: "text", text: prompt }],
      })

      const textPart = result.parts.find((p) => p.type === "text")
      if (!textPart || textPart.type !== "text") return null

      return textPart.text.trim()
    } catch (error) {
      console.error(`Debate agent ${agentRole} failed:`, error)
      return null
    }
  }

  /**
   * Run the arbitrator to make final decision
   */
  async function runArbitration(
    session: CouncilSession,
    debateInfo: DebateInfo,
    parentSessionId: string
  ): Promise<{ finalDecision: "approve" | "reject"; confidence: number; rationale: string } | null> {
    const arbitratorAgent = await Agent.get("general")
    if (!arbitratorAgent) return null

    // Format vote results
    const voteResults = session.votes
      .map((v) => `- ${v.agentRole}: ${v.vote} (confidence: ${v.confidence}) - "${v.rationale}"`)
      .join("\n")

    // Format debate rounds
    const debateRounds = debateInfo.rounds
      .map(
        (r) =>
          `### Round ${r.round}\n**Pro (${r.proAgent}):** ${r.proArgument}\n**Con (${r.conAgent}):** ${r.conArgument}`
      )
      .join("\n\n")

    const prompt = ARBITRATOR_PROMPT.replace("{key}", session.entryKey)
      .replace("{currentValue}", session.currentValue)
      .replace("{proposedValue}", session.proposedValue)
      .replace("{contestReason}", session.contestReason)
      .replace("{voteResults}", voteResults)
      .replace("{debateRounds}", debateRounds)

    const arbSession = await Session.create({
      parentID: parentSessionId,
      title: `Arbitration (@general)`,
    })

    try {
      const result = await SessionPrompt.prompt({
        sessionID: arbSession.id,
        model: arbitratorAgent.model
          ? { modelID: arbitratorAgent.model.modelID, providerID: arbitratorAgent.model.providerID }
          : undefined,
        agent: arbitratorAgent.name,
        tools: {
          task: false,
          todowrite: false,
          todoread: false,
          edit: false,
          write: false,
          bash: false,
        },
        parts: [{ type: "text", text: prompt }],
      })

      const textPart = result.parts.find((p) => p.type === "text")
      if (!textPart || textPart.type !== "text") return null

      // Parse the arbitrator's decision
      return parseArbitrationResponse(textPart.text)
    } catch (error) {
      console.error("Arbitration failed:", error)
      return null
    }
  }

  function parseArbitrationResponse(
    text: string
  ): { finalDecision: "approve" | "reject"; confidence: number; rationale: string } | null {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0])

      if (parsed.decision !== "approve" && parsed.decision !== "reject") {
        return null
      }

      return {
        finalDecision: parsed.decision,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        rationale: parsed.rationale || "No rationale provided",
      }
    } catch {
      return null
    }
  }

  /**
   * Get debate info for a completed session
   */
  export function formatDebateSummary(debateInfo: DebateInfo): string {
    const roundsSummary = debateInfo.rounds
      .map(
        (r) =>
          `Round ${r.round}:\n  Pro (${r.proAgent}): ${r.proArgument}\n  Con (${r.conAgent}): ${r.conArgument}`
      )
      .join("\n\n")

    return `Debate Summary:\n${roundsSummary}\n\nFinal Synthesis: ${debateInfo.finalSynthesis || "N/A"}`
  }
}
