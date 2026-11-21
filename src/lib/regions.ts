/** Countries offered when setting up a company, with their usual currency and time zone. */
export const COUNTRIES = [
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London", tax: "VAT" },
  { code: "ES", name: "Spain", currency: "EUR", timezone: "Europe/Madrid", tax: "IVA" },
  { code: "FR", name: "France", currency: "EUR", timezone: "Europe/Paris", tax: "TVA" },
  { code: "MC", name: "Monaco", currency: "EUR", timezone: "Europe/Monaco", tax: "TVA" },
  { code: "IT", name: "Italy", currency: "EUR", timezone: "Europe/Rome", tax: "IVA" },
  { code: "DE", name: "Germany", currency: "EUR", timezone: "Europe/Berlin", tax: "MwSt" },
  { code: "NL", name: "Netherlands", currency: "EUR", timezone: "Europe/Amsterdam", tax: "BTW" },
  { code: "BE", name: "Belgium", currency: "EUR", timezone: "Europe/Brussels", tax: "BTW/TVA" },
  { code: "PT", name: "Portugal", currency: "EUR", timezone: "Europe/Lisbon", tax: "IVA" },
  { code: "IE", name: "Ireland", currency: "EUR", timezone: "Europe/Dublin", tax: "VAT" },
  { code: "HR", name: "Croatia", currency: "EUR", timezone: "Europe/Zagreb", tax: "PDV" },
  { code: "GR", name: "Greece", currency: "EUR", timezone: "Europe/Athens", tax: "ΦΠΑ" },
  { code: "MT", name: "Malta", currency: "EUR", timezone: "Europe/Malta", tax: "VAT" },
  { code: "CY", name: "Cyprus", currency: "EUR", timezone: "Asia/Nicosia", tax: "VAT" },
  { code: "SG", name: "Singapore", currency: "SGD", timezone: "Asia/Singapore", tax: "GST" },
  { code: "TH", name: "Thailand", currency: "THB", timezone: "Asia/Bangkok", tax: "VAT" },
  { code: "KH", name: "Cambodia", currency: "USD", timezone: "Asia/Phnom_Penh", tax: "VAT" },
] as const;

export const CURRENCIES = [
  { code: "GBP", name: "Pound sterling" },
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US dollar" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "THB", name: "Thai baht" },
  { code: "KHR", name: "Cambodian riel" },
  { code: "CHF", name: "Swiss franc" },
  { code: "AUD", name: "Australian dollar" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "AED", name: "UAE dirham" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "IDR", name: "Indonesian rupiah" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "SEK", name: "Swedish krona" },
  { code: "DKK", name: "Danish krone" },
  { code: "TRY", name: "Turkish lira" },
] as const;

/** Currencies the European Central Bank publishes reference rates for (fetchable automatically). */
export const ECB_CURRENCIES = new Set(["EUR", "USD", "GBP", "SGD", "THB", "CHF", "AUD", "HKD", "MYR", "IDR", "NOK", "SEK", "DKK", "TRY", "JPY", "CNY", "CAD", "NZD", "PHP", "KRW", "INR", "ZAR", "PLN", "CZK", "HUF", "RON", "ISK", "BRL", "MXN", "ILS", "BGN"]);

export function countryName(code: string) {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}
