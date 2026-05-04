export type DeployTarget = "docker-compose" | "kubernetes";

export interface DeployPromptChoice {
  description?: string;
  value: string;
}

export interface DeployPrompt {
  confirm(options: { defaultValue?: boolean; message: string }): Promise<boolean>;
  input(options: { defaultValue?: string; message: string; secret?: boolean }): Promise<string>;
  select(options: {
    choices: DeployPromptChoice[];
    defaultValue?: string;
    message: string;
  }): Promise<string>;
}

export interface CommandExecutionResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<CommandExecutionResult>;
}

export interface DeployServices {
  prompt: DeployPrompt;
  runner: CommandRunner;
}

export interface DependencyStatus {
  available: boolean;
  hint: string;
  name: string;
}

export interface DependencyCheckResult {
  missing: DependencyStatus[];
  statuses: DependencyStatus[];
}

export interface ComposeImageSet {
  db: string;
  server: string;
}

export interface DeployAdsbOptions {
  area?: {
    distNm: number;
    lat: number;
    lon: number;
  };
  feedUrl: string;
  source: "geo" | "mil";
}

export interface DeployEnvironmentValues {
  adminCertName: string;
  adminCertPass: string;
  caName: string;
  caPass: string;
  city: string;
  organization: string;
  organizationalUnit: string;
  postgresPassword: string;
  state: string;
  takserverCertPass: string;
}

export interface DeployBootstrapWebTakUser {
  password: string;
  username: string;
}

export interface DeployWizardOptions {
  adminCertName?: string;
  adminCertPass?: string;
  adsbDistNm?: string;
  adsbFeedUrl?: string;
  adsbLat?: string;
  adsbLon?: string;
  adsbSource?: "geo" | "mil";
  configPath?: string;
  caName?: string;
  caPass?: string;
  certsDir?: string;
  city?: string;
  dbImage?: string;
  dataDir?: string;
  deploymentName?: string;
  deploymentRoot?: string;
  dryRun?: boolean;
  flavor?: string;
  imageTag?: string;
  json?: boolean;
  logsDir?: string;
  organization?: string;
  organizationalUnit?: string;
  postgresPassword?: string;
  registry?: string;
  saveProfiles?: boolean;
  state?: string;
  takserverCertPass?: string;
  target?: DeployTarget;
  withAdsb?: boolean;
  webtakPassword?: string;
  webtakUsername?: string;
  yes?: boolean;
}

export interface DeployRequest {
  adsb?: DeployAdsbOptions;
  certsDir: string;
  dataDir: string;
  dbImage: string;
  deploymentName: string;
  deploymentRoot: string;
  dryRun: boolean;
  flavor: "unhardened";
  imageTag: string;
  logsDir: string;
  registry: string;
  target: DeployTarget;
  webtakUser?: DeployBootstrapWebTakUser;
  yes: boolean;
}

export interface ComposeWorkspace {
  composeFilePath: string;
  dbDataDir: string;
  deploymentMetadataPath: string;
  envFilePath: string;
  images: ComposeImageSet;
  workspacePath: string;
}

export interface KubernetesWorkspace {
  deploymentMetadataPath: string;
  images: ComposeImageSet;
  manifestPath: string;
  namespace: string;
  workspacePath: string;
}

export interface DeployResult {
  compose?: ComposeWorkspace;
  deploymentName: string;
  dryRun: boolean;
  gitCommit?: string;
  imageTag: string;
  kubernetes?: KubernetesWorkspace;
  registry: string;
  statePath?: string;
  steps: string[];
  target: DeployTarget;
}
