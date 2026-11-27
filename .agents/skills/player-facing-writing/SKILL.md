---
name: player-facing-writing
description: Write or edit words Electrify players see, including game UI, tutorials, manual, contextual help, and store copy. Use alongside the public-site and scenario skills on their surfaces.
---

# Player-facing writing

Write like you're explaining the grid to a friend who wants to play. Lead with what they can do,
what changed, or what they need to decide. Use plain words and contractions where natural. One
real consequence is better than a generic promise.

## Edit the screen, not just the sentence

- Read the whole screen, lesson, or manual entry before rewriting. If the heading, button, or game
  state already carries the message, delete the extra sentence; don't replace it with a shorter
  version. A **Feedback** button can be the entire prompt. Don't remove warnings or change behavior
  just to save words.
- Use the shortest unambiguous action label. Omit the object if it's clear on the screen:
  **Copy link**, not **Copy invite link**. Keep the same name and glyph for the same tool on its
  button and panel, and keep the same wording across devices when it fits. Check neighboring
  actions together at 360 px; keep useful accessible names and touch targets.
- Use the exact on-screen name and shared glyph when pointing to a game control in the manual.
  Use the game's existing navigation-label component where available. Say when the route differs:
  **Fleet** opens the facilities list in map games. Check rendered spaces around inline links and
  labels, and follow changed links to their destination.

## Teach the decision

- A tutorial step gives one available action and, when useful, what the player should see next.
  Use input-neutral verbs for shared prompts. Disclose resets, costs, or lost progress before
  the action that causes them; don't hide the warning to make the step shorter.
- In the manual and contextual help, answer the reader's question first. Split entries when they
  answer different questions, keep each explanation in one place, and link from the screen
  or entry where the question comes up. For example, **Customer demand** explains use;
  **Pricing** explains rates and customer switching. Link to each from Customers chart help.
- Cut familiar definitions and details that don't affect the choice. Keep the mechanic's scope,
  numbers, units, timing, and exceptions. For peak curtailment, say whose demand drops, by how much,
  and when; don't replace the rule with “uses less power.”

## Check the next draft

Compare it with nearby shipped copy and read it in the actual screen or lesson. Can the player
act without rereading? Do the control, link, or game state match? Check affected input modes,
viewports, and locales when relevant.

When Todd corrects copy, keep his exact replacement on the requested surface. Check related
instances within scope. If the correction reveals a repeatable rule, try it on a second example
before proposing a skill update; keep one-off labels and mechanics out of global rules.
