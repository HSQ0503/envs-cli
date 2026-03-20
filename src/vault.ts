import fs from "fs";
import path from "path";
import os from "os";
import type {
  GlobalConfig,
  AuthCache,
  ProjectConfig,
  VaultFile,
  DecryptedVault,
} from "./types";
import {
  deriveKey,
  createVerificationHash,
  generateSalt,
  encrypt,
  decrypt,
  getMachineId,
  encryptForCache,
  decryptFromCache,
} from "./crypto";

const ENVS_DIR = path.join(os.homedir(), ".envs");
const VAULT_DIR = path.join(ENVS_DIR, "vault");
const CONFIG_PATH = path.join(ENVS_DIR, "config.json");
const AUTH_PATH = path.join(ENVS_DIR, "auth.json");
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// In-memory key cache for current session
let sessionKey: Buffer | null = null;

export function ensureVaultDirs(): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

export function globalConfigExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function readGlobalConfig(): GlobalConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

export function writeGlobalConfig(config: GlobalConfig): void {
  ensureVaultDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function setupMasterPassword(password: string): Buffer {
  const salt = generateSalt();
  const key = deriveKey(password, salt);
  const verificationHash = createVerificationHash(key);

  writeGlobalConfig({
    salt,
    verificationHash,
    cacheTTL: DEFAULT_CACHE_TTL,
  });

  sessionKey = key;
  cacheKey(key);
  return key;
}

export function verifyPassword(password: string): Buffer | null {
  const config = readGlobalConfig();
  const key = deriveKey(password, config.salt);
  const hash = createVerificationHash(key);

  if (hash === config.verificationHash) {
    sessionKey = key;
    cacheKey(key);
    return key;
  }
  return null;
}

function cacheKey(key: Buffer): void {
  try {
    const machineId = getMachineId();
    const config = readGlobalConfig();
    const cache: AuthCache = {
      derivedKey: encryptForCache(key, machineId),
      machineId,
      expiresAt: new Date(Date.now() + config.cacheTTL).toISOString(),
    };
    fs.writeFileSync(AUTH_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Caching is optional, silently fail
  }
}

export function getCachedKey(): Buffer | null {
  // Check in-memory first
  if (sessionKey) return sessionKey;

  // Check file cache
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const cache: AuthCache = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));

    if (new Date(cache.expiresAt) < new Date()) {
      fs.unlinkSync(AUTH_PATH);
      return null;
    }

    const machineId = getMachineId();
    if (cache.machineId !== machineId) return null;

    const key = decryptFromCache(cache.derivedKey, machineId);
    if (key) {
      // Verify it's still valid
      const config = readGlobalConfig();
      const hash = createVerificationHash(key);
      if (hash === config.verificationHash) {
        sessionKey = key;
        return key;
      }
    }
  } catch {
    // Cache corrupted, ignore
  }
  return null;
}

export function readProjectConfig(dir: string = process.cwd()): ProjectConfig | null {
  const configPath = path.join(dir, ".envs.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function writeProjectConfig(
  config: ProjectConfig,
  dir: string = process.cwd()
): void {
  const configPath = path.join(dir, ".envs.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function encryptAndStoreVault(
  projectId: string,
  projectName: string,
  data: DecryptedVault,
  key: Buffer
): void {
  ensureVaultDirs();
  const config = readGlobalConfig();
  const plaintext = JSON.stringify(data);
  const { iv, authTag, encrypted } = encrypt(plaintext, key);

  const vaultFile: VaultFile = {
    projectId,
    projectName,
    salt: config.salt,
    iv,
    authTag,
    data: encrypted,
  };

  const filePath = path.join(VAULT_DIR, `${projectId}.enc.json`);
  fs.writeFileSync(filePath, JSON.stringify(vaultFile, null, 2));
}

export function decryptVault(
  projectId: string,
  key: Buffer
): DecryptedVault | null {
  const filePath = path.join(VAULT_DIR, `${projectId}.enc.json`);
  if (!fs.existsSync(filePath)) return null;

  const vaultFile: VaultFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const plaintext = decrypt(vaultFile.data, key, vaultFile.iv, vaultFile.authTag);
  return JSON.parse(plaintext);
}

export function listVaultFiles(): VaultFile[] {
  ensureVaultDirs();
  const files = fs.readdirSync(VAULT_DIR).filter((f) => f.endsWith(".enc.json"));
  return files.map((f) =>
    JSON.parse(fs.readFileSync(path.join(VAULT_DIR, f), "utf8"))
  );
}

export function getVaultDir(): string {
  return VAULT_DIR;
}
