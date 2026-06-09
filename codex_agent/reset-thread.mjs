import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(__dirname, "state.json");

await rm(statePath, { force: true });
console.log("Thread local reseteado. El proximo `npm run ask` empezara un hilo nuevo.");
