---
name: ux-principles-and-patterns
description: UX theory — Norman's 7 principles, Nielsen's 10 heuristics, Fitts/Hick/Miller laws, cognitive load, progressive disclosure, feedback timing — plus common UX patterns; optimized for designer discussion and product decisions
domain: design
type: cross-cutting
triggers:
  - "UX principles"
  - "usability"
  - "Norman"
  - "Nielsen heuristics"
  - "Fitts law"
  - "Hick's law"
  - "cognitive load"
  - "progressive disclosure"
  - "UX patterns"
  - "UX best practices"
  - "UX goals"
  - "interaction design"
---

# UX Principles and Patterns

## When to use

Before designing any interaction, when reviewing a design for usability, or when discussing UX decisions with a designer or product manager. These principles are the vocabulary of professional UX discourse — knowing them lets you participate in design reviews, push back on decisions with principled arguments, and catch usability issues before they reach users.

## The Goal of UX

UX is the discipline of designing interactions between people and systems to achieve user goals with minimum friction, error, and cognitive load — while also meeting business goals. The core tension: what is easiest for the user to understand is often what the business did not want to build.

**Learnability** — how quickly can a new user achieve basic tasks?  
**Efficiency** — how quickly can an experienced user achieve tasks?  
**Memorability** — after absence, how quickly does performance return?  
**Errors** — how many errors, how severe, how recoverable?  
**Satisfaction** — is the experience subjectively pleasant?

These five dimensions (Nielsen, 1993) define "usability." A great UX optimizes across all five; most products sacrifice one or two.

## Norman's 7 Principles of Design

From Donald Norman's *The Design of Everyday Things* (see `docs/references.md`):

**1. Discoverability** — can users discover what actions are possible? Affordances and signifiers must be visible. Hidden features that users must be told about fail discoverability. Apply to: navigation, interactive elements, available commands.

**2. Feedback** — the system communicates the result of every action. Pressing a button: visual change confirms the press. Submitting a form: success/error state confirms receipt. Loading: spinner confirms processing. *No feedback = no confirmation = user presses again.* The double-submit problem is a feedback failure.

**3. Conceptual Model** — the user's mental model of how the system works. Good design creates an accurate mental model. Poor design creates a wrong mental model that leads to errors. Example: the "cloud" is a poor conceptual model for beginners (where is my file?) but a powerful one for experts.

**4. Affordances** — the actual capabilities of an object in relation to an agent. Flat surfaces afford stepping on; handles afford grasping. Affordances are relational, not properties of objects alone.

**5. Signifiers** — communicates where and how to take action. The painted strip on a door communicates "push here." An underline signals "click me." Signifiers make affordances visible.

**6. Mappings** — the relationship between controls and their effects. Natural mappings feel obvious (steer wheel turns like the road curves; scroll direction matches the page moving). Inverted mappings feel wrong and generate errors.

**7. Constraints** — physical, cultural, logical, and semantic limits that prevent errors. A form that disables the submit button until required fields are filled uses a logical constraint. A date picker that disables past dates for a "future event" field uses a semantic constraint.

**Designer discussion vocabulary:** "The mapping is inverted — users expect the slider to move the content in the same direction as the drag." / "The constraint is too early — disabling submit before the user has attempted to submit prevents learning what's required."

## Nielsen's 10 Usability Heuristics

Jakob Nielsen's heuristics are used for heuristic evaluation — a structured expert review of a design's usability without user testing.

**1. Visibility of system status** — always keep users informed of what's happening, with appropriate feedback in reasonable time. Loading states, progress indicators, status messages.

**2. Match between system and the real world** — use words, phrases, and concepts familiar to the user. Follow real-world conventions. "Trash," not "Deletion Queue."

**3. User control and freedom** — support undo and redo. Provide clearly marked "emergency exits." Users make mistakes; they need recovery paths.

**4. Consistency and standards** — follow platform conventions. Users spend most of their time on other products. Don't make them learn new conventions when established ones exist.

**5. Error prevention** — prevent problems from occurring by eliminating error-prone conditions, confirming before irreversible actions. Better than good error messages.

**6. Recognition over recall** — minimize memory load. Visible options are better than remembered commands. Keep objects, actions, and options visible.

**7. Flexibility and efficiency of use** — accelerators for experts that novices can ignore. Keyboard shortcuts, power-user modes, autocomplete.

**8. Aesthetic and minimalist design** — every additional element reduces the relative visibility of useful elements. "Perfect when nothing more can be removed" (Antoine de Saint-Exupéry).

**9. Help users recognize, diagnose, and recover from errors** — error messages in plain language (not error codes), indicate the problem, constructively suggest a solution.

**10. Help and documentation** — if needed, make it searchable and focused on the user's task.

**Using these in a review:** "This violates H1 — after the user submits, there's no feedback that the form was received. They'll think it failed." / "H4 violation — this uses a custom calendar widget with non-standard controls; the date picker has different behavior than every other date picker on the platform."

## Fitts's Law

**The law:** The time to acquire a target is a function of the distance to the target and the size of the target. Formally: `T = a + b * log₂(D/W + 1)` where D = distance, W = target width.

**Implications:**
- **Large targets are faster to click.** This is why mobile touch targets should be at least 44×44px (Apple HIG) or 48×48px (Material Design). A 16px icon with a 16px hit area will be missed frequently.
- **Targets at the screen edges and corners are "infinitely large"** — the cursor stops at the edge, making it fast to reach. macOS menu bar at top is a Fitts-aware design. Corners are even faster.
- **Targets far away take more time.** Put the confirm button close to where the user was working, not at the opposite end of the dialog.

**Designer discussion vocabulary:** "Fitts's Law tells us the primary CTA at the bottom-right of a large screen is the longest travel path from the form. Can we anchor it below the last field instead?" / "The touch target is 24px — we need 44px minimum. The icon itself can be 24px but the interactive area must be larger."

## Hick's Law

**The law:** The time to make a decision increases logarithmically with the number of choices. More choices = slower decisions = potential paralysis.

**Implications:**
- **Progressive disclosure** — show only what's needed for the current step. Hide advanced options until requested.
- **Navigation depth vs breadth tradeoff** — fewer top-level nav items (breadth) means more clicks to find things (depth). Research suggests 5–7 top-level items is optimal; beyond that, Hick's Law slows navigation.
- **Chunking** — group choices into categories to reduce the effective number of decisions.
- **Recommendation** — a suggested default reduces the decision to "accept" or "change," collapsing many choices to two.

**Designer discussion vocabulary:** "We have 14 items in the primary navigation — Hick's Law predicts users will take significantly longer to find their destination. Let's consider grouping." / "Adding a 'Recommended' badge reduces the choice problem to binary: use the recommendation or not."

## Miller's Law

**The law:** The average human can hold about 7 (±2) items in working memory at once.

**Implications:**
- **Chunking** — group information into meaningful units (digits in a phone number, steps in a process) to reduce effective item count.
- **Step-by-step disclosure** — a 12-field form can be restructured as a 3-step wizard (4 fields each) to fit within working memory at each step.
- **Navigation chunking** — group navigation items (4–5 in each group) rather than presenting 20 items in a flat list.

**Important nuance (Cowan, 2001):** The actual working memory limit is closer to 4 items (chunks). Miller's 7±2 applied to chunks of information, which can be complex. Modern UX uses "4" as the practical working memory unit.

## Cognitive Load Theory

**Intrinsic load** — the inherent complexity of the task itself. Cannot be reduced by design.

**Extraneous load** — complexity added by the design that doesn't contribute to learning or task completion. This is what UX design eliminates.

**Germane load** — cognitive work that builds understanding and mental schemas. Tutorials, onboarding, and guided experiences add germane load intentionally.

**Design strategies to reduce extraneous load:**
- **Progressive disclosure** — reveal complexity as needed, not upfront
- **Defaults** — pre-fill with the most likely value; let users change rather than always create
- **Chunking and grouping** — Gestalt proximity signals which elements belong together, reducing the cognitive work of parsing the layout
- **Consistency** — each novel pattern requires cognitive load to process; familiar patterns are processed automatically
- **Recognition over recall** — visible options, typeahead, autocomplete reduce load

## Progressive Disclosure

Reveal information and features progressively, in proportion to user intent. The goal: complexity is always one step further than the user's current need.

**Three levels:**
1. **Beginner view** — only the most common actions. Complexity hidden.
2. **Advanced view** — revealed on explicit request ("Show advanced options").
3. **Expert view** — full control via settings, API, or power-user mode.

**Implementation patterns:**
- Expandable sections: `<details>/<summary>` or accordion
- "Show more" buttons
- Settings page separate from the core workflow
- Contextual menus that reveal on right-click or long-press
- Inline help text that expands on hover/focus

## Response Time Guidelines

Jakob Nielsen's three thresholds remain the standard:

| Delay | User experience |
|-------|----------------|
| < 100ms | Immediate — feels instantaneous, like physical manipulation |
| 100ms – 1s | Slight delay — noticeable but no need for feedback |
| 1s – 10s | Noticeable delay — show a progress indicator |
| > 10s | Significant wait — show a progress bar with percentage |

**Optimistic UI** — update the UI immediately, before the server confirms, then reconcile. Liking a post updates the count instantly; the server call happens in the background. Rollback only on failure.

## Common UX Patterns

**Empty states** — a list with no items is a design decision. Good empty states: explain why it's empty, show what it will look like when populated, provide a clear path to add the first item. "No results" with a search empty state differs from "No projects yet" with a creation CTA.

**Error states** — every form field that can fail needs: which field failed, why it failed, how to fix it. Never: "Please correct the errors above." Always: "Email: must be a valid email address."

**Loading states** — distinguish between: initial load (skeleton UI, not spinner), subsequent loads (spinner or inline indicator), and background sync (subtle indicator, not blocking UI).

**Confirmation dialogs** — for irreversible actions only. "Are you sure?" for deletable items; never for reversible actions. Include the specific thing being affected: "Delete project 'My App'? This cannot be undone." Destructive action button labeled with the action ("Delete"), not "OK" or "Yes."

**Toasts and notifications** — success toasts for actions the user can verify themselves (e.g., "File saved" — they can see the file was saved). Use for non-critical information only. Duration: 4–5 seconds. Never toast an error that needs action — errors go inline, not in a toast that disappears.

**Infinite scroll vs pagination** — infinite scroll for content consumption (social feed, news) where the end point doesn't matter. Pagination for task-oriented content (search results, data tables) where users need to return to a specific page, bookmark a position, or find an item by page number.

**Designer discussion vocabulary:** "The empty state is punishing first-time users — there's no context for why it's empty or what to do. Let's add an illustration and a CTA." / "We're using a toast for a destructive action confirmation — that needs to be inline. The toast will disappear before the user understands what happened."

## Checklist

- [ ] Every action provides feedback (success, error, or loading state)
- [ ] Error messages identify the problem and suggest the fix (not just "Error occurred")
- [ ] Primary CTA placement follows Fitts's Law (close to where the user is working)
- [ ] Navigation items ≤ 7 at any level; complex navigation chunked into groups
- [ ] Irreversible actions protected by confirmation with specific content named
- [ ] Progressive disclosure applied: beginners see defaults, advanced users can expand
- [ ] Loading states: skeleton for initial load, spinner for subsequent, progress bar for >10s
- [ ] Empty states explain the state and provide a path forward

## Common mistakes

**Confirmation dialogs for everything** — "Are you sure you want to save?" destroys trust and adds noise. Confirmation is for irreversible or high-consequence actions only.

**Toasting errors** — a toast disappears. An error that the user needs to act on (form validation, payment failure) must be persistent and inline.

**"Please correct the errors above" without specifying which or what** — the user must re-scan the entire form. Inline validation at the field level eliminates the re-scan.

**Designing for learnability only** — optimizing for first-time users (lots of guidance, tooltips, simplified workflows) at the expense of efficiency means power users are permanently slowed. Provide accelerators: keyboard shortcuts, bulk actions, saved templates.
