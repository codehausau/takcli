import YAML from "yaml";
import { describe, expect, it } from "vitest";

import {
  renderComposeEnvFile,
  renderTakCliComposeYaml
} from "../../src/deploy/compose.js";
import { createDeployImages, DEFAULT_DB_IMAGE, inferImageTag } from "../../src/deploy/images.js";
import { renderTakCliKubernetesYaml } from "../../src/deploy/kubernetes.js";
import { createRefCacheSegment } from "../../src/deploy/repo.js";
import { checkDeployDependencies } from "../../src/deploy/system.js";
import type { CommandRunner, DeployRequest } from "../../src/deploy/types.js";

describe("deploy helpers", () => {
  it("infers safe image tags from simple refs", () => {
    expect(inferImageTag("main")).toBe("latest");
    expect(inferImageTag("v1.2.3")).toBe("v1.2.3");
    expect(inferImageTag("feature/test")).toBeUndefined();
  });

  it("creates stable cache segments for refs", () => {
    expect(createRefCacheSegment("main")).toMatch(/^main-[0-9a-f]{12}$/);
    expect(createRefCacheSegment("feature/test")).toMatch(/^feature-test-[0-9a-f]{12}$/);
  });

  it("renders compose environment values", () => {
    const envFile = renderComposeEnvFile({
      adminCertName: "admin",
      adminCertPass: "admin-pass",
      caName: "TestCA",
      caPass: "ca-pass",
      city: "Canberra",
      organization: "CodeHaus",
      organizationalUnit: "Ops",
      postgresPassword: "postgres-pass",
      state: "ACT",
      takserverCertPass: "tak-pass"
    });

    expect(envFile).toContain("POSTGRES_PASSWORD=postgres-pass");
    expect(envFile).toContain("ADMIN_CERT_NAME=admin");
    expect(envFile).toContain("POSTGRES_HOST=tak-database");
    expect(envFile).toContain("POSTGRES_URL=jdbc:postgresql://tak-database:5432/cot");
  });

  it("renders a TAKCLI-managed compose file with the published server image and upstream postgres", () => {
    const request: DeployRequest = {
      certsDir: "/tmp/tak/certs",
      dataDir: "/tmp/tak/data",
      dbImage: DEFAULT_DB_IMAGE,
      deploymentName: "demo",
      deploymentRoot: "/tmp/tak/deployments/demo",
      dryRun: true,
      flavor: "unhardened",
      imageTag: "main",
      logsDir: "/tmp/tak/logs",
      ref: "main",
      registry: "docker.io/codehausau",
      repoUrl: "https://github.com/TAK-Product-Center/Server.git",
      target: "docker-compose",
      yes: true
    };

    const images = createDeployImages(request.registry, request.imageTag);
    const document = YAML.parse(renderTakCliComposeYaml(images, request)) as {
      services: {
        "tak-database": { image: string };
        takserver: { image: string; volumes: string[] };
      };
    };

    expect(document.services.takserver.image).toBe("docker.io/codehausau/takserver-full:main");
    expect(document.services["tak-database"].image).toBe("kartoza/postgis:15-3.4");
    expect(document.services.takserver.volumes).toContain("/tmp/tak/data:/opt/tak/data");
    expect(document.services.takserver.volumes).toContain("/tmp/tak/logs:/opt/tak/data/logs");
    expect(document.services.takserver.volumes).toContain("/tmp/tak/certs:/opt/tak/data/certs");
  });

  it("renders an optional ADS-B gateway service in the TAKCLI-managed compose file", () => {
    const request: DeployRequest = {
      adsb: {
        feedUrl: "https://opendata.adsb.fi/api/v2/mil",
        source: "mil"
      },
      certsDir: "/tmp/tak/certs",
      dataDir: "/tmp/tak/data",
      dbImage: DEFAULT_DB_IMAGE,
      deploymentName: "demo",
      deploymentRoot: "/tmp/tak/deployments/demo",
      dryRun: true,
      flavor: "unhardened",
      imageTag: "main",
      logsDir: "/tmp/tak/logs",
      ref: "main",
      registry: "docker.io/codehausau",
      repoUrl: "https://github.com/TAK-Product-Center/Server.git",
      target: "docker-compose",
      yes: true
    };

    const images = createDeployImages(request.registry, request.imageTag);
    const document = YAML.parse(renderTakCliComposeYaml(images, request)) as {
      services: {
        "tak-adsb-gateway": {
          build: { context: string };
          depends_on: string[];
          volumes: string[];
        };
      };
    };

    expect(document.services["tak-adsb-gateway"].build.context).toBe("./ads-b");
    expect(document.services["tak-adsb-gateway"].depends_on).toContain("takserver");
    expect(document.services["tak-adsb-gateway"].volumes).toContain("./ads-b/adsbcot.ini:/etc/adsbcot/adsbcot.ini:ro");
    expect(document.services["tak-adsb-gateway"].volumes).toContain(
      "/tmp/tak/certs/files:/etc/adsbcot/certs:ro"
    );
  });

  it("renders TAKCLI-managed Kubernetes manifests with a namespace, secret, and services", () => {
    const request: DeployRequest = {
      certsDir: "/tmp/tak/certs",
      dataDir: "/tmp/tak/data",
      dbImage: DEFAULT_DB_IMAGE,
      deploymentName: "demo-cluster",
      deploymentRoot: "/tmp/tak/deployments/demo",
      dryRun: true,
      flavor: "unhardened",
      imageTag: "main",
      logsDir: "/tmp/tak/logs",
      ref: "main",
      registry: "docker.io/codehausau",
      repoUrl: "https://github.com/TAK-Product-Center/Server.git",
      target: "kubernetes",
      yes: true
    };

    const images = createDeployImages(request.registry, request.imageTag);
    const documents = YAML.parseAllDocuments(renderTakCliKubernetesYaml(images, request, {
      adminCertName: "admin",
      adminCertPass: "admin-pass",
      caName: "TestCA",
      caPass: "ca-pass",
      city: "Canberra",
      organization: "CodeHaus",
      organizationalUnit: "Ops",
      postgresPassword: "postgres-pass",
      state: "ACT",
      takserverCertPass: "tak-pass"
    })).map((document) => document.toJSON() as {
      kind: string;
      metadata?: { name?: string; namespace?: string };
      spec?: { type?: string };
      stringData?: Record<string, string>;
    });

    expect(documents.find((document) => document.kind === "Namespace")?.metadata?.name).toBe("demo-cluster");
    expect(documents.find((document) => document.kind === "Secret")?.stringData?.POSTGRES_HOST).toBe("tak-database");
    expect(documents.find((document) => document.kind === "Service" && document.metadata?.name === "takserver")?.spec?.type)
      .toBe("LoadBalancer");
  });

  it("reports missing deploy dependencies", async () => {
    const runner: CommandRunner = {
      async run(command, args) {
        if (command === "git") {
          return { exitCode: 0, stderr: "", stdout: "git version 2.0.0\n" };
        }
        if (command === "docker" && args[0] === "--version") {
          return { exitCode: 0, stderr: "", stdout: "Docker version 1.0.0\n" };
        }

        return { exitCode: 1, stderr: "missing", stdout: "" };
      }
    };

    const result = await checkDeployDependencies(runner, "docker-compose");

    expect(result.missing.map((dependency) => dependency.name)).toContain("docker compose");
    expect(result.missing.map((dependency) => dependency.name)).not.toContain("git");
  });

  it("allows overriding the database image", () => {
    const images = createDeployImages("docker.io/codehausau", "latest", "example/postgis:custom");

    expect(images.db).toBe("example/postgis:custom");
    expect(images.server).toBe("docker.io/codehausau/takserver-full:latest");
  });

  it("only requires kubectl for kubernetes deployments", async () => {
    const runner: CommandRunner = {
      async run(command) {
        if (command === "git") {
          return { exitCode: 0, stderr: "", stdout: "git version 2.0.0\n" };
        }

        return { exitCode: 1, stderr: "missing", stdout: "" };
      }
    };

    const result = await checkDeployDependencies(runner, "kubernetes");

    expect(result.missing.map((dependency) => dependency.name)).toContain("kubectl");
    expect(result.missing.map((dependency) => dependency.name)).not.toContain("helm");
  });
});
