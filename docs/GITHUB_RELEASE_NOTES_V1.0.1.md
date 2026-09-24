# Faber Code v1.0.1 — desktop distribution update

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This maintenance release keeps the local access and personal Pexels API setup introduced in v1.0.0. It provides installers for all six supported operating-system/architecture combinations and aligns the release source with the project's `main` branch.

## Fixes

- **macOS installation:** Separate x64 and ARM64 DMGs are available. Their disk images are verified, but they are **not signed with Apple Developer ID or notarized**. The signed build path remains gated until those credentials become available.
- **Release source:** The application changes from v1.0.0 are integrated into `main`. The v1.0.1 tag and installers must be produced from the same commit.
- **Package identity:** Application metadata identifies the author as **megaptera - Eduardo Frigo**. The operating system displays the legal publisher identity from the platform certificate where a trusted certificate is used.
- **Distribution helper:** The internal Ed25519 release key is rotated for v1.0.1. This key verifies the bundled portable isolation helper; it does not replace operating-system code signing.

## Compatibility

Choose the installer matching your operating system and CPU architecture. macOS, Windows, and Linux packages are planned for x64 and ARM64. There is no 32-bit build. Electron 42 requires Windows 10 or newer; Linux requires compatible system libraries.

Projects and locally saved settings remain in place. Pexels photos and videos still require each user's own key in **Settings → Configure APIs → Pexels**; other app features do not require a Faber account.

## Signing status and installation

**None of these installers currently has a trusted publisher signature.** Windows installers have no Authenticode signature while the SignPath Foundation application is pending. macOS DMGs have no Developer ID signature or Apple notarization. Linux AppImages have no platform code signature. The internal Ed25519 helper attestation does not identify the publisher to the operating system. See the [code signing policy](https://github.com/Eduardo-Frigo/fabercode/blob/main/CODE_SIGNING_POLICY.md).

On macOS, copy the app from the DMG to Applications and try opening it. If Gatekeeper blocks it, open **System Settings → Privacy & Security**, choose **Open Anyway** for Faber Code, and confirm. Compare the downloaded file with `SHA256SUMS.txt` first. Do not disable Gatekeeper globally or remove quarantine through Terminal. On Windows, SmartScreen may display an unknown-publisher warning; verify the installer source and SHA-256 before deciding whether to proceed.

The project welcomes donations specifically to cover future signing and notarization costs. The official donation channel will be linked from the repository and release page once its payout setup is complete; there is no donation link in this release yet.

## Distribution

The landing page reads the latest published GitHub release, so it will expose v1.0.1 after all six installers and `SHA256SUMS.txt` are published. The macOS DMGs pass image verification, and the Windows installers come from a public GitHub Actions build.

| System | x64 | ARM64 |
| --- | --- | --- |
| macOS | `Faber.Code-1.0.1-x64.dmg` | `Faber.Code-1.0.1-arm64.dmg` |
| Windows | `Faber.Code-Setup-1.0.1-x64.exe` | `Faber.Code-Setup-1.0.1-arm64.exe` |
| Linux | `Faber-Code-1.0.1-x86_64.AppImage` | `Faber-Code-1.0.1-arm64.AppImage` |

## Validation

The public release gate, portable isolation helper tests, build artifact checksums, and macOS disk-image verification must pass. The ARM64 app opens from a temporary installed copy. Gatekeeper assessment rejects both macOS builds because neither has a trusted Developer ID signature; macOS requires the user's explicit override for a downloaded copy.
