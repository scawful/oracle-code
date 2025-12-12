/**
 * Cognitive Protocol Module
 *
 * This module implements the HAFS Cognitive Protocol for AI agents,
 * providing self-monitoring, goal tracking, epistemic state management,
 * and emotional valence tracking.
 *
 * Key components:
 * - Metacognition: Spin detection, cognitive load, flow state, strategy tracking
 * - Goals: Goal hierarchy, conflict detection, focus management
 * - Epistemic: Knowledge tracking with confidence, assumptions, unknowns, contradictions
 * - Emotions: Emotional valence (fears, curiosities, satisfactions, frustrations)
 * - CognitiveIntegration: Hooks into session/tool processing
 *
 * Usage:
 *   import { Metacognition, Goals, Epistemic, Emotions, CognitiveIntegration } from '@/cognitive'
 *
 *   // Initialize integration (call once at startup)
 *   await CognitiveIntegration.init()
 *
 *   // Record an action for spin detection
 *   await Metacognition.recordAction(contextRoot, "editing file.ts")
 *
 *   // Set a primary goal
 *   await Goals.setPrimaryGoal(contextRoot, "Implement authentication")
 *
 *   // Add a knowledge fact
 *   await Epistemic.addWorkingFact(contextRoot, "config.typescript.strict", true, 0.9, "file_read")
 *
 *   // Record an emotion
 *   await Emotions.addEmotion(contextRoot, "satisfaction", "Tests passing", "All 50 tests green", 7)
 *
 *   // Check flow state
 *   const { inFlow, changed } = await Metacognition.checkFlowState(contextRoot)
 *
 *   // Get cognitive context for system prompt
 *   const context = await CognitiveIntegration.getPromptContext()
 */

export { Metacognition } from "./metacognition"
export { Goals } from "./goals"
export { Epistemic } from "./epistemic"
export { Emotions } from "./emotions"
export { AnalysisTriggers } from "./analysis-triggers"
export { CognitiveIntegration } from "./integration"
