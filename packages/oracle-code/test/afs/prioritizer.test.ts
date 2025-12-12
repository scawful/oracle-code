import { describe, expect, test } from "bun:test"
import { ContextPrioritizer } from "../../src/afs/prioritizer"

describe("ContextPrioritizer", () => {
  test("prioritizes memory over history with same recency/relevance", () => {
    const now = Date.now()
    const memoryItem = {
      content: "shared fact",
      source: "memory",
      path: "/repo/.context/memory/fact.md",
      timestamp: now,
    }
    const historyItem = {
      content: "shared fact",
      source: "history",
      path: "/repo/.context/history/fact.md",
      timestamp: now,
    }
    const config = { maxTokens: 1000 }

    const memoryScore = ContextPrioritizer.calculatePriority(memoryItem, "shared fact", config).priority
    const historyScore = ContextPrioritizer.calculatePriority(historyItem, "shared fact", config).priority

    expect(memoryScore).toBeGreaterThan(historyScore)
  })
})

