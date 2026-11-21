import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RATE_LIMIT_SALT: z.string().min(16).default("development-only-rate-limit-salt"),
});

/** Environment readable on the server and in the browser bundle. */
export function publicEnv() {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_URL,
  });
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid public environment variables: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
    );
  }
  return parsed.data;
}

/** Server-only environment. Never import from a Client Component. */
export function serverEnv() {
  const parsed = serverSchema.safeParse({
    ...publicEnv(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RATE_LIMIT_SALT: process.env.RATE_LIMIT_SALT,
  });
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid server environment variables: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
    );
  }
  if (process.env.NODE_ENV === "production" && parsed.data.RATE_LIMIT_SALT.startsWith("development")) {
    throw new Error("RATE_LIMIT_SALT must be set in production.");
  }
  return parsed.data;
}
