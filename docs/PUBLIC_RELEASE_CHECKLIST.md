# Public Release Checklist

Use this checklist before pushing Faber Code to a public GitHub repository.

1. Confirm `.env` is local only and `.env.example` has placeholders only.
2. Confirm `private_context/` is not tracked.
3. Confirm local model files, memory stores, generated workspaces and release outputs are not tracked.
4. Confirm `cortex_bootstrap/knowledge_sources/` contains only public-safe placeholders or documentation.
5. Confirm third-party integrations are described as optional unless their code is vendored in this repository.
6. Confirm third-party names, licenses and links are attributed without implying sponsorship or endorsement.
7. Run `npm run audit:public`.
8. Run `npm run test:architecture` when dependencies are installed.
9. Review `git status --short --ignored` before the first commit.
10. Create commits only after the audit and tests pass.
11. Push from the local repository instead of editing tracked files directly in the GitHub web UI.

The public repository should contain product code, safe examples and generic documentation. It should not contain client-specific context, deployment scopes, internal project history or local machine paths.
