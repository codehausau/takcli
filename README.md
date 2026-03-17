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
curl -fsSL https://raw.githubusercontent.com/<your-org>/takcli/main/scripts/install.sh | bash
```

### Docker
```bash
docker run --rm ghcr.io/<your-org>/takcli:latest version
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
