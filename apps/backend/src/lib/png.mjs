const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");

export function parsePngMeta(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) {
    const error = new Error("invalid_png");
    error.status = 415;
    throw error;
  }
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    const error = new Error("invalid_png");
    error.status = 415;
    throw error;
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    const error = new Error("invalid_png");
    error.status = 415;
    throw error;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}
