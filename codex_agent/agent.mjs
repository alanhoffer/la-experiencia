import { Codex } from "@openai/codex-sdk";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const statePath = path.join(__dirname, "state.json");
const memoryPath = path.join(__dirname, "memory.md");
const rulesPath = path.join(__dirname, "rules.md");
const transcriptDir = path.join(__dirname, "transcripts");

function hasFlag(name) {
  return process.argv.includes(name);
}

function getPromptFromArgs() {
  return process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim();
}

async function readOptional(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readState() {
  if (hasFlag("--new")) return {};
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeState(threadId) {
  await writeFile(
    statePath,
    JSON.stringify(
      {
        threadId,
        updatedAt: new Date().toISOString(),
        workspaceRoot,
      },
      null,
      2,
    ),
  );
}

async function appendTranscript(userPrompt, finalResponse) {
  await mkdir(transcriptDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const transcriptPath = path.join(transcriptDir, `${today}.md`);
  await appendFile(
    transcriptPath,
    [
      "",
      `## ${new Date().toISOString()}`,
      "",
      "### User",
      userPrompt,
      "",
      "### Agent",
      finalResponse,
      "",
    ].join("\n"),
    "utf8",
  );
}

function buildPrompt({ userPrompt, memory, rules }) {
  return [
    "Sos un agente local persistente que corre dentro del workspace del usuario.",
    "Usas la cuenta ya logueada del Codex CLI. No pidas ni uses OPENAI_API_KEY.",
    "Usa la memoria local como contexto, pero no la trates como verdad absoluta si el usuario corrige algo.",
    "Si el usuario pide recordar una preferencia estable, actualiza codex_agent/memory.md de forma breve.",
    "No guardes secretos, tokens, passwords, cookies ni credenciales.",
    "",
    "<rules.md>",
    rules.trim(),
    "</rules.md>",
    "",
    "<memory.md>",
    memory.trim(),
    "</memory.md>",
    "",
    "<user_request>",
    userPrompt,
    "</user_request>",
  ].join("\n");
}

async function main() {
  const argPrompt = getPromptFromArgs();
  const stdinPrompt = await readStdinIfPiped();
  const userPrompt = [argPrompt, stdinPrompt].filter(Boolean).join("\n\n").trim();

  if (!userPrompt) {
    console.error('Uso: npm run ask -- "tu pedido"');
    console.error('Opcional: npm run ask -- --new "empezar un hilo nuevo"');
    process.exit(1);
  }

  const [memory, rules, state] = await Promise.all([
    readOptional(memoryPath),
    readOptional(rulesPath),
    readState(),
  ]);

  const codex = new Codex();
  const threadOptions = {
    workingDirectory: workspaceRoot,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    skipGitRepoCheck: false,
  };

  const thread = state.threadId
    ? codex.resumeThread(state.threadId, threadOptions)
    : codex.startThread(threadOptions);

  const fullPrompt = buildPrompt({ userPrompt, memory, rules });
  const turn = await thread.run(fullPrompt);

  if (thread.id) {
    await writeState(thread.id);
  }

  await appendTranscript(userPrompt, turn.finalResponse);
  console.log(turn.finalResponse);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
