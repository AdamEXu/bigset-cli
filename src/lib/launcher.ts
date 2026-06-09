import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export async function runLauncher(args: string[]): Promise<void> {
  const launcherPath = join(repoRoot, "bin", "launcher.js");
  const child = spawn(process.execPath, [launcherPath, ...args], {
    stdio: "inherit",
  });

  const code = await new Promise<number>((resolve) => {
    child.once("exit", (exitCode, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(exitCode ?? 0);
    });
  });

  if (code !== 0) process.exit(code);
}
