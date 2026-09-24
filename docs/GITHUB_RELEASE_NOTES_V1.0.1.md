# Faber Code v1.0.1 — macOS distribution correction

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This maintenance release keeps the local access and personal Pexels API setup introduced in v1.0.0. It corrects the macOS distribution process and aligns the release source with the project's `main` branch.

## Fixes

- **macOS installation:** The release build now requires a valid Apple Developer ID Application signature and Apple notarization. It verifies the signature, stapled ticket, Gatekeeper assessment, and DMG before an installer can be published.
- **Release source:** The application changes from v1.0.0 are integrated into `main`. The v1.0.1 tag and installers must be produced from the same commit.
- **Package identity:** Application metadata identifies the author as **megaptera - Eduardo Frigo**. The operating system displays the legal publisher identity from the platform certificate where a trusted certificate is used.
- **Distribution helper:** The internal Ed25519 release key is rotated for v1.0.1. This key verifies the bundled portable isolation helper; it does not replace operating-system code signing.

## Compatibility

Choose the installer matching your operating system and CPU architecture. macOS, Windows, and Linux packages are planned for x64 and ARM64. There is no 32-bit build. Electron 42 requires Windows 10 or newer; Linux requires compatible system libraries.

Projects and locally saved settings remain in place. Pexels photos and videos still require each user's own key in **Settings → Configure APIs → Pexels**; other app features do not require a Faber account.

## Distribution

The landing page reads the latest published GitHub release, so it will expose v1.0.1 only after all six installers and `SHA256SUMS.txt` are published. The macOS installers must pass the Developer ID and notarization checks before publication. Windows and Linux installers require validation on their respective systems.

**Code signing policy:** [read the current signature status and release approval process](../CODE_SIGNING_POLICY.md). Windows installers remain unsigned unless the SignPath Foundation application is accepted and this release is rebuilt and signed through the approved workflow.

| System | x64 | ARM64 |
| --- | --- | --- |
| macOS | `Faber.Code-1.0.1-x64.dmg` | `Faber.Code-1.0.1-arm64.dmg` |
| Windows | `Faber.Code-Setup-1.0.1-x64.exe` | `Faber.Code-Setup-1.0.1-arm64.exe` |
| Linux | `Faber-Code-1.0.1-x86_64.AppImage` | `Faber-Code-1.0.1-arm64.AppImage` |

## Validation

The public release gate, portable isolation helper tests, and macOS distribution gate must pass. Both macOS DMGs must be installed from downloaded copies and opened without manually removing quarantine before the release is published.
