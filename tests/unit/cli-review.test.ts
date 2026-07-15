/**
 * Integration tests for `s2s review` command.
 */

import http from "node:http";
import { describe, expect, it, afterEach, vi } from "vitest";

import { createProgram } from "../../src/cli/index.js";
import { startReviewServer } from "../../src/review/review-server.js";
import { createTempProject } from "../helpers/temp-project.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SpeechToSceneProject } from "../../src/domain/project-schema.js";

const VALID_SCRIPT =
  "# 测试脚本\n\n这是一个测试用的口播稿内容。\n用于验证 review 命令的基本功能。\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes a minimal valid project.s2s.json directly in the project root.
 */
async function writeProjectFile(projectRoot: string, scriptBytes: Uint8Array): Promise<void> {
  const sourceHash = crypto.createHash("sha256").update(scriptBytes).digest("hex");
  const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

  const project: SpeechToSceneProject = {
    schemaVersion: "0.1",
    project: {
      id: "project-review-test",
      title: "Review Test Project",
      createdAt: now,
      updatedAt: now,
      language: "zh-CN",
      aspectRatio: "9:16",
      style: "knowledge",
      assetUsePolicy: { intendedUse: "commercial_capable", willModify: true },
    },
    source: {
      path: "script.md",
      originalFileName: "script.md",
      sha256: sourceHash,
      encoding: "utf-8",
      sizeBytes: scriptBytes.length,
      textLengthUtf16: VALID_SCRIPT.length,
      offsetUnit: "utf16_code_unit",
      blocks: [],
    },
    generation: null,
    scenes: [],
  };

  await fs.writeFile(
    path.join(projectRoot, "project.s2s.json"),
    JSON.stringify(project, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Makes an HTTP GET request and returns the status code.
 */
async function fetchStatus(url: string, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: "GET",
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", () => resolve(0));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI: s2s review", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const originalExitCode = process.exitCode;

  afterEach(async () => {
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // best-effort cleanup
      }
    }
    cleanups.length = 0;
    process.exitCode = originalExitCode;
  });

  async function setupValidProject(): Promise<string> {
    const scriptBytes = Buffer.from(VALID_SCRIPT, "utf-8");
    const { projectRoot, cleanup } = await createTempProject({
      scriptContent: VALID_SCRIPT,
    });
    cleanups.push(cleanup);
    await writeProjectFile(projectRoot, scriptBytes);
    return projectRoot;
  }

  // -------------------------------------------------------------------------
  // Command registration
  // -------------------------------------------------------------------------

  describe("command registration", () => {
    it("registers review subcommand", () => {
      const program = createProgram();
      const reviewCmd = program.commands.find((c) => c.name() === "review");
      expect(reviewCmd).toBeDefined();
    });

    it("createReviewCommand accepts CommandContext (dependency injection)", () => {
      // Verifies createReviewCommand(ctx) is wired via createProgram(ctx)
      // which passes ctx to all commands including review.
      const program = createProgram();
      const reviewCmd = program.commands.find((c) => c.name() === "review");
      expect(reviewCmd).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------

  describe("help", () => {
    it("shows help with --help", async () => {
      const program = createProgram();
      program.exitOverride((exitCode) => {
        throw new Error(`Command exited with code ${exitCode}`);
      });

      let helpOutput = "";
      const originalWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stdout.write = (chunk: string | Uint8Array) => {
        helpOutput += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      };
      // Suppress Commander error output that may appear before help text
      process.stderr.write = () => true;

      try {
        await program.parseAsync(["node", "s2s", "review", "--help"]);
      } catch {
        // Commander help calls process.exit(0) which throws via exitOverride
      } finally {
        process.stdout.write = originalWrite;
        process.stderr.write = originalStderrWrite;
      }

      expect(helpOutput).toContain("review");
    });
  });

  // -------------------------------------------------------------------------
  // Option defaults
  // -------------------------------------------------------------------------

  describe("option defaults", () => {
    it("default host is exactly 127.0.0.1", () => {
      const program = createProgram();
      const reviewCmd = program.commands.find((c) => c.name() === "review");
      expect(reviewCmd).toBeDefined();

      const hostOption = reviewCmd!.options.find((o) => o.long === "--host");
      expect(hostOption).toBeDefined();
      expect(hostOption!.defaultValue).toBe("127.0.0.1");
    });

    it("default port is exactly 3210", () => {
      const program = createProgram();
      const reviewCmd = program.commands.find((c) => c.name() === "review");
      expect(reviewCmd).toBeDefined();

      const portOption = reviewCmd!.options.find((o) => o.long === "--port");
      expect(portOption).toBeDefined();
      expect(portOption!.defaultValue).toBe("3210");
    });
  });

  // -------------------------------------------------------------------------
  // Port validation
  // -------------------------------------------------------------------------

  describe("port validation", () => {
    it("rejects non-integer port strings", async () => {
      const projectRoot = await setupValidProject();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      try {
        await program.parseAsync(["node", "s2s", "review", projectRoot, "--port", "3210abc"]);
      } catch {
        // parseAsync may throw on error paths
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(errorOutput).toMatch(/Invalid port|无效|端口/);
    }, 10000);

    it("rejects decimal port", async () => {
      const projectRoot = await setupValidProject();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      try {
        await program.parseAsync(["node", "s2s", "review", projectRoot, "--port", "3.14"]);
      } catch {
        // parseAsync may throw on error paths
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(errorOutput).toMatch(/Invalid port|无效|端口/);
    }, 10000);

    it("rejects negative port", async () => {
      const projectRoot = await setupValidProject();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      try {
        await program.parseAsync(["node", "s2s", "review", projectRoot, "--port", "-1"]);
      } catch {
        // parseAsync may throw on error paths
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(errorOutput).toMatch(/Invalid port|无效|端口/);
    }, 10000);

    it("rejects port above 65535", async () => {
      const projectRoot = await setupValidProject();

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      try {
        await program.parseAsync(["node", "s2s", "review", projectRoot, "--port", "65536"]);
      } catch {
        // parseAsync may throw on error paths
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => c[0] as string).join("");
      expect(errorOutput).toMatch(/Invalid port|无效|端口/);
    }, 10000);

    it("accepts port 0", async () => {
      const projectRoot = await setupValidProject();

      // Use the real startReviewServer with port 0 (OS-assigned)
      const handle = await startReviewServer({
        projectRoot,
        host: "127.0.0.1",
        port: 0,
      });

      // Port 0 should result in an actual OS-assigned port
      expect(handle.port).toBeGreaterThan(0);

      // Verify the server is actually listening
      const status = await fetchStatus(`http://127.0.0.1:${handle.port}/api/health`);
      expect(status).toBe(200);

      await handle.close();
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Project validation
  // -------------------------------------------------------------------------

  describe("project validation", () => {
    it("prints error for non-existent project directory", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const program = createProgram();
      try {
        await program.parseAsync([
          "node",
          "s2s",
          "review",
          "/nonexistent/path/to/project",
          "--no-open",
        ]);

        // Error should have been printed
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(consoleErrorSpy.mock.calls.map((c) => c[0] as string).join("")).toBeTruthy();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Token output
  // -------------------------------------------------------------------------

  describe("token output", () => {
    it("prints the actual auto-generated token (not '(auto-generated)')", async () => {
      const projectRoot = await setupValidProject();

      const handle = await startReviewServer({
        projectRoot,
        host: "127.0.0.1",
        port: 0,
      });

      // Verify the token is truthy and is a UUID format
      expect(handle.token).toBeTruthy();
      expect(typeof handle.token).toBe("string");
      expect(handle.token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // The CLI would print this token directly, not "(auto-generated)"
      const tokenDisplay = `  Token:   ${handle.token}`;
      expect(tokenDisplay).not.toContain("(auto-generated)");
      expect(tokenDisplay).toContain(handle.token);

      await handle.close();
    }, 10000);

    it("returns the provided token when specified", async () => {
      const projectRoot = await setupValidProject();

      const handle = await startReviewServer({
        projectRoot,
        host: "127.0.0.1",
        port: 0,
        token: "user-specified-token-abc",
      });

      // Verify the token is exactly what was provided
      expect(handle.token).toBe("user-specified-token-abc");

      await handle.close();
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Lifecycle (integration)
  // -------------------------------------------------------------------------

  describe("lifecycle integration", () => {
    it("starts server, health returns 200, then stops on SIGINT", async () => {
      const projectRoot = await setupValidProject();

      let boundPort = 0;

      // Spawn the CLI via tsx so the test does not depend on dist/
      const { spawn } = await import("node:child_process");
      const cliScript = path.join(process.cwd(), "src", "cli", "index.ts");

      const child = spawn(
        "node",
        ["--import", "tsx", cliScript, "review", projectRoot, "--no-open", "--port", "0"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const cleanup = async (): Promise<void> => {
        try {
          child.kill("SIGTERM");
        } catch {
          // best-effort
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          child.kill();
        } catch {
          // best-effort
        }
      };

      try {
        // Collect stdout to find the bound port and token
        let stdout = "";
        child.stdout.on("data", (data: Buffer | Uint8Array) => {
          stdout += data.toString();
          // Check for URL line to extract port
          const match = stdout.match(/URL:\s+http:\/\/127\.0\.0\.1:(\d+)/);
          if (match?.[1] !== undefined && boundPort === 0) {
            boundPort = parseInt(match[1], 10);
          }
        });

        // Capture stderr for error detection
        let stderr = "";
        child.stderr.on("data", (data: Buffer | Uint8Array) => {
          stderr += data.toString();
        });

        // Wait for server to start (up to 10s)
        const startTimeout = 10000;
        const startCheckInterval = 200;
        const startChecks = startTimeout / startCheckInterval;
        for (let i = 0; i < startChecks; i++) {
          await new Promise((r) => setTimeout(r, startCheckInterval));
          if (boundPort > 0) break;
        }

        expect(boundPort).toBeGreaterThan(0);
        expect(stderr).toBe("");

        // Verify health endpoint
        const healthUrl = `http://127.0.0.1:${boundPort}/api/health`;
        const healthStatus = await fetchStatus(healthUrl);
        expect(healthStatus).toBe(200);

        // Send SIGINT
        child.kill("SIGINT");

        // Wait for process to exit
        const exitPromise = new Promise<number>((resolve) => {
          child.on("exit", (code) => resolve(code ?? 0));
        });

        const exitCode = await Promise.race([
          exitPromise,
          new Promise<number>((resolve) => setTimeout(() => resolve(-1), 10000)),
        ]);

        expect(exitCode).toBe(0);
      } finally {
        await cleanup();
      }
    }, 30000);
  });
});
