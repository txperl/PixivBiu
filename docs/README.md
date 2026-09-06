# Documentation

PixivBiu's documentation describes the v3 code in this checkout. For an installed release, use the documentation at its source tag when behavior differs. The core includes the web UI; desktop bundles a separately versioned, pinned core.

## Use and operate PixivBiu

| I want to… | Start here |
| --- | --- |
| Install and run the app | [中文](../README.md) · [English](../README_EN.md) · [日本語](../README_JA.md) |
| Configure paths, proxy, language, or downloads | [Configuration reference](CONFIGURATION.md) |
| Deploy, update, or back up a container | [Docker deployment](DOCKER.md) |
| Understand desktop storage and window behavior | [Desktop guide](../desktop/README.md) |

## Develop

| I want to… | Start here |
| --- | --- |
| Set up a checkout, run locally, or build | [Development guide](DEVELOPMENT.md) |
| Understand service boundaries and state flow | [Architecture](ARCHITECTURE.md) |
| Change an API or add a setting | [OpenAPI workflow](DEVELOPMENT.md#openapi-workflow) · [Settings workflow](DEVELOPMENT.md#adding-or-changing-a-setting) |
| Work on the React UI | [Frontend guide](../frontend/README.md) |
| Add or change translations | [Message conventions](../frontend/src/i18n/messages/README.md) |
| Work on Electron or its renderer bridge | [Desktop guide](../desktop/README.md) |
| Find AI coding-agent constraints | [AGENTS.md](../AGENTS.md) |

The running core serves Scalar API Reference at `/docs` and its OpenAPI document at `/openapi.json`. Both paths are outside `/api/v1` and are currently registered in all builds. They describe that running binary, which may differ from a checkout.

## Release and maintain

- [Release checklist](RELEASE.md): one-time setup, core/desktop publishing steps, and failed-release recovery.
- [Release reference](RELEASE_REFERENCE.md): artifacts, channels, verification, key rotation, forks, and local rehearsals.
- [Documentation maintenance](DEVELOPMENT.md#documentation-maintenance): which document owns each subject and what to verify when changing it.

Keep procedures in the task guide, facts in the reference, and design reasons in the architecture or module guide. Link to the owning document rather than maintaining another complete copy.
