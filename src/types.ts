export type ProjectConfig = {
  projectId: string;
  projectName: string;
  environments: Record<string, string>;
  ignore: string[];
};

export type VaultFile = {
  projectId: string;
  projectName: string;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
};

export type DecryptedVault = {
  environments: Record<string, Record<string, string>>;
  comments: Record<string, string[]>;
  lastPushedAt: string;
};

export type RemoteConfig = {
  enabled: boolean;
  method: "gh" | "git" | null;
  repoUrl: string | null;
};

export type GlobalConfig = {
  salt: string;
  verificationHash: string;
  cacheTTL: number;
  remote?: RemoteConfig;
};

export type AuthCache = {
  derivedKey: string;
  machineId: string;
  expiresAt: string;
};
