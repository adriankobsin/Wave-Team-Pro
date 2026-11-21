import type { Metadata } from "next";
import { CallbackHandler } from "./callback-handler";

export const metadata: Metadata = { title: "Signing in" };

export default function AuthCallbackPage() {
  return <CallbackHandler />;
}
