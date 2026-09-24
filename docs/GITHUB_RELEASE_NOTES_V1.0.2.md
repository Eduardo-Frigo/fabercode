# Faber Code v1.0.2 — Node.js detection on macOS

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This maintenance release fixes the local-requirements screen blocking **Continue** when Node.js is installed but a macOS app launched from Finder or the Dock cannot see its directory in `PATH`.

## Fix

- The desktop app now discovers Node.js in common system and per-user installations, including Homebrew, the official installer, NVM, FNM, Volta, asdf, mise, and nodenv. No account name or Node.js version is hard-coded.
- The corrected path is shared with requirement checks, project terminals, and tools. **Verify again** refreshes the search, including after Node.js is installed while Faber Code is open.
- The requirements dialog now follows Faber Code's dark and light themes, typography, colors, and button styles.
- Git detection and the other application features are unchanged. Existing projects and settings remain in place.

## Signing and installation

**These installers do not yet carry a trusted publisher signature.** The SignPath Foundation application for Windows signing was submitted and awaits review. The macOS DMGs are not signed with Apple Developer ID or notarized. Linux AppImages have no platform code signature. The internal Ed25519 helper attestation is not an operating-system publisher signature. See the [code signing policy](https://github.com/Eduardo-Frigo/fabercode/blob/main/CODE_SIGNING_POLICY.md).

On macOS, copy Faber Code from the DMG to Applications. If Gatekeeper blocks first launch, open **System Settings → Privacy & Security**, choose **Open Anyway** for Faber Code, and confirm. Check `SHA256SUMS.txt` before opening the downloaded file. Windows SmartScreen may show an unknown-publisher warning.

The project welcomes voluntary support for future signing and notarization costs. A donation link will be added after the payout account is ready. The app remains free and open source.

## Installers

| System | x64 | ARM64 |
| --- | --- | --- |
| macOS | `Faber.Code-1.0.2-x64.dmg` | `Faber.Code-1.0.2-arm64.dmg` |
| Windows | `Faber.Code-Setup-1.0.2-x64.exe` | `Faber.Code-Setup-1.0.2-arm64.exe` |
| Linux | `Faber-Code-1.0.2-x86_64.AppImage` | `Faber-Code-1.0.2-arm64.AppImage` |

The [landing page](https://www.fabercode.site/) reads the newest published GitHub release and will display v1.0.2 after all six installers and the checksum file are published.
