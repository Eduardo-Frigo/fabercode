# Faber Code v1.0.0 — Local access and personal Pexels API

**Official website:** [www.fabercode.site](https://www.fabercode.site/)

This release changes how the desktop app starts and obtains Pexels media. Faber Code now opens locally without a Faber account or database. Each user who wants Pexels photos or videos connects their own Pexels API key in the app.

## Highlights

- **No sign-in required:** The desktop workspace opens with local access on packaged macOS, Windows, and Linux builds. An older `.env` setting that disabled local access no longer blocks a packaged app.
- **Your own Pexels key:** Open **Settings → Configure APIs → Pexels**, follow the link to the [official Pexels API page](https://www.pexels.com/api/), create a key, paste it, and save. Pexels media searches require that key; the rest of the app remains available without it.
- **Direct media requests:** The desktop app sends Pexels searches directly to Pexels using the locally configured key. The shared platform key, Faber media proxy, and sign-in-only media endpoint are no longer part of this flow.
- **Six desktop variants:** Separate x64 and ARM64 installers are prepared for macOS, Windows, and Linux. File names identify the operating system and architecture.
- **Updated setup guidance:** The API screen explains the Pexels setup in Portuguese, English, and Spanish and links to Pexels when a key is missing.

## Safety and control

The Pexels key is saved in local app settings and is used for requests to Pexels. It is not bundled into the installers or sent to a Faber media service. Usage limits belong to the user's Pexels account.

The existing project and agent permission model remains in place. The local access change removes the account gate; it does not grant the agent new authority over project files or external services.

## Compatibility

Choose the installer that matches your computer's operating system and CPU architecture. This release supports x64 and ARM64; it does not include a 32-bit installer. Electron 42 requires Windows 10 or newer. Linux compatibility depends on the system libraries available in the distribution, so an AppImage cannot cover every historical Linux version.

Users upgrading from v0.2.0 can open the packaged app without signing in. To continue using Pexels images and videos, add a personal key in Settings. Existing local project files are not changed by the Pexels configuration flow.

## Validation

The account-gate, Pexels settings, direct media service, backend route, runtime settings, and release-helper tests passed. The public release and test-hygiene audits passed.

Provider-dependent live qualification requires the user's own API credentials and remains opt-in.

## Rollout note

The application and API changes are part of the same v1.0.0 update for every desktop variant. [fabercode.site](https://www.fabercode.site/) remains on Vercel and reads the latest GitHub release for its download links.

## Distribution

| System | x64 | ARM64 |
| --- | --- | --- |
| macOS | `Faber Code-1.0.0-x64.dmg` | `Faber Code-1.0.0-arm64.dmg` |
| Windows | `Faber Code-Setup-1.0.0-x64.exe` | `Faber Code-Setup-1.0.0-arm64.exe` |
| Linux | `Faber-Code-1.0.0-x86_64.AppImage` | `Faber-Code-1.0.0-arm64.AppImage` |

The installers are not signed or notarized by the operating-system vendors, so the OS may show a trust warning. Verify the downloaded file against `SHA256SUMS.txt`. Manual installation is required for vendor-unsigned packages; the macOS automatic installer requires a vendor-signed package, and Windows/Linux do not use the DMG update path.
