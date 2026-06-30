import { beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  flowImagePublish,
  flowImageRepublish,
  publishScreenshots
} from "../src/tools/publish.mjs";
import { collectAnnotations, flowImageSync } from "../src/tools/collect.mjs";
import { preprocessScreenshots } from "../src/image-preprocess.mjs";
import {
  readFlowImageSession,
  rememberFlowImageSession,
  resolveFlowImageConfig
} from "../src/flowimage-config.mjs";
import { createBlankPng, parsePngMeta } from "../../backend/src/lib/png.mjs";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000150a0f53a0000000049454e44ae426082",
  "hex"
);

let tmp;
let deps;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "flow-image-bridge-"));
  deps = {
    backend: {
      createSession: vi.fn(),
      resolveOwnerSession: vi.fn(),
      uploadScreenshots: vi.fn(),
      collectAnnotations: vi.fn(),
      fetchAnnotationImage: vi.fn()
    },
    sessionRegistry: {
      remember: vi.fn(),
      read: vi.fn(),
      latest: vi.fn()
    }
  };
  return async () => {
    await rm(tmp, { recursive: true, force: true });
  };
});

describe("flow image config", () => {
  test("loads server URL from FLOWIMAGE_CONFIG_PATH when env values are absent", async () => {
    const configPath = path.join(tmp, "flowimage-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        server_url: "https://custom.example"
      })
    );

    const config = resolveFlowImageConfig({ FLOWIMAGE_CONFIG_PATH: configPath });

    expect(config).toMatchObject({
      serverUrl: "https://custom.example",
      configPath
    });
  });

  test("environment values override config file values", async () => {
    const configPath = path.join(tmp, "flowimage-config-env.json");
    await writeFile(
      configPath,
      JSON.stringify({
        server_url: "https://file.example"
      })
    );

    const config = resolveFlowImageConfig({
      FLOWIMAGE_CONFIG_PATH: configPath,
      FLOWIMAGE_SERVER_URL: "https://env.example"
    });

    expect(config).toMatchObject({
      serverUrl: "https://env.example"
    });
  });

  test("blank environment values do not override config file values", async () => {
    const configPath = path.join(tmp, "flowimage-config-blank-env.json");
    await writeFile(
      configPath,
      JSON.stringify({
        server_url: "https://file.example"
      })
    );

    const config = resolveFlowImageConfig({
      FLOWIMAGE_CONFIG_PATH: configPath,
      FLOWIMAGE_SERVER_URL: ""
    });

    expect(config).toMatchObject({
      serverUrl: "https://file.example"
    });
  });

  test("stores remembered owner sessions in a user-only config file", async () => {
    const configPath = path.join(tmp, "secure-config.json");

    rememberFlowImageSession(
      {
        sessionId: "sess_1",
        ownerToken: "own_1",
        viewUrl: "https://example.test/v/viewtoken12",
        editUrl: "https://example.test/e/edittoken12",
        ownerUrl: "https://example.test/o/owntoken123"
      },
      { FLOWIMAGE_CONFIG_PATH: configPath }
    );

    expect(readFlowImageSession("sess_1", { FLOWIMAGE_CONFIG_PATH: configPath })).toMatchObject({
      sessionId: "sess_1",
      ownerToken: "own_1",
      ownerUrl: "https://example.test/o/owntoken123"
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });
});

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
      view_url: "https://example.test/v/viewtoken12",
      edit_url: "https://example.test/e/edittoken12",
      owner_url: "https://example.test/o/owntoken123",
      owner_token: "own_1"
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
    expect(deps.backend.uploadScreenshots).toHaveBeenCalledWith(
      "sess_1",
      [filePath],
      ["Settings"],
      "own_1"
    );
    expect(deps.sessionRegistry.remember).toHaveBeenCalledWith({
      sessionId: "sess_1",
      ownerToken: "own_1",
      viewUrl: "https://example.test/v/viewtoken12",
      editUrl: "https://example.test/e/edittoken12",
      ownerUrl: "https://example.test/o/owntoken123"
    });
    expect(result.structuredContent.uploaded_pages).toHaveLength(1);
    expect(result.structuredContent.view_url).toBe("https://example.test/v/viewtoken12");
    expect(result.structuredContent.edit_url).toBe("https://example.test/e/edittoken12");
    expect(result.structuredContent.owner_url).toBe("https://example.test/o/owntoken123");
    expect(result.structuredContent.owner_token).toBeUndefined();
    expect(result.structuredContent.viewer_url).toBeUndefined();
    expect(result.content[0].text).toContain("不要修改代码");
  });

  test("supports link sessions without a session secret", async () => {
    const filePath = path.join(tmp, "shot.png");
    await writeFile(filePath, png1x1);
    deps.backend.createSession.mockResolvedValue({
      session_id: "sess_link",
      view_url: "https://flow-image.liujinhang.com/v/viewtoken12",
      edit_url: "https://flow-image.liujinhang.com/e/edittoken12",
      owner_url: "https://flow-image.liujinhang.com/o/owntoken123",
      owner_token: "own_link",
      status: "pending_annotation"
    });
    deps.backend.uploadScreenshots.mockResolvedValue({
      count: 1,
      items: [{ screenshot_id: "shot_0001", page_index: 1, label: "Settings" }]
    });

    const result = await publishScreenshots(
      { session_title: "Settings", screenshot_paths: [filePath] },
      deps
    );

    expect(deps.backend.uploadScreenshots).toHaveBeenCalledWith(
      "sess_link",
      [filePath],
      [],
      "own_link"
    );
    expect(result.structuredContent.session_secret).toBeUndefined();
    expect(result.content[0].text).toContain("Edit Link");
  });

  test("flow_image_publish creates a new session and uploads four screenshots in one request", async () => {
    const filePaths = [];
    for (let index = 0; index < 4; index += 1) {
      const filePath = path.join(tmp, `shot-${index}.png`);
      await writeFile(filePath, png1x1);
      filePaths.push(filePath);
    }
    deps.backend.createSession.mockResolvedValue({
      session_id: "sess_new",
      view_url: "https://example.test/v/viewtoken12",
      edit_url: "https://example.test/e/edittoken12",
      owner_url: "https://example.test/o/owntoken123",
      owner_token: "owntoken123"
    });
    deps.backend.uploadScreenshots.mockResolvedValue({
      count: 4,
      items: filePaths.map((_, index) => ({
        screenshot_id: `shot_${String(index + 1).padStart(4, "0")}`,
        page_index: index + 1,
        label: `Page ${index + 1}`
      }))
    });

    const result = await flowImagePublish({
      session_title: "Four pages",
      screenshot_paths: filePaths
    }, deps);

    expect(deps.backend.createSession).toHaveBeenCalledTimes(1);
    expect(deps.backend.uploadScreenshots).toHaveBeenCalledTimes(1);
    expect(deps.backend.uploadScreenshots.mock.calls[0][0]).toBe("sess_new");
    expect(deps.backend.uploadScreenshots.mock.calls[0][1]).toHaveLength(4);
    expect(result.structuredContent.owner_url).toBe("https://example.test/o/owntoken123");
  });

  test("flow_image_republish requires an owner URL and does not create a new session", async () => {
    const filePath = path.join(tmp, "replacement.png");
    await writeFile(filePath, png1x1);
    deps.backend.resolveOwnerSession.mockResolvedValue({
      session_id: "sess_existing",
      view_url: "https://example.test/v/viewtoken12",
      edit_url: "https://example.test/e/edittoken12",
      owner_url: "https://example.test/o/owntoken123",
      owner_token: "owntoken123"
    });
    deps.backend.uploadScreenshots.mockResolvedValue({
      count: 1,
      items: [{ screenshot_id: "shot_0001", page_index: 1, label: "" }]
    });

    await expect(
      flowImageRepublish({ screenshot_paths: [filePath] }, deps)
    ).rejects.toThrow(/owner_url/i);

    const result = await flowImageRepublish({
      owner_url: "https://example.test/o/owntoken123",
      screenshot_paths: [filePath]
    }, deps);

    expect(deps.backend.createSession).not.toHaveBeenCalled();
    expect(deps.backend.resolveOwnerSession).toHaveBeenCalledWith("https://example.test/o/owntoken123");
    expect(deps.backend.uploadScreenshots).toHaveBeenCalledWith(
      "sess_existing",
      [filePath],
      [],
      "owntoken123",
      { replace: true }
    );
    expect(result.structuredContent.session_id).toBe("sess_existing");
  });
});

describe("screenshot preprocessing", () => {
  test("resizes large PNGs without changing aspect ratio", async () => {
    const originalPath = path.join(tmp, "wide.png");
    await writeFile(originalPath, createBlankPng(384, 216));

    const processed = await preprocessScreenshots([originalPath], {
      maxDimension: 192,
      tempDir: tmp
    });
    try {
      const resized = await readFile(processed.paths[0]);
      expect(parsePngMeta(resized)).toEqual({ width: 192, height: 108 });
    } finally {
      await processed.cleanup();
    }
  });

  test("does not enlarge small PNGs", async () => {
    const originalPath = path.join(tmp, "small.png");
    await writeFile(originalPath, createBlankPng(10, 6));

    const processed = await preprocessScreenshots([originalPath], {
      maxDimension: 192,
      tempDir: tmp
    });

    expect(processed.paths[0]).toBe(originalPath);
    await processed.cleanup();
  });
});

describe("collectAnnotations", () => {
  test("returns ready_count zero without error", async () => {
    deps.sessionRegistry.read.mockReturnValue({
      sessionId: "sess_x",
      ownerToken: "own_x"
    });
    deps.backend.collectAnnotations.mockResolvedValue({ ready_count: 0, items: [] });

    const result = await collectAnnotations({ session_id: "sess_x" }, deps);

    expect(result.structuredContent.ready_count).toBe(0);
    expect(result.content[0].text).toContain("当前没有可收取的 FlowImage 结果");
  });

  test("fetches merged image content from authenticated annotation URLs", async () => {
    deps.sessionRegistry.read.mockReturnValue({
      sessionId: "sess",
      ownerToken: "own_1"
    });
    deps.backend.collectAnnotations.mockResolvedValue({
      ready_count: 1,
      items: [
        {
          page_index: 1,
          screenshot_id: "shot_0001",
          merged_png_url: "/files/sessions/sess/annotations/shot_0001-merged.png"
        }
      ]
    });
    deps.backend.fetchAnnotationImage.mockResolvedValue(png1x1);

    const result = await collectAnnotations({ session_id: "sess" }, deps);

    expect(deps.backend.collectAnnotations).toHaveBeenCalledWith("sess", "own_1");
    expect(deps.backend.fetchAnnotationImage).toHaveBeenCalledWith(
      "/files/sessions/sess/annotations/shot_0001-merged.png",
      "own_1"
    );
    expect(result.content[0].text).toContain("第 1 页");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: png1x1.toString("base64")
    });
    expect(result.structuredContent.ready_count).toBe(1);
  });

  test("collects latest remembered link-mode session for review when session id is omitted", async () => {
    deps.sessionRegistry.latest.mockReturnValue({
      sessionId: "sess_latest",
      ownerToken: "own_latest",
      viewUrl: "https://flow-image.liujinhang.com/v/viewlatest12"
    });
    deps.backend.collectAnnotations.mockResolvedValue({
      session_id: "sess_latest",
      ready_count: 1,
      review_url: "https://flow-image.liujinhang.com/s/sess_latest",
      items: [
        {
          page_index: 1,
          merged_png_url: "/files/sessions/sess_latest/annotations/shot_0001-merged.png"
        }
      ]
    });
    deps.backend.fetchAnnotationImage.mockResolvedValue(png1x1);

    const result = await collectAnnotations({}, deps);

    expect(deps.backend.collectAnnotations).toHaveBeenCalledWith("sess_latest", "own_latest");
    expect(result.content[0].text).toContain("请先目视检查");
    expect(result.content[0].text).toContain("https://flow-image.liujinhang.com/v/viewlatest12");
    expect(result.content[0].text).toContain("结果图");
    expect(result.content[0].text).not.toContain("标注图");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: png1x1.toString("base64")
    });
  });

  test("flow_image_sync pulls the latest remembered owner session", async () => {
    deps.sessionRegistry.latest.mockReturnValue({
      sessionId: "sess_latest",
      ownerToken: "own_latest",
      viewUrl: "https://example.test/v/viewlatest12"
    });
    deps.backend.collectAnnotations.mockResolvedValue({
      session_id: "sess_latest",
      ready_count: 0,
      items: []
    });

    const result = await flowImageSync({}, deps);

    expect(deps.backend.collectAnnotations).toHaveBeenCalledWith("sess_latest", "own_latest");
    expect(result.structuredContent.session_id).toBe("sess_latest");
  });

  test("explains missing owner token instead of using pair code fallback", async () => {
    deps.sessionRegistry.read.mockReturnValue(null);

    await expect(collectAnnotations({ session_id: "sess_missing" }, deps)).rejects.toThrow(
      /owner token/i
    );
  });
});
