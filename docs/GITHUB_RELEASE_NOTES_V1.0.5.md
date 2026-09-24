# Faber Code v1.0.5 — complete in-app update flow

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This release fixes the Windows restart step and provides the complete in-app update flow for macOS, Windows, and Linux on x64 and ARM64.

## Fix

- The Update button now downloads the installer from the matching asset in the latest official GitHub release, checks its size and SHA-256 digest, and installs it without opening a browser.
- On macOS, Faber Code checks the DMG contents and architecture, prepares the replacement beside the current app, then restarts into the new version. This avoids the missing `latest-mac.yml` error in v1.0.2.
- On Windows, the app starts the matching NSIS installer after verification and asks it to launch the updated app when installation finishes. On Linux, an AppImage started from a writable location is replaced and relaunched.
- The confirmation and progress text now describe the actual in-app installation flow.

**One-time transition:** v1.0.3 and older do not contain this updater. Install v1.0.5 once from this release page to enable in-app installation for later updates. The previously installed v1.0.2 cannot repair its updater through release metadata alone. v1.0.4 can install this update inside the app; on Windows, reopen Faber Code manually if that version does not restart after installing it.

The installation location must be writable by the current user. Windows may still show an operating-system security or permission prompt. Linux in-app replacement requires running the AppImage itself.

## Signing and installation

**These installers do not yet carry a trusted publisher signature.** The SignPath Foundation application for Windows signing awaits review. The macOS DMGs are not signed with Apple Developer ID or notarized. Linux AppImages have no platform code signature. The internal Ed25519 helper attestation is not an operating-system publisher signature. See the [code signing policy](https://github.com/Eduardo-Frigo/fabercode/blob/main/CODE_SIGNING_POLICY.md).

On macOS, copy Faber Code from the DMG to Applications. If Gatekeeper blocks first launch, open **System Settings → Privacy & Security**, choose **Open Anyway** for Faber Code, and confirm. Check `SHA256SUMS.txt` before opening the downloaded file. Windows SmartScreen may show an unknown-publisher warning.

The project welcomes voluntary support for future signing and notarization costs. A donation link will be added after the payout account is ready. The app remains free and open source.

## Installers

| System | x64 | ARM64 |
| --- | --- | --- |
| macOS | `Faber.Code-1.0.5-x64.dmg` | `Faber.Code-1.0.5-arm64.dmg` |
| Windows | `Faber.Code-Setup-1.0.5-x64.exe` | `Faber.Code-Setup-1.0.5-arm64.exe` |
| Linux | `Faber-Code-1.0.5-x86_64.AppImage` | `Faber-Code-1.0.5-arm64.AppImage` |

The [landing page](https://www.fabercode.site/) reads the newest published GitHub release and will display v1.0.5 after all six installers and the checksum file are published.
