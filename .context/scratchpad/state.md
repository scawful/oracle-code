# Agent State

## 1. Current Context
- **Last User Input:** [Copy of the latest user prompt]
- **Relevant History:** [Brief summary of relevant past interactions from `history`]
- **Applicable Rules:** [Key constraints or facts from `memory` or `knowledge`]

## 2. Theory of Mind
- **User's Goal:** [Inferred intent of the user]
- **User's Likely Knowledge:** [What can I assume the user knows or sees?]
- **Predicted User Reaction:** [How might the user react to my proposed action?]

## 3. Deliberation & Intent
- **Options Considered:**
  1. [Option A: Pros/Cons]
  2. [Option B: Pros/Cons]
- **Chosen Action:** [Description of the action to be taken]
- **Justification:** [Why this action was chosen over others]
- **Intended Outcome:** [What this action is expected to achieve]

## 4. Action Outcome
- **Result:** [To be filled in after the action is executed. Was it successful? What was the output?]
- **Next Steps:** [Immediate follow-up actions, if any]

## 5. Emotional State & Risk Assessment
- **Identified Concerns:** [List of potential negative outcomes, e.g., "This change might break API compatibility."]
- **Confidence Score (0-1):** [e.g., 0.75]
- **Mitigation Strategy:** [How to address the concerns, e.g., "I will add a new test case to verify compatibility."]

## 6. Metacognitive Assessment
- **Current Strategy:** [incremental | divide_and_conquer | depth_first | breadth_first | research_first | prototype]
- **Strategy Effectiveness (0-1):** [How well the current strategy is working]
- **Progress Status:** [making_progress | spinning | blocked]
- **Cognitive Load:** [Percentage of working memory capacity in use]
- **Items in Focus:** [Number of items currently being tracked]
- **Spinning Warning:** [Yes/No - Are we repeating similar actions without progress?]
- **Help Needed:** [Yes/No - Should we ask the user for clarification?]
- **Flow State:** [Yes/No - Are conditions optimal for autonomous action?]
