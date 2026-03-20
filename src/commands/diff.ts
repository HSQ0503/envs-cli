import fs from "fs";
import path from "path";
import chalk from "chalk";
import { authenticate } from "../auth";
import { readProjectConfig, decryptVault } from "../vault";
import { parseEnvFile } from "../env-parser";

export async function diffCommand(options: { reveal?: boolean }): Promise<void> {
  const config = readProjectConfig();
  if (!config) {
    console.log(chalk.red("✗ Not an envs project. Run `envs init` first."));
    process.exit(1);
  }

  const key = await authenticate();

  const vault = decryptVault(config.projectId, key);
  if (!vault) {
    console.log(chalk.red("✗ No vault data found. Run `envs push` first."));
    process.exit(1);
  }

  for (const [envName, filePath] of Object.entries(config.environments)) {
    console.log(chalk.cyan(`\n─── ${envName} (${filePath}) ───`));

    const vaultVars = vault.environments[envName] || {};
    const fullPath = path.join(process.cwd(), filePath);

    if (!fs.existsSync(fullPath)) {
      console.log(chalk.yellow("  ⚠ Local file not found"));
      const vaultKeys = Object.keys(vaultVars);
      if (vaultKeys.length > 0) {
        console.log(chalk.yellow(`  ⚠ ${vaultKeys.length} variables only in vault:`));
        for (const key of vaultKeys) {
          console.log(chalk.yellow(`    - ${key}`));
        }
      }
      continue;
    }

    const content = fs.readFileSync(fullPath, "utf8");
    const localVars = parseEnvFile(content).variables;

    const allKeys = new Set([
      ...Object.keys(localVars),
      ...Object.keys(vaultVars),
    ]);

    let inSync = 0;
    let missingLocally = 0;
    let onlyLocal = 0;
    let different = 0;

    for (const k of allKeys) {
      const inLocal = k in localVars;
      const inVault = k in vaultVars;

      if (inLocal && inVault) {
        if (localVars[k] === vaultVars[k]) {
          inSync++;
        } else {
          different++;
          const localVal = options.reveal ? localVars[k] : maskValue(localVars[k]);
          const vaultVal = options.reveal ? vaultVars[k] : maskValue(vaultVars[k]);
          console.log(chalk.yellow(`  ⚠ ${k}`));
          console.log(chalk.gray(`    local: ${localVal}`));
          console.log(chalk.gray(`    vault: ${vaultVal}`));
        }
      } else if (inVault && !inLocal) {
        missingLocally++;
        console.log(chalk.yellow(`  ⚠ Missing locally: ${k}`));
      } else if (inLocal && !inVault) {
        onlyLocal++;
        console.log(chalk.yellow(`  ⚠ Only local: ${k}`));
      }
    }

    console.log("");
    if (inSync > 0) console.log(chalk.green(`  ✓ ${inSync} in sync`));
    if (missingLocally > 0) console.log(chalk.yellow(`  ⚠ ${missingLocally} missing locally`));
    if (onlyLocal > 0) console.log(chalk.yellow(`  ⚠ ${onlyLocal} only local`));
    if (different > 0) console.log(chalk.yellow(`  ⚠ ${different} different values`));
    if (inSync === allKeys.size) console.log(chalk.green("  ✓ All variables in sync"));
  }
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return value.slice(0, 2) + "****" + value.slice(-2);
}
