# Security Policy

Faber Code is designed as a local-first desktop application. User projects, provider keys, local model paths, Cortex memories, RAG indexes and MemPalace stores are expected to remain on the user's machine unless the user explicitly configures an external service.

## Secrets

Do not commit real API keys, access tokens, private keys, local `.env` files, model paths, memory stores or client project data.

Supported local secret locations:

- `.env` for local runtime environment variables.
- Electron user data storage for provider settings saved through the app.

Only `.env.example` should be committed.

## Optional External Services

Remote AI providers, RAG backends and deployment platforms should be treated as user-configured integrations. Do not hardcode service credentials, organization IDs, customer identifiers or deployment targets in source files.

## Public Release Checks

Run this before creating a public commit:

```bash
npm run audit:public
```

If the audit reports private paths, known client identifiers, tokens or key-like values, fix those files before pushing.

## Reporting

If you find a security issue in this repository, use GitHub private vulnerability reporting when available. If private reporting is not available, open a minimal public issue that does not include secrets, tokens, private file paths or exploitable details.
