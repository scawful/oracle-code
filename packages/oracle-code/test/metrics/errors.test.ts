import { describe, expect, test } from "bun:test"
import { ErrorDetection } from "../../src/metrics/errors"

describe("ErrorDetection", () => {
  test("detects internal logical contradictions", () => {
    const errors = ErrorDetection.detectContradictions(
      "The sky is blue. The sky is not blue.",
      [],
    )
    expect(errors.some((e) => e.type === "logical_contradiction")).toBe(true)
  })

  test("detects contradictions with previous outputs", () => {
    const errors = ErrorDetection.detectContradictions(
      "The sky is not blue.",
      ["The sky is blue."],
    )
    expect(errors.some((e) => e.type === "logical_contradiction")).toBe(true)
  })
})
