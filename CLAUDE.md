# roundtable — working agreement

## Model policy (required)

| Phase | Model |
|---|---|
| Brainstorming, planning, architecture decisions | Opus 5 (the main session) |
| Implementing planned tasks | Sonnet 5, high reasoning effort — delegated to the `implementer` subagent |
| Final review of completed work | Opus 5 (the main session) |

Concretely:

- The main session runs on Opus 5. Keep planning and final review here — do not delegate them.
- Every implementation task goes to a subagent: `Agent(subagent_type: "implementer", model: "sonnet")`.
  The agent definition lives in `.claude/agents/implementer.md` and already pins `model: sonnet`;
  pass `model: "sonnet"` explicitly anyway so an inherited default can never override it.
- Do not implement planned tasks directly in the Opus session, even small ones, unless the user
  says to. Plan → delegate → review.
- Independent tasks may be delegated in parallel; dependent ones must be sequential.
