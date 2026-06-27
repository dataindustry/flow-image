import { beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishScreenshots } from "../src/tools/publish.mjs";
import { collectAnnotations } from "../src/tools/collect.mjs";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000150a0f53a0000000049454e44ae426082",
  "hex"
);

let tmp;
let deps;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "like-water-bridge-"));
  deps = {
    backend: {
      createSession: vi.fn(),
      uploadScreenshots: vi.fn(),
      readyAnnotations: vi.fn()
    },
    readFile: vi.fn(async (filePath) => readFile(filePath))
  };
  return async () => {
    await rm(tmp, { recursive: true, force: true });
  };
});

async function readFile(filePath) {
  return (await import("node:fs/promises")).readFile(filePath);
}

describe("publishScreenshots", () => {
  test("rejects missing local PNG before creating a session", async () => {
    await expect(
      publishScreenshots({ session_title: "X", screenshot_paths: ["/missing.png"] }, deps)
    ).rejects.toThrow(/missing/i);

    expect(deps.backend.createSession).not.toHaveBeenCalled();
  });

  test("creates session and uploads existing local PNGs", async () => {
    const filePath = path.join(tmp, "shot.png");
    await writeFile(filePath, png1x1);
    deps.backend.createSession.mockResolvedValue({
      session_id: "sess_1",
      session_secret: "sec_1",
      viewer_url: "https://example.test/s/sess_1?secret=sec_1"
    });
    deps.backend.uploadScreenshots.mockResolvedValue({
      count: 1,
      items: [{ screenshot_id: "shot_0001", page_index: 1, label: "Settings" }]
    });

    const result = await publishScreenshots(
      { session_title: "Settings", screenshot_paths: [filePath], labels: ["Settings"] },
      deps
    );

    expect(result.structuredContent.session_id).toBe("sess_1");
    expect(result.structuredContent.uploaded_pages).toHaveLength(1);
    expect(result.content[0].text).toContain("do not modify code");
  });
});

describe("collectAnnotations", () => {
  test("returns ready_count zero without error", async () => {
    deps.backend.readyAnnotations.mockResolvedValue({ ready_count: 0, items: [] });

    const result = await collectAnnotations({ session_id: "sess_x", session_secret: "sec_x" }, deps);

    expect(result.structuredContent.ready_count).toBe(0);
    expect(result.content[0].text).toMatch(/no ready annotations/i);
  });

  test("returns merged image content for ready annotations", async () => {
    const filePath = path.join(tmp, "merged.png");
    await writeFile(filePath, png1x1);
    deps.backend.readyAnnotations.mockResolvedValue({
      ready_count: 1,
      items: [
        {
          page_index: 1,
          screenshot_id: "shot_0001",
          merged_png_path: filePath,
          merged_png_url: "/files/sessions/sess/annotations/shot_0001-merged.png"
        }
      ]
    });

    const result = await collectAnnotations({ session_id: "sess", session_secret: "sec" }, deps);

    expect(result.content[0].text).toContain("Page 1");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: png1x1.toString("base64")
    });
    expect(result.structuredContent.ready_count).toBe(1);
  });
});
