import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import YAML from "yaml";

import { createDeployImages } from "./images.js";
import type {
  ComposeImageSet,
  DeployEnvironmentValues,
  DeployRequest,
  KubernetesWorkspace
} from "./types.js";

function toDnsLabel(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");

  return (normalized || "tak").slice(0, 63).replace(/-+$/g, "") || "tak";
}

export function getKubernetesNamespace(request: Pick<DeployRequest, "deploymentName">): string {
  return toDnsLabel(request.deploymentName);
}

export function renderTakCliKubernetesYaml(
  images: ComposeImageSet,
  request: DeployRequest,
  envValues: DeployEnvironmentValues
): string {
  const namespace = getKubernetesNamespace(request);
  const sharedLabels = {
    "app.kubernetes.io/instance": request.deploymentName,
    "app.kubernetes.io/managed-by": "takcli",
    "app.kubernetes.io/name": "takserver"
  };

  const documents = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        labels: sharedLabels,
        name: namespace
      }
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        labels: sharedLabels,
        name: "tak-config",
        namespace
      },
      stringData: {
        ADMIN_CERT_NAME: envValues.adminCertName,
        ADMIN_CERT_PASS: envValues.adminCertPass,
        CA_NAME: envValues.caName,
        CA_PASS: envValues.caPass,
        CITY: envValues.city,
        ORGANIZATION: envValues.organization,
        ORGANIZATIONAL_UNIT: envValues.organizationalUnit,
        POSTGRES_DB: "cot",
        POSTGRES_HOST: "tak-database",
        POSTGRES_PASSWORD: envValues.postgresPassword,
        POSTGRES_PORT: "5432",
        POSTGRES_URL: "jdbc:postgresql://tak-database:5432/cot",
        POSTGRES_USER: "martiuser",
        STATE: envValues.state,
        TAKSERVER_CERT_PASS: envValues.takserverCertPass
      },
      type: "Opaque"
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        labels: sharedLabels,
        name: "tak-data",
        namespace
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: "20Gi"
          }
        }
      }
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        labels: sharedLabels,
        name: "tak-postgres",
        namespace
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: "20Gi"
          }
        }
      }
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        labels: {
          ...sharedLabels,
          "app.kubernetes.io/component": "database"
        },
        name: "tak-database",
        namespace
      },
      spec: {
        ports: [
          {
            name: "postgres",
            port: 5432,
            targetPort: 5432
          }
        ],
        selector: {
          "app.kubernetes.io/component": "database",
          "app.kubernetes.io/instance": request.deploymentName
        }
      }
    },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        labels: {
          ...sharedLabels,
          "app.kubernetes.io/component": "database"
        },
        name: "tak-database",
        namespace
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            "app.kubernetes.io/component": "database",
            "app.kubernetes.io/instance": request.deploymentName
          }
        },
        template: {
          metadata: {
            labels: {
              ...sharedLabels,
              "app.kubernetes.io/component": "database"
            }
          },
          spec: {
            containers: [
              {
                env: [
                  {
                    name: "POSTGRES_DB",
                    valueFrom: {
                      secretKeyRef: {
                        key: "POSTGRES_DB",
                        name: "tak-config"
                      }
                    }
                  },
                  {
                    name: "POSTGRES_USER",
                    valueFrom: {
                      secretKeyRef: {
                        key: "POSTGRES_USER",
                        name: "tak-config"
                      }
                    }
                  },
                  {
                    name: "POSTGRES_PASSWORD",
                    valueFrom: {
                      secretKeyRef: {
                        key: "POSTGRES_PASSWORD",
                        name: "tak-config"
                      }
                    }
                  }
                ],
                image: images.db,
                name: "postgres",
                ports: [
                  {
                    containerPort: 5432,
                    name: "postgres"
                  }
                ],
                volumeMounts: [
                  {
                    mountPath: "/var/lib/postgresql/data",
                    name: "postgres-data"
                  }
                ]
              }
            ],
            volumes: [
              {
                name: "postgres-data",
                persistentVolumeClaim: {
                  claimName: "tak-postgres"
                }
              }
            ]
          }
        }
      }
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        labels: {
          ...sharedLabels,
          "app.kubernetes.io/component": "server"
        },
        name: "takserver",
        namespace
      },
      spec: {
        ports: [
          { name: "api-8089", port: 8089, targetPort: 8089 },
          { name: "https-8443", port: 8443, targetPort: 8443 },
          { name: "feed-8444", port: 8444, targetPort: 8444 },
          { name: "cert-8446", port: 8446, targetPort: 8446 },
          { name: "metrics-9000", port: 9000, targetPort: 9000 },
          { name: "admin-9001", port: 9001, targetPort: 9001 }
        ],
        selector: {
          "app.kubernetes.io/component": "server",
          "app.kubernetes.io/instance": request.deploymentName
        },
        type: "LoadBalancer"
      }
    },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        labels: {
          ...sharedLabels,
          "app.kubernetes.io/component": "server"
        },
        name: "takserver",
        namespace
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            "app.kubernetes.io/component": "server",
            "app.kubernetes.io/instance": request.deploymentName
          }
        },
        template: {
          metadata: {
            labels: {
              ...sharedLabels,
              "app.kubernetes.io/component": "server"
            }
          },
          spec: {
            containers: [
              {
                envFrom: [
                  {
                    secretRef: {
                      name: "tak-config"
                    }
                  }
                ],
                image: images.server,
                name: "takserver",
                ports: [
                  { containerPort: 8089, name: "api-8089" },
                  { containerPort: 8443, name: "https-8443" },
                  { containerPort: 8444, name: "feed-8444" },
                  { containerPort: 8446, name: "cert-8446" },
                  { containerPort: 9000, name: "metrics-9000" },
                  { containerPort: 9001, name: "admin-9001" }
                ],
                volumeMounts: [
                  {
                    mountPath: "/opt/tak/data",
                    name: "tak-data"
                  }
                ]
              }
            ],
            volumes: [
              {
                name: "tak-data",
                persistentVolumeClaim: {
                  claimName: "tak-data"
                }
              }
            ]
          }
        }
      }
    }
  ];

  return `${documents.map((document) => YAML.stringify(document)).join("---\n")}`;
}

export async function prepareKubernetesWorkspace(options: {
  clonePath: string;
  envValues: DeployEnvironmentValues;
  gitCommit: string;
  request: DeployRequest;
}): Promise<KubernetesWorkspace> {
  await mkdir(options.request.deploymentRoot, { recursive: true });

  const images = createDeployImages(options.request.registry, options.request.imageTag, options.request.dbImage);
  const manifestPath = path.join(options.request.deploymentRoot, "kubernetes.yaml");
  const deploymentMetadataPath = path.join(options.request.deploymentRoot, "takcli-deployment.yaml");
  const namespace = getKubernetesNamespace(options.request);

  await writeFile(manifestPath, renderTakCliKubernetesYaml(images, options.request, options.envValues), "utf8");
  await writeFile(
    deploymentMetadataPath,
    YAML.stringify({
      deploymentName: options.request.deploymentName,
      flavor: options.request.flavor,
      gitCommit: options.gitCommit,
      kubernetes: {
        manifestPath,
        namespace
      },
      ref: options.request.ref,
      registry: options.request.registry,
      repoUrl: options.request.repoUrl,
      sourceClonePath: options.clonePath,
      target: options.request.target,
      workspace: {
        certsDir: options.request.certsDir,
        dataDir: options.request.dataDir,
        logsDir: options.request.logsDir,
        root: options.request.deploymentRoot
      }
    }),
    "utf8"
  );

  return {
    deploymentMetadataPath,
    images,
    manifestPath,
    namespace,
    workspacePath: options.request.deploymentRoot
  };
}
