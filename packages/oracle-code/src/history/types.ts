/**
 * History Pipeline Types - AFS Cognitive Protocol v0.2
 *
 * Type definitions for the immutable episodic memory layer.
 * Per PROTOCOL_SPEC.md Section 2.
 */

import z from "zod"

/**
 * Operation types that can be logged to history.
 */
export const OperationType = z.enum([
  "tool_call",
  "agent_message",
  "user_input",
  "system_event",
  "cognitive_state",
])
export type OperationType = z.infer<typeof OperationType>

/**
 * Tracks the origin of a history entry.
 */
export const Provenance = z.object({
  agentId: z.string().optional(),
  modelId: z.string().optional(),
  parentMessageId: z.string().optional(),
  parentEntryId: z.string().optional(),
})
export type Provenance = z.infer<typeof Provenance>

/**
 * Metadata for retrieval and filtering.
 */
export const OperationMetadata = z.object({
  tags: z.array(z.string()).optional(),
  filesTouched: z.array(z.string()).optional(),
  tokenCount: z.number().optional(),
  redacted: z.boolean().optional(),
})
export type OperationMetadata = z.infer<typeof OperationMetadata>

/**
 * Details of the operation performed.
 */
export const Operation = z.object({
  type: OperationType,
  name: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
  durationMs: z.number().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
})
export type Operation = z.infer<typeof Operation>

/**
 * A single entry in the history log.
 * Represents an immutable record of an agent operation.
 */
export const HistoryEntry = z.object({
  id: z.string(), // ULID
  timestamp: z.string(), // ISO 8601
  sessionId: z.string(),
  projectId: z.string().optional(),

  operation: Operation,
  provenance: Provenance.optional(),
  metadata: OperationMetadata.optional(),

  extensions: z.record(z.string(), z.unknown()).optional(),
})
export type HistoryEntry = z.infer<typeof HistoryEntry>

/**
 * Session lifecycle states.
 */
export const SessionStatus = z.enum([
  "active",
  "suspended",
  "completed",
  "aborted",
])
export type SessionStatus = z.infer<typeof SessionStatus>

/**
 * Computed statistics for a session.
 */
export const SessionStats = z.object({
  operationCount: z.number().optional(),
  durationMs: z.number().optional(),
  filesModified: z.array(z.string()).optional(),
  toolsUsed: z.array(z.string()).optional(),
})
export type SessionStats = z.infer<typeof SessionStats>

/**
 * LLM-generated session summary.
 */
export const SessionSummaryContent = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
})
export type SessionSummaryContent = z.infer<typeof SessionSummaryContent>

/**
 * Information about a session.
 */
export const SessionInfo = z.object({
  id: z.string(), // ULID
  projectId: z.string().optional(),
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601

  status: SessionStatus.optional(),
  parentSessionId: z.string().optional(),

  stats: SessionStats.optional(),
  summary: SessionSummaryContent.optional(),

  extensions: z.record(z.string(), z.unknown()).optional(),
})
export type SessionInfo = z.infer<typeof SessionInfo>

/**
 * Query parameters for history retrieval.
 */
export const HistoryQuery = z.object({
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  operationTypes: z.array(OperationType).optional(),
  startTime: z.string().optional(), // ISO 8601
  endTime: z.string().optional(), // ISO 8601
  tags: z.array(z.string()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})
export type HistoryQuery = z.infer<typeof HistoryQuery>

/**
 * Cognitive state subtypes for type: "cognitive_state".
 */
export const CognitiveStateType = z.enum([
  "emotions",
  "metacognition",
  "epistemic",
  "goals",
])
export type CognitiveStateType = z.infer<typeof CognitiveStateType>
