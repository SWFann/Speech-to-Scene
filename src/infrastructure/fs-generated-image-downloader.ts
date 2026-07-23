/**
 * Persists a provider-generated image after validating its network target,
 * response size, media type, and file signature.
 */

import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { GeneratedImageDownloader } from "../application/ports/generated-image-downloader.js";
import { InvalidArgumentError } from "../shared/errors.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;

type SupportedImage = {
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  readonly extension: ".png" | ".jpg" | ".webp";
};

interface DownloaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "image";
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (!net.isIPv6(normalized)) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

function detectImage(bytes: Uint8Array): SupportedImage | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: ".png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: ".jpg" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: ".webp" };
  }
  return null;
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new InvalidArgumentError("Generated image is too large", "图片超过 15 MiB 限制");
  }
  if (!response.body) {
    throw new InvalidArgumentError("Generated image response has no body", "图片响应为空");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new InvalidArgumentError("Generated image is too large", "图片超过 15 MiB 限制");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export class FsGeneratedImageDownloader implements GeneratedImageDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHostname: (hostname: string) => Promise<readonly string[]>;

  constructor(options: DownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHostname =
      options.resolveHostname ??
      (async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address));
  }

  private async assertSafeUrl(value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new InvalidArgumentError("Invalid generated image URL", "图片地址无效");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      throw new InvalidArgumentError("Unsafe generated image URL", "图片地址必须是标准 HTTPS 地址");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (hostname.toLowerCase() === "localhost" || hostname.toLowerCase().endsWith(".localhost")) {
      throw new InvalidArgumentError("Generated image URL resolves locally", "图片地址不安全");
    }
    const addresses = net.isIP(hostname) ? [hostname] : await this.resolveHostname(hostname);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new InvalidArgumentError("Generated image URL resolves locally", "图片地址不安全");
    }
    return url;
  }

  private async fetchImage(initialUrl: string): Promise<Response> {
    let url = await this.assertSafeUrl(initialUrl);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await this.fetchImpl(url, { redirect: "manual" });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new InvalidArgumentError("Too many image redirects", "图片下载重定向失败");
      }
      url = await this.assertSafeUrl(new URL(location, url).toString());
    }
    throw new InvalidArgumentError("Image download failed", "图片下载失败");
  }

  async download(
    projectRoot: string,
    imageUrl: string,
    candidateId: string,
    port: number,
  ): Promise<string> {
    const response = await this.fetchImage(imageUrl);
    if (!response.ok) {
      throw new InvalidArgumentError(
        `Failed to download generated image: HTTP ${response.status}`,
        "下载生成图片失败，请重试",
      );
    }

    const buffer = await readLimitedBody(response);
    const detected = detectImage(buffer);
    const declaredType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!detected || declaredType !== detected.contentType) {
      throw new InvalidArgumentError(
        "Generated image type does not match its content",
        "图片格式无效或与响应类型不一致",
      );
    }

    const assetsDir = path.join(projectRoot, "assets", "generated");
    await fs.mkdir(assetsDir, { recursive: true });
    const fileName = `${sanitizeId(candidateId)}${detected.extension}`;
    await fs.writeFile(path.join(assetsDir, fileName), buffer, { flag: "wx" });

    return `http://127.0.0.1:${port}/api/project-assets/generated/${fileName}`;
  }
}
