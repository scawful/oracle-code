import { describe, expect, test } from "bun:test"
import { TaskTracking } from "../../src/metrics/tracking"

describe("TaskTracking", () => {
  test("createTrackedOutcome stores errors list and count", () => {
    const errors = [
      {
        type: "logical_contradiction" as const,
        severity: 0.5,
        evidence: "contradiction",
        timestamp: Date.now(),
      },
    ]

    const outcome = TaskTracking.createTrackedOutcome({
      sessionID: "s1",
      taskID: "t1",
      agentID: "a1",
      agentName: "a1",
      partnerIDs: undefined,
      success: true,
      tokens: 10,
      duration: 100,
      errors,
      taskDescription: "demo",
    })

    expect(outcome.errorCount).toBe(1)
    expect(outcome.errors?.length).toBe(1)
  })

  test("TrackedOutcome schema accepts legacy outcomes without errors", () => {
    const legacy = {
      sessionID: "s1",
      taskID: "t1",
      agentID: "a1",
      agentName: "a1",
      isCollaborative: false,
      success: false,
      tokens: 1,
      duration: 1,
      errorCount: 0,
      timestamp: Date.now(),
    }

    const parsed = TaskTracking.TrackedOutcome.parse(legacy)
    expect(parsed.errors).toBeUndefined()
  })
})

