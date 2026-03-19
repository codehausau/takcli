# TAKCLI

`takcli` is a modern operator CLI for Team Awareness Kit workflows.

The first milestone focuses on:
- profile and active-context management
- TAK server diagnostics with `doctor`
- TAK server operational summaries with `status`
- CoT query, target discovery, injection, and stream following with `cot`
- interactive Docker Compose deployment with `deploy`
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
takcli cot query --uid my-uid
takcli cot targets
takcli deploy
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
- `takcli cot query`
- `takcli cot targets`
- `takcli cot inject`
- `takcli cot follow`
- `takcli deploy`
- `takcli profile list`
- `takcli profile add`
- `takcli profile use`
- `takcli profile show`
- `takcli profile remove`
- `takcli version`

### Roadmap
These command families are intentionally not shipped in v1 yet:
- `admin`
- Kubernetes deployment in `takcli deploy`

### Next candidates from the TAK Server Configuration Guide
The local guide at [`TAK_Server_Configuration_Guide.pdf`](/workspaces/tak/tak-server/src/docs/TAK_Server_Configuration_Guide.pdf) points to several strong next-step CLI surfaces for `takcli`:

- `takcli cert`
  - create and rotate TAK CA, server, admin, client, and database TLS material
  - automate cert enrollment / Quick Connect bootstrap for the `8446` enrollment path
  - configure PostgreSQL TLS and validate cert wiring
- `takcli auth`
  - manage file-based users and groups
  - configure LDAP / Active Directory backends
  - inspect OAuth2 / token endpoint configuration
- `takcli users`
  - create, delete, bulk-create, and reset passwords for TAK users
  - inspect and update IN / OUT group membership
- `takcli inputs`
  - inspect and manage input listeners, group filtering, multicast routing, and auth mode
  - manage group-assignment behavior for x509 and authentication messages
- `takcli federation`
  - enable federation, upload federate certs, create connections, and manage outbound / mapped groups
  - inspect mission disruption tolerance and data-package / mission file blocking settings
- `takcli observe`
  - surface metrics and log locations
  - tail messaging / API logs and summarize common failure modes
- `takcli retention`
  - drive the data retention tool and validate retention configuration

The best near-term sequence is probably:
1. `cert`
2. `users` / `auth`
3. `federation`
4. `observe`
5. Kubernetes deploy support

## Deploy workflows

`takcli deploy` is a compose-first wizard that:
- checks for `git`, `docker`, and `docker compose`
- clones or reuses the official `TAK-Product-Center/Server` repo in `~/.takcli/cache/tak-server`
- copies the upstream `docker/full` assets into a TAKCLI-managed deployment workspace
- renders a TAKCLI-owned `.env`, compose file, and deployment metadata beside the upstream copy
- prompts for deployment secrets interactively and writes the generated `.env` with restricted permissions
- starts the stack with `docker compose up -d`

The default image sources are:
- `docker.io/codehausau/takserver-full:<tag>`
- `postgis/postgis:15-3.3`

Quick example:

```bash
takcli deploy \
  --target docker-compose \
  --ref main \
  --name tak-demo \
  --registry docker.io/codehausau \
  --image-tag main
```

For non-interactive use, you can provide the required deployment values up front:

```bash
takcli deploy \
  --target docker-compose \
  --ref main \
  --name tak-demo \
  --deployment-root ~/.takcli/deployments/tak-demo \
  --data-dir ~/.takcli/deployments/tak-demo/data \
  --logs-dir ~/.takcli/deployments/tak-demo/data/logs \
  --certs-dir ~/.takcli/deployments/tak-demo/data/certs \
  --registry docker.io/codehausau \
  --image-tag main \
  --postgres-password change-me \
  --ca-name tak-demo-CA \
  --ca-pass change-me \
  --state ACT \
  --city Canberra \
  --organization CodeHaus \
  --organizational-unit Ops \
  --takserver-cert-pass change-me \
  --admin-cert-name admin \
  --admin-cert-pass change-me \
  --yes
```

## CoT workflows

Query the latest CoT event for a UID:

```bash
takcli cot query --uid alpha --server https://127.0.0.1:8446 --insecure
takcli cot query --uid alpha --server https://127.0.0.1:8446 --insecure --raw
```

List recent CoT targets from the last 24 hours:

```bash
takcli cot targets --server https://127.0.0.1:8446 --insecure
takcli cot targets --start-date 2026-03-16 --end-date 2026-03-17 --limit 25 --json
```

Inject a generated CoT event over the live TLS CoT port:

```bash
takcli cot inject \
  --uid alpha \
  --type a-f-G-U-C \
  --lat -35.3 \
  --lon 149.1 \
  --callsign "Eagle 1"
```

Follow the live CoT stream:

```bash
takcli cot follow
takcli cot follow --limit 10 --json
```

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## TAK Server Images

The hardened TAK Server Docker images require Iron Bank base images, so the practical publishing path today is the **unhardened** image set.

There is a helper script for building release-tagged unhardened images from an upstream `tak-server` checkout:

```bash
./scripts/build-unhardened-takserver-images.sh \
  --tak-server-repo /path/to/tak-server \
  --tag 5.2-RELEASE-16 \
  --image-prefix docker.io/codehausau
```

More detail is in [docs/unhardened-takserver-images.md](/workspaces/tak/takcli/docs/unhardened-takserver-images.md).

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
