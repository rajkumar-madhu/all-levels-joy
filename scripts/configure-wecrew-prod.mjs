import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const context = "wecrew-prod";
const namespace = "wecrew-servicedesk";
function kubectl(args, input) {
  const result = spawnSync("kubectl", ["--context", context, "--request-timeout=60s", ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`kubectl failed with status ${result.status}`);
  return result.stdout;
}

const data = {};
for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) {
  const value = process.env[name] || process.env[`VITE_${name}`];
  if (!value) throw new Error(`Missing ${name}; run with Bun from the repository root`);
  data[name] = value;
}
const pull = JSON.parse(
  kubectl(["-n", "linkedeye-build", "get", "secret", "harbor-linkedeye-pull", "-o", "json"]),
);
if (pull.type !== "kubernetes.io/dockerconfigjson" || !pull.data?.[".dockerconfigjson"]) {
  throw new Error("Expected the existing LinkedEye project registry pull credential");
}
console.log(kubectl(["apply", "-f", "-"], readFileSync("k8s/wecrew-prod/namespace.yaml", "utf8")));
for (const resource of [
  {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "itsm-public", namespace },
    data,
  },
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "harbor-pull", namespace },
    type: pull.type,
    data: { ".dockerconfigjson": pull.data[".dockerconfigjson"] },
  },
]) {
  // Secret values remain in memory/stdin; kubectl prints only resource status.
  console.log(kubectl(["apply", "-f", "-"], JSON.stringify(resource)));
}
