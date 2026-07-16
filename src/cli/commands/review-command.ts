/**
 * `s2s review` command handler.
 *
 * Starts a local HTTP review server for the specified project.
 *
 * Usage:
 *   s2s review <project-directory> [--host 127.0.0.1] [--port 3210] [--no-open] [--token <token>]
 *
 * M4-01 scope: server skeleton only. No project read/write API.
 */

import { Command } from "commander";

import { type CommandContext } from "../command-context.js";
import { AppError } from "../../shared/errors.js";
import { startReviewServer } from "../../review/review-server.js";
import type { ReviewServerDependencies } from "../../review/review-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewCommandOptions {
  host: string;
  port: string;
  open: boolean;
  token?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and configures the `review` subcommand.
 *
 * The command starts a local HTTP server bound to loopback by default.
 * The server is fixed to the project root resolved at startup.
 *
 * Project validation via `ctx.repository.load()` happens before the server
 * binds to the port. If the project is invalid, no server is started.
 */
export function createReviewCommand(ctx: CommandContext): Command {
  const command = new Command("review");

  command
    .description("Start a local review server for a Speech-to-Scene project")
    .argument("<project-directory>", "Path to the project directory")
    .option("--host <host>", "Host to bind to", "127.0.0.1")
    .option("--port <port>", "Port to listen on", "3210")
    .option("--no-open", "Do not open a browser (default: do not open)")
    .option("--token <token>", "Session token for mutating requests")
    .action(async (projectDirectory: string, options: ReviewCommandOptions) => {
      try {
        // Validate host
        const host = options.host.trim() || "127.0.0.1";

        // Parse port: accept 0-65535 inclusive, pure integer string only
        const portStr = options.port.trim();
        const port = Number.parseInt(portStr, 10);
        if (!/^\d+$/.test(portStr) || port > 65535) {
          throw new Error(`Invalid port: ${options.port}. Must be an integer between 0 and 65535.`);
        }

        // Resolve project root to absolute path for validation
        const resolvedProjectRoot = projectDirectory;

        // Validate project before starting server (P1-2)
        // This ensures the project exists and passes full schema validation
        // before we bind to any port.
        await ctx.repository.load(resolvedProjectRoot);

        // Start server with injected dependencies
        const deps: ReviewServerDependencies = {
          repository: ctx.repository,
          getReviewProject: ctx.getReviewProject,
          updateScene: ctx.updateScene,
          updateSceneQueries: ctx.updateSceneQueries,
        };
        const handle = await startReviewServer(
          {
            projectRoot: resolvedProjectRoot,
            host,
            port,
            ...(options.token !== undefined ? { token: options.token } : {}),
          },
          deps,
        );

        console.log(`Review server started:`);
        console.log(`  Project: ${resolvedProjectRoot}`);
        console.log(`  URL:     http://${host}:${handle.port}`);
        console.log(`  Token:   ${handle.token}`);
        console.log(`  Press Ctrl+C to stop`);

        // Keep process alive until SIGINT/SIGTERM
        // The server keeps listening; signals trigger graceful shutdown.
        await new Promise<void>((resolve, reject) => {
          let shuttingDown = false;

          const shutdown = async (): Promise<void> => {
            if (shuttingDown) return;
            shuttingDown = true;

            try {
              await handle.close();
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } finally {
              process.removeListener("SIGINT", onShutdownSignal);
              process.removeListener("SIGTERM", onShutdownSignal);
            }
          };

          // Wrap async shutdown in a non-async handler to satisfy
          // @typescript-eslint/no-misused-promises.
          const onShutdownSignal = (): void => {
            void shutdown().catch(() => {
              // Shutdown errors propagate via reject() above.
              // This catch prevents unhandled promise rejection
              // from the event listener context.
            });
          };

          process.once("SIGINT", onShutdownSignal);
          process.once("SIGTERM", onShutdownSignal);
        });

        console.log("\nReview server stopped.");
        process.exitCode = 0;
      } catch (error) {
        if (error instanceof AppError) {
          console.error(ctx.formatError(error));
        } else {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(ctx.formatUnexpectedError(err));
        }
        process.exitCode = 1;
      }
    });

  return command;
}
