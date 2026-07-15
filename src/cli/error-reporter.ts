/**
 * CLI error reporter.
 *
 * Formats application errors for terminal output.
 * Follows the M1 spec:
 *   ✗ <conclusion>
 *   原因：<safe, actionable reason>
 *   解决：<executable suggestion>
 *
 * The reporter never exposes:
 * - Absolute user paths
 * - Full project JSON
 * - Source text content
 * - Stack traces
 */

import type { AppError } from "../shared/errors.js";

/**
 * Formats an AppError for stderr output.
 */
export function formatError(error: AppError): string {
  const lines: string[] = [`✗ ${error.message}`, `原因：${error.userHint}`];
  if (error.userHint !== error.message) {
    lines.push(`解决：${error.userHint}`);
  }
  return lines.join("\n");
}

/**
 * Formats a generic (non-AppError) error safely.
 */
export function formatUnexpectedError(error: unknown): string {
  if (error instanceof Error) {
    return `✗ Unexpected error\n原因：${error.message}`;
  }
  return "✗ Unexpected error\n原因：未知错误";
}
