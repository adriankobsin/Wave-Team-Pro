/**
 * Optional integrations. Each one stays hidden from the menus until the deployment has its keys,
 * so a company that doesn't use Microsoft 365 never sees it. (Set the keys in the hosting
 * environment; see docs/deploy/microsoft-365.md.)
 */
export function microsoftConfigured() {
  return Boolean(process.env.MS_TENANT_ID?.trim() && process.env.MS_CLIENT_ID?.trim() && process.env.MS_CLIENT_SECRET?.trim());
}
