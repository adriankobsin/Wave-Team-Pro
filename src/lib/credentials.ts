/** Kinds of stored login, in the order they are offered. */
export const CREDENTIAL_CATEGORIES = {
  device: "Device",
  network: "Network (switch, router, firewall)",
  wifi: "Wi-Fi",
  server: "Server / computer",
  platform: "Online platform / portal",
  account: "Account",
  other: "Other",
} as const;
export type CredentialCategory = keyof typeof CREDENTIAL_CATEGORIES;
