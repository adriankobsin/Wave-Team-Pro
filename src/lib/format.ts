export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Formats an amount in its own currency; never mixes currencies. */
export function formatMoney(amount: number | string | null | undefined, currency: string) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function formatHours(h: number | string) {
  const n = Number(h);
  return `${n.toFixed(n % 1 === 0 ? 0 : 2).replace(/0$/, "")} h`;
}
