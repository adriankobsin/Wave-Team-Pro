/**
 * Product naming. Every deployment sets its own name with the NEXT_PUBLIC_* variables in its Vercel
 * project (they are inlined at build time); the defaults below are the neutral Wave Team Pro names.
 */
const env = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

export const BRAND = {
  /** Full product name: page titles, emails, reports. */
  product: env(process.env.NEXT_PUBLIC_PRODUCT_NAME, "Wave Team Pro"),
  /** The group-wide view across companies. */
  hub: env(process.env.NEXT_PUBLIC_HUB_NAME, "Group Hub"),
  /** Short name of the group, used where a company name is missing. */
  group: env(process.env.NEXT_PUBLIC_GROUP_NAME, "Group"),
  /** Examples shown in forms. */
  exampleDomain: env(process.env.NEXT_PUBLIC_EXAMPLE_DOMAIN, "example.com"),
  exampleCompany: env(process.env.NEXT_PUBLIC_EXAMPLE_COMPANY, "Acme Ltd"),
  /** Demo deployments: show demo sign-in shortcuts and block account changes. */
  demo: process.env.NEXT_PUBLIC_DEMO_MODE === "1",
} as const;
