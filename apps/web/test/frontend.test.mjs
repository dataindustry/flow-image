import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  mapPointToNative,
  computeStrokeWidth,
  savePairState,
  readPairState,
  setSafeText,
  fetchImageObjectUrl
} from "../public/app.js";

describe("canvas helpers", () => {
  test("maps CSS pointer coordinates to native screenshot pixels", () => {
    expect(
      mapPointToNative(
        { x: 50, y: 25 },
        { cssWidth: 100, cssHeight: 50, imageWidth: 200, imageHeight: 100 }
      )
    ).toEqual({ x: 100, y: 50 });
  });

  test("computes pressure-adjusted pen width", () => {
    expect(computeStrokeWidth({ pointerType: "pen", pressure: 1 }, 4)).toBeCloseTo(7.2);
    expect(computeStrokeWidth({ pointerType: "mouse", pressure: 0 }, 4)).toBeCloseTo(4.8);
  });
});

describe("styles", () => {
  test("disables browser touch gestures on drawing canvas", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");
    expect(css).toMatch(/touch-action:\s*none/);
  });
});

describe("pair helpers", () => {
  test("stores and reads pair state from localStorage-compatible storage", () => {
    const storage = new Map();
    const adapter = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    };

    savePairState(adapter, {
      pair_id: "pair_1",
      pair_device_token: "pdevtok_1"
    });

    expect(readPairState(adapter)).toEqual({
      pair_id: "pair_1",
      pair_device_token: "pdevtok_1"
    });
  });

  test("renders untrusted values with textContent", () => {
    const node = { textContent: "", innerHTML: "" };

    setSafeText(node, "<img src=x onerror=alert(1)>");

    expect(node.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(node.innerHTML).toBe("");
  });

  test("fetches image blobs with pair device token header", async () => {
    const calls = [];
    const objectUrl = await fetchImageObjectUrl(
      "/files/sessions/sess/screenshots/shot_0001.png",
      "pdevtok_1",
      async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          blob: async () => new Blob(["png"], { type: "image/png" })
        };
      },
      { createObjectURL: () => "blob:shot" }
    );

    expect(objectUrl).toBe("blob:shot");
    expect(calls[0]).toEqual({
      url: "/files/sessions/sess/screenshots/shot_0001.png",
      options: { headers: { "X-Pair-Device-Token": "pdevtok_1" } }
    });
  });
});
