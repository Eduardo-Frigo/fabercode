# Public Release Checklist

Use this checklist before publishing or updating the public Faber Code
repository on GitHub.

## Public positioning

- [ ] The README explains that Faber Code is a local-first, AI-assisted IDE.
- [ ] The README makes clear that users can code manually and are not limited
      to requesting AI-generated work.
- [ ] The README describes the main tools: editor, terminal, execution/preview,
      Git, GitHub, memory, and validation.
- [ ] The README describes the Git/GitHub flow in the correct order: review new
      and modified files, select changes, stage, commit, send to GitHub, and
      then publish or deploy.
- [ ] The README explains that the project is free and licensed under
      Apache-2.0.
- [ ] The README explains that AI providers may be configured through a native
      API, a compatible API, or a custom connector.
- [ ] The README explains that a local RWKV model is not currently bundled or
      configured in Faber Code.
- [ ] The README explains that the planned RWKV integration is a separate,
      open project designed to connect cleanly to Faber Code.
- [ ] The documentation states that external AI providers are optional and may
      have their own usage costs.
- [ ] The documentation does not promise a final installer or signed release
      until those artifacts exist.
- [ ] GitHub release notes, the public README, and user-facing release material
      are written in English.

## Release metadata

- [ ] The release title, package version, tag, and update metadata use the same
      approved semantic version.
- [ ] The release tag points to the exact commit on `main` used to build every
      installer; no release is tagged from an older branch or commit.
- [ ] The official landing-page URL is final, uses HTTPS, and returns a successful
      response.
- [ ] No `TBD`, placeholder URL, temporary link, or draft-only instruction
      remains in the published release body.
- [ ] The concise GitHub release notes match the final technical release record.
- [ ] Artifact signing and notarization status is stated accurately and does not
      imply platform-vendor trust that the artifacts do not have.
- [ ] Every public macOS installer contains a Developer ID Application-signed
      app with a stapled notarization ticket and passes Gatekeeper assessment.
- [ ] Each macOS DMG has been downloaded and installed on a Mac without
      removing quarantine or bypassing Gatekeeper.
- [ ] Windows installers are checked for an Authenticode signature. If unsigned,
      the release notes state that Windows may show a publisher warning.

## Publication security

- [ ] `.env` and local variants are not tracked.
- [ ] `.env.example` contains placeholders only and does not select RWKV as the
      default provider.
- [ ] `private_context/` is not tracked.
- [ ] `.faber/`, local memories, databases, ledgers, caches, screenshots, and
      generated artifacts are not tracked.
- [ ] Local models, AI weights, `.gguf`, `.safetensors`, `.onnx`, `.pt`, `.pth`,
      `.bin`, and similar files are not tracked.
- [ ] User projects, generated workspaces, and client code are not tracked.
- [ ] Documentation contains no absolute local paths, personal accounts,
      tokens, or client names.
- [ ] `cortex_bootstrap/knowledge_sources/` contains only safe placeholders or
      public documentation.

## License, brand, and third parties

- [ ] `LICENSE` uses Apache-2.0.
- [ ] `NOTICE` includes copyright, attribution, and trademark guidance.
- [ ] The README explains that the license does not grant trademark rights.
- [ ] External integrations are described as optional unless their code is
      actually vendored.
- [ ] Third-party names, licenses, and links do not imply sponsorship,
      endorsement, or affiliation.

## Audit and tests

Run before publication:

```bash
npm run audit:release
npm run test:architecture
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Run as required by the changed area:

```bash
npm run test:ai-trust-boundary
npm run test:project-blueprint
npm run test:memory-rag-mempalace
npm run test:mcp-capabilities
npm run test:smoke-scenarios
npm run smoke:full-tool-loop
npm run smoke:briefing-loop-matrix
```

Run when a change affects AI, external context, memory, RAG, attachments, MCP,
or another privileged capability:

```bash
npm run test:ai-trust-boundary
npm run test:render-pass-service
npm run test:real-openai-prompt-injection
```

`test:real-openai-prompt-injection` is opt-in. It uses Electron to read a
protected key from `safeStorage`, requires network access, and may consume API
credits. It must not be part of the default architecture suite.

## Pentest and hardening

- [ ] External content sent to AI passes through `wrapUntrustedPromptSection`
      or an equivalent boundary.
- [ ] Privileged capabilities receive `aiTrustBoundary` when they consume an
      untrusted source.
- [ ] AI writes to `.env`, `.ssh`, `.git`, `private_context`, private keys, and
      credential files remain blocked.
- [ ] External URLs use an allowlist and HTTPS and reject embedded credentials.
- [ ] Preview opens only a local `file:` URL or
      `localhost`/`127.0.0.1`/`::1`.
- [ ] Local processes are invoked with `shell: false` when using structured
      arguments.
- [ ] External MCP integrations protect persisted secrets and block physical
      symlink escape.
- [ ] Git/GitHub flows validate paths, branches, remotes, owners, and clone
      destinations.

## GitHub

- [ ] Review `git status --short --ignored`.
- [ ] Review `git diff --check`.
- [ ] Create a commit only after audits and tests pass and the project owner
      explicitly approves it.
- [ ] Push only with explicit approval from the project owner.
- [ ] Avoid direct GitHub Web edits except for emergency documentation fixes.
- [ ] Verify the release title, tag, target branch, artifact signing status, checksums,
      landing-page link, and update instructions before publishing.

The public repository should contain product code, safe examples, and generic
documentation. It must not contain client context, private deployment scopes,
private user history, absolute local-machine paths, generated artifacts,
temporary focused tests, skipped tests, or obsolete work markers.
