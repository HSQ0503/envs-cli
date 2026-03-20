import chalk from "chalk";
import inquirer from "inquirer";
import { readProjectConfig, writeProjectConfig } from "../vault";

export async function envListCommand(): Promise<void> {
  const config = readProjectConfig();
  if (!config) {
    console.log(chalk.red("✗ Not an envs project. Run `envs init` first."));
    process.exit(1);
  }

  console.log(chalk.cyan(`\nEnvironments for ${config.projectName}:`));
  console.log("");

  for (const [envName, filePath] of Object.entries(config.environments)) {
    console.log(`  ${chalk.bold(envName)} → ${filePath}`);
  }

  if (config.ignore.length > 0) {
    console.log(chalk.gray(`\n  Ignored: ${config.ignore.join(", ")}`));
  }
  console.log("");
}

export async function envAddCommand(name: string): Promise<void> {
  const config = readProjectConfig();
  if (!config) {
    console.log(chalk.red("✗ Not an envs project. Run `envs init` first."));
    process.exit(1);
  }

  if (config.environments[name]) {
    console.log(chalk.yellow(`⚠ Environment "${name}" already exists → ${config.environments[name]}`));
    return;
  }

  const defaultFile = `.env.${name}`;
  const { filePath } = await inquirer.prompt([
    {
      type: "input",
      name: "filePath",
      message: `File for "${name}" environment:`,
      default: defaultFile,
    },
  ]);

  config.environments[name] = filePath;
  writeProjectConfig(config);

  console.log(chalk.green(`✓ Added environment "${name}" → ${filePath}`));
  console.log(chalk.gray("  Run `envs push` to encrypt and store it."));
}
