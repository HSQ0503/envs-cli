import chalk from "chalk";
import inquirer from "inquirer";
import { readGlobalConfig, writeGlobalConfig, globalConfigExists } from "../vault";
import {
  isGhAvailable,
  isGhAuthenticated,
  isGitAvailable,
  getGhUsername,
  ghRepoExists,
  ghCreateRepo,
  cloneVaultRepo,
  initVaultGitRepo,
  remoteHasContent,
  gitPullVault,
  gitPushVault,
  getVaultSyncStatus,
} from "../git";
import type { RemoteConfig } from "../types";

export async function setupRemoteSync(): Promise<RemoteConfig | null> {
  // Explain what remote sync is
  console.log(chalk.cyan("── Remote Sync ──"));
  console.log(
    chalk.gray(
      "  Remote sync lets you access your encrypted .env files from any machine.\n" +
      "  Your variables are encrypted locally — only the encrypted vault is stored\n" +
      "  in a private Git repo. No one can read your secrets without your password."
    )
  );
  console.log("");

  // Tier 1: GitHub CLI detected and authenticated
  if (isGhAvailable() && isGhAuthenticated()) {
    const username = getGhUsername();
    if (!username) {
      console.log(chalk.yellow("⚠ Could not determine GitHub username."));
    } else {
      console.log(
        chalk.green("  ✓ GitHub CLI detected") +
        chalk.gray(` (logged in as ${username})`)
      );
      console.log(
        chalk.gray(
          "  We can automatically create a private repo to sync your vault."
        )
      );
      console.log("");

      const { enable } = await inquirer.prompt([
        {
          type: "confirm",
          name: "enable",
          message: "Enable remote sync via GitHub?",
          default: true,
        },
      ]);

      if (enable) {
        const repoName = "envs-vault";

        if (ghRepoExists(username, repoName)) {
          const repoUrl = `https://github.com/${username}/${repoName}.git`;

          if (remoteHasContent(repoUrl)) {
            console.log(chalk.gray(`  Found ${username}/${repoName} on GitHub, cloning...`));
            const cloned = cloneVaultRepo(repoUrl);
            if (cloned) {
              console.log(chalk.green("✓ Vault synced from GitHub"));
            } else {
              initVaultGitRepo(repoUrl);
              console.log(chalk.green("✓ Vault connected to GitHub"));
            }
          } else {
            console.log(chalk.gray(`  Found empty repo ${username}/${repoName}, initializing...`));
            initVaultGitRepo(repoUrl);
            console.log(chalk.green("✓ Vault connected to GitHub"));
          }
          return { enabled: true, method: "gh", repoUrl };
        } else {
          console.log(chalk.gray(`  Creating private repo ${username}/${repoName}...`));
          const repoUrl = ghCreateRepo(repoName);
          if (repoUrl) {
            initVaultGitRepo(repoUrl);
            console.log(chalk.green("✓ Remote sync enabled via GitHub"));
            console.log(chalk.gray(`  Your vault syncs to: ${repoUrl}`));
            return { enabled: true, method: "gh", repoUrl };
          } else {
            console.log(chalk.yellow("⚠ Failed to create GitHub repo. Continuing local-only."));
          }
        }
      }
    }

    // User declined gh sync — don't ask again for git
    if (!isGitAvailable()) {
      return localOnlyMessage();
    }
    return localOnlyMessage();
  }

  // Tier 2: No gh, but git is available
  if (isGitAvailable()) {
    console.log(chalk.yellow("  GitHub CLI not detected."));
    console.log(
      chalk.gray(
        "  To sync across machines, you need a private Git repo to store your\n" +
        "  encrypted vault. You can use GitHub, GitLab, Bitbucket, or any Git host.\n" +
        "\n" +
        "  How to set it up:\n" +
        "  1. Create a private repo (e.g. \"envs-vault\") on your Git host\n" +
        "  2. Copy the repo URL (HTTPS or SSH)\n" +
        "  3. Paste it below\n" +
        "\n" +
        "  On your next machine, run `envs init` and paste the same URL to sync."
      )
    );
    console.log("");

    const { enable } = await inquirer.prompt([
      {
        type: "list",
        name: "enable",
        message: "What would you like to do?",
        choices: [
          { name: "I have a repo URL — set up remote sync", value: "yes" },
          { name: "Skip for now — I'll use local only", value: "no" },
        ],
      },
    ]);

    if (enable === "yes") {
      const { repoUrl } = await inquirer.prompt([
        {
          type: "input",
          name: "repoUrl",
          message: "Repo URL:",
          validate: (input: string) =>
            input.trim().length > 0 || "Please enter a repo URL",
        },
      ]);

      const url = repoUrl.trim();

      if (remoteHasContent(url)) {
        console.log(chalk.gray("  Cloning existing vault..."));
        const cloned = cloneVaultRepo(url);
        if (cloned) {
          console.log(chalk.green("✓ Vault synced from remote"));
        } else {
          initVaultGitRepo(url);
          console.log(chalk.green("✓ Vault connected to remote"));
        }
      } else {
        initVaultGitRepo(url);
        console.log(chalk.green("✓ Vault connected to remote"));
      }
      console.log(
        chalk.gray("  On your next machine, run `envs init` and paste the same URL.")
      );
      return { enabled: true, method: "git", repoUrl: url };
    }

    return localOnlyMessage();
  }

  // Tier 3: No git at all
  console.log(chalk.yellow("  Git is not installed on this machine."));
  console.log(
    chalk.gray(
      "  Remote sync requires Git. Your vault will be stored locally only.\n" +
      "  Install Git and run `envs sync` later to enable remote sync."
    )
  );
  console.log("");
  return { enabled: false, method: null, repoUrl: null };
}

function localOnlyMessage(): RemoteConfig {
  console.log("");
  console.log(chalk.gray("  Using local vault only. Your .env files are encrypted on this machine."));
  console.log(chalk.gray("  You can enable remote sync anytime with `envs sync`."));
  console.log("");
  return { enabled: false, method: null, repoUrl: null };
}

export async function syncCommand(): Promise<void> {
  if (!globalConfigExists()) {
    console.log(chalk.red("✗ Not set up yet. Run `envs init` first."));
    process.exit(1);
  }

  const config = readGlobalConfig();

  if (!config.remote?.enabled) {
    // Set up remote sync
    console.log(chalk.cyan("Setting up remote sync...\n"));
    const remote = await setupRemoteSync();
    if (remote) {
      config.remote = remote;
      writeGlobalConfig(config);
      if (remote.enabled) {
        // Push all existing vault files
        const pushed = gitPushVault("all projects");
        if (pushed) {
          console.log(chalk.green("✓ All vault files synced to remote."));
        }
      }
    }
    return;
  }

  // Already configured — do a sync (pull then push)
  console.log(chalk.gray("  Pulling from remote..."));
  const pulled = gitPullVault();
  if (pulled) {
    console.log(chalk.green("  ✓ Synced ↓"));
  } else {
    console.log(chalk.yellow("  ⚠ Pull failed"));
  }

  console.log(chalk.gray("  Pushing to remote..."));
  const pushed = gitPushVault("manual sync");
  if (pushed) {
    console.log(chalk.green("  ✓ Synced ↑"));
  } else {
    console.log(chalk.yellow("  ⚠ Push failed"));
  }

  console.log(chalk.green("\n✓ Vault synced."));
}

export async function syncDisableCommand(): Promise<void> {
  if (!globalConfigExists()) {
    console.log(chalk.red("✗ Not set up yet. Run `envs init` first."));
    process.exit(1);
  }

  const config = readGlobalConfig();

  if (!config.remote?.enabled) {
    console.log(chalk.yellow("⚠ Remote sync is already disabled."));
    return;
  }

  config.remote.enabled = false;
  writeGlobalConfig(config);

  console.log(
    chalk.green(
      "✓ Remote sync disabled. Your vault files remain on the remote but will no longer auto-sync."
    )
  );
  console.log(chalk.gray("  To re-enable: envs sync"));
}

export async function syncStatusCommand(): Promise<void> {
  if (!globalConfigExists()) {
    console.log(chalk.red("✗ Not set up yet. Run `envs init` first."));
    process.exit(1);
  }

  const config = readGlobalConfig();
  const status = getVaultSyncStatus(config.remote);

  console.log("");

  if (!status.enabled) {
    console.log(chalk.gray("Remote: disabled (local only)"));
    console.log(chalk.gray("Run `envs sync` to enable."));
    console.log("");
    return;
  }

  const methodLabel =
    status.method === "gh" ? "GitHub via gh" : "git";

  console.log(`Remote: ${chalk.green("enabled")} (${methodLabel})`);
  console.log(`Repo:   ${status.repoUrl}`);

  if (status.inSync) {
    const timeStr = status.lastCommitTime
      ? ` (last synced ${status.lastCommitTime})`
      : "";
    console.log(`Status: ${chalk.green("✓ in sync")}${timeStr}`);
  } else if (status.ahead > 0 && status.behind === 0) {
    console.log(
      `Status: ${chalk.yellow(`⚠ ${status.ahead} commit(s) ahead`)} (unpushed changes). Run \`envs sync\` to push.`
    );
  } else if (status.behind > 0 && status.ahead === 0) {
    console.log(
      `Status: ${chalk.yellow(`⚠ ${status.behind} commit(s) behind`)}. Run \`envs sync\` to pull.`
    );
  } else {
    console.log(
      `Status: ${chalk.yellow(`⚠ ${status.ahead} ahead, ${status.behind} behind`)}. Run \`envs sync\` to reconcile.`
    );
  }

  console.log("");
}
