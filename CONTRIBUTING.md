# Contributing to AppHub

Thank you for your interest in contributing! This guide outlines how we work and how you can help keep the project healthy.

## Getting Started
- Review `AGENTS.md` for the repo structure, coding style, and workflow basics.
- Install dependencies with `npm install` at the repo root.
- Run services with the npm workspaces described in the guidelines when you need a live stack.

## Workflow
1. Find an open GitHub issue that you want to work on (or file a new one using the issue templates).
2. Create a topic branch from `main`: `git checkout -b <scope>/<short-description>`.
3. As you work, keep commits focused and follow Conventional Commit messages (for example `feat:`, `fix:`, `chore:`).
4. Before pushing, rely on the git hooks (`pre-commit` and `pre-push`) or run manually:
   - `npm run lint`
   - `npm run build`
   - `npm run test`
5. Open a pull request once the project builds cleanly and all tests pass.

## Pull Requests
- Use the PR template and fill in all sections (summary, testing, linked issues).
- Reference issues with `Fixes #<id>` or `Refs #<id>` to help automation link work back to planning.
- Include screenshots, API responses, or logs for user-facing changes when helpful.
- Keep PRs scoped to one area; large changes should be split into reviewable chunks when possible.

## Code Style
- TypeScript everywhere; React components in `*.tsx`.
- Two-space indentation, single quotes, trailing commas on multi-line literals.
- Group imports: external → internal aliases → relative paths.
- Add concise comments only when the intent of the code is not obvious.

## Tests
- Follow the testing guidance in `AGENTS.md`.
- Place unit tests near the implementation; larger scenarios go under `tests/`.
- Ensure new code paths are covered, especially API endpoints, queue jobs, and UI flows.

## Communication
- Use GitHub Discussions for questions, design proposals, or help requests that are not actionable bugs.
- Security concerns should be reported privately as described in `SECURITY.md`.

## Release Notes
Maintainers may request that you add a changelog entry or release note when your change is user-facing. Follow the instructions in the PR if that occurs.

We appreciate your contributions—thank you for helping AppHub grow!
