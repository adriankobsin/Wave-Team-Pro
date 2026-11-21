import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
const { processAvatar, normalizeCrop, parseCrop, parseRotation, AvatarError } = await import("@/lib/images/avatar");

async function jpegWithGps(width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 120 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Orientation: "6" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "13/1 45/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "100/1 30/1 0/1" },
    })
    .toBuffer();
}

describe("processAvatar", () => {
  it("re-encodes to square WebP and strips EXIF including GPS", async () => {
    const input = await jpegWithGps();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();

    const out = await processAvatar({ bytes: new Uint8Array(input) });
    const full = await sharp(out.full).metadata();
    const thumb = await sharp(out.thumb).metadata();
    expect(full.format).toBe("webp");
    expect([full.width, full.height]).toEqual([512, 512]);
    expect([thumb.width, thumb.height]).toEqual([128, 128]);
    expect(full.exif).toBeUndefined();
    expect(full.xmp).toBeUndefined();
    expect(full.icc).toBeUndefined();
    expect(out.full.includes(Buffer.from("TestCam"))).toBe(false);
  });

  it("applies EXIF orientation before cropping", async () => {
    // Orientation 6 = rotate 90° CW: 800x600 becomes 600x800, so the crop side is 600.
    const out = await processAvatar({ bytes: new Uint8Array(await jpegWithGps()) });
    expect(out.width).toBe(600);
  });

  it("rejects files whose bytes are not an allowed image, whatever the name says", async () => {
    const fakePng = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    await expect(processAvatar({ bytes: fakePng })).rejects.toBeInstanceOf(AvatarError);
    const pdf = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj");
    await expect(processAvatar({ bytes: pdf })).rejects.toThrow(/JPEG, PNG or WebP/);
  });

  it("rejects empty and oversized uploads", async () => {
    await expect(processAvatar({ bytes: new Uint8Array() })).rejects.toThrow(/empty/);
    await expect(processAvatar({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) })).rejects.toThrow(/8 MB/);
  });

  it("rejects truncated image data", async () => {
    const good = await jpegWithGps();
    await expect(processAvatar({ bytes: new Uint8Array(good.subarray(0, 200)) })).rejects.toBeInstanceOf(AvatarError);
  });
});

describe("crop helpers", () => {
  it("centers a default square", () => {
    expect(normalizeCrop(null, 800, 600)).toEqual({ left: 100, top: 0, width: 600, height: 600 });
  });
  it("clamps crops inside the image", () => {
    expect(normalizeCrop({ x: 0.9, y: 0.9, size: 0.5 }, 1000, 1000)).toEqual({ left: 500, top: 500, width: 500, height: 500 });
  });
  it("parses only well-formed crop JSON", () => {
    expect(parseCrop('{"x":0.1,"y":0.2,"size":0.5}')).toEqual({ x: 0.1, y: 0.2, size: 0.5 });
    expect(parseCrop('{"x":-1,"y":0,"size":1}')).toBeNull();
    expect(parseCrop("not json")).toBeNull();
    expect(parseCrop('{"x":0,"y":0,"size":0}')).toBeNull();
  });
  it("only accepts right-angle rotations", () => {
    expect(parseRotation("90")).toBe(90);
    expect(parseRotation("45")).toBe(0);
    expect(parseRotation(null)).toBe(0);
  });
});
