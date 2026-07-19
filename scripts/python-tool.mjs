import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPython =
  process.platform === "win32"
    ? join(root, "apps", "verification", ".venv", "Scripts", "python.exe")
    : join(root, "apps", "verification", ".venv", "bin", "python");
const python =
  process.env.NIYAM_PYTHON ||
  (existsSync(localPython)
    ? localPython
    : process.platform === "win32"
      ? "python"
      : "python3");
const result = spawnSync(python, process.argv.slice(2), {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to start ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
