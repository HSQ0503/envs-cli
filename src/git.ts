import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import type { RemoteConfig } from "./types";

const ENVS_DIR = path.join(os.homedir(), ".envs");
const VAULT_DIR = path.join(ENVS_DIR, "vault");

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

function execSafe(cmd: string, cwd?: string): string | null {
  try {
    return exec(cmd, cwd);
  } catch {
    return null;
  }
}

export function isGhAvailable(): boolean {
  return execSafe("gh --version") !== null;
}

export function isGhAuthenticated(): boolean {
  try {
    execSync("gh auth status", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getGhUsername(): string | null {
  return execSafe("gh api user --jq .login");
}

export function ghRepoExists(username: string, repo: string): boolean {
  return execSafe(`gh repo view ${username}/${repo}`) !== null;
}

export function ghCreateRepo(repo: string): string | null {
  const username = getGhUsername();
  if (!username) return null;

  // Use --clone=false to prevent interactive clone prompt
  const variants = [
    `gh repo create ${repo} --private --clone=false`,
    `gh repo create ${repo} --private`,
  ];

  for (const cmd of variants) {
    try {
      exec(cmd);
      return `https://github.com/${username}/${repo}.git`;
    } catch {
      continue;
    }
  }
  return null;
}

export function isGitAvailable(): boolean {
  return execSafe("git --version") !== null;
}

export function isVaultGitRepo(): boolean {
  if (!fs.existsSync(VAULT_DIR)) return false;
  return execSafe("git rev-parse --is-inside-work-tree", VAULT_DIR) === "true";
}

export function remoteHasContent(repoUrl: string): boolean {
  const output = execSafe(`git ls-remote ${repoUrl}`);
  return output !== null && output.trim().length > 0;
}

export function cloneVaultRepo(repoUrl: string): boolean {
  try {
    // Remove empty vault dir if it exists (git clone needs it to not exist)
    if (fs.existsSync(VAULT_DIR)) {
      const files = fs.readdirSync(VAULT_DIR);
      if (files.length === 0) {
        fs.rmdirSync(VAULT_DIR);
      } else {
        // Vault has local files — back them up, clone, then restore
        const backupDir = VAULT_DIR + "_backup";
        fs.renameSync(VAULT_DIR, backupDir);
        try {
          exec(`git clone ${repoUrl} vault`, ENVS_DIR);
          // Restore any local files not in the clone
          const backupFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith(".enc.json"));
          for (const file of backupFiles) {
            const dest = path.join(VAULT_DIR, file);
            if (!fs.existsSync(dest)) {
              fs.copyFileSync(path.join(backupDir, file), dest);
            }
          }
          fs.rmSync(backupDir, { recursive: true, force: true });
          return true;
        } catch {
          // Clone failed, restore backup
          if (fs.existsSync(VAULT_DIR)) fs.rmSync(VAULT_DIR, { recursive: true, force: true });
          fs.renameSync(backupDir, VAULT_DIR);
          return false;
        }
      }
    }

    exec(`git clone ${repoUrl} vault`, ENVS_DIR);
    return true;
  } catch {
    // Clone failed — maybe empty repo. Create vault dir and init
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    return false;
  }
}

export function initVaultGitRepo(repoUrl: string): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true });

  if (!isVaultGitRepo()) {
    exec("git init", VAULT_DIR);
    execSafe("git branch -M main", VAULT_DIR);
  }

  // Set up remote
  const remotes = execSafe("git remote", VAULT_DIR) || "";
  if (!remotes.includes("origin")) {
    exec(`git remote add origin ${repoUrl}`, VAULT_DIR);
  } else {
    exec(`git remote set-url origin ${repoUrl}`, VAULT_DIR);
  }

  // Pull from remote if it has content
  try {
    execSafe("git fetch origin", VAULT_DIR);
    const remoteBranch = execSafe("git ls-remote --heads origin main", VAULT_DIR);
    if (remoteBranch && remoteBranch.trim().length > 0) {
      execSafe("git pull origin main --allow-unrelated-histories", VAULT_DIR);
    }
  } catch {
    // Remote might be empty, that's fine
  }

  // Create initial commit if no commits exist yet
  const hasCommits = execSafe("git rev-parse HEAD", VAULT_DIR) !== null;
  if (!hasCommits) {
    const files = fs.readdirSync(VAULT_DIR).filter((f) => f.endsWith(".enc.json"));
    if (files.length > 0) {
      exec("git add .", VAULT_DIR);
      exec('git commit -m "Initial vault sync"', VAULT_DIR);
    } else {
      const placeholder = path.join(VAULT_DIR, ".gitkeep");
      fs.writeFileSync(placeholder, "");
      exec("git add .", VAULT_DIR);
      exec('git commit -m "Initialize vault"', VAULT_DIR);
    }
  }

  // Push to remote
  try {
    exec("git push -u origin main", VAULT_DIR);
  } catch {
    execSafe("git push -u origin master", VAULT_DIR);
  }
}

export function ensureVaultGitLinked(repoUrl: string): void {
  if (isVaultGitRepo()) return;
  initVaultGitRepo(repoUrl);
}

export function gitPushVault(projectName: string): boolean {
  if (!isVaultGitRepo()) return false;

  try {
    exec("git add .", VAULT_DIR);
    const status = (execSafe("git status --porcelain", VAULT_DIR) || "").trim();
    if (!status) return true; // Nothing to commit

    const timestamp = new Date().toISOString();
    exec(`git commit -m "envs push: ${projectName} ${timestamp}"`, VAULT_DIR);
    exec("git push", VAULT_DIR);
    return true;
  } catch {
    return false;
  }
}

export function gitPullVault(): boolean {
  if (!isVaultGitRepo()) return false;

  try {
    exec("git pull --rebase", VAULT_DIR);
    return true;
  } catch {
    return false;
  }
}

export type SyncStatus = {
  enabled: boolean;
  method: string | null;
  repoUrl: string | null;
  ahead: number;
  behind: number;
  lastCommitTime: string | null;
  inSync: boolean;
};

export function getVaultSyncStatus(remote: RemoteConfig | undefined): SyncStatus {
  const result: SyncStatus = {
    enabled: !!remote?.enabled,
    method: remote?.method || null,
    repoUrl: remote?.repoUrl || null,
    ahead: 0,
    behind: 0,
    lastCommitTime: null,
    inSync: true,
  };

  if (!result.enabled || !isVaultGitRepo()) return result;

  // Fetch latest (silently)
  execSafe("git fetch origin", VAULT_DIR);

  // Check ahead/behind
  const counts = execSafe("git rev-list --left-right --count HEAD...origin/main", VAULT_DIR);
  if (counts) {
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    result.ahead = ahead || 0;
    result.behind = behind || 0;
    result.inSync = result.ahead === 0 && result.behind === 0;
  }

  // Last commit time
  const lastCommit = execSafe('git log -1 --format="%cr"', VAULT_DIR);
  if (lastCommit) {
    result.lastCommitTime = lastCommit.replace(/"/g, "");
  }

  return result;
}
