import chalk from "chalk";
import inquirer from "inquirer";
import {
  globalConfigExists,
  getCachedKey,
  verifyPassword,
  setupMasterPassword,
} from "./vault";

export async function authenticate(): Promise<Buffer> {
  // Try cached key first
  const cached = getCachedKey();
  if (cached) return cached;

  if (!globalConfigExists()) {
    console.log(
      chalk.yellow("First time setup — please create a master password.")
    );
    console.log(
      chalk.gray(
        "This password encrypts all your env files. Don't forget it!"
      )
    );

    const { password } = await inquirer.prompt([
      {
        type: "password",
        name: "password",
        message: "Create master password:",
        mask: "*",
        validate: (input: string) =>
          input.length >= 8 || "Password must be at least 8 characters",
      },
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: "password",
        name: "confirm",
        message: "Confirm master password:",
        mask: "*",
        validate: (input: string) =>
          input === password || "Passwords do not match",
      },
    ]);

    if (confirm !== password) {
      console.log(chalk.red("✗ Passwords do not match."));
      process.exit(1);
    }

    const key = setupMasterPassword(password);
    console.log(chalk.green("✓ Master password set."));
    return key;
  }

  // Prompt for existing password
  const { password } = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      message: "Master password:",
      mask: "*",
    },
  ]);

  const key = verifyPassword(password);
  if (!key) {
    console.log(chalk.red("✗ Incorrect password."));
    process.exit(1);
  }

  return key;
}
