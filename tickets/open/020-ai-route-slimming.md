# Slim AI routes and orchestration surface

## Context
- `services/core/src/routes/ai.ts:1` spans ~1.7k lines, combining prompt management, bundle publishing, and provider orchestration.
- Core AI helpers already live in `services/core/src/ai/`, but the route module embeds substantial business logic and token accounting.
- Adding new providers or features (e.g. prompt versioning) is difficult due to the tightly coupled route structure.

## Impact
- Large route module increases risk of regressions when adding endpoints or adjusting prompts.
- Logic duplication between routes and helper modules complicates testing and maintenance.
- Provider-specific behaviour is hard to isolate, complicating future integrations beyond OpenAI/OpenRouter.

## Proposed direction
1. Extract prompt templates, token accounting, and provider orchestration into service classes/utilities under `services/core/src/ai/`.
2. Refactor routes to delegate to these services, focusing on HTTP validation and response shaping only.
3. Introduce targeted unit tests for extracted services plus lighter-weight route tests.
4. Document extension points for adding new AI providers or prompt workflows.
5. Evaluate opportunities to move long-running tasks into workers instead of blocking HTTP handlers.

## Acceptance criteria
- AI route module is decomposed into smaller files with minimal inline business logic.
- Tests cover extracted services, ensuring prompt handling and provider calls remain reliable.
- Documentation outlines how to extend AI capabilities using the new abstractions.
