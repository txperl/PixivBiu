# Desktop update validation

Validation date: 2026-10-09. The real installer run used Windows 11 Pro 10.0.26300 x64 and isolated, unsigned, current-user NSIS packages. Its three fixtures shared the production UpdateController, UpdateStore, CoreSupervisor and Windows installation-directory helper, with a real locally built Go Core and a loopback update feed.

## Results

The real installation sequence **0.0.1 → 0.0.2 → 0.0.3 passed**. Both silent installer handoffs automatically reopened the actual new version in the original custom directory containing spaces. Windows version resources, the packaged version, and executable/ASAR bytes changed on each upgrade. Both installation receipts reported success only after the target Desktop version launched.

Background downloads retained the same healthy Core PID. Ordinary quit left the installed bytes unchanged and stopped the shell/Core; reopening required fresh feed and cache verification before restoring the downloaded state. Explicit installation waited for Core to stop. Persisted settings were read back through the real REST API, and a synthetic authenticated session survived both upgrades. No real account credentials were used.

Before the directory fix, repeated isolated runs reproduced a second-upgrade fallback to the default Programs directory while the custom directory still held 0.0.2. The compiled app ID, NSIS GUID and x64 architecture matched across all three packages, and both registry views retained the custom installation record. Configuring NsisUpdater's public installDirectory from the running executable resolved the observed failure in the consecutive-upgrade test; the underlying NSIS failure was not independently identified.

| Check | Result |
| --- | --- |
| Desktop npm run check | 93 passed, 2 platform-dependent skips, 0 failed |
| Frontend Biome ci | Passed |
| Frontend Bun tests | 64 passed |
| Frontend bun run build | Passed |
| Native update UI fixture | Passed for four locales, navigation/reload, consent, keyboard input and external-package actions |
| Native Go Core lifecycle fixture | Passed for managed restarts, persisted settings, protocol/SSE cleanup and shutdown |
| Real NSIS installation fixture | Both consecutive upgrades passed |
| E2E script syntax and git diff --check | Passed |

## Installed-byte evidence

The hashes below identify this run's isolated fixtures, not release artifacts. FileVersion values were 0.0.1, 0.0.2 and 0.0.3; ProductVersion values were the corresponding four-part versions ending in .0.

| Desktop version | Executable SHA256 | ASAR SHA256 |
| --- | --- | --- |
| 0.0.1 | d57cad776d3ec5a6362a08e8a395b664be6e50eeb2d7d63ecad0798c9fbce071 | 77b41469f61126a5b86b31cabff7e2d8a53bb2d34a84bbd6b35ad1cc8483fcbc |
| 0.0.2 | f51076ae64b8282a2327c8b919e5bff5fc9c52339ba1305d4823b1074a10867f | 36b7cbbfc4522aec25d5b74819e4d5d3e5914c975ea3a28c8e35135fdfcd5671 |
| 0.0.3 | 98c859dea9147bf7f34156856c1d7e4c7a5cfcc70f8b311867af7718613d851f | 71e5bc054f1dbd380952550372e83a94e0601b2091ac2fe2bfd52159a65d556a |

## Coverage and cleanup

The installer fixture uses its own main entry and command transport. Production SPA/preload behavior and Core lifecycle have complementary native fixtures; a single production-window/IPC-to-installer E2E was not performed. Machine installation, UAC acceptance/cancellation, signing/SmartScreen, Windows 10, real Pixiv OAuth, artwork download-job recovery, macOS and Linux installation remain unverified.

The fixture's own uninstallers removed its installation directories and registration; old shell/Core/setup processes were absent, and the task's NSIS installer stores were removed after checksum-based ownership verification. Large generated installers, copied dependencies, synthetic profiles and task caches were subsequently cleaned at the user's request. This summary retains the successful run's key evidence; rerun commands are in the [desktop guide](README.md#isolated-windows-installer-e2e).
