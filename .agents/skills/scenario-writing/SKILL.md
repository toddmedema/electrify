---
name: scenario-writing
description: Write or edit Electrify scenario, world-event and story copy. Use when adding or changing event descriptions, previews or live messages in src/data/Scenarios.tsx, src/data/WorldEvents.tsx or related text.
---

# Scenario writing

Read [AGENTS.md](../../../AGENTS.md) for commands and required checks. This skill holds the
copy guidance for scenarios and events.

- Keep event descriptions brief: lead with the main change the player needs to respond to,
  usually in one short sentence. Do not narrate every simulation modifier.
- Omit minor secondary cost changes (such as 8% higher running costs or a 10% fuel increase)
  when a supply loss is the event's main consequence. Keep major price shocks, decision
  tradeoffs, and timing that affects preparation or recovery.
- Use direct wording: "Coal output is down to 67%." Avoid qualifiers such as "of nominal",
  "normal maximum output", and "for the year" when the context already supplies the meaning.
- Keep previews brief and in future tense; report exact effects and recorded outcomes in live
  messages. Shortening copy must not change simulation effects, schedules, or seeded outcomes.
