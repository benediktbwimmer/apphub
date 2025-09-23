# Ticket 018: Python Snippet Versioning & Dependency Support

## Summary
Clarify and implement the remaining product decisions for the Python job authoring experience. Specifically, define how bundle versions should be managed when operators paste updated snippets, and determine how additional Python dependencies beyond the built-in `pydantic` requirement can be surfaced and enforced.

## Problem Statement
The new paste-a-function workflow assumes a fixed bundle version and only ships `pydantic` in the generated artifact. Operators have asked whether pasting a revised function should automatically publish an incremented bundle version, and how they can declare extra dependencies (e.g., `requests`, `numpy`). Without clear behavior:
- Bundle updates could silently overwrite versions or require manual version editing in the UI.
- Jobs may fail at runtime due to missing libraries, leading to operator frustration and increased support load.

## Goals & Scope
- Decide on and implement a default versioning strategy when users submit a Python snippet (auto-bump vs. manual control), including UX cues and audit logging.
- Provide a mechanism for specifying additional Python dependencies during job creation, persisting those requirements in the bundle artifact, and ensuring workers install them at runtime.
- Document the finalized behaviors so operators know how versions advance and how to include dependencies safely.

## Non-Goals
- Rewriting the broader job bundle publishing pipeline beyond what is necessary to support the snippet workflow.
- Introducing a full dependency resolver or lockfile management system; the focus is on capturing declared packages for installation within the sandbox.

## Acceptance Criteria
- A documented decision and implemented behavior for version increments when reusing the snippet flow (e.g., semantic auto-bump with ability to override).
- UI affordances in the job creation dialog that communicate the versioning behavior and allow edits if applicable.
- Additional dependency input (textbox or structured control) that validates package names, stores them alongside the snippet, and results in a `requirements.txt` (or equivalent) inside the generated bundle.
- Backend integration that ensures declared dependencies are installed/available to the Python sandbox at execution time.
- Updated documentation outlining versioning rules and dependency declarations for Python jobs.

## Implementation Notes
- Evaluate reusing existing bundle tooling to increment versions automatically (e.g., fetch last version, bump patch) while allowing manual overrides for advanced operators.
- Consider storing dependency declarations in job metadata or bundle manifest and generating an install step during bundle packaging.
- Ensure the sandbox runner has a deterministic installation step (possibly leveraging virtual environments) with appropriate timeouts and caching.
- Coordinate UI/UX messaging with design to avoid confusing operators about when versions change or dependencies install.

## Dependencies
- Python snippet analyzer and job creation API being developed for the new workflow.
- Existing bundle publishing and sandbox execution infrastructure.

## Testing Notes
- Add integration tests that cover publishing a snippet with dependencies, verifying that the bundle includes `requirements.txt`, and that the runtime can import the packages.
- Include regression coverage for repeated submissions to confirm version increments behave as expected.

## Deliverables
- Implemented versioning and dependency-handling behavior for Python snippet jobs.
- Documentation updates (docs and/or operator help) reflecting the new workflow details.
- Test evidence demonstrating correct version bumps and dependency availability in the sandbox.
