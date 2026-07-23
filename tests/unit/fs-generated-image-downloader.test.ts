import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FsGeneratedImageDownloader } from "../../src/infrastructure/fs-generated-image-downloader.js";

const roots: string[] = [];
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-generated-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("FsGeneratedImageDownloader", () => {
  it("saves a validated image with an extension derived from its bytes", async () => {
    const root = await makeRoot();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(PNG, {
        headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) },
      }),
    );
    const downloader = new FsGeneratedImageDownloader({
      fetchImpl,
      resolveHostname: () => Promise.resolve(["203.0.113.10"]),
    });

    const url = await downloader.download(
      root,
      "https://cdn.example.com/file-without-extension",
      "candidate-1",
      3210,
    );

    expect(url).toBe("http://127.0.0.1:3210/api/project-assets/generated/candidate-1.png");
    await expect(fs.readFile(path.join(root, "assets/generated/candidate-1.png"))).resolves.toEqual(
      Buffer.from(PNG),
    );
  });

  it.each([
    "http://cdn.example.com/image.png",
    "https://127.0.0.1/image.png",
    "https://localhost/image.png",
    "https://[::1]/image.png",
  ])("rejects unsafe image URL %s", async (imageUrl) => {
    const root = await makeRoot();
    const fetchImpl = vi.fn();
    const downloader = new FsGeneratedImageDownloader({
      fetchImpl,
      resolveHostname: () => Promise.resolve(["203.0.113.10"]),
    });

    await expect(downloader.download(root, imageUrl, "id", 3210)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to a private address", async () => {
    const root = await makeRoot();
    const fetchImpl = vi.fn();
    const downloader = new FsGeneratedImageDownloader({
      fetchImpl,
      resolveHostname: () => Promise.resolve(["10.0.0.5"]),
    });

    await expect(
      downloader.download(root, "https://cdn.example.com/image.png", "id", 3210),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized, non-image, and signature-mismatched responses without writing", async () => {
    const root = await makeRoot();
    const responses = [
      new Response(PNG, {
        headers: { "content-type": "image/png", "content-length": "20000000" },
      }),
      new Response("hello", { headers: { "content-type": "text/plain" } }),
      new Response("not png", { headers: { "content-type": "image/png" } }),
    ];
    const downloader = new FsGeneratedImageDownloader({
      fetchImpl: vi.fn().mockImplementation(() => Promise.resolve(responses.shift()!)),
      resolveHostname: () => Promise.resolve(["203.0.113.10"]),
    });

    for (const id of ["large", "text", "mismatch"]) {
      await expect(
        downloader.download(root, "https://cdn.example.com/image", id, 3210),
      ).rejects.toThrow();
    }
    await expect(fs.readdir(path.join(root, "assets/generated"))).rejects.toThrow();
  });
});
