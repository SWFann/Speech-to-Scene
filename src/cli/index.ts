#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

export const createProgram = (): Command =>
  new Command()
    .name("s2s")
    .description("Plan and review visual assets for talking-head video scripts.")
    .version("0.0.0")
    .showHelpAfterError();

export const runCli = async (args: readonly string[] = process.argv): Promise<void> => {
  await createProgram().parseAsync([...args]);
};

const entryPath = process.argv[1];

if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  await runCli();
}
