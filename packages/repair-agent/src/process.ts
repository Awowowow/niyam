import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(input: {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maxOutputBytes = input.maxOutputBytes ?? 1_000_000;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, input.timeoutMs);
    timer.unref();

    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= maxOutputBytes) return current;
      return `${current}${chunk.toString("utf8")}`.slice(0, maxOutputBytes);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function git(
  repositoryPath: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryPath, ...args], {
    timeout: timeoutMs,
    maxBuffer: 2_000_000,
    encoding: "utf8",
  });
  return result.stdout;
}
