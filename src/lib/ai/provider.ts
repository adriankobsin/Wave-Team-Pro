import "server-only";
import { RECEIPT_INSTRUCTIONS, receiptExtraction, receiptJsonSchema, type ReceiptExtraction } from "./receipt-schema";

export type AiConfig = { provider: "anthropic" | "openai"; apiKey: string; model: string; baseUrl?: string };

/** Reads the adapter configuration. Returns null when automatic reading is off (manual entry only). */
export function aiConfig(): AiConfig | null {
  const provider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if ((provider !== "anthropic" && provider !== "openai") || !apiKey || !model) return null;
  return { provider, apiKey, model, baseUrl: process.env.AI_BASE_URL?.trim() || undefined };
}

export function aiProviderLabel(): string | null {
  const c = aiConfig();
  return c ? (c.provider === "anthropic" ? "Anthropic" : "OpenAI") : null;
}

export class ExtractionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export type ExtractionOutcome = { data: ReceiptExtraction; usage?: { input?: number; output?: number }; ms: number };

const TIMEOUT_MS = 60_000;

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ExtractionError(`Provider returned HTTP ${res.status}`, retryable);
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    throw new ExtractionError(ctrl.signal.aborted ? "Provider timed out" : "Provider could not be reached", true);
  } finally {
    clearTimeout(t);
  }
}

function validate(raw: unknown): ReceiptExtraction {
  const parsed = receiptExtraction.safeParse(raw);
  if (!parsed.success) throw new ExtractionError("The reading didn't match the expected format", false);
  return parsed.data;
}

/**
 * Sends one receipt (image or PDF) to the configured provider and returns a validated reading.
 * Only the file bytes and fixed instructions are sent; no employee data.
 */
export async function extractReceipt(cfg: AiConfig, file: { bytes: Buffer; mime: string }): Promise<ExtractionOutcome> {
  const started = Date.now();
  const b64 = file.bytes.toString("base64");
  const schema = receiptJsonSchema();

  if (cfg.provider === "anthropic") {
    const media =
      file.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: file.mime, data: b64 } };
    const json = await post(`${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }, {
      model: cfg.model,
      max_tokens: 4096,
      system: RECEIPT_INSTRUCTIONS,
      tools: [{ name: "record_receipt", description: "Record the fields read from the receipt.", input_schema: schema }],
      tool_choice: { type: "tool", name: "record_receipt" },
      messages: [{ role: "user", content: [media, { type: "text", text: "Read this receipt." }] }],
    });
    const content = (json.content as { type: string; name?: string; input?: unknown }[] | undefined) ?? [];
    const call = content.find((c) => c.type === "tool_use" && c.name === "record_receipt");
    if (!call) throw new ExtractionError("No structured reading was returned", false);
    const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return { data: validate(call.input), usage: { input: usage?.input_tokens, output: usage?.output_tokens }, ms: Date.now() - started };
  }

  // OpenAI-compatible chat completions with function calling. PDFs are sent as file input.
  const part =
    file.mime === "application/pdf"
      ? { type: "file", file: { filename: "receipt.pdf", file_data: `data:application/pdf;base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${file.mime};base64,${b64}` } };
  const json = await post(`${cfg.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`, { authorization: `Bearer ${cfg.apiKey}` }, {
    model: cfg.model,
    messages: [
      { role: "system", content: RECEIPT_INSTRUCTIONS },
      { role: "user", content: [part, { type: "text", text: "Read this receipt." }] },
    ],
    tools: [{ type: "function", function: { name: "record_receipt", description: "Record the fields read from the receipt.", parameters: schema } }],
    tool_choice: { type: "function", function: { name: "record_receipt" } },
  });
  const choice = (json.choices as { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] | undefined)?.[0];
  const args = choice?.message?.tool_calls?.find((c) => c.function?.name === "record_receipt")?.function?.arguments;
  if (!args) throw new ExtractionError("No structured reading was returned", false);
  let raw: unknown;
  try {
    raw = JSON.parse(args);
  } catch {
    throw new ExtractionError("The reading was not valid JSON", false);
  }
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return { data: validate(raw), usage: { input: usage?.prompt_tokens, output: usage?.completion_tokens }, ms: Date.now() - started };
}
