# Code signing policy

Faber Code is a personal, free and open-source project maintained by Eduardo
Frigo. The repository is [Eduardo-Frigo/fabercode](https://github.com/Eduardo-Frigo/fabercode),
and releases are published on its [GitHub Releases page](https://github.com/Eduardo-Frigo/fabercode/releases).

## Current status

The project is applying for free Windows code signing. Until the application is
accepted and a release is signed, Windows installers must be treated as
**unsigned**. A signature from SignPath Foundation is never implied by the
project name, this policy, or a SHA-256 checksum alone.

If accepted: Free code signing provided by [SignPath.io](https://signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/). The Windows
publisher shown by the certificate would be SignPath Foundation, while Eduardo
Frigo remains the project maintainer. Signed releases will explicitly identify
the signed files and the source revision used to build them.

The SignPath Foundation program concerns Windows code signing. macOS public
distribution separately requires an Apple Developer ID certificate and Apple
notarization. Linux packages have no SignPath or Apple signature.

## Build and approval

The [Windows release candidate workflow](.github/workflows/windows-release-candidate.yml)
is configured to build both Windows architectures from `main` on GitHub Actions
and publish build artifacts with SHA-256 checksums. The private key used to
attest Faber Code's portable isolation helper is stored as a GitHub Actions
secret in the `release-signing` environment, restricted to `main`. This private
key is not part of the source repository or release artifacts. SignPath signing, if
granted, will be requested only for approved artifacts from this workflow.
Each signing request requires a separate manual approval.

The sole current maintainer, [Eduardo Frigo](https://github.com/Eduardo-Frigo),
is responsible for source changes (author), reviewing outside contributions
(reviewer), and deciding whether a specific release may be signed (approver).
Contributions from others require his review before they are merged.

## Privacy and external services

Faber Code keeps projects and settings locally. The program does not send user
information to other networked systems unless the user requests or configures
an integration. Optional integrations can send relevant requests or project
content to the provider selected by the user, including AI providers, Pexels,
GitHub, and external MCP services. Each provider has its own privacy policy.
See the [security policy](SECURITY.md) for handling of local secrets.
