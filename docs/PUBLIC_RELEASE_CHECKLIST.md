# Public Release Checklist

Use this checklist before pushing Faber Code to a public GitHub repository.

1. Confirm `.env` is local only and `.env.example` has placeholders only.
2. Confirm `private_context/` is not tracked.
3. Confirm local model files, memory stores, generated workspaces and release outputs are not tracked.
4. Confirm `cortex_bootstrap/knowledge_sources/` contains only public-safe placeholders or documentation.
5. Run `npm run audit:public`.
6. Run `npm run test:architecture` when dependencies are installed.
7. Review `git status --short --ignored` before the first commit.
8. Create the first commit only after the audit and tests pass.

The public repository should contain product code, safe examples and generic documentation. It should not contain client-specific context, deployment scopes, internal project history or local machine paths.

