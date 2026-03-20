# README Demos

This repo uses [VHS](https://github.com/charmbracelet/vhs) tapes for repeatable terminal demos.

## Render the live demo

From the repo root:

```bash
pnpm demo:readme:live
```

The live demo renders against a running local TAK compose deployment and exercises real `status`, `doctor`, `users`, `cot`, and `deploy` commands. It runs a dedicated renderer container on the same Docker network as the TAK server, so it does not depend on installing `vhs` on the host or in the devcontainer.

The live renderer will:

- detect a running TAK Server container
- attach the renderer container to the same Docker network
- copy the admin client cert/key and CA into `/tmp/takcli-live-demo`
- install the current `takcli` package inside the renderer container
- create a throwaway local TAK Server repo for the compose deploy dry-run
- render [readme-live.tape](/workspaces/tak/takcli/docs/demos/readme-live.tape) against the running server

## Files

- `docs/demos/readme-live.tape`
  - live TAK demo using real `status`, `doctor`, `users`, `cot`, and compose `deploy` commands
- `docs/assets/`
  - generated GIF assets

## Updating the demo

1. Edit `docs/demos/readme-live.tape`.
2. Re-run `pnpm demo:readme:live`.
3. Commit the updated asset in `docs/assets/` if the output changed.
