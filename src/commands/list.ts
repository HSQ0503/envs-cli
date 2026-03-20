import chalk from "chalk";
import { authenticate } from "../auth";
import { listVaultFiles, decryptVault } from "../vault";

export async function listCommand(): Promise<void> {
  const vaultFiles = listVaultFiles();

  if (vaultFiles.length === 0) {
    console.log(chalk.yellow("⚠ No projects in vault."));
    return;
  }

  const key = await authenticate();

  // Table header
  const nameWidth = 24;
  const envWidth = 24;
  const varWidth = 10;

  console.log("");
  console.log(
    chalk.bold(
      pad("Project", nameWidth) +
        pad("Environments", envWidth) +
        pad("Variables", varWidth)
    )
  );
  console.log(chalk.gray("─".repeat(nameWidth + envWidth + varWidth)));

  for (const vaultFile of vaultFiles) {
    try {
      const vault = decryptVault(vaultFile.projectId, key);
      if (!vault) continue;

      const envNames = Object.keys(vault.environments);
      const totalVars = envNames.reduce(
        (sum, env) => sum + Object.keys(vault.environments[env]).length,
        0
      );

      console.log(
        pad(vaultFile.projectName, nameWidth) +
          pad(envNames.join(", "), envWidth) +
          pad(String(totalVars), varWidth)
      );
    } catch {
      console.log(
        pad(vaultFile.projectName, nameWidth) +
          chalk.red(pad("(decrypt error)", envWidth)) +
          pad("-", varWidth)
      );
    }
  }
  console.log("");
}

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width - 1) + " ";
  return str + " ".repeat(width - str.length);
}
