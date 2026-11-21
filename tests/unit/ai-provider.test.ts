import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { extractReceipt, ExtractionError } = await import("@/lib/ai/provider");

const toolInput = {
  is_receipt: true, merchant: { value: "ChaCha Denia", confidence: "high" }, date: { value: "2026-04-04", confidence: "high" },
  reference: { value: null, confidence: "unreadable" }, tax_number: { value: null, confidence: "unreadable" },
  currency: { value: "EUR", confidence: "medium" }, subtotal: { value: 50.91, confidence: "high" }, discount: { value: null, confidence: "unreadable" },
  tax_lines: [{ label: "BTW", rate: 10, amount: 5.09 }], tip: { value: null, confidence: "unreadable" }, total: { value: 56, confidence: "high" },
  payment_hint: { value: null, confidence: "unreadable" }, language: "nl", line_items: [{ description: "Menu", quantity: 3, amount: 43.5 }],
  notes: null, document_type: "receipt", country: "ES", card_last4: null, other_receipts: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("receipt provider adapter", () => {
  it("sends a PDF as a document with a forced tool call and validates the answer (Anthropic)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_receipt", input: toolInput }], usage: { input_tokens: 1200, output_tokens: 300 } })));
    vi.stubGlobal("fetch", fetchMock);
    const out = await extractReceipt({ provider: "anthropic", apiKey: "test-key", model: "test-model" }, { bytes: Buffer.from("%PDF-1.4"), mime: "application/pdf" });
    expect(out.data.total.value).toBe(56);
    expect(out.data.country).toBe("ES");
    expect(out.usage).toEqual({ input: 1200, output: 300 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_receipt" });
    expect(body.messages[0].content[0].type).toBe("document");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
  });

  it("parses OpenAI-compatible function calls for images", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "record_receipt", arguments: JSON.stringify(toolInput) } }] } }] }))));
    const out = await extractReceipt({ provider: "openai", apiKey: "k", model: "m" }, { bytes: Buffer.from([0xff, 0xd8]), mime: "image/jpeg" });
    expect(out.data.merchant.value).toBe("ChaCha Denia");
  });

  it("classifies failures for retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })));
    await expect(extractReceipt({ provider: "anthropic", apiKey: "k", model: "m" }, { bytes: Buffer.from("x"), mime: "image/png" })).rejects.toMatchObject({ retryable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    await expect(extractReceipt({ provider: "anthropic", apiKey: "k", model: "m" }, { bytes: Buffer.from("x"), mime: "image/png" })).rejects.toMatchObject({ retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_receipt", input: { ...toolInput, total: { value: -5, confidence: "high" } } }] }))));
    await expect(extractReceipt({ provider: "anthropic", apiKey: "k", model: "m" }, { bytes: Buffer.from("x"), mime: "image/png" })).rejects.toBeInstanceOf(ExtractionError);
  });
});
