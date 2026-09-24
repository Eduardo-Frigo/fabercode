# Faber Code

[Official website](https://www.fabercode.site/)

Faber Code is a local-first, AI-assisted Spec-Driven Development (SDD) IDE. It
brings planning, code editing, execution, validation, Git, and project context
into one desktop workspace while keeping the user in control of files,
repositories, permissions, and final decisions.

Faber Code is free and distributed under the Apache-2.0 License.

## Harness v2

Faber Code v0.2.0 introduces Harness v2, a governed agent runtime that can plan,
edit, run, inspect, repair, and validate projects within explicit authority and
isolated workspaces.

- [Faber Code v0.2.0 release notes](docs/GITHUB_RELEASE_NOTES_V0.2.0.md)
- [Faber Code v1.0.0 release notes](docs/GITHUB_RELEASE_NOTES_V1.0.0.md)
- [Faber Code v1.0.1 release notes](docs/GITHUB_RELEASE_NOTES_V1.0.1.md)
- [Complete Harness v2 technical release record](docs/FABER_CODE_RELEASE_HARNESS_V2_2026-09-09.md)
- [Public release checklist](docs/PUBLIC_RELEASE_CHECKLIST.md)

Version 0.2.0 is the first public release of the governed Harness v2 cycle.
The technical record documents its architecture, migration, validation, and
known limitations.

## Core features

### Governed development agent

Harness v2 coordinates agent work through project- and job-scoped authority.
Sensitive operations require the appropriate approval, changes can be staged in
isolation before controlled promotion, and durable receipts support validation,
recovery, and targeted rollback.

Faber Code never treats model confidence as proof of completion. Required
builds, tests, browser checks, external effects, or visual delivery must produce
the corresponding evidence before a governed job can report verified success.

### Application Map and Spec-Driven Development

Every project has an Application Map for organizing requirements, text, images,
and relationships in a visual structure.

- **Map Chat:** discuss the mapped scope with AI without giving the map chat
  direct authority to mutate project code.
- **Auto-documentation:** map content can be projected into Markdown files and
  organized assets inside the project.
- **Milestone rendering:** turn an approved map into an actionable development
  plan with milestones and acceptance criteria.

### Context-aware development

Development Chat can start directly from a user request or work from an active
milestone. ContextPack assembles the relevant conversation, Cortex memory,
Application Map data, milestone criteria, Git state, selected files,
instructions, permissions, and provenance without handing canonical product
state to the model.

### Guided onboarding

The multilingual tutorial covers the product journey from initial briefing and
design-system choices through project structure, Application Map, milestones,
incremental development, Git review, local execution, and preview. Tutorial
simulations do not consume provider credits.

### Browser-assisted validation

Governed browser sessions can open an authorized local preview, inspect console
output and failed requests, perform bounded local interactions, and request
visual captures. Capturing an image and sending it to an AI provider are
separate, freshly approved operations.

Normal project preview remains unchanged: Faber Code opens the result in the
user's default browser instead of creating a second Electron preview window.

### Flexible AI providers and models

Provider availability depends on the adapters and endpoints configured by the
user. Faber Code supports native integrations, compatible APIs, and custom
connectors without freezing the interface to a permanent model list. The
current qualified OpenAI discovery path includes `gpt-5.6-sol` and
`gpt-5.6-terra` when exposed by the configured runtime.

External providers are optional and may have their own usage costs. A local
RWKV model is not bundled or configured in this repository; the planned RWKV
integration is a separate open project.

## IDE tools

- **File workspace:** project tree, reading, editing, rename, refresh, and
  incremental AI changes.
- **Visual Git workflow:** review new and modified files, select changes, stage,
  commit, and send to GitHub through explicit user actions.
- **Integrated terminal:** a manual terminal in the active project context,
  separate from the governed agent process runtime.
- **Application executor:** local runtime and port management with preview in
  the user's default browser.
- **Cortex:** memory, topics, RAG/MemPalace context, and provenance.
- **Application Map and milestones:** structured planning connected to
  development and validation.

## Safety and control

- Network access is denied by default for governed agent execution.
- External MCP mutations require an exact server/tool allowlist, fresh
  digest-bound approval, idempotency, and an auditable receipt.
- Visual capture and visual egress require separate approvals.
- Project-root authority, symlink checks, process supervision, cleanup, and
  rollout interlocks protect the local workspace.
- Faber Code does not automatically commit, push, publish, or deploy changes.

Read [SECURITY.md](SECURITY.md) before publishing a fork or release.
The desktop app's [privacy policy](PRIVACY.md) explains local storage and
user-configured network integrations.

## Code signing policy

Read the [Code signing policy](CODE_SIGNING_POLICY.md) for current signature
status, release approval roles, the Windows build process, and privacy details.
Windows installers are currently unsigned while the project applies to
SignPath Foundation.

## Installation and development

### Desktop packages

`npm run dist:mac` builds separate x64 and ARM64 macOS packages.
`npm run dist:win` and `npm run dist:linux` do the same for Windows and Linux.
Use the `:x64` or `:arm64` suffix to build one architecture. Before building,
set `FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_FILE` to an absolute
path containing the private release key in PKCS#8 DER base64 form. The build
checks that its public key matches the trusted key for every selected target.
The signed macOS build path requires an Apple Developer ID Application identity
and notarization credentials. It stops before packaging if either is missing,
then verifies the Developer ID signature, stapled notarization ticket,
Gatekeeper assessment, and DMG. `npm run dist:mac:unsigned` explicitly builds
both architectures without those credentials; macOS users must authorize the
first launch themselves in Privacy & Security. Set one of the credential groups
supported by
`electron-builder`: `APPLE_API_KEY` / `APPLE_API_KEY_ID` /
`APPLE_API_ISSUER`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
`APPLE_TEAM_ID`, or `APPLE_KEYCHAIN_PROFILE`. Keep these credentials outside
the repository. An ad hoc or self-signed certificate is not accepted by this
signed release gate.
The portable isolation helper supports these two architectures;
32-bit builds are not supported. Electron 42 requires Windows 10 or newer and
supported Linux distributions with compatible system libraries. AppImage does
not guarantee support on every Linux release.

The app opens without a Faber account or PostgreSQL. To use Pexels photos and
videos, each user creates a personal key at https://www.pexels.com/api/ and
enters it in Configurações → APIs → Pexels. The key is stored in local app
settings and requests go directly from the desktop app to Pexels. Builds do
not contain a shared Pexels key or use a Faber media proxy.

Requirements:

- Node.js compatible with `package.json`
- npm
- Git
- an Electron-compatible desktop environment

```bash
npm install
cp .env.example .env
npm run dev
```

Only `.env.example` should be committed. Never publish `.env`, API keys,
tokens, local databases, private memories, generated artifacts, or client
projects.

## Release validation

Release candidates must pass the checks selected by
[`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md). Live
provider qualification remains opt-in because it requires credentials, network
access, usage credits, and fresh human approvals.

## License and trademarks

The source code is licensed under the Apache License 2.0. See
[LICENSE](LICENSE) and [NOTICE](NOTICE).

The Faber Code name, logos, icons, and brand assets identify the official
project. The Apache-2.0 license does not grant trademark rights or permission to
imply official endorsement, distribution, or affiliation.
