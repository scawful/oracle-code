import { describe, expect, test } from "bun:test"
import { IRT } from "../../src/metrics/irt"

describe("IRT", () => {
  test("logistic clamps extremes and centers at 0.5", () => {
    expect(IRT.logistic(100)).toBe(1)
    expect(IRT.logistic(-100)).toBe(0)
    const mid = IRT.logistic(0)
    expect(Math.abs(mid - 0.5)).toBeLessThan(1e-6)
  })

  test("pSuccess increases with collaborative ability", () => {
    const solo = IRT.pSuccess({
      theta: 1,
      kappa: 0,
      beta: 0,
      gamma: 0,
      isCollaborative: false,
    })
    const collaborative = IRT.pSuccess({
      theta: 1,
      kappa: 1,
      beta: 0,
      gamma: 0,
      isCollaborative: true,
    })
    expect(collaborative).toBeGreaterThan(solo)
  })

  test("fitModel assigns higher theta to higher-success agent", () => {
    const now = Date.now()
    const outcomes: IRT.TaskOutcome[] = []

    for (const i of Array.from({ length: 50 }, (_, index) => index)) {
      outcomes.push({
        taskID: "task",
        agentID: "a",
        isCollaborative: false,
        success: i < 40,
        tokens: 100,
        duration: 1000,
        errorCount: 0,
        timestamp: now + i,
      })
      outcomes.push({
        taskID: "task",
        agentID: "b",
        isCollaborative: false,
        success: i < 10,
        tokens: 100,
        duration: 1000,
        errorCount: 0,
        timestamp: now + i,
      })
    }

    const model = IRT.fitModel(outcomes, { iterations: 1500 })
    expect(model.sampleSize).toBe(outcomes.length)
    expect(model.theta.a).toBeGreaterThan(model.theta.b)
    const ciA = model.confidence.theta.a
    expect(ciA.lower).toBeLessThan(ciA.upper)
  })
})
