import { spawnSync } from "node:child_process";

// Run with Bun from the repository root: Bun loads the checked-in public .env.
const image = process.argv[2];
if (!image) throw new Error("Usage: bun scripts/build-self-host.mjs <image:tag>");
const args = ["buildx", "build", "--platform", "linux/amd64", "--load", "--tag", image];
for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) {
  const value = process.env[name] || process.env[`VITE_${name}`];
  if (!value) throw new Error(`Missing ${name}`);
  args.push("--build-arg", `${name}=${value}`);
}
args.push(".");
const result = spawnSync("docker", args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
