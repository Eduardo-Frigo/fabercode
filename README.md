# Faber Code

Faber Code is a local Electron workspace for AI-assisted project creation, editing and project delivery.

It is being built as a desktop-first coding environment where the user remains in control of the project path: the AI can plan, generate, edit, preview and guide integrations, but file changes are routed through explicit confirmation and local safety checks.

Current focus:

- guided project generation for web stacks such as LAMP and Next.js;
- incremental edits that preserve existing project intent;
- explicit user confirmation before file writes;
- local preview/runtime helpers for generated projects;
- AI provider switching through local, native and custom providers;
- Cortex project memory with optional RAG and optional MemPalace synchronization;
- Git, GitHub and deployment guidance.

## Current Status

This repository is a public-safe development build. It is not yet distributed as a packaged desktop application.

For now, run Faber Code from source using the development command below. Packaging, signed releases and end-user installers are future release work.

## Local Setup

Requirements:

- Node.js and npm
- Git
- Electron-compatible desktop environment

Run locally:

```bash
npm install
cp .env.example .env
npm run dev
```

Only `.env.example` is intended for version control. Keep `.env` local.

## Configuration

Faber Code reads runtime settings from `.env` and from the app settings UI.

Supported provider categories:

- local deterministic mock provider for architecture tests;
- local RWKV provider hooks;
- remote/custom API providers configured by the user;
- optional RAG backend;
- optional MemPalace runtime.

Secrets, API keys, local model files, private memories and user project history should never be committed.

## Optional Integrations and Attribution

Faber Code can connect to external open-source projects when the user installs and configures them locally. These integrations are optional and are not vendored in this repository.

- [MemPalace](https://github.com/MemPalace/mempalace): optional local-first memory runtime. MemPalace is released under the MIT License by MemPalace contributors.
- [R2R](https://github.com/SciPhi-AI/R2R): optional Retrieval-Augmented Generation service used through its REST API. R2R is released under the MIT License and maintained by SciPhi-AI; its license file lists copyright by EmergentAGI Inc.

No affiliation, sponsorship or endorsement by these projects is implied.

## Development Workflow

Use the local repository as the source of truth.

Recommended flow:

1. Make changes locally.
2. Run the public safety audit.
3. Run the architecture test suite when dependencies are installed.
4. Commit with a clear message.
5. Push to GitHub.

Avoid editing project files directly in the GitHub web UI unless it is an emergency documentation-only correction. Local edits keep the audit, tests and Git history reproducible.

## Public Repository Notes

This repository intentionally excludes private project history, client-specific knowledge bases, local model files, memory stores and runtime secrets.

## License and Brand

The source code in this repository is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Faber Code name, logos, icons and brand assets identify the official project. The Apache License, Version 2.0 does not grant trademark rights, and use of the Faber Code marks in a way that implies endorsement, official distribution or affiliation requires prior permission.

Before publishing or pushing changes, run:

```bash
npm run audit:public
npm run test:architecture
```

See [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md) for the release checklist.

## Architecture

The application keeps the renderer lightweight and routes privileged work through Electron main-process services:

- `renderer/`: UI, chat flow, settings panels and project file presentation.
- `main/`: IPC handlers, filesystem/project services, Git/GitHub helpers, preview runtimes and security boundaries.
- `cortex/`: provider registry, orchestration, memory adapters, validation and execution planning.
- `plugins/`: stack/plugin extension surface.
- `tests/`: focused architecture and service tests.

Knowledge and memory layers:

- Cortex stores user rules, project context and decision memory.
- RAG retrieves relevant indexed material when an external retrieval service is configured.
- MemPalace adds optional long-term local memory and project recall when the runtime is available.

These layers are designed to complement each other without making the core application dependent on a single external memory provider.
