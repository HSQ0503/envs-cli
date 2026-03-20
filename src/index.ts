#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init";
import { pushCommand } from "./commands/push";
import { pullCommand } from "./commands/pull";
import { diffCommand } from "./commands/diff";
import { listCommand } from "./commands/list";
import { envListCommand, envAddCommand } from "./commands/env";
import { syncCommand, syncDisableCommand, syncStatusCommand } from "./commands/sync";

const program = new Command();

program
  .name("envs")
  .description("Local encrypted vault for managing .env files across projects")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize envs vault for current project")
  .action(initCommand);

program
  .command("push")
  .description("Encrypt and push local env files to vault")
  .action(pushCommand);

program
  .command("pull")
  .description("Pull and decrypt env files from vault")
  .action(pullCommand);

program
  .command("diff")
  .description("Compare local env files with vault")
  .option("--reveal", "Show plaintext values instead of masked")
  .action(diffCommand);

program
  .command("list")
  .description("List all projects in the vault")
  .action(listCommand);

const env = program
  .command("env")
  .description("Manage environments for current project");

env
  .command("list")
  .description("List environments for current project")
  .action(envListCommand);

env
  .command("add <name>")
  .description("Add a new environment to current project")
  .action(envAddCommand);

const sync = program
  .command("sync")
  .description("Enable or run remote vault sync")
  .action(syncCommand);

sync
  .command("disable")
  .description("Disable remote sync")
  .action(syncDisableCommand);

sync
  .command("status")
  .description("Show remote sync status")
  .action(syncStatusCommand);

program.parse();
