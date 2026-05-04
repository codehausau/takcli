# TAKCLI Agent Guide

## Project summary

`takcli` is a standalone Node.js + TypeScript CLI for operating Team Awareness Kit environments.

Current v1 scope:

- manage TAK server profiles with an active context
- run diagnostics with `takcli doctor`
- inspect health with `takcli status`
- query, summarize, inject, and follow CoT data with `takcli cot`
- run a compose-first TAK Server deployment wizard with `takcli deploy`
- support human-readable output and stable `--json`
- install via npm, convenience script, and Docker

Out of scope for v1:

- plugin SDK
- TUI
- Kubernetes deployment support in the binary

## Stack

- Node.js 22+
- TypeScript
- ESM modules
- `commander` for CLI parsing
- `zod` for config validation
- `yaml` for config persistence
- `vitest` for testing
- `pnpm` for package management

Published package:

- npm: `@codehaus-au/takcli`
- binary: `takcli`

## Repository layout

- `src/cli`
  - command definitions, runtime plumbing, output formatting, shell completions
- `src/core`
  - config store, schema, profile resolution, version helpers
- `src/tak`
  - probe logic, doctor/status report generation, and CoT transport helpers
- `test/unit`
  - focused logic tests
- `test/integration`
  - CLI and probe integration tests
- `scripts`
  - convenience installer
- `.github/workflows`
  - CI, semantic PR checks, Release Please, publishing

## Important behavior

### Config

- default config path: `~/.takcli/config.yaml`
- override with `TAKCLI_CONFIG` or `--config`
- profiles are stored in YAML with `currentProfile`

### Health checks

- `doctor` and `status` probe multiple TAK endpoints, not just the API port
- ad-hoc usage supports `--server` and `--insecure`

### Completions

- built-in command: `takcli completion <bash|zsh|fish>`
- hidden backend command: `takcli __complete`

### CoT commands

- `cot query` uses the TAK HTTP surfaces for CoT lookup
- `cot targets` uses uidsearch plus per-UID CoT enrichment
- `cot inject` and `cot follow` use the live TLS CoT port
- v1 reuses PEM-style profile TLS settings:
  - `tls.caFile`
  - `tls.certFile`
  - `tls.keyFile`
  - `tls.insecureSkipVerify`

### Deploy command

- `deploy` currently targets the published unhardened Docker Compose path
- it generates TAKCLI-owned deployment files in `~/.takcli/deployments/<name>/`
- it expects `docker.io/codehausau/takserver-full` for the server image and `docker.io/codehausau/postgres15-postgis3` for the database by default
- Kubernetes support is planned as the next deployment milestone

### Guide-driven next features

The strongest follow-on CLI areas from [`TAK_Server_Configuration_Guide.pdf`](/workspaces/tak/tak-server/src/docs/TAK_Server_Configuration_Guide.pdf) are:

- `cert`
  - CA, server, client, admin, enrollment, and PostgreSQL TLS workflows
- `auth` / `users`
  - file users, groups, password reset, bulk user creation, LDAP / AD, OAuth2
- `inputs`
  - group filtering, multicast routing, x509 / auth-message assignment behavior
- `federation`
  - federate certificates, connections, group mapping, mission disruption tolerance, blockers
- `observe`
  - metrics, logs, and data-retention operations

If extending `takcli`, prefer those areas before broadening into lower-value installation wrappers.

### TAK Server image publishing

- hardened image publishing is blocked on Iron Bank access
- current practical path is unhardened image publishing
- helper script:
  - `scripts/build-unhardened-takserver-images.sh`
- supporting notes:
  - `docs/unhardened-takserver-images.md`
- the intended manual release flow is:
  - check out an upstream `tak-server` release tag
  - run the helper script
  - review the local build
  - push the versioned images to `codehausau`

## Common commands

Install dependencies:

```bash
pnpm install
```

Validate locally:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pack the npm tarball:

```bash
pnpm pack
```

Run the CLI locally:

```bash
node dist/cli.js version
pnpm build
node dist/cli.js status --help
```

## CI/CD and release flow

- `CI` runs on every branch push and on pull requests
- `Semantic PR Title` runs on pull requests
- `Release Please` runs on `main`
- `Release` runs when a GitHub release is published

Publishing targets:

- npm package: `@codehaus-au/takcli`
- container image: `ghcr.io/codehausau/takcli`

Required GitHub Actions secrets:

- `NPM_TOKEN`
- `RELEASE_PLEASE_TOKEN`

## Development guidance

- prefer small, targeted CLI changes
- keep human output readable and `--json` stable
- do not couple the CLI to repo-specific TAK deployment scripts
- keep tests environment-independent
- when adding new probes or health logic, make CI-safe behavior explicit
- preserve the public command UX unless there is a clear reason to change it

## Git notes

- this folder is its own git repo
- current preferred author email for public commits:
  - `20449557+mat-codehaus@users.noreply.github.com`
