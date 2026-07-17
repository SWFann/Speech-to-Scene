/**
 * `s2s review` command handler.
 *
 * Starts a local HTTP review server for the specified project.
 *
 * Usage:
 *   s2s review <project-directory> [--host 127.0.0.1] [--port 3210] [--no-open] [--token <token>]
 *
 * M4-01: server skeleton + health endpoint.
 * M4-02: security envelope (Host/Origin/token, JSON body parser, security headers).
 * M4-03B: GET /api/project (token-gated read).
 * M4-04B: PATCH /api/scenes/:sceneId, PUT /api/scenes/:sceneId/queries.
 * M4-05: POST /api/scenes/:sceneId/search (single-scene asset search).
 * M4-06: PUT /api/scenes/:sceneId/selection, PUT /api/scenes/:sceneId/skip.
 * M5-03: Serves the React Review Board build from web/dist.
 */

import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";

import { type CommandContext } from "../command-context.js";
import { AppError } from "../../shared/errors.js";
import { startReviewServer } from "../../review/review-server.js";
import type { ReviewServerDependencies } from "../../review/review-types.js";
import { searchSceneAssets } from "../../application/search-scene-assets.js";
import type { SearchProjectAssetsResult } from "../../application/search-project-assets.js";
import { searchProjectAssets as searchProjectAssetsUseCase } from "../../application/search-project-assets.js";
import { createProjectFromContent as createProjectFromContentUseCase } from "../../application/create-project-from-content.js";
import { planProject as planProjectUseCase } from "../../application/plan-script.js";
import type { Settings } from "../../application/ports/settings-store.js";
import { FsSettingsStore } from "../../infrastructure/settings-store.js";
import {
  createSearchProvider,
  getSearchCacheDir,
  createPlannerProvider,
  assetProviderEnvFromSettings,
} from "../provider-factory.js";
import { FileSearchCache } from "../../infrastructure/file-search-cache.js";
import { readEnv } from "../../infrastructure/env.js";
import { resolveReviewStaticRoot } from "../review-static-root.js";

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
    .option("--no-open", "Do not open a browser (default: open)")
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

        // E1: ensure the workspace directory exists (one-click first run).
        // The frontend creates the project via POST /api/project/create.
        await fs.mkdir(resolvedProjectRoot, { recursive: true });

        // Validate project before starting server (P1-2).
        // For one-click flow, tolerate an empty workspace (no project yet) —
        // the frontend LandingView will create it via POST /api/project/create.
        try {
          await ctx.repository.load(resolvedProjectRoot);
        } catch {
          console.log(
            `  (no existing project at ${resolvedProjectRoot}; create one via the web UI)`,
          );
        }

        // E1/E2: workspace-level settings store (<workspace>/.s2s/settings.json).
        // projectRoot is <workspace>/default; workspace root is its parent.
        const workspaceRoot = path.dirname(path.resolve(resolvedProjectRoot));
        const settingsStore = new FsSettingsStore({
          settingsPath: path.join(workspaceRoot, ".s2s", "settings.json"),
        });

        // Start server with injected dependencies
        const assetProviderEnv = readEnv().assetProvider;
        const searchSceneAssetsBound = (input: unknown): Promise<SearchProjectAssetsResult> =>
          searchSceneAssets(input, {
            repository: ctx.repository,
            createProvider: async (providerName: string) =>
              createSearchProvider(providerName, assetProviderEnv),
            createCache: (projectRoot: string, providerName: string) =>
              new FileSearchCache({ cacheDir: getSearchCacheDir(projectRoot, providerName) }),
            now: () => new Date(),
          });

        const deps: ReviewServerDependencies = {
          repository: ctx.repository,
          getReviewProject: ctx.getReviewProject,
          updateScene: ctx.updateScene,
          updateSceneQueries: ctx.updateSceneQueries,
          searchSceneAssets: searchSceneAssetsBound,
          selectCandidate: ctx.selectCandidate,
          skipScene: ctx.skipScene,
          attachLocalAsset: ctx.attachLocalAsset,
          assetWriter: ctx.assetWriter,

          // E1: settings (workspace-level, settings.json priority over .env)
          getSettings: async () => settingsStore.toView(await settingsStore.load()),
          saveSettings: async (input: unknown) => {
            const current = await settingsStore.load();
            const merged = { ...current, ...(input as Record<string, unknown>) };
            const clean = Object.fromEntries(
              Object.entries(merged).filter(([, v]) => v !== undefined),
            ) as unknown as Settings;
            await settingsStore.save(clean);
            return settingsStore.toView(clean);
          },

          // E1: create project from in-memory content bytes (frontend upload)
          createProjectFromContent: async (input: unknown) =>
            createProjectFromContentUseCase(
              input as Parameters<typeof createProjectFromContentUseCase>[0],
              ctx.clock,
              ctx.idGenerator,
              ctx.repository,
              ctx.scaffolder,
            ),

          // E1/E2: plan project (planner provider from settings.json priority)
          planProject: async (input: unknown) => {
            const planInput = input as {
              projectRoot: string;
              provider: string;
              maxScenes: number;
              force: boolean;
              dryRun: boolean;
            };
            const settings = await settingsStore.load();
            const planner = await createPlannerProvider(planInput.provider, settings);
            return planProjectUseCase(
              planInput,
              ctx.repository,
              planner,
              ctx.clock,
              ctx.idGenerator,
            );
          },

          // E1/E2: search all project assets (settings.json priority for keys)
          searchProjectAssets: async (input: unknown) => {
            const searchInput = input as {
              projectRoot: string;
              provider: string;
              maxAssetsPerQuery: number;
              refresh?: boolean;
              dryRun?: boolean;
            };
            const settings = await settingsStore.load();
            const provider = await createSearchProvider(
              searchInput.provider,
              assetProviderEnvFromSettings(settings),
            );
            const cache = new FileSearchCache({
              cacheDir: getSearchCacheDir(searchInput.projectRoot, searchInput.provider),
            });
            return searchProjectAssetsUseCase(
              searchInput,
              ctx.repository,
              provider,
              cache,
              () => new Date(),
            );
          },
        };
        const staticRoot = resolveReviewStaticRoot({
          cwd: process.cwd(),
          moduleUrl: import.meta.url,
          ...(process.env.S2S_REVIEW_STATIC_ROOT !== undefined
            ? { envStaticRoot: process.env.S2S_REVIEW_STATIC_ROOT }
            : {}),
        });

        const handle = await startReviewServer(
          {
            projectRoot: resolvedProjectRoot,
            host,
            port,
            staticRoot,
            ...(options.token !== undefined ? { token: options.token } : {}),
          },
          deps,
        );

        console.log(`Review server started:`);
        console.log(`  Project: ${resolvedProjectRoot}`);
        console.log(`  URL:     http://${host}:${handle.port}`);
        console.log(`  Token:   ${handle.token}`);
        console.log(`  Review:  http://${host}:${handle.port}/?token=${handle.token}`);
        console.log(`  Press Ctrl+C to stop`);

        // E1: open browser to the review URL (token auto-included)
        if (options.open) {
          const reviewUrl = `http://${host}:${handle.port}/?token=${handle.token}`;
          const cmd =
            process.platform === "darwin"
              ? `open "${reviewUrl}"`
              : process.platform === "win32"
                ? `start "" "${reviewUrl}"`
                : `xdg-open "${reviewUrl}"`;
          try {
            const { exec } = await import("node:child_process");
            exec(cmd, () => {
              /* best-effort; ignore errors */
            });
          } catch {
            /* best-effort; user can copy the URL from the console */
          }
        }

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
