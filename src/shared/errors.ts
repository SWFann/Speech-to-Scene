/**
 * Application-level error hierarchy.
 *
 * All errors thrown or returned by the application must be instances of
 * AppError (or a subclass). This allows CLI handlers and tests to catch
 * and format errors consistently without depending on infrastructure details.
 *
 * Design constraints:
 * - Never include the full project JSON, full source text, user absolute
 *   paths, or stack traces in the user-facing message.
 * - Keep `cause` minimal; it may be used for logging but not displayed.
 * - `code` must be stable for programmatic error handling.
 * - `exitCode` maps to CLI exit codes per M1 spec.
 */

/**
 * Base class for all application errors.
 */
export abstract class AppError extends Error {
  /**
   * Stable machine-readable error code.
   * Examples: "project_already_exists", "invalid_argument", "path_safety"
   */
  readonly code: string;

  /**
   * CLI exit code for this error category.
   * 0 = success, 1 = I/O, 2 = user input, 3 = schema/path violation.
   */
  readonly exitCode: number;
  /**
   * Safe, actionable message for end users.
   * Must not contain absolute paths, project JSON, or source text.
   */
  readonly userHint: string;

  /**
   * Whether the operation is safe to retry without code changes.
   * Transient I/O errors may be true; validation errors are false.
   */
  readonly retryable: boolean;

  constructor(params: {
    code: string;
    message: string;
    exitCode: number;
    cause?: Error;
    userHint: string;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = this.constructor.name;
    this.code = params.code;
    this.exitCode = params.exitCode;
    this.cause = params.cause;
    this.userHint = params.userHint;
    this.retryable = params.retryable ?? false;

    // Maintains proper stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Format for CLI output (stderr).
   * Example:
   *   ✗ Project already exists
   *   原因：/path/to/demo 已包含 project.s2s.json
   *   解决：使用不同目录名或删除现有项目
   */
  toUserOutput(): string {
    return `✗ ${this.message}\n原因：${this.userHint}`;
  }
}

// ---------------------------------------------------------------------------
// M1 error types
// ---------------------------------------------------------------------------

/**
 * Bad CLI argument, unknown option, or invalid enum value.
 * Exit code: 2
 */
export class InvalidArgumentError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "invalid_argument",
      message,
      exitCode: 2,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Source document cannot be read or decoded.
 * Exit code: 2
 */
export class SourceDocumentError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "source_document_error",
      message,
      exitCode: 2,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Project root does not exist or is not a directory.
 * Exit code: 1
 */
export class ProjectNotFoundError extends AppError {
  constructor(projectRoot: string, cause?: Error) {
    // projectRoot may be user-provided; use only the basename in output
    const safeLabel = projectRoot.split("/").pop() ?? projectRoot;
    const safeHint = projectRoot.split("/").pop() ?? projectRoot;
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_not_found",
      message: `Project not found: ${safeLabel}`,
      exitCode: 1,
      userHint: `确认目录存在：${safeHint}`,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Target directory already contains a project file or is non-empty.
 * Exit code: 1
 */
export class ProjectAlreadyExistsError extends AppError {
  constructor(projectRoot: string, cause?: Error) {
    const safeLabel = projectRoot.split("/").pop() ?? projectRoot;
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_already_exists",
      message: `Project already exists: ${safeLabel}`,
      exitCode: 1,
      userHint: "使用不同目录名或删除现有项目",
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Project file exists but fails schema validation or relation checks.
 * Exit code: 3
 */
export class ProjectValidationError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_validation_error",
      message,
      exitCode: 3,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Project file has a schema version that this binary does not understand.
 * Exit code: 3
 */
export class UnsupportedSchemaVersionError extends AppError {
  constructor(version: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "unsupported_schema_version",
      message: `Unsupported schema version: ${version}`,
      exitCode: 3,
      userHint: "升级 s2s 或联系项目维护者",
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Project file exceeds MAX_PROJECT_FILE_BYTES.
 * Exit code: 3
 */
export class ProjectFileTooLargeError extends AppError {
  constructor(sizeBytes: number, limitBytes: number, cause?: Error) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(2);
    const limitMb = (limitBytes / (1024 * 1024)).toFixed(2);
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_file_too_large",
      message: `Project file too large: ${mb} MiB (limit: ${limitMb} MiB)`,
      exitCode: 3,
      userHint: "删除不用的缓存候选或联系维护者",
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * A path safety check failed (traversal, symlink escape, Windows device name, etc.).
 * Exit code: 3
 */
export class PathSafetyError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "path_safety_error",
      message,
      exitCode: 3,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Write operation failed after validation (I/O error, permission, disk full, etc.).
 * Exit code: 1
 */
export class ProjectWriteError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_write_error",
      message,
      exitCode: 1,
      userHint,
      retryable: true,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

// ---------------------------------------------------------------------------
// M2 planner errors
// ---------------------------------------------------------------------------

/**
 * Planner provider returned an error or the request could not be completed.
 * Exit code: 1
 */
export class PlannerError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "planner_error",
      message,
      exitCode: 1,
      userHint,
      retryable: true,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Planner returned valid HTTP but invalid or unparseable JSON.
 * Exit code: 3
 */
export class PlannerOutputError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "planner_output_error",
      message,
      exitCode: 3,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Planner output parsed successfully but failed schema or relation validation.
 * Exit code: 3
 */
export class PlannerValidationError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "planner_validation_error",
      message,
      exitCode: 3,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * Project is already planned and cannot be replanned without --force.
 * Exit code: 1
 */
export class ProjectAlreadyPlannedError extends AppError {
  constructor(projectRoot: string) {
    const safeLabel = projectRoot.split("/").pop() ?? projectRoot;
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_already_planned",
      message: `Project already planned: ${safeLabel}`,
      exitCode: 1,
      userHint: "使用 --force 重新规划会丢失已有场景和审查决定",
    };
    super(params);
  }
}

export class ProjectNotPlannedError extends AppError {
  constructor(projectId: string) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_not_planned",
      message: `Project has not been planned: ${projectId}`,
      exitCode: 2,
      userHint: "先运行 s2s plan 生成场景",
    };
    super(params);
  }
}

// ---------------------------------------------------------------------------
// M4 review-server errors
// ---------------------------------------------------------------------------

/**
 * A scene with the given ID was not found in the project.
 * Exit code: 2
 *
 * The `sceneId` is included in the message for diagnostics but never includes
 * absolute paths, stack traces, or internal state.
 */
export class SceneNotFoundError extends AppError {
  constructor(sceneId: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "scene_not_found",
      message: `Scene not found: ${sceneId}`,
      exitCode: 2,
      userHint: "场景不存在，请刷新项目后重试",
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}

/**
 * The requested mutation conflicts with the current project state.
 *
 * Examples:
 * - Setting visualPlan.decision to "stock_asset" when the scene has no
 *   enabled search query.
 * - Replacing queries so that candidates reference non-existent query IDs.
 *
 * Exit code: 2
 */
export class ProjectConflictError extends AppError {
  constructor(message: string, userHint: string, cause?: Error) {
    const params: ConstructorParameters<typeof AppError>[0] = {
      code: "project_conflict",
      message,
      exitCode: 2,
      userHint,
    };
    if (cause !== undefined) params.cause = cause;
    super(params);
  }
}
