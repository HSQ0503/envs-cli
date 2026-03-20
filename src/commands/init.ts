import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { generateProjectId } from "../crypto";
import { authenticate } from "../auth";
import {
  readProjectConfig,
  writeProjectConfig,
  encryptAndStoreVault,
  globalConfigExists,
  readGlobalConfig,
  writeGlobalConfig,
  decryptVault,
  listVaultFiles,
} from "../vault";
import { parseEnvFile } from "../env-parser";
import { setupRemoteSync } from "./sync";
import { gitPushVault, isVaultGitRepo, ensureVaultGitLinked } from "../git";
import type { ProjectConfig, DecryptedVault } from "../types";

const ENV_PATTERN = /^\.env(\..+)?$/;

const DEFAULT_ENV_MAP: Record<string, string> = {
  ".env": "development",
  ".env.development": "development",
  ".env.production": "production",
  ".env.staging": "staging",
  ".env.test": "test",
};

const IGNORED_BY_DEFAULT = [".env.local", ".env.development.local", ".env.production.local"];

export async function initCommand(): Promise<void> {
  // Global setup first (password + remote sync) — regardless of project state
  const isFirstTimeSetup = !globalConfigExists();
  const key = await authenticate();

  if (isFirstTimeSetup) {
    console.log("");
    const remote = await setupRemoteSync();
    if (remote) {
      const config = readGlobalConfig();
      config.remote = remote;
      writeGlobalConfig(config);
    }
  }

  // Now check if this project is already initialized
  const existing = readProjectConfig();
  if (existing) {
    const vaultData = decryptVault(existing.projectId, key);
    if (vaultData) {
      console.log(
        chalk.yellow(
          "⚠ Already initialized. Project ID: " + existing.projectId
        )
      );
      console.log(
        chalk.gray(
          "  Found vault data for this project. Run `envs pull` to restore your .env files."
        )
      );
    } else {
      console.log(chalk.yellow("⚠ Already initialized. Project ID: " + existing.projectId));
    }
    return;
  }

  // Check if vault has existing projects the user can link to
  const vaultFiles = listVaultFiles();
  if (vaultFiles.length > 0) {
    const linked = await offerLinkToExisting(vaultFiles, key);
    if (linked) return;
  }

  // New project — generate ID and set up from scratch
  await initNewProject(key);
}

async function offerLinkToExisting(
  vaultFiles: import("../types").VaultFile[],
  key: Buffer
): Promise<boolean> {
  // Build choices from vault projects, showing env/variable counts
  const choices: { name: string; value: string }[] = [];

  for (const vf of vaultFiles) {
    try {
      const vault = decryptVault(vf.projectId, key);
      if (vault) {
        const envNames = Object.keys(vault.environments);
        const varCount = envNames.reduce(
          (sum, e) => sum + Object.keys(vault.environments[e]).length,
          0
        );
        choices.push({
          name: `Link to "${vf.projectName}" (${envNames.join(", ")}) — ${varCount} variables`,
          value: vf.projectId,
        });
      }
    } catch {
      // Can't decrypt — different password, skip
    }
  }

  if (choices.length === 0) return false;

  choices.push({ name: "Create a new project", value: "__new__" });

  console.log("");
  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Found existing projects in vault:",
      choices,
    },
  ]);

  if (selected === "__new__") return false;

  // Link to the selected project
  const vaultFile = vaultFiles.find((vf) => vf.projectId === selected)!;
  const vault = decryptVault(selected, key)!;
  const envNames = Object.keys(vault.environments);

  // Build environment file mapping
  const environments: Record<string, string> = {};
  for (const envName of envNames) {
    const defaultFile =
      envName === "development" ? ".env" : `.env.${envName}`;
    environments[envName] = defaultFile;
  }

  const config: ProjectConfig = {
    projectId: selected,
    projectName: vaultFile.projectName,
    environments,
    ignore: [],
  };
  writeProjectConfig(config);
  updateGitignore(Object.values(environments), []);

  console.log(chalk.green(`✓ Linked to "${vaultFile.projectName}" (${selected})`));
  console.log(chalk.gray(`  Environments: ${envNames.join(", ")}`));
  console.log(chalk.gray("  Run `envs pull` to restore your .env files."));
  return true;
}

async function initNewProject(key: Buffer): Promise<void> {
  const projectId = generateProjectId();

  // Get project name from directory
  const defaultName = path.basename(process.cwd());
  const { projectName } = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: defaultName,
    },
  ]);

  // Scan for .env files
  const files = fs.readdirSync(process.cwd()).filter((f) => ENV_PATTERN.test(f));

  if (files.length === 0) {
    console.log(chalk.yellow("⚠ No .env files found in current directory."));
    console.log(chalk.gray("  Create a .env file and run envs init again, or use envs env add."));
  }

  // Build environment mapping
  const environments: Record<string, string> = {};
  const ignore: string[] = [];

  if (files.length > 0) {
    console.log(chalk.cyan("\nFound .env files:"));

    for (const file of files) {
      if (IGNORED_BY_DEFAULT.includes(file)) {
        console.log(chalk.gray(`  ${file} → ignored (local override)`));
        ignore.push(file);
        continue;
      }

      const suggestedEnv = DEFAULT_ENV_MAP[file] || file.replace(/^\.env\.?/, "") || "development";

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: `${file} →`,
          choices: [
            { name: `Map to "${suggestedEnv}" environment`, value: "map" },
            { name: "Map to custom environment name", value: "custom" },
            { name: "Ignore this file", value: "ignore" },
          ],
        },
      ]);

      if (action === "ignore") {
        ignore.push(file);
      } else if (action === "custom") {
        const { envName } = await inquirer.prompt([
          {
            type: "input",
            name: "envName",
            message: "Environment name:",
          },
        ]);
        environments[envName] = file;
      } else {
        environments[suggestedEnv] = file;
      }
    }
  }

  // Create .envs.json
  const config: ProjectConfig = {
    projectId,
    projectName,
    environments,
    ignore,
  };
  writeProjectConfig(config);

  // Update .gitignore
  updateGitignore(Object.values(environments), ignore);

  // Encrypt and store env files
  const vaultData: DecryptedVault = {
    environments: {},
    comments: {},
    lastPushedAt: new Date().toISOString(),
  };

  let totalVars = 0;
  for (const [envName, filePath] of Object.entries(environments)) {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = parseEnvFile(content);
      vaultData.environments[envName] = parsed.variables;
      vaultData.comments[envName] = parsed.comments;
      const count = Object.keys(parsed.variables).length;
      totalVars += count;
      console.log(chalk.green(`  ✓ ${filePath} → ${envName} (${count} variables)`));
    } else {
      console.log(chalk.yellow(`  ⚠ ${filePath} not found, skipping`));
    }
  }

  if (Object.keys(vaultData.environments).length > 0) {
    encryptAndStoreVault(projectId, projectName, vaultData, key);
  }

  // Sync to remote if enabled
  if (Object.keys(vaultData.environments).length > 0) {
    const globalConf = readGlobalConfig();
    if (globalConf.remote?.enabled && globalConf.remote.repoUrl) {
      if (!isVaultGitRepo()) {
        try {
          ensureVaultGitLinked(globalConf.remote.repoUrl);
        } catch {
          console.log(chalk.yellow("  ⚠ Remote sync is enabled but vault is not linked. Run `envs sync` to fix."));
        }
      }

      const pushed = gitPushVault(projectName);
      if (pushed) {
        console.log(chalk.gray("  ✓ Synced ↑"));
      } else {
        console.log(chalk.yellow("  ⚠ Remote sync failed. Run `envs sync` to retry."));
      }
    }
  }

  console.log("");
  console.log(chalk.green("✓ Initialized envs vault"));
  console.log(chalk.gray(`  Project: ${projectName} (${projectId})`));
  console.log(chalk.gray(`  Environments: ${Object.keys(environments).join(", ") || "none"}`));
  console.log(chalk.gray(`  Variables: ${totalVars}`));
  console.log(chalk.gray(`  Config: .envs.json (commit this file)`));
}

function updateGitignore(envFiles: string[], ignoredFiles: string[]): void {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  let content = "";

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf8");
  }

  const lines = content.split(/\r?\n/);
  const additions: string[] = [];

  // Add .env* pattern if not present
  const hasEnvPattern = lines.some(
    (l) => l.trim() === ".env*" || l.trim() === ".env" || l.trim() === ".env.*"
  );

  if (!hasEnvPattern) {
    // Add individual env file patterns
    const allEnvFiles = [...new Set([...envFiles, ...ignoredFiles])];
    for (const file of allEnvFiles) {
      if (!lines.some((l) => l.trim() === file)) {
        additions.push(file);
      }
    }

    // Also add general .env* but exclude .envs.json
    if (!lines.some((l) => l.trim() === ".env*")) {
      additions.push(".env*");
    }
    if (!lines.some((l) => l.trim() === "!.envs.json")) {
      additions.push("!.envs.json");
    }
  } else {
    // Make sure .envs.json is not ignored
    if (!lines.some((l) => l.trim() === "!.envs.json")) {
      additions.push("!.envs.json");
    }
  }

  if (additions.length > 0) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    const block = `${separator}\n# envs vault\n${additions.join("\n")}\n`;
    fs.writeFileSync(gitignorePath, content + block);
    console.log(chalk.gray("  Updated .gitignore"));
  }
}
