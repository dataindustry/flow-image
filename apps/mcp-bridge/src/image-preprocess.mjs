import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

const DEFAULT_MAX_DIMENSION = 1920;

export async function preprocessScreenshots(paths, options = {}) {
  const enabled = options.enabled ?? envEnabled(process.env.FLOWIMAGE_PUBLISH_COMPRESS, true);
  const maxDimension = Number(
    options.maxDimension ?? process.env.FLOWIMAGE_PUBLISH_MAX_DIMENSION ?? DEFAULT_MAX_DIMENSION
  );
  if (!enabled || !Number.isFinite(maxDimension) || maxDimension <= 0) {
    return { paths, cleanup: async () => {} };
  }

  const tempDir =
    options.tempDir ?? await mkdtemp(path.join(os.tmpdir(), "flowimage-publish-"));
  const ownsTempDir = !options.tempDir;
  const outputPaths = [];
  const cleanupPaths = [];

  for (const inputPath of paths) {
    const original = await readFile(inputPath);
    const image = readPngOrNull(original);
    if (!image) {
      outputPaths.push(inputPath);
      continue;
    }
    const resized = resizeIfNeeded(image, maxDimension);
    if (!resized) {
      outputPaths.push(inputPath);
      continue;
    }

    const encoded = PNG.sync.write(resized, {
      colorType: 6,
      inputColorType: 6,
      deflateLevel: 9
    });
    if (encoded.length >= original.length) {
      outputPaths.push(inputPath);
      continue;
    }

    const outputPath = path.join(
      tempDir,
      `${path.basename(inputPath, path.extname(inputPath))}-${randomUUID()}.png`
    );
    await writeFile(outputPath, encoded);
    cleanupPaths.push(outputPath);
    outputPaths.push(outputPath);
  }

  return {
    paths: outputPaths,
    cleanup: async () => {
      if (ownsTempDir) {
        await rm(tempDir, { recursive: true, force: true });
        return;
      }
      await Promise.all(cleanupPaths.map((filePath) => rm(filePath, { force: true })));
    }
  };
}

function readPngOrNull(buffer) {
  try {
    return PNG.sync.read(buffer);
  } catch {
    return null;
  }
}

function resizeIfNeeded(image, maxDimension) {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxDimension) return null;

  const scale = maxDimension / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const output = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      output.data[targetOffset] = image.data[sourceOffset];
      output.data[targetOffset + 1] = image.data[sourceOffset + 1];
      output.data[targetOffset + 2] = image.data[sourceOffset + 2];
      output.data[targetOffset + 3] = image.data[sourceOffset + 3];
    }
  }
  return output;
}

function envEnabled(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}
