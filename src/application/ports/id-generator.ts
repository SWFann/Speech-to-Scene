/**
 * ID generator port.
 *
 * Abstraction over unique ID generation. Production uses `crypto.randomUUID`;
 * tests use fixed sequences.
 */

export interface IdGenerator {
  /**
   * Generates a new project ID.
   * Format: "project-<uuid>" in production.
   */
  projectId(): string;

  /**
   * Generates a temporary ID for sentinel files and temp resources.
   * Format: "tmp-<uuid>" in production.
   */
  temporaryId(): string;

  /**
   * Generates a new scene ID.
   * Format: "scene-<uuid>" in production.
   */
  sceneId(): string;
}
