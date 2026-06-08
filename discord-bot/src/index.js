import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import prism from "prism-media";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

const fallbackWords = [
  "relampago",
  "mate",
  "brisa",
  "asado",
  "foco",
  "trueno",
  "pomelo",
  "cancha",
  "misterio",
  "satelite",
  "domingo",
  "terere",
];

const defaultTriggers = [
  {
    keyword: "viejo",
    responses: fallbackWords,
  },
];

const token = process.env.DISCORD_TOKEN;
const commandPrefix = process.env.COMMAND_PREFIX || "!bot";
const cooldownMs = Number.parseInt(process.env.COOLDOWN_MS || "1500", 10);
const useTts = process.env.DISCORD_TTS === "true";
const requireManageGuild = process.env.REQUIRE_MANAGE_GUILD_FOR_CONFIG !== "false";
const debugMessages = process.env.DEBUG_MESSAGES === "true";
const ttsProvider = process.env.TTS_PROVIDER || "edge";
const edgeTtsVoice = process.env.EDGE_TTS_VOICE || "es-AR-TomasNeural";
const edgeTtsRate = process.env.EDGE_TTS_RATE || "+0%";
const voiceSilenceMs = Number.parseInt(process.env.VOICE_SILENCE_MS || "450", 10);
const voiceTriggerCooldownMs = Number.parseInt(process.env.VOICE_TRIGGER_COOLDOWN_MS || "3500", 10);
const codexEnabled = process.env.CODEX_ENABLED !== "false";
const codexWakeWord = normalizeText(process.env.CODEX_WAKE_WORD || "experiencia");
const codexModel = process.env.CODEX_MODEL || "gpt-5.5";
const codexReasoningEffort = process.env.CODEX_REASONING_EFFORT || "low";
const codexTimeoutMs = Number.parseInt(process.env.CODEX_TIMEOUT_MS || "90000", 10);
const codexMaxWords = Number.parseInt(process.env.CODEX_MAX_WORDS || "45", 10);
const codexWakeCooldownMs = Number.parseInt(process.env.CODEX_WAKE_COOLDOWN_MS || "8000", 10);
const lastResponseByChannel = new Map();
const lastVoiceTriggerByGuild = new Map();
const lastCodexWakeByGuild = new Map();
const activeSpeechGuilds = new Set();
const activeCodexGuilds = new Set();
const speechQueues = new Map();
const audioPlayers = new Map();
const activeReceivers = new Set();
const voskRequests = new Map();
const botRootPath = fileURLToPath(new URL("..", import.meta.url));
const dataFilePath = fileURLToPath(new URL("../data/triggers.json", import.meta.url));
const debugLogPath = fileURLToPath(new URL("../data/debug.log", import.meta.url));
const codexDirPath = fileURLToPath(new URL("../data/codex", import.meta.url));
const ttsDirPath = fileURLToPath(new URL("../data/tts", import.meta.url));
const ttsCacheDirPath = fileURLToPath(new URL("../data/tts-cache", import.meta.url));
const voiceDirPath = fileURLToPath(new URL("../data/voice", import.meta.url));
const voskModelPath = fileURLToPath(new URL("../models/vosk-model-small-es-0.42", import.meta.url));
const transcribeScriptPath = fileURLToPath(new URL("../scripts/transcribe_vosk.py", import.meta.url));
const voskWorkerScriptPath = fileURLToPath(new URL("../scripts/vosk_worker.py", import.meta.url));
const edgeTtsScriptPath = fileURLToPath(new URL("../scripts/synthesize_edge_tts.py", import.meta.url));
let triggerStore = await loadTriggerStore();
let voskWorker = null;
let voskWorkerBuffer = "";
let voskRequestId = 1;

if (!token || token === "pon_tu_token_del_bot") {
  console.error("Falta DISCORD_TOKEN. Copia .env.example a .env y pega el token del bot.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`VIEJO bot conectado como ${client.user.tag}`);
  console.log(`Prefijo de administracion: ${commandPrefix}`);
  console.log(`Keywords cargadas: ${triggerStore.triggers.length}`);
  console.log(`Voz: ${ttsProvider === "edge" ? edgeTtsVoice : "Windows SAPI"}`);
  if (codexEnabled) {
    console.log(`Wake Codex: ${codexWakeWord} -> ${codexModel}`);
  }
  getVoskWorker();
  prewarmSpeechCache().catch((error) => console.error("No pude precachear audios:", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  await debugLog(
    `message guild=${message.guild.name} channel=${message.channelId} author=${message.author.tag} length=${message.content.length}`,
  );

  if (isCommand(message.content)) {
    await debugLog("command matched");
    await handleCommand(message);
    return;
  }

  const trigger = findMatchingTrigger(message.content);
  await debugLog(`trigger ${trigger ? `matched keyword=${trigger.keyword}` : "missed"}`);
  if (!trigger) return;
  if (isOnCooldown(message.channelId)) return;

  const response = pickRandomResponse(trigger.responses);
  lastResponseByChannel.set(message.channelId, Date.now());

  const spoke = await queueSpeech(message.guild.id, response);
  if (!spoke) {
    await debugLog("trigger matched but no voice connection is active");

    if (useTts) {
      try {
        await sendReply(message, {
          content: response,
          tts: true,
          allowedMentions: { repliedUser: false },
        });
      } catch (error) {
        console.error(`No pude responder en #${message.channelId}:`, error);
      }
    }
  }
});

client.on("error", (error) => {
  console.error("Error del cliente Discord:", error);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  console.error(`Shard ${shardId} desconectado: ${event.code} ${event.reason || ""}`.trim());
});

client.on(Events.ShardError, (error, shardId) => {
  console.error(`Error en shard ${shardId}:`, error);
});

client.login(token);

async function handleCommand(message) {
  const rawArgs = message.content.slice(commandPrefix.length).trim();
  const [command = "help", ...rest] = rawArgs.split(/\s+/);
  const payload = rest.join(" ").trim();

  switch (normalizeText(command)) {
    case "join":
    case "entrar":
      await joinUserVoiceChannel(message);
      break;

    case "leave":
    case "salir":
      await leaveVoiceChannel(message);
      break;

    case "add":
    case "agregar":
      await addTriggers(message, payload);
      break;

    case "remove":
    case "rm":
    case "delete":
    case "eliminar":
      await removeTriggerData(message, payload);
      break;

    case "list":
    case "lista":
      await listTriggers(message);
      break;

    case "clear":
    case "limpiar":
      await clearTriggers(message);
      break;

    case "help":
    case "ayuda":
    default:
      await sendHelp(message);
      break;
  }
}

async function joinUserVoiceChannel(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    await sendReply(message, {
      content: "Tenes que estar en un canal de voz para que me una.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    await sendReply(message, {
      content: "No tengo permiso para conectarme a ese canal de voz.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    setupVoiceReceiver(connection, message.guild.id);
    await queueSpeech(message.guild.id, "listo");
    await sendReply(message, {
      content: `Listo, me uni a ${voiceChannel.name}.`,
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    connection.destroy();
    console.error("No pude entrar al canal de voz:", error);
    await sendReply(message, {
      content: "No pude conectarme al canal de voz. Revisa permisos o intenta otra vez.",
      allowedMentions: { repliedUser: false },
    });
  }
}

async function leaveVoiceChannel(message) {
  const connection = getVoiceConnection(message.guild.id);

  if (!connection) {
    await sendReply(message, {
      content: "No estoy conectado a ningun canal de voz en este servidor.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  connection.destroy();
  await sendReply(message, {
    content: "Sali del canal de voz.",
    allowedMentions: { repliedUser: false },
  });
}

async function addTriggers(message, payload) {
  if (!(await canEditConfig(message))) return;

  const parsed = parseTriggerPayload(payload);
  if (!parsed) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} add palabra1, palabra2 => respuesta 1 | respuesta 2\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  let addedKeywords = 0;
  let addedResponses = 0;

  for (const keyword of parsed.keywords) {
    const trigger = getOrCreateTrigger(keyword);
    const before = trigger.responses.length;
    trigger.responses = uniqueValues([...trigger.responses, ...parsed.responses]);
    addedResponses += trigger.responses.length - before;
    addedKeywords += before === 0 ? 1 : 0;
  }

  await saveTriggerStore();
  await sendReply(message, {
    content: `Registrado. Keywords: ${parsed.keywords.join(", ")}. Respuestas nuevas: ${addedResponses}.`,
    allowedMentions: { repliedUser: false },
  });

  if (addedKeywords > 0) {
    console.log(`Agregadas ${addedKeywords} keywords nuevas en ${message.guild.name}`);
  }
}

async function removeTriggerData(message, payload) {
  if (!(await canEditConfig(message))) return;

  const parsed = parseRemovePayload(payload);
  if (!parsed) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} remove palabra\` o \`${commandPrefix} remove palabra => respuesta\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  let removedKeywords = 0;
  let removedResponses = 0;

  for (const keyword of parsed.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    const triggerIndex = triggerStore.triggers.findIndex(
      (trigger) => normalizeText(trigger.keyword) === normalizedKeyword,
    );

    if (triggerIndex === -1) continue;

    if (!parsed.responses.length) {
      triggerStore.triggers.splice(triggerIndex, 1);
      removedKeywords += 1;
      continue;
    }

    const trigger = triggerStore.triggers[triggerIndex];
    const responsesToRemove = new Set(parsed.responses.map(normalizeText));
    const before = trigger.responses.length;
    trigger.responses = trigger.responses.filter(
      (response) => !responsesToRemove.has(normalizeText(response)),
    );
    removedResponses += before - trigger.responses.length;

    if (!trigger.responses.length) {
      triggerStore.triggers.splice(triggerIndex, 1);
      removedKeywords += 1;
    }
  }

  await saveTriggerStore();
  await sendReply(message, {
    content: `Eliminado. Keywords removidas: ${removedKeywords}. Respuestas removidas: ${removedResponses}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listTriggers(message) {
  const lines = triggerStore.triggers.map((trigger) => {
    const responses = trigger.responses.join(", ");
    return `- ${trigger.keyword}: ${responses}`;
  });

  const content = lines.length
    ? `Keywords registradas:\n${lines.join("\n")}`
    : "No hay keywords registradas.";

  await sendReply(message, {
    content: truncateDiscordMessage(content),
    allowedMentions: { repliedUser: false },
  });
}

async function clearTriggers(message) {
  if (!(await canEditConfig(message))) return;

  triggerStore.triggers = [];
  await saveTriggerStore();
  await sendReply(message, {
    content: "Lista de keywords limpiada.",
    allowedMentions: { repliedUser: false },
  });
}

async function sendHelp(message) {
  await sendReply(message, {
    content: [
      `Comandos:`,
      `\`${commandPrefix} join\` - me uno a tu canal de voz.`,
      `\`${commandPrefix} leave\` - salgo del canal de voz.`,
      `\`${commandPrefix} add viejo, bro => mate | trueno\` - agrega keywords y respuestas.`,
      `\`${commandPrefix} remove viejo\` - elimina una keyword completa.`,
      `\`${commandPrefix} remove viejo => mate\` - elimina solo una respuesta.`,
      `\`${commandPrefix} list\` - muestra lo registrado.`,
    ].join("\n"),
    allowedMentions: { repliedUser: false },
  });
}

async function canEditConfig(message) {
  if (!requireManageGuild) return true;
  if (message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  await sendReply(message, {
    content: "Necesitas permiso de Manage Server para cambiar keywords o respuestas.",
    allowedMentions: { repliedUser: false },
  });
  return false;
}

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCommand(content) {
  const trimmed = content.trim();
  const normalizedPrefix = commandPrefix.toLowerCase();
  const lowerContent = trimmed.toLowerCase();
  return lowerContent === normalizedPrefix || lowerContent.startsWith(`${normalizedPrefix} `);
}

function findMatchingTrigger(content) {
  const normalizedContent = ` ${normalizeText(content)} `;
  return triggerStore.triggers.find((trigger) => {
    const normalizedKeyword = normalizeText(trigger.keyword);
    return normalizedKeyword && normalizedContent.includes(` ${normalizedKeyword} `);
  });
}

function containsKeyword(content, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return false;

  return ` ${normalizeText(content)} `.includes(` ${normalizedKeyword} `);
}

function pickRandomResponse(responses) {
  const bank = responses.length ? responses : fallbackWords;
  return bank[Math.floor(Math.random() * bank.length)];
}

function parseTriggerPayload(payload) {
  const parts = payload.split("=>");
  if (parts.length < 2) return null;

  const keywords = parseList(parts[0]);
  const responses = parseList(parts.slice(1).join("=>"), /\||,/);

  if (!keywords.length || !responses.length) return null;
  return { keywords, responses };
}

function parseRemovePayload(payload) {
  if (!payload) return null;

  const parts = payload.split("=>");
  const keywords = parseList(parts[0]);
  const responses = parts.length > 1 ? parseList(parts.slice(1).join("=>"), /\||,/) : [];

  if (!keywords.length) return null;
  return { keywords, responses };
}

function parseList(value, separator = /,/) {
  return uniqueValues(
    value
      .split(separator)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function getOrCreateTrigger(keyword) {
  const normalizedKeyword = normalizeText(keyword);
  let trigger = triggerStore.triggers.find(
    (candidate) => normalizeText(candidate.keyword) === normalizedKeyword,
  );

  if (!trigger) {
    trigger = { keyword: normalizedKeyword, responses: [] };
    triggerStore.triggers.push(trigger);
  }

  return trigger;
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const cleanValue = String(value).trim();
    const normalized = normalizeText(cleanValue);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(cleanValue);
  }

  return result;
}

function isOnCooldown(channelId) {
  const lastResponseAt = lastResponseByChannel.get(channelId) || 0;
  return Date.now() - lastResponseAt < cooldownMs;
}

async function loadTriggerStore() {
  try {
    const rawData = await readFile(dataFilePath, "utf8");
    return sanitizeStore(JSON.parse(rawData));
  } catch {
    const store = sanitizeStore({ triggers: defaultTriggers });
    await saveStoreToDisk(store);
    return store;
  }
}

async function saveTriggerStore() {
  triggerStore = sanitizeStore(triggerStore);
  await saveStoreToDisk(triggerStore);
}

async function saveStoreToDisk(store) {
  await mkdir(dirname(dataFilePath), { recursive: true });
  await writeFile(dataFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function sanitizeStore(store) {
  const triggers = Array.isArray(store?.triggers) ? store.triggers : defaultTriggers;
  const sanitizedTriggers = [];

  for (const trigger of triggers) {
    const keyword = normalizeText(trigger.keyword || "");
    const responses = uniqueValues(Array.isArray(trigger.responses) ? trigger.responses : []);

    if (!keyword || !responses.length) continue;

    const existing = sanitizedTriggers.find(
      (candidate) => normalizeText(candidate.keyword) === keyword,
    );

    if (existing) {
      existing.responses = uniqueValues([...existing.responses, ...responses]);
    } else {
      sanitizedTriggers.push({ keyword, responses });
    }
  }

  return { triggers: sanitizedTriggers };
}

function truncateDiscordMessage(content) {
  if (content.length <= 1900) return content;
  return `${content.slice(0, 1880)}\n...`;
}

function setupVoiceReceiver(connection, guildId) {
  if (activeReceivers.has(guildId)) return;

  activeReceivers.add(guildId);
  connection.receiver.speaking.on("start", (userId) => {
    if (userId === client.user.id) return;
    handleSpokenSegment(connection, guildId, userId).catch((error) => {
      console.error("No pude procesar audio recibido:", error);
    });
  });

  connection.on("stateChange", (_, newState) => {
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      activeReceivers.delete(guildId);
    }
  });
}

async function handleSpokenSegment(connection, guildId, userId) {
  if (activeSpeechGuilds.has(guildId)) {
    await debugLog(`voice ignored while speaking user=${userId}`);
    return;
  }

  if (isVoiceTriggerOnCooldown(guildId, userId)) {
    await debugLog(`voice ignored cooldown user=${userId}`);
    return;
  }

  await debugLog(`voice start user=${userId}`);

  const opusStream = connection.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: voiceSilenceMs,
    },
  });

  const decoder = new prism.opus.Decoder({
    frameSize: 960,
    channels: 2,
    rate: 48000,
  });

  const chunks = [];
  let totalBytes = 0;

  decoder.on("data", (chunk) => {
    chunks.push(chunk);
    totalBytes += chunk.length;
  });

  opusStream.pipe(decoder);

  await new Promise((resolve, reject) => {
    decoder.once("end", resolve);
    decoder.once("error", reject);
    opusStream.once("error", reject);
  });

  const minBytes = 48000 * 2 * 2 * 0.2;
  if (totalBytes < minBytes) {
    await debugLog(`voice ignored short bytes=${totalBytes}`);
    return;
  }

  const rawFile = await writeRawVoice(Buffer.concat(chunks));
  const wavFile = rawFile.replace(/\.pcm$/i, ".wav");

  try {
    await convertRawToWav(rawFile, wavFile);
    const transcript = await transcribeWav(wavFile);
    await debugLog(`voice transcript=${JSON.stringify(transcript)}`);

    if (codexEnabled && containsKeyword(transcript, codexWakeWord)) {
      const fullTranscript = await transcribeWav(wavFile, { grammar: false });
      const question = extractCodexQuestion(transcript, fullTranscript);

      await debugLog(
        `codex wake transcript=${JSON.stringify(fullTranscript)} question=${JSON.stringify(question)}`,
      );
      await handleCodexVoiceQuestion(guildId, userId, question);
      return;
    }

    const trigger = findMatchingTrigger(transcript);
    if (!trigger) return;
    if (isVoiceTriggerOnCooldown(guildId, userId)) {
      await debugLog(`voice trigger ignored duplicate keyword=${trigger.keyword}`);
      return;
    }

    const response = pickRandomResponse(trigger.responses);
    markVoiceTrigger(guildId, userId);
    await debugLog(`voice trigger matched keyword=${trigger.keyword} response=${response}`);
    await queueSpeech(guildId, response);
  } finally {
    await unlink(rawFile).catch(() => {});
    await unlink(wavFile).catch(() => {});
  }
}

async function writeRawVoice(buffer) {
  await mkdir(voiceDirPath, { recursive: true });
  const rawFile = join(voiceDirPath, `${Date.now()}-${randomUUID()}.pcm`);
  await writeFile(rawFile, buffer);
  return rawFile;
}

async function convertRawToWav(rawFile, wavFile) {
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-i",
      rawFile,
      "-ar",
      "16000",
      "-ac",
      "1",
      wavFile,
    ],
    { windowsHide: true },
  );
}

async function transcribeWav(wavFile, options = {}) {
  const useGrammar = options.grammar !== false;
  const keywords = useGrammar ? getVoiceKeywords() : [];
  const stdout = await transcribeWithVoskWorker(wavFile, keywords, { grammar: useGrammar });

  return normalizeText(stdout);
}

function getVoiceKeywords() {
  const keywords = triggerStore.triggers.map((trigger) => trigger.keyword);
  if (codexEnabled && codexWakeWord) {
    keywords.push(codexWakeWord);
  }

  return uniqueValues(keywords);
}

function getVoskWorker() {
  if (voskWorker && !voskWorker.killed) return voskWorker;

  voskWorker = spawn("python", [voskWorkerScriptPath, voskModelPath], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  voskWorkerBuffer = "";

  voskWorker.stdout.on("data", (chunk) => {
    voskWorkerBuffer += chunk.toString("utf8");
    const lines = voskWorkerBuffer.split(/\r?\n/);
    voskWorkerBuffer = lines.pop() || "";

    for (const line of lines) {
      handleVoskWorkerLine(line);
    }
  });

  voskWorker.stderr.on("data", (chunk) => {
    debugLog(`vosk stderr: ${chunk.toString("utf8").trim()}`).catch(() => {});
  });

  voskWorker.on("exit", (code) => {
    for (const request of voskRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(`Vosk worker exited with code ${code}`));
    }

    voskRequests.clear();
    voskWorker = null;
  });

  return voskWorker;
}

function handleVoskWorkerLine(line) {
  if (!line.trim()) return;

  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    debugLog(`vosk invalid line: ${line}`).catch(() => {});
    return;
  }

  const request = voskRequests.get(payload.id);
  if (!request) return;

  clearTimeout(request.timeout);
  voskRequests.delete(payload.id);

  if (payload.error) {
    request.reject(new Error(payload.error));
    return;
  }

  request.resolve(payload.text || "");
}

function transcribeWithVoskWorker(wavFile, keywords, options = {}) {
  const worker = getVoskWorker();
  const id = voskRequestId++;
  const useGrammar = options.grammar !== false;
  const timeoutMs = useGrammar ? 6000 : 12000;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      voskRequests.delete(id);
      reject(new Error("Vosk transcription timed out"));
    }, timeoutMs);

    voskRequests.set(id, { resolve, reject, timeout });
    worker.stdin.write(`${JSON.stringify({ id, audio: wavFile, keywords, grammar: useGrammar })}\n`, (error) => {
      if (!error) return;

      clearTimeout(timeout);
      voskRequests.delete(id);
      reject(error);
    });
  });
}

function extractQuestionAfterWake(transcript, wakeWord) {
  const words = normalizeText(transcript).split(" ").filter(Boolean);
  const wakeWords = normalizeText(wakeWord).split(" ").filter(Boolean);

  if (!words.length || !wakeWords.length) return "";

  for (let index = 0; index <= words.length - wakeWords.length; index += 1) {
    const matches = wakeWords.every((word, offset) => words[index + offset] === word);
    if (matches) {
      return words.slice(index + wakeWords.length).join(" ");
    }
  }

  return "";
}

function extractCodexQuestion(wakeTranscript, fullTranscript) {
  const questionFromFullTranscript = extractQuestionAfterWake(fullTranscript, codexWakeWord);
  if (questionFromFullTranscript) return questionFromFullTranscript;

  if (fullTranscript && !containsKeyword(fullTranscript, codexWakeWord)) {
    return normalizeText(fullTranscript);
  }

  return extractQuestionAfterWake(wakeTranscript, codexWakeWord);
}

async function handleCodexVoiceQuestion(guildId, userId, question) {
  if (!question) {
    markCodexWake(guildId);
    markVoiceTrigger(guildId, userId);
    await queueSpeech(guildId, `Decime la pregunta despues de ${codexWakeWord}.`);
    return;
  }

  if (activeCodexGuilds.has(guildId)) {
    await debugLog(`codex ignored busy question=${question}`);
    return;
  }

  if (isCodexWakeOnCooldown(guildId)) {
    await debugLog(`codex ignored cooldown question=${question}`);
    return;
  }

  markCodexWake(guildId);
  markVoiceTrigger(guildId, userId);
  activeCodexGuilds.add(guildId);

  try {
    await debugLog(`codex question=${question}`);
    const answer = await queryCodexCli(question);
    const spokenAnswer = sanitizeCodexAnswer(answer);

    await debugLog(`codex answer=${spokenAnswer}`);
    await queueSpeech(guildId, spokenAnswer || "Codex no devolvio una respuesta.");
  } catch (error) {
    console.error("No pude consultar Codex CLI:", error.message);
    await debugLog(`codex failed: ${error.message}`);
    await queueSpeech(guildId, "No pude consultar Codex ahora.");
  } finally {
    activeCodexGuilds.delete(guildId);
  }
}

function isCodexWakeOnCooldown(guildId) {
  const lastAt = lastCodexWakeByGuild.get(guildId) || 0;
  return Date.now() - lastAt < codexWakeCooldownMs;
}

function markCodexWake(guildId) {
  lastCodexWakeByGuild.set(guildId, Date.now());
}

async function queryCodexCli(question) {
  await mkdir(codexDirPath, { recursive: true });

  const outputFile = join(codexDirPath, `${Date.now()}-${randomUUID()}.txt`);
  const prompt = buildCodexPrompt(question);
  const command = [
    "codex",
    "exec",
    "-m",
    quotePowerShellArg(codexModel),
    "-c",
    quotePowerShellArg(`model_reasoning_effort="${codexReasoningEffort}"`),
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-C",
    quotePowerShellArg(botRootPath),
    "-o",
    quotePowerShellArg(outputFile),
    "-",
  ].join(" ");

  try {
    await runCodexCommand(command, prompt, outputFile);
    return await readFile(outputFile, "utf8");
  } finally {
    await unlink(outputFile).catch(() => {});
  }
}

function runCodexCommand(command, prompt, outputFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        cwd: botRootPath,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let settled = false;
    let stderr = "";
    let stdout = "";

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`Codex CLI timed out after ${codexTimeoutMs}ms`));
    }, codexTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = trimProcessBuffer(stdout + chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      stderr = trimProcessBuffer(stderr + chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      finish(error);
    });

    child.on("exit", async (code) => {
      if (code !== 0) {
        finish(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`.trim()));
        return;
      }

      if (!(await fileExists(outputFile))) {
        finish(new Error(`Codex CLI did not write output: ${stderr || stdout}`.trim()));
        return;
      }

      await debugLog(`codex cli stdout=${stdout.trim()} stderr=${stderr.trim()}`);
      finish();
    });

    child.stdin.end(prompt, "utf8");
  });
}

function buildCodexPrompt(question) {
  return [
    "Sos un asistente de voz dentro de un canal de Discord.",
    `Responde en español claro. Maximo ${codexMaxWords} palabras.`,
    "No uses markdown, listas, tablas, emojis ni bloques de codigo.",
    "Si falta contexto, da la mejor respuesta breve y practica.",
    `Pregunta del usuario: ${question}`,
  ].join("\n");
}

function sanitizeCodexAnswer(answer) {
  const cleaned = String(answer || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= codexMaxWords) return cleaned;

  return `${words.slice(0, codexMaxWords).join(" ")}.`;
}

function trimProcessBuffer(value) {
  const maxLength = 4000;
  return value.length <= maxLength ? value : value.slice(-maxLength);
}

function quotePowerShellArg(value) {
  return `'${escapePowerShellString(value)}'`;
}

async function queueSpeech(guildId, text) {
  const connection = getVoiceConnection(guildId);
  if (!connection) {
    await debugLog(`speech skipped no connection text=${text}`);
    return false;
  }

  const previous = speechQueues.get(guildId) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => playSpeech(connection, guildId, text))
    .catch((error) => {
      console.error("No pude reproducir voz:", error);
    });

  const queued = current.finally(() => {
    if (speechQueues.get(guildId) === queued) {
      speechQueues.delete(guildId);
    }
  });

  speechQueues.set(guildId, queued);

  return true;
}

async function playSpeech(connection, guildId, text) {
  await debugLog(`speech play text=${text}`);
  const audio = await synthesizeSpeech(text);

  activeSpeechGuilds.add(guildId);

  try {
    const player = getAudioPlayer(guildId);
    connection.subscribe(player);

    const ffmpeg = new prism.FFmpeg({
      args: [
        "-analyzeduration",
        "0",
        "-loglevel",
        "0",
        "-i",
        audio.path,
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
      ],
    });

    const resource = createAudioResource(ffmpeg, {
      inputType: StreamType.Raw,
    });

    player.play(resource);
    await entersState(player, AudioPlayerStatus.Idle, 30_000);
  } finally {
    setTimeout(() => {
      activeSpeechGuilds.delete(guildId);
    }, 350);

    if (audio.temporary) {
      await unlink(audio.path).catch(() => {});
    }
  }
}

function isVoiceTriggerOnCooldown(guildId, userId) {
  const guildLastAt = lastVoiceTriggerByGuild.get(guildId) || 0;
  const userLastAt = lastVoiceTriggerByGuild.get(`${guildId}:${userId}`) || 0;
  const now = Date.now();

  return (
    now - guildLastAt < voiceTriggerCooldownMs ||
    now - userLastAt < voiceTriggerCooldownMs
  );
}

function markVoiceTrigger(guildId, userId) {
  const now = Date.now();
  lastVoiceTriggerByGuild.set(guildId, now);
  lastVoiceTriggerByGuild.set(`${guildId}:${userId}`, now);
}

function getAudioPlayer(guildId) {
  let player = audioPlayers.get(guildId);

  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    player.on("error", (error) => {
      console.error("Error del reproductor de voz:", error);
    });

    audioPlayers.set(guildId, player);
  }

  return player;
}

async function synthesizeSpeech(text) {
  if (ttsProvider === "edge") {
    try {
      return await synthesizeEdgeSpeech(text);
    } catch (error) {
      console.error("Fallo edge-tts, usando voz local:", error.message);
      await debugLog(`edge tts failed: ${error.message}`);
    }
  }

  return synthesizeLocalSpeech(text);
}

async function synthesizeEdgeSpeech(text) {
  await mkdir(ttsCacheDirPath, { recursive: true });

  const cacheKey = createHash("sha1")
    .update(`${edgeTtsVoice}|${edgeTtsRate}|${text}`)
    .digest("hex");
  const audioFile = join(ttsCacheDirPath, `${cacheKey}.mp3`);

  if (await fileExists(audioFile)) {
    return { path: audioFile, temporary: false };
  }

  await execFileAsync(
    "python",
    [edgeTtsScriptPath, edgeTtsVoice, audioFile, text, edgeTtsRate],
    {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );

  return { path: audioFile, temporary: false };
}

async function synthesizeLocalSpeech(text) {
  await mkdir(ttsDirPath, { recursive: true });

  const audioFile = join(ttsDirPath, `${Date.now()}-${randomUUID()}.wav`);
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$synth.Rate = 0",
    "$synth.Volume = 100",
    `$synth.SetOutputToWaveFile('${escapePowerShellString(audioFile)}')`,
    `$synth.Speak('${escapePowerShellString(text)}')`,
    "$synth.Dispose()",
  ].join("; ");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true },
  );

  return { path: audioFile, temporary: true };
}

async function prewarmSpeechCache() {
  if (ttsProvider !== "edge") return;

  const phrases = uniqueValues([
    "listo",
    ...triggerStore.triggers.flatMap((trigger) => trigger.responses),
  ]);

  for (const phrase of phrases) {
    await synthesizeEdgeSpeech(phrase);
  }

  await debugLog(`tts cache ready phrases=${phrases.length}`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

async function sendReply(message, payload) {
  try {
    return await message.reply(payload);
  } catch (replyError) {
    await debugLog(`reply failed: ${replyError.message}`);

    try {
      return await message.channel.send(payload);
    } catch (sendError) {
      await debugLog(`channel send failed: ${sendError.message}`);
      console.error("No pude enviar mensaje de texto:", sendError.message);
      return null;
    }
  }
}

async function debugLog(line) {
  if (!debugMessages) return;

  await mkdir(dirname(debugLogPath), { recursive: true });
  await appendFile(debugLogPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}
