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
  // Tier 1: GitHub CLI
  if (isGhAvailable() && isGhAuthenticated()) {
    const username = getGhUsername();
    if (!username) {
      console.log(chalk.yellow("⚠ Could not determine GitHub username."));
    } else {
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

          // Check if remote has actual content (commits)
          if (remoteHasContent(repoUrl)) {
            // Case 2: Returning user on new machine — clone existing vault
            console.log(chalk.gray(`  Found ${username}/${repoName} on GitHub, cloning...`));
            const cloned = cloneVaultRepo(repoUrl);
            if (cloned) {
              console.log(chalk.green("✓ Vault synced from GitHub"));
            } else {
              // Clone failed but repo exists — init locally and link
              initVaultGitRepo(repoUrl);
              console.log(chalk.green("✓ Vault connected to GitHub"));
            }
          } else {
            // Repo exists but is empty — init locally and push
            console.log(chalk.gray(`  Found empty repo ${username}/${repoName}, initializing...`));
            initVaultGitRepo(repoUrl);
            console.log(chalk.green("✓ Vault connected to GitHub"));
          }
          return { enabled: true, method: "gh", repoUrl };
        } else {
          // Create new repo
          console.log(chalk.gray(`  Creating private repo ${username}/${repoName}...`));
          const repoUrl = ghCreateRepo(repoName);
          if (repoUrl) {
            initVaultGitRepo(repoUrl);
            console.log(chalk.green("✓ Remote sync enabled via GitHub"));
            return { enabled: true, method: "gh", repoUrl };
          } else {
            console.log(chalk.yellow("⚠ Failed to create GitHub repo. Continuing local-only."));
          }
        }
      }
    }
  }

  // Tier 2: Git available
  if (isGitAvailable()) {
    // Only ask if we didn't already ask via gh
    const alreadyDeclined = isGhAvailable() && isGhAuthenticated();
    if (!alreadyDeclined) {
      const { enable } = await inquirer.prompt([
        {
          type: "confirm",
          name: "enable",
          message: "Enable remote sync via Git?",
          default: true,
        },
      ]);

      if (enable) {
        const { repoUrl } = await inquirer.prompt([
          {
            type: "input",
            name: "repoUrl",
            message: "Paste your private vault repo URL:",
            validate: (input: string) =>
              input.trim().length > 0 || "Please enter a repo URL",
          },
        ]);

        const url = repoUrl.trim();

        if (remoteHasContent(url)) {
          // Existing vault — clone it
          console.log(chalk.gray("  Cloning existing vault..."));
          const cloned = cloneVaultRepo(url);
          if (cloned) {
            console.log(chalk.green("✓ Vault synced from remote"));
          } else {
            initVaultGitRepo(url);
            console.log(chalk.green("✓ Vault connected to remote"));
          }
        } else {
          // New/empty repo — init locally and push
          initVaultGitRepo(url);
          console.log(chalk.green("✓ Vault connected to remote"));
        }
        return { enabled: true, method: "git", repoUrl: url };
      }
    }
  }

  // Tier 3: Local only
  if (!isGitAvailable()) {
    console.log(chalk.gray("  Git not found. Using local vault only."));
  } else {
    console.log(
      chalk.gray("  Using local vault only. Run `envs sync` later to enable remote sync.")
    );
  }
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
