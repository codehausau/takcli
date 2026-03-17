# TAKCLI

`takcli` is a modern operator CLI for Team Awareness Kit workflows.

The first milestone focuses on:
- profile and active-context management
- TAK server diagnostics with `doctor`
- TAK server operational summaries with `status`
- human-friendly output with stable `--json`

## Install

### npm
```bash
npm install -g @codehaus-au/takcli
```

### Convenience script
```bash
curl -fsSL https://raw.githubusercontent.com/codehausau/takcli/main/scripts/install.sh | bash
```

### Docker
```bash
docker run --rm ghcr.io/codehausau/takcli:latest version
```

## Quick start

Add a profile and make it current:

```bash
takcli profile add local --server https://127.0.0.1:8446 --insecure --set-current
```

Run diagnostics:

```bash
takcli doctor
takcli status
takcli doctor --json
takcli status --server https://127.0.0.1:8446 --insecure --json
```

Use a one-off target without changing the active profile:

```bash
takcli doctor --server https://tak.example.internal:8446 --json
```

## Profile model

Profiles live in:

```text
~/.takcli/config.yaml
```

You can override that path with:

```bash
TAKCLI_CONFIG=/path/to/config.yaml takcli profile list
```

Example config:

```yaml
schemaVersion: 1
currentProfile: local
profiles:
  local:
    server: https://127.0.0.1:8446
    tls:
      insecureSkipVerify: true
    ports:
      api: 8446
      enrollment: 8443
      federation: 8444
      cot: 8089
```

## Commands

### Implemented
- `takcli completion <bash|zsh|fish>`
- `takcli doctor`
- `takcli status`
- `takcli profile list`
- `takcli profile add`
- `takcli profile use`
- `takcli profile show`
- `takcli profile remove`
- `takcli version`

### Roadmap
These command families are intentionally not shipped in v1 yet:
- `deploy`
- `admin`
- `cot`

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Shell completions

Generate a completion script for your shell:

```bash
takcli completion bash
takcli completion zsh
takcli completion fish
```

Examples:

```bash
takcli completion bash > ~/.local/share/bash-completion/completions/takcli
takcli completion zsh > "${fpath[1]}/_takcli"
takcli completion fish > ~/.config/fish/completions/takcli.fish
```

## Release model

This repository is designed for:
- Conventional Commits
- Release Please managed versioning and changelogs
- npm publishing as `@codehaus-au/takcli`
- Docker publishing to GitHub Container Registry

## GitHub setup

To get CI/CD and publishing working on `https://github.com/codehausau/takcli`, configure these GitHub Actions secrets:

- `NPM_TOKEN`
  - npm automation token with permission to publish `@codehaus-au/takcli`
- `RELEASE_PLEASE_TOKEN`
  - recommended when the repository or organization does not allow the default `GITHUB_TOKEN` to create pull requests
  - if using a fine-grained PAT, grant repository access with:
    - `Contents: Read and write`
    - `Pull requests: Read and write`
    - `Issues: Read and write`

Workflow behavior:

- pull requests run CI and semantic PR checks
- pushes to `main` run Release Please
- published GitHub releases run npm and GHCR publishing

Notes:

- `release-please.yml` prefers `RELEASE_PLEASE_TOKEN` and falls back to the built-in `GITHUB_TOKEN`
- if your organization has disabled “GitHub Actions can create and approve pull requests”, Release Please will need `RELEASE_PLEASE_TOKEN`
- GitHub currently warns that `googleapis/release-please-action@v4` still runs on the older Node 20 action runtime; this is an upstream action warning rather than a TAKCLI code issue
