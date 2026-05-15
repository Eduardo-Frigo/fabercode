# Faber Code

Faber Code is a local Electron workspace for AI-assisted project creation and editing.

The app focuses on:

- guided project generation for web stacks such as LAMP and Next.js;
- explicit user confirmation before file edits;
- local preview/runtime helpers;
- AI provider switching through local, native and custom providers;
- Cortex memory, optional RAG and optional MemPalace integration;
- Git and deployment guidance.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Only `.env.example` is intended for version control. Keep `.env` local.

## Public Repository Notes

This repository intentionally excludes private project history, client-specific knowledge bases, local model files, memory stores and runtime secrets.

Before publishing or pushing changes, run:

```bash
npm run audit:public
```

See [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md) for the release checklist.

## Architecture

The application keeps the renderer lightweight and routes privileged work through Electron main-process services:

- `renderer/`: UI, chat flow, settings panels and project file presentation.
- `main/`: IPC handlers, filesystem/project services, Git/GitHub helpers, preview runtimes and security boundaries.
- `cortex/`: provider registry, orchestration, memory adapters, validation and execution planning.
- `plugins/`: stack/plugin extension surface.
- `tests/`: focused architecture and service tests.

