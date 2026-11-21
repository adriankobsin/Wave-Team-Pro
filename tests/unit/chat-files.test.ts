import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const { resolveMentions } = await import("@/server/services/chat");
const { validateUpload, safeFileName, UploadError } = await import("@/lib/files/validate");

const people = [
  { userId: "a", name: "Ana Popescu" },
  { userId: "b", name: "Bob Tanaka" },
  { userId: "c", name: "Bobby Lee" },
];

describe("resolveMentions", () => {
  it("matches first names and full names, not prefixes", () => {
    expect(resolveMentions("hey @ana can you check", people)).toEqual(["a"]);
    expect(resolveMentions("@Bob Tanaka and @bobby", people).sort()).toEqual(["b", "c"]);
    expect(resolveMentions("@bobcat is not a person", people)).toEqual([]);
    expect(resolveMentions("email bob@example.com", people)).toEqual([]);
  });
});

describe("validateUpload", () => {
  const file = (bytes: Uint8Array | Buffer, name: string, type = "application/octet-stream") => new File([new Uint8Array(bytes)], name, { type });

  it("accepts a real PDF regardless of the claimed name", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const v = await validateUpload(file(pdf, "invoice.exe"));
    expect(v.mime).toBe("application/pdf");
    expect(v.fileName).toBe("invoice.pdf");
    expect(v.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("re-encodes images and drops EXIF", async () => {
    const jpg = await sharp({ create: { width: 50, height: 40, channels: 3, background: "#123456" } }).jpeg().withExif({ IFD0: { Make: "Spy" } }).toBuffer();
    const v = await validateUpload(file(jpg, "photo.jpg", "image/jpeg"));
    expect(v.isImage).toBe(true);
    expect((await sharp(v.bytes).metadata()).exif).toBeUndefined();
  });

  it("rejects disguised HTML and executables", async () => {
    await expect(validateUpload(file(Buffer.from("<html><script>alert(1)</script>"), "x.pdf"))).rejects.toBeInstanceOf(UploadError);
    await expect(validateUpload(file(Buffer.from("MZ\x90\x00\x03"), "report.txt"))).rejects.toBeInstanceOf(UploadError);
    await expect(validateUpload(file(Buffer.from("<svg onload=alert(1)>"), "logo.svg"))).rejects.toBeInstanceOf(UploadError);
  });

  it("accepts plain text and CSV by extension only when the bytes are text", async () => {
    const v = await validateUpload(file(Buffer.from("a,b\n1,2\n"), "data.csv"));
    expect(v.mime).toBe("text/csv");
  });

  it("only allows images or PDF for receipts", async () => {
    await expect(validateUpload(file(Buffer.from("a,b\n"), "r.csv"), "image-or-pdf")).rejects.toThrow(/photo|PDF/);
  });

  it("sanitises file names", () => {
    expect(safeFileName("../../etc/passwd", "txt")).toBe("passwd.txt");
    expect(safeFileName("Report <Q3>.final.docx", "docx")).toBe("Report _Q3_.final.docx");
    expect(safeFileName("", "pdf")).toBe("file.pdf");
  });
});
