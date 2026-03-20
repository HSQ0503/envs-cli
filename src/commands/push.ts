import fs from "fs";
import path from "path";
import chalk from "chalk";
import { authenticate } from "../auth";
import { readProjectConfig, encryptAndStoreVault, readGlobalConfig, globalConfigExists } from "../vault";
import { parseEnvFile } from "../env-parser";
import { gitPushVault, isVaultGitRepo, ensureVaultGitLinked } from "../git";
import type { DecryptedVault } from "../types";

export async function pushCommand(): Promise<void> {
  const config = readProjectConfig();
  if (!config) {
    console.log(chalk.red("✗ Not an envs project. Run `envs init` first."));
    process.exit(1);
  }

  const key = await authenticate();

  const vaultData: DecryptedVault = {
    environments: {},
    comments: {},
    lastPushedAt: new Date().toISOString(),
  };

  let totalVars = 0;

  for (const [envName, filePath] of Object.entries(config.environments)) {
    const fullPath = path.join(process.cwd(), filePath);

    if (!fs.existsSync(fullPath)) {
      console.log(chalk.yellow(`⚠ ${filePath} not found, skipping`));
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    const parsed = parseEnvFile(content);
    vaultData.environments[envName] = parsed.variables;
    vaultData.comments[envName] = parsed.comments;

    const count = Object.keys(parsed.variables).length;
    totalVars += count;
    console.log(chalk.green(`✓ Pushed ${count} variables (${envName})`));
  }

  encryptAndStoreVault(config.projectId, config.projectName, vaultData, key);

  // Sync to remote if enabled
  if (globalConfigExists()) {
    const globalConf = readGlobalConfig();
    if (globalConf.remote?.enabled && globalConf.remote.repoUrl) {
      // Ensure vault dir is a git repo — auto-repair if not
      if (!isVaultGitRepo()) {
        try {
          ensureVaultGitLinked(globalConf.remote.repoUrl);
        } catch {
          console.log(chalk.yellow("  ⚠ Remote sync is enabled but vault is not linked. Run `envs sync` to fix."));
        }
      }

      const pushed = gitPushVault(config.projectName);
      if (pushed) {
        console.log(chalk.gray("  ✓ Synced ↑"));
      } else {
        console.log(chalk.yellow("  ⚠ Remote sync failed (changes saved locally). Run `envs sync` to retry."));
      }
    }
  }

  console.log(
    chalk.gray(`\n  Total: ${totalVars} variables across ${Object.keys(vaultData.environments).length} environments`)
  );
}
