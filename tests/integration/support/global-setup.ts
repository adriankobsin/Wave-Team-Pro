import { execFileSync } from "node:child_process";
import path from "node:path";

/** Rebuilds the integration database from migrations before the suite runs. */
export default function setup() {
  if (process.env.TEST_DATABASE_URL) return; // externally managed (e.g. `supabase start` + db reset)
  const script = path.resolve(__dirname, "../../../scripts/test-db.sh");
  execFileSync(script, ["start"], { stdio: "inherit" });
}
