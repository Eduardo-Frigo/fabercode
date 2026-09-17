# Faber Code v0.2.0 — Harness v2

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This release introduces Harness v2, a governed agent runtime designed to plan,
edit, run, inspect, repair, and validate projects within explicit permissions
and isolated workspaces.

## Highlights

- **Governed agent runtime:** Harness v2 can iterate on real project results
  while operating within project- and job-scoped authority.
- **Safer workspace changes:** Mutations run in isolation and use controlled
  promotion, durable receipts, recovery, and targeted rollback.
- **Better project context:** ContextPack brings together relevant Cortex
  memory, Application Map data, milestones, Git state, selected files,
  instructions, and permissions.
- **Browser-assisted validation:** Governed browser sessions can inspect local
  previews, console output, failed requests, interactions, and visual captures.
- **Controlled external tools:** Network and MCP operations follow explicit
  policies, scoped approvals, exact allowlists, idempotency, and auditable
  receipts.
- **End-to-end product workflow:** Application Map, documentation, milestones,
  execution, validation, and Git now work through one governed flow.
- **More flexible app creation:** Project creation and repair are no longer tied
  to a rigid blueprint. The runtime can detect the stack, run its native checks,
  repair failures, and validate observable outcomes.
- **Improved onboarding:** The guided tutorial now covers briefing, design
  system, project structure, milestones, development, Git review, local
  execution, and preview.
- **Durable execution state:** Progress, approvals, retries, cancellation,
  recovery, and terminal results share a persistent source of truth.
- **Current model discovery:** Compatible OpenAI models are supplied by the
  runtime instead of being frozen in the interface, including the qualified
  `gpt-5.6-sol` and `gpt-5.6-terra` paths.

## Safety and control

Harness v2 introduces:

- authority scoped to the active project and job;
- explicit approval for sensitive or external effects;
- deny-by-default network behavior;
- single-use, digest-bound approval for visual egress and external writes;
- transactional deletion and recovery;
- process-tree supervision and cleanup;
- rollout interlocks, a kill switch, and a temporary legacy fallback.

Faber Code does not automatically commit or push changes. Git review and final
publication remain under the user's control.

## Compatibility

Existing projects, conversations, Application Maps, milestones, Cortex memory,
Files, Git, Map Chat, and Execute workflows remain supported.

Project previews continue to open in the user's default browser. The governed
browser is an agent capability and does not replace the normal preview
experience.

## Validation

The planned Harness v2 scope and its offline release gates were completed
successfully. Phase 8, Phase 9 offline qualification, the controlled-rollout
release gate, and `git diff --check` passed at the technical milestone.

A guided live smoke test also validated a complete application workflow,
including build, tests, local preview, browser inspection, approved visual
delivery, and successful completion.

Provider-dependent live qualification remains opt-in because it requires
credentials, network access, usage credits, and fresh human approvals.

## Rollout note

Harness v2 includes the policies and interlocks required for controlled
activation. Installations without explicit v2 configuration continue to use
the legacy runtime during the rollout period.

## Distribution

This release provides GitHub source archives and ARM64 desktop installers for
macOS, Windows, and Linux. The desktop installers are not yet signed or
notarized by the platform vendors, so the operating system may display a trust
warning during installation. Verify downloaded artifacts against the published
SHA-256 checksum file.

Automatic installation remains macOS-only and requires a platform-vendor-signed
package. Because v0.2.0 is vendor-unsigned, install it manually; Windows and
Linux never attempt the DMG update path.

For the complete architecture, migration history, validation matrix, and known
limitations, see
[`FABER_CODE_RELEASE_HARNESS_V2_2026-09-09.md`](https://github.com/Eduardo-Frigo/fabercode/blob/v0.2.0/docs/FABER_CODE_RELEASE_HARNESS_V2_2026-09-09.md).
