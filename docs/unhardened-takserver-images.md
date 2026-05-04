# Unhardened TAK Server Images

This project currently has a practical path for publishing **unhardened** TAK Server images, while the hardened images remain tied to Iron Bank base images.

## Recommendation

For now, a **manual but repeatable** release workflow is enough:

1. Check out the upstream `tak-server` release tag you want to publish.
2. Build the packaging artifacts from that checkout.
3. Assemble the Docker build context.
4. Build Docker images under the `codehausau` namespace.
5. Push the release tag, and optionally `latest`.

That keeps the supply chain understandable while the process is still being proven. Once this is stable, it can move into GitHub Actions.

## Helper script

The script expects a Java 17 runtime for the upstream Gradle build. It will try these automatically:

- `JAVA17_HOME`
- `/usr/lib/jvm/java-17-openjdk-amd64`
- `/usr/lib/jvm/java-1.17.0-openjdk-amd64`

If your host uses a different Java 17 install path, export `JAVA17_HOME` before running it.

Use:

```bash
./scripts/build-unhardened-takserver-images.sh \
  --tak-server-repo /path/to/tak-server \
  --tag 5.2-RELEASE-16 \
  --platforms linux/amd64,linux/arm64 \
  --image-prefix docker.io/codehausau
```

To push as well:

```bash
./scripts/build-unhardened-takserver-images.sh \
  --tak-server-repo /path/to/tak-server \
  --tag 5.2-RELEASE-16 \
  --platforms linux/amd64,linux/arm64 \
  --image-prefix docker.io/codehausau \
  --push \
  --tag-latest
```

## What the script does

- runs `:takserver-cluster:buildCluster` unless `--skip-gradle` is used
- reuses the cluster packaging outputs for:
  - `takserver.war`
  - `takserver-pm.jar`
  - `SchemaManager.jar`
  - `UserManager.jar`
- assembles a clean `/opt/tak` payload without reusing locally generated cert material
- builds:
  - `docker.io/codehausau/postgres15-postgis3:<tag>`
  - `docker.io/codehausau/takserver-full:<tag>`
- publishes a multi-platform manifest when `--push` is used
- exports OCI archives to the workspace for multi-platform builds when `--push` is omitted
- for repeatable local output paths, pass `--workspace <dir>` when exporting multi-platform archives

## Why manual first

This is the lowest-risk starting point:

- upstream releases remain the source of truth
- tags stay aligned with the TAK Server release
- the build context is reviewable before anything is published
- failures stay local and obvious

## Suggested next step

After one or two successful manual releases, the next step is a GitHub Actions workflow that:

- checks out the upstream release tag
- runs the same helper script
- pushes the images after a manual dispatch or approval gate
