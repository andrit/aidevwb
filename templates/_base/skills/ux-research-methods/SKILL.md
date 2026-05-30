---
name: ux-research-methods
description: UX research methods — user interviews, usability testing, card sorting, journey mapping, heuristic evaluation, SUS score — optimized for informed discussion with a designer about when and how to run each method
domain: design
type: cross-cutting
triggers:
  - "UX research"
  - "user research"
  - "usability testing"
  - "user interviews"
  - "card sorting"
  - "journey mapping"
  - "heuristic evaluation"
  - "SUS score"
  - "research methods"
  - "design validation"
---

# UX Research Methods

## When to use

When a designer proposes a research method, when you need to advocate for or against research investment, or when making design decisions without user data and wanting to name that risk explicitly. This skill gives you the vocabulary to participate in research discussions, understand the tradeoffs of each method, and interpret findings intelligently.

## The Research Spectrum

UX research exists on two axes: **attitudinal vs behavioral** and **qualitative vs quantitative**.

| | Qualitative (why/how) | Quantitative (how many/how much) |
|--|--|--|
| **Attitudinal** (what users say) | User interviews, focus groups | Surveys, SUS, NPS |
| **Behavioral** (what users do) | Usability testing, contextual inquiry | A/B testing, analytics, clickstream |

**The trap:** users say what they think they should do (attitudinal) but do something different (behavioral). "Would you pay for this?" interviews predict poorly; A/B pricing tests predict well. Use multiple methods to triangulate.

**Designer discussion vocabulary:** "We have strong attitudinal data from interviews, but we don't have behavioral validation — users may not do what they say they'll do. Before committing to this navigation pattern, a task completion test would be more predictive."

## User Interviews

**Purpose:** Understand users' mental models, contexts, goals, frustrations, and workflows. Discover what you don't know to ask.

**When to use:** Early in a project, before design. After launch, to diagnose unexpected behavior. To understand the domain before building domain-specific features.

**Format:** 45–60 minutes, one-on-one, semi-structured (prepared questions + follow-up on unexpected threads). 5–8 participants typically reveals most themes (diminishing returns after 5 per user segment — Nielsen, 2000).

**Good interview questions:**
- "Walk me through the last time you did X" (concrete, past, behavioral)
- "What makes that step difficult?" (probes for pain points)
- "What do you do instead of Y?" (reveals workarounds = unmet needs)
- "What would need to be true for you to use Z?" (conditional reveals blockers)

**Bad interview questions:**
- "Would you use feature X?" (attitudinal, predictively weak)
- "Do you like the design?" (evaluative framing, not exploratory)
- Leading: "Isn't it confusing when...?" (confirms bias)

**Outputs:** Themes, mental model diagrams, job-to-be-done statements, persona attributes.

**Designer discussion vocabulary:** "The interviews gave us mental model data, not preference data — we know how users think about the problem, not whether they prefer design A over B. Those are different research questions."

## Usability Testing

**Purpose:** Observe real users attempting real tasks with the design (prototype or live). Reveals usability failures that cannot be found by expert review alone.

**When to use:** Before launch to catch critical failures. After a redesign to confirm improvement. Any time the team disagrees about whether something will work.

**Format:** 5 participants per design variant. Moderated (facilitator present, can probe) or unmoderated (remote, video-recorded). Think-aloud protocol: "Please tell me what you're thinking as you do this."

**Task design:** Give the scenario and the goal, not the path. "You need to set up automatic monthly payments for your account. Please show me how you'd do that." Not: "Click Settings, then Billing, then..."

**What to watch for:**
- **Errors** — wrong path, wrong action, wrong interpretation
- **Hesitations** — moments where users pause and scan (signal: they don't know where to go)
- **Workarounds** — doing something other than the designed path to achieve the goal
- **Verbalizations** — "I'd expect this to be under..." reveals mental model mismatch
- **Satisfaction** — did they complete the task? How difficult did they say it was?

**Metrics:**
- Task completion rate (% of participants who complete without assistance)
- Time on task (median)
- Error rate
- SUS score (see below)

**Designer discussion vocabulary:** "We need moderated testing here — the task is novel enough that think-aloud will give us richer data than the completion rate alone." / "5 participants won't give us statistical significance, but they'll surface the major usability failures before we ship."

## SUS Score (System Usability Scale)

A validated 10-question questionnaire administered after a usability test or product use. Yields a single score 0–100.

**The 10 questions** (alternating positive/negative to prevent response bias):
1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need support from a technical person to use this.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I need to learn a lot before using this system.

**Scoring:** Positive questions: score − 1. Negative questions: 5 − score. Sum × 2.5. Range: 0–100.

**Interpretation benchmarks:**

| SUS Score | Grade | Adjective | Percentile |
|-----------|-------|-----------|------------|
| > 80.3 | A | Excellent | Top 10% |
| 68–80.3 | B | Good | Above average |
| 68 | C | Okay | Average (industry mean) |
| 51–68 | D | Poor | Below average |
| < 51 | F | Awful | Bottom 15% |

**Designer discussion vocabulary:** "Our SUS came in at 64 — below average but not critical. The 'unnecessarily complex' item scored low, which aligns with the interview feedback about the settings section. That's where we should focus."

## Card Sorting

**Purpose:** Understand how users categorize information — reveals the mental model for navigation structure, content grouping, and taxonomy.

**Open card sorting:** Users group items and name the groups themselves. Reveals: what categories users naturally form, what they expect to be related.

**Closed card sorting:** Users place items into predefined categories. Tests: whether an existing navigation structure matches users' expectations.

**When to use:** When designing information architecture. When users complain about not finding things. Before redesigning navigation.

**Format:** 15–30 cards (more than 30 creates fatigue), 15–20 participants. Remote tools: Optimal Workshop, Maze, Lyssna.

**Outputs:** Dendrogram (cluster analysis showing which items users group together), similarity matrix (% of users who grouped each pair of items).

**Designer discussion vocabulary:** "The card sort showed users consistently group 'Team' and 'Permissions' together, but our current IA separates them by 3 levels. That's the root cause of the navigation complaints." / "Let's run a closed sort on the proposed IA before committing to the engineering work."

## Tree Testing

**Purpose:** Test the findability of items in a navigation structure, without the influence of visual design.

**Format:** Participants are given tasks ("Where would you go to invite a team member?") and navigate a text-only tree of the site structure. No visual design, icons, or search — just labels.

**Outputs:** Success rate per task, directness (found it on first try or backtracked), first click (where did users go first?).

**When to use:** After card sorting, to validate the proposed information architecture before designing. Faster and cheaper than a full usability test.

**Designer discussion vocabulary:** "Tree testing gives us IA validation without UI noise. We can run it in a day with 50 participants — much cheaper than redoing the visual design if the IA is wrong."

## Journey Mapping

**Purpose:** Visualize the full user experience across touchpoints, time, and emotional states — including moments outside the product (awareness, consideration, support).

**Components of a journey map:**
- **Stages** — phases of the user's journey (Discover → Onboard → Use → Retain → Advocate)
- **Actions** — what the user does at each stage
- **Thoughts** — what they're thinking (from research, not assumption)
- **Emotions** — the emotional arc (excited, confused, frustrated, satisfied)
- **Touchpoints** — which channels/products they interact with
- **Pain points** — moments of friction
- **Opportunities** — where design could improve the experience

**When to use:** Cross-team alignment on the user experience. To identify the highest-impact improvement opportunities across the full journey, not just within the product.

**Important limitation:** A journey map based on assumptions is a bias artifact, not a research output. It must be grounded in user interviews, analytics, or support ticket analysis.

**Designer discussion vocabulary:** "The journey map shows the peak pain point is between onboarding and first success — not the onboarding wizard itself, but the gap before users get value. That's where we should focus, not the wizard redesign." / "This map is based on assumptions — let's call it a hypothesis map until we validate the emotional arc with interviews."

## Heuristic Evaluation

An expert (or team) reviews a design against a set of established usability principles (typically Nielsen's 10 heuristics — see `ux-principles-and-patterns`). Not a replacement for user testing; a complement.

**Process:**
1. Each evaluator reviews the interface independently
2. Each records violations, severity, and the heuristic violated
3. Team aggregates findings, discusses severity ratings

**Severity ratings (Nielsen):**
- 0 — Not a usability problem
- 1 — Cosmetic only; fix if time permits
- 2 — Minor; low priority
- 3 — Major; important to fix
- 4 — Catastrophic; must fix before launch

**Outputs:** Prioritized list of violations with severity, heuristic violated, and recommended fix.

**Designer discussion vocabulary:** "I did a heuristic pass — H3 (user control) is violated in the bulk delete flow: there's no undo, and the confirmation dialog doesn't specify what's being deleted. That's a severity 4 before launch." / "Expert reviews find different issues than user tests — we should do both, not choose between them."

## Checklist

- [ ] Research method chosen matches the question (attitudinal or behavioral, qualitative or quantitative)
- [ ] Interview questions are behavioral and past-tense, not hypothetical or leading
- [ ] Usability test tasks describe goal, not path
- [ ] SUS administered after each test session; scores interpreted against 68 benchmark
- [ ] Card sort findings documented: dendrogram, similarity matrix, top disagreements
- [ ] Journey map explicitly labeled "hypothesis" until grounded in research
- [ ] Heuristic evaluation findings severity-rated and prioritized
- [ ] Research findings linked to specific design decisions they informed

## Common mistakes

**Doing interviews instead of observation** — what users say they do and what they actually do diverge consistently. Contextual inquiry (watching users in their actual environment) is more accurate than interviews for behavioral questions.

**5 participants for statistical significance** — 5 participants reveal ~85% of usability issues (Nielsen), but this does not extend to quantitative claims. "4 out of 5 users preferred A" is not statistically significant. Use 20+ participants and proper A/B tests for quantitative claims.

**Asking "do you like it?"** — preference is not the same as usability. Users can prefer a less effective design. Ask behavioral questions; measure task completion, not preference.

**Journey map as decoration** — a journey map that lives in the design tool and is never acted on is theater. Each pain point on the map should map to an opportunity in the product backlog.
