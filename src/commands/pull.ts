import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { authenticate } from "../auth";
import { readProjectConfig, decryptVault, readGlobalConfig, globalConfigExists } from "../vault";
import { serializeEnv } from "../env-parser";
import { gitPullVault } from "../git";

export async function pullCommand(): Promise<void> {
  const config = readProjectConfig();
  if (!config) {
    console.log(chalk.red("✗ Not an envs project. Run `envs init` first."));
    process.exit(1);
  }

  const key = await authenticate();

  // Sync from remote before reading local vault
  if (globalConfigExists()) {
    const globalConf = readGlobalConfig();
    if (globalConf.remote?.enabled) {
      const pulled = gitPullVault();
      if (pulled) {
        console.log(chalk.gray("  ✓ Synced ↓"));
      } else {
        console.log(chalk.yellow("  ⚠ Remote sync failed (using local vault). Run `envs sync` to retry."));
      }
    }
  }

  const vault = decryptVault(config.projectId, key);
  if (!vault) {
    console.log(chalk.red("✗ No vault data found. Run `envs push` first."));
    process.exit(1);
  }

  for (const [envName, filePath] of Object.entries(config.environments)) {
    const fullPath = path.join(process.cwd(), filePath);
    const variables = vault.environments[envName];

    if (!variables) {
      console.log(chalk.yellow(`⚠ No vault data for "${envName}", skipping`));
      continue;
    }

    const comments = vault.comments?.[envName] || [];
    const count = Object.keys(variables).length;

    if (fs.existsSync(fullPath)) {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: `${filePath} already exists. What to do?`,
          choices: [
            { name: "Overwrite with vault version", value: "overwrite" },
            { name: "Skip (keep local)", value: "skip" },
          ],
        },
      ]);

      if (action === "skip") {
        console.log(chalk.gray(`  Skipped ${filePath}`));
        continue;
      }
    }

    const content = serializeEnv(variables, comments);
    fs.writeFileSync(fullPath, content);
    console.log(chalk.green(`✓ Pulled ${count} variables → ${filePath}`));
  }
}
