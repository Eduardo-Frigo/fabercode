# Security Policy

## Secrets

Do not commit real API keys, access tokens, private keys, local `.env` files, model paths, memory stores or client project data.

Supported local secret locations:

- `.env` for local runtime environment variables.
- Electron user data storage for provider settings saved through the app.

Only `.env.example` should be committed.

## Public Release Checks

Run this before creating a public commit:

```bash
npm run audit:public
```

If the audit reports private paths, known client identifiers, tokens or key-like values, fix those files before pushing.

## Reporting

If you find a security issue in this repository, open a private report with enough reproduction detail and avoid posting secrets in public issues.

