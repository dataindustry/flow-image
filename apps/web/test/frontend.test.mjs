import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mapPointToNative, computeStrokeWidth } from "../public/app.js";

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
