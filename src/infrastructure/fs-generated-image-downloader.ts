/**
 * Filesystem implementation of GeneratedImageDownloader.
 *
 * Downloads a generated image from a remote URL and saves it to the
 * project's assets/generated/ directory.
 *
 * Returns a locally-served URL (http://127.0.0.1:{port}/api/project-assets/generated/{filename}).
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { GeneratedImageDownloader } from "../application/ports/generated-image-downloader.js";
import { InvalidArgumentError } from "../shared/errors.js";

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

function getExtensionFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  if ((SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) return ext;
  return ".png";
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "image";
}

export class FsGeneratedImageDownloader implements GeneratedImageDownloader {
  async download(
    projectRoot: string,
    imageUrl: string,
    candidateId: string,
    port: number,
  ): Promise<string> {
    const assetsDir = path.join(projectRoot, "assets", "generated");
    await fs.mkdir(assetsDir, { recursive: true });

    const ext = getExtensionFromUrl(imageUrl);
    const safeId = sanitizeId(candidateId);
    const fileName = `${safeId}${ext}`;
    const filePath = path.join(assetsDir, fileName);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new InvalidArgumentError(
        `Failed to download generated image: HTTP ${response.status}`,
        "下载生成图片失败，请重试",
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    return `http://127.0.0.1:${port}/api/project-assets/generated/${fileName}`;
  }
}
