import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { superviseProcess } from "./process-supervisor";

const workerPath = fileURLToPath(new URL("./server.js", import.meta.url));
const supervisor = superviseProcess({
  spawnChild: () => spawn(process.execPath, [workerPath], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  }),
  onStopped: (code) => process.exit(code),
});

// A platform stop or deployment replacement must never restart the worker.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => supervisor.stop());
}
