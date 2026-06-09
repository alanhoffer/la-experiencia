import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access, appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  ApplicationCommandOptionType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
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
const clearMessagesCommand = process.env.CLEAR_MESSAGES_COMMAND || "!clear";
const initialAutoJoinMode = normalizeAutoJoinMode(process.env.AUTO_JOIN_VOICE || "most");
const defaultAutoJoinMode = initialAutoJoinMode === "status" ? "most" : initialAutoJoinMode;
const cooldownMs = Number.parseInt(process.env.COOLDOWN_MS || "1500", 10);
const useTts = process.env.DISCORD_TTS === "true";
const requireManageGuild = process.env.REQUIRE_MANAGE_GUILD_FOR_CONFIG !== "false";
const debugMessages = process.env.DEBUG_MESSAGES === "true";
const ttsProvider = process.env.TTS_PROVIDER || "edge";
const edgeTtsVoice = process.env.EDGE_TTS_VOICE || "es-AR-TomasNeural";
const edgeTtsRate = process.env.EDGE_TTS_RATE || "+0%";
const voiceSilenceMs = Number.parseInt(process.env.VOICE_SILENCE_MS || "450", 10);
const voiceTriggerCooldownMs = Number.parseInt(process.env.VOICE_TRIGGER_COOLDOWN_MS || "3500", 10);
const voiceTriggerMaxExtraWords = Number.parseInt(process.env.VOICE_TRIGGER_MAX_EXTRA_WORDS || "1", 10);
const voiceTriggerConfirmWithFull = normalizeVoiceConfirmMode(
  process.env.VOICE_TRIGGER_CONFIRM_WITH_FULL || "short",
);
const voiceTriggerShortMaxChars = Number.parseInt(process.env.VOICE_TRIGGER_SHORT_MAX_CHARS || "4", 10);
const voiceWakeConfirmWithFull = process.env.VOICE_WAKE_CONFIRM_WITH_FULL !== "false";
const codexEnabled = process.env.CODEX_ENABLED !== "false";
const codexWakeWord = normalizeText(process.env.CODEX_WAKE_WORD || "experiencia");
const codexModel = process.env.CODEX_MODEL || "gpt-5.5";
const codexReasoningEffort = process.env.CODEX_REASONING_EFFORT || "low";
const codexTimeoutMs = Number.parseInt(process.env.CODEX_TIMEOUT_MS || "90000", 10);
const codexMaxWords = Number.parseInt(process.env.CODEX_MAX_WORDS || "45", 10);
const codexWakeCooldownMs = Number.parseInt(process.env.CODEX_WAKE_COOLDOWN_MS || "8000", 10);
const codexHoldMusicEnabled = process.env.CODEX_HOLD_MUSIC !== "false";
const codexHoldMusicVolume = Number.parseFloat(process.env.CODEX_HOLD_MUSIC_VOLUME || "0.18");
const clearScanLimit = Number.parseInt(process.env.CLEAR_SCAN_LIMIT || "1000", 10);
const clearMaxScanLimit = Number.parseInt(process.env.CLEAR_MAX_SCAN_LIMIT || "2000", 10);
const bulkDeleteMaxAgeMs = 14 * 24 * 60 * 60 * 1000;
const autoJoinMinMembers = Number.parseInt(process.env.AUTO_JOIN_MIN_MEMBERS || "1", 10);
const autoJoinCooldownMs = Number.parseInt(process.env.AUTO_JOIN_COOLDOWN_MS || "5000", 10);
const autoJoinLeaveWhenEmpty = process.env.AUTO_JOIN_LEAVE_WHEN_EMPTY !== "false";
const autoJoinEmptyCheckDelayMs = Number.parseInt(
  process.env.AUTO_JOIN_EMPTY_CHECK_DELAY_MS || "1200",
  10,
);
const rejoinOnDisconnect = process.env.REJOIN_ON_DISCONNECT !== "false";
const rejoinDelayMs = Number.parseInt(process.env.REJOIN_DELAY_MS || "1500", 10);
const rejoinMaxAttempts = Number.parseInt(process.env.REJOIN_MAX_ATTEMPTS || "5", 10);
const builtInVoiceKeywordAliases = new Map([
  ["peti", ["piti", "pete", "pedi", "pity", "petit"]],
]);
const voiceKeywordAliases = parseVoiceKeywordAliases(process.env.VOICE_KEYWORD_ALIASES || "");
const characterModeDefinitions = {
  normal: "amigo argentino de Discord",
  "bostero-termo": "bostero termo que lleva todo a la cancha, la Libertadores y el aguante",
  "tio-borracho": "tio borracho de asado que opina de todo con confianza dudosa",
  "relator-futbol": "relator de futbol que narra la vida como jugada peligrosa",
  "tecnico-ascenso": "tecnico de ascenso, barro, excusas y pizarron roto",
  "npc-kiosco": "NPC de kiosco argentino, seco, absurdo y con comentario de mostrador",
};
const defaultCharacterMode = normalizeCharacterMode(process.env.CODEX_CHARACTER_MODE || "normal");
const aiTriggerVariationHints = [
  "angulo gaming: aim, ranked, tutorial, team, derrota o MMR",
  "angulo seco de Discord: comentario cortito, sin metafora larga",
  "angulo bardo de amigo: una chicana directa y un remate",
  "angulo absurdo cotidiano: teclado, silla, lobby, respawn o setup",
  "angulo anti-repeticion: no uses las imagenes mas obvias del lore",
  "angulo minimalista: menos de doce palabras, pegada seca",
  "angulo comparacion simple: peor que algo comun del server",
  "angulo respuesta al paso: como si fuera una frase tirada en voice",
];
const excuseKeywords = uniqueValues(
  parseList(process.env.EXCUSE_KEYWORDS || "lag, tecla, bug").map(normalizeText),
);
const excuseKeywordSet = new Set(excuseKeywords);
const lastResponseByChannel = new Map();
const lastVoiceTriggerByGuild = new Map();
const lastCodexWakeByGuild = new Map();
const lastAutoJoinByGuild = new Map();
const lastVoiceChannelByGuild = new Map();
const recentAiTriggerAnswers = new Map();
const guildStores = new Map();
const rejoinAttemptsByGuild = new Map();
const rejoinTimersByGuild = new Map();
const emptyVoiceCheckTimersByGuild = new Map();
const activeSpeechGuilds = new Set();
const activeCodexGuilds = new Set();
const speechQueues = new Map();
const audioPlayers = new Map();
const activeReceivers = new Set();
const activeVoiceSegments = new Set();
const intentionalVoiceDisconnects = new Set();
const voskRequests = new Map();
const botRootPath = fileURLToPath(new URL("..", import.meta.url));
const dataFilePath = fileURLToPath(new URL("../data/triggers.json", import.meta.url));
const guildDataDirPath = fileURLToPath(new URL("../data/guilds", import.meta.url));
const debugLogPath = fileURLToPath(new URL("../data/debug.log", import.meta.url));
const codexDirPath = fileURLToPath(new URL("../data/codex", import.meta.url));
const codexSkillPath = fileURLToPath(new URL("../CODEX_SKILL.md", import.meta.url));
const holdMusicPath = fileURLToPath(new URL("../data/hold-music/elevator-loop.wav", import.meta.url));
const ttsDirPath = fileURLToPath(new URL("../data/tts", import.meta.url));
const ttsCacheDirPath = fileURLToPath(new URL("../data/tts-cache", import.meta.url));
const voiceDirPath = fileURLToPath(new URL("../data/voice", import.meta.url));
const voskModelPath = fileURLToPath(new URL("../models/vosk-model-small-es-0.42", import.meta.url));
const transcribeScriptPath = fileURLToPath(new URL("../scripts/transcribe_vosk.py", import.meta.url));
const voskWorkerScriptPath = fileURLToPath(new URL("../scripts/vosk_worker.py", import.meta.url));
const edgeTtsScriptPath = fileURLToPath(new URL("../scripts/synthesize_edge_tts.py", import.meta.url));
let legacyTriggerStore = null;
let legacyTriggerStoreLoaded = false;
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

client.once(Events.ClientReady, async () => {
  console.log(`VIEJO bot conectado como ${client.user.tag}`);
  console.log(`Prefijo de administracion: ${commandPrefix}`);
  console.log(`Servidores conectados: ${client.guilds.cache.size}`);
  console.log(`Config por servidor: data/guilds/<server-id>.json`);
  console.log(`Voz: ${ttsProvider === "edge" ? edgeTtsVoice : "Windows SAPI"}`);
  if (codexEnabled) {
    console.log(`Wake Codex: ${codexWakeWord} -> ${codexModel}`);
  }
  console.log(`Autojoin default: ${defaultAutoJoinMode}; rejoin: ${rejoinOnDisconnect ? "on" : "off"}`);
  const voiceAliasSummary = formatVoiceKeywordAliases();
  if (voiceAliasSummary) {
    console.log(`Aliases de voz: ${voiceAliasSummary}`);
  }
  await migrateLegacyStoresOnReady().catch((error) =>
    console.error("No pude migrar configuracion vieja:", error),
  );
  await registerSlashCommands().catch((error) =>
    console.error("No pude registrar slash commands:", error),
  );
  getVoskWorker();
  ensureCodexHoldMusic().catch((error) => console.error("No pude preparar musica de espera:", error));
  autoJoinMostOnReady().catch((error) => console.error("No pude hacer autojoin inicial:", error));
  prewarmSpeechCache().catch((error) => console.error("No pude precachear audios:", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  await debugLog(
    `message guild=${message.guild.name} channel=${message.channelId} author=${message.author.tag} length=${message.content.length}`,
  );

  if (isClearMessagesCommand(message.content)) {
    await debugLog("clear messages command matched");
    await handleClearMessagesCommand(message);
    return;
  }

  if (isCommand(message.content)) {
    await debugLog("command matched");
    await handleCommand(message);
    return;
  }

  const store = await getGuildStore(message.guild.id);
  await recordExcuseHits(message.guild.id, message.author.id, message.content, store, {
    member: message.member,
    user: message.author,
    source: "text",
  });

  const aiTrigger = codexEnabled ? findMatchingAiTrigger(message.content, store) : null;
  await debugLog(`ai trigger ${aiTrigger ? `matched keyword=${aiTrigger.keyword}` : "missed"}`);
  if (aiTrigger) {
    await handleCodexVoiceQuestion(
      message.guild.id,
      message.author.id,
      buildAiTriggerQuestion(aiTrigger, message.content),
      { aiTrigger, message, sourceText: message.content },
    );
    return;
  }

  const trigger = findMatchingTrigger(message.content, store);
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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    await debugLog(
      `slash guild=${interaction.guild.name} channel=${interaction.channelId} user=${interaction.user.tag} command=${interaction.commandName}`,
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await handleSlashCommand(interaction);
  } catch (error) {
    console.error("No pude procesar slash command:", error);
    await debugLog(`slash command failed: ${error.message}`);

    if (interaction.isRepliable()) {
      const payload = {
        content: "Se rompio algo procesando el comando. Lo revise en logs.",
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: payload.content }).catch(() => {});
      } else if (interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    await handleSelfVoiceReconnect(oldState, newState);
    await handleVoiceStateAutoJoin(oldState, newState);
  } catch (error) {
    console.error("No pude procesar estado de voz:", error);
    debugLog(`voice state failed: ${error.message}`).catch(() => {});
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

function buildSlashCommands() {
  return [
    {
      name: "join",
      description: "Hace que el bot entre a tu canal de voz.",
    },
    {
      name: "joinmost",
      description: "Hace que el bot entre al canal de voz con mas personas.",
    },
    {
      name: "leave",
      description: "Hace que el bot salga del canal de voz.",
    },
    {
      name: "autojoin",
      description: "Configura la entrada automatica en este servidor.",
      options: [
        {
          name: "modo",
          description: "Modo de autojoin.",
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: "ver estado", value: "status" },
            { name: "entrar al primero", value: "on" },
            { name: "seguir el mas poblado", value: "most" },
            { name: "apagado", value: "off" },
          ],
        },
      ],
    },
    {
      name: "add",
      description: "Agrega keywords y respuestas en este servidor.",
      options: [
        {
          name: "keywords",
          description: "Una o varias keywords separadas por coma.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "respuestas",
          description: "Una o varias respuestas separadas por | o coma.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "addai",
      description: "Agrega keywords que activan Codex con contexto.",
      options: [
        {
          name: "keywords",
          description: "Una o varias keywords AI separadas por coma.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "contexto",
          description: "Contexto que Codex usa cuando se activa la keyword.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "remove",
      description: "Elimina una keyword o una respuesta de este servidor.",
      options: [
        {
          name: "keywords",
          description: "Una o varias keywords separadas por coma.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "respuesta",
          description: "Opcional: elimina solo esta respuesta.",
          type: ApplicationCommandOptionType.String,
          required: false,
        },
      ],
    },
    {
      name: "removeai",
      description: "Elimina una keyword AI de este servidor.",
      options: [
        {
          name: "keywords",
          description: "Una o varias keywords AI separadas por coma.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "list",
      description: "Muestra las keywords registradas en este servidor.",
    },
    {
      name: "listai",
      description: "Muestra las keywords AI registradas en este servidor.",
    },
    {
      name: "clear-keywords",
      description: "Borra todas las keywords de este servidor.",
    },
    {
      name: "clearai",
      description: "Borra todas las keywords AI de este servidor.",
    },
    {
      name: "molestar",
      description: "Marca un usuario para que Codex lo descanse un poco mas.",
      options: [
        {
          name: "usuario",
          description: "Usuario al que el bot puede molestar mas.",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: "contexto",
          description: "Dato o chiste recurrente para bardearlo.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "intensidad",
          description: "Nivel de bardo.",
          type: ApplicationCommandOptionType.Integer,
          required: false,
          minValue: 1,
          maxValue: 3,
          choices: [
            { name: "tranqui", value: 1 },
            { name: "normal", value: 2 },
            { name: "sin piedad", value: 3 },
          ],
        },
      ],
    },
    {
      name: "dejar-de-molestar",
      description: "Saca a un usuario de la lista de bardo especial.",
      options: [
        {
          name: "usuario",
          description: "Usuario que ya no queda marcado.",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
    },
    {
      name: "molestados",
      description: "Muestra los usuarios marcados para bardo especial.",
    },
    {
      name: "apodo",
      description: "Registra un apodo interno para un usuario.",
      options: [
        {
          name: "usuario",
          description: "Usuario que recibe el apodo.",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
        {
          name: "apodo",
          description: "Apodo que Codex puede usar.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "quitar-apodo",
      description: "Borra el apodo interno de un usuario.",
      options: [
        {
          name: "usuario",
          description: "Usuario al que se le borra el apodo.",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
    },
    {
      name: "apodos",
      description: "Muestra los apodos registrados en este servidor.",
    },
    {
      name: "lore",
      description: "Registra una frase privada o lore interno del server.",
      options: [
        {
          name: "texto",
          description: "Frase, historia o chiste recurrente.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "borrar-lore",
      description: "Borra una frase de lore por ID.",
      options: [
        {
          name: "id",
          description: "ID mostrado en /lore-list.",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
      ],
    },
    {
      name: "lore-list",
      description: "Muestra el lore interno registrado.",
    },
    {
      name: "personaje",
      description: "Cambia el modo personaje de Codex.",
      options: [
        {
          name: "modo",
          description: "Personaje activo.",
          type: ApplicationCommandOptionType.String,
          required: false,
          choices: [
            { name: "normal", value: "normal" },
            { name: "bostero termo", value: "bostero-termo" },
            { name: "tio borracho", value: "tio-borracho" },
            { name: "relator de futbol", value: "relator-futbol" },
            { name: "tecnico de ascenso", value: "tecnico-ascenso" },
            { name: "npc de kiosco", value: "npc-kiosco" },
          ],
        },
      ],
    },
    {
      name: "excusas",
      description: "Muestra el ranking de excusas del server.",
    },
    {
      name: "reset-excusas",
      description: "Resetea el contador de excusas.",
      options: [
        {
          name: "usuario",
          description: "Opcional: resetear solo a este usuario.",
          type: ApplicationCommandOptionType.User,
          required: false,
        },
      ],
    },
    {
      name: "clear",
      description: "Borra mensajes escritos del bot y de usuarios que usaron el bot.",
      options: [
        {
          name: "limite",
          description: "Cantidad de mensajes recientes a escanear.",
          type: ApplicationCommandOptionType.Integer,
          required: false,
          minValue: 1,
          maxValue: clearMaxScanLimit,
        },
      ],
    },
    {
      name: "help",
      description: "Muestra los comandos del bot.",
    },
  ];
}

async function registerSlashCommands() {
  const commands = buildSlashCommands();
  let registeredGuilds = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      registeredGuilds += 1;
      await debugLog(`slash commands registered guild=${guild.id} count=${commands.length}`);
    } catch (error) {
      console.error(`No pude registrar slash commands en ${guild.name}:`, error.message);
      await debugLog(`slash commands register failed guild=${guild.id} error=${error.message}`);
    }
  }

  console.log(`Slash commands registrados: ${commands.length} comandos en ${registeredGuilds} servidores`);
}

async function handleSlashCommand(interaction) {
  const context = await createInteractionContext(interaction);

  switch (interaction.commandName) {
    case "join":
      await joinUserVoiceChannel(context);
      break;

    case "joinmost":
      await joinMostPopulatedVoiceChannel(context);
      break;

    case "leave":
      await leaveVoiceChannel(context);
      break;

    case "autojoin": {
      const mode = interaction.options.getString("modo") || "";
      await configureAutoJoin(context, mode);
      break;
    }

    case "add": {
      const keywords = interaction.options.getString("keywords", true);
      const responses = interaction.options.getString("respuestas", true);
      await addTriggers(context, `${keywords} => ${responses}`);
      break;
    }

    case "addai": {
      const keywords = interaction.options.getString("keywords", true);
      const aiContext = interaction.options.getString("contexto", true);
      await addAiTriggers(context, `${keywords} => ${aiContext}`);
      break;
    }

    case "remove": {
      const keywords = interaction.options.getString("keywords", true);
      const response = interaction.options.getString("respuesta");
      await removeTriggerData(context, response ? `${keywords} => ${response}` : keywords);
      break;
    }

    case "removeai": {
      const keywords = interaction.options.getString("keywords", true);
      await removeAiTriggers(context, keywords);
      break;
    }

    case "list":
      await listTriggers(context);
      break;

    case "listai":
      await listAiTriggers(context);
      break;

    case "clear-keywords":
      await clearTriggers(context);
      break;

    case "clearai":
      await clearAiTriggers(context);
      break;

    case "molestar": {
      const user = interaction.options.getUser("usuario", true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const note = interaction.options.getString("contexto", true);
      const level = interaction.options.getInteger("intensidad") || 2;
      await upsertRoastTarget(context, { user, member, note, level });
      break;
    }

    case "dejar-de-molestar": {
      const user = interaction.options.getUser("usuario", true);
      await removeRoastTarget(context, { user });
      break;
    }

    case "molestados":
      await listRoastTargets(context);
      break;

    case "apodo": {
      const user = interaction.options.getUser("usuario", true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const nickname = interaction.options.getString("apodo", true);
      await upsertNickname(context, { user, member, nickname });
      break;
    }

    case "quitar-apodo": {
      const user = interaction.options.getUser("usuario", true);
      await removeNickname(context, { user });
      break;
    }

    case "apodos":
      await listNicknames(context);
      break;

    case "lore": {
      const text = interaction.options.getString("texto", true);
      await addLoreItem(context, text);
      break;
    }

    case "borrar-lore": {
      const id = interaction.options.getString("id", true);
      await removeLoreItem(context, id);
      break;
    }

    case "lore-list":
      await listLoreItems(context);
      break;

    case "personaje": {
      const mode = interaction.options.getString("modo") || "";
      await configureCharacterMode(context, mode);
      break;
    }

    case "excusas":
      await listExcuseCounts(context);
      break;

    case "reset-excusas": {
      const user = interaction.options.getUser("usuario");
      await resetExcuseCounts(context, { user });
      break;
    }

    case "clear": {
      const limit = interaction.options.getInteger("limite");
      context.content = `${clearMessagesCommand}${limit ? ` ${limit}` : ""}`;
      await handleClearMessagesCommand(context);
      break;
    }

    case "help":
    default:
      await sendHelp(context);
      break;
  }
}

async function createInteractionContext(interaction) {
  const member =
    (await interaction.guild.members.fetch(interaction.user.id).catch(() => null)) ||
    interaction.member;
  const channel =
    interaction.channel ||
    (await interaction.guild.channels.fetch(interaction.channelId).catch(() => null));

  return {
    interaction,
    guild: interaction.guild,
    member,
    channel,
    channelId: interaction.channelId,
    content: `/${interaction.commandName}`,
    author: interaction.user,
  };
}

async function handleCommand(message) {
  const rawArgs = message.content.slice(commandPrefix.length).trim();
  const [command = "help", ...rest] = rawArgs.split(/\s+/);
  const payload = rest.join(" ").trim();

  switch (normalizeText(command)) {
    case "join":
    case "entrar":
      await joinUserVoiceChannel(message);
      break;

    case "joinmost":
    case "mas":
    case "popular":
      await joinMostPopulatedVoiceChannel(message);
      break;

    case "autojoin":
    case "autoentrar":
      await configureAutoJoin(message, payload);
      break;

    case "leave":
    case "salir":
      await leaveVoiceChannel(message);
      break;

    case "add":
    case "agregar":
      await addTriggers(message, payload);
      break;

    case "addai":
    case "agregarai":
    case "ia":
      await addAiTriggers(message, payload);
      break;

    case "remove":
    case "rm":
    case "delete":
    case "eliminar":
      await removeTriggerData(message, payload);
      break;

    case "removeai":
    case "rmai":
    case "eliminarai":
      await removeAiTriggers(message, payload);
      break;

    case "list":
    case "lista":
      await listTriggers(message);
      break;

    case "listai":
    case "listaai":
      await listAiTriggers(message);
      break;

    case "clear":
    case "limpiar":
      await clearTriggers(message);
      break;

    case "clearai":
    case "limpiarai":
      await clearAiTriggers(message);
      break;

    case "molestar":
    case "bardear":
    case "descansar":
      await upsertRoastTargetFromPayload(message, payload);
      break;

    case "dejar de molestar":
    case "dejar-de-molestar":
    case "perdonar":
    case "indultar":
      await removeRoastTargetFromPayload(message, payload);
      break;

    case "molestados":
    case "bardeados":
    case "descansados":
      await listRoastTargets(message);
      break;

    case "apodo":
    case "apodar":
      await upsertNicknameFromPayload(message, payload);
      break;

    case "quitar-apodo":
    case "sacar-apodo":
      await removeNicknameFromPayload(message, payload);
      break;

    case "apodos":
      await listNicknames(message);
      break;

    case "lore":
      if (payload) {
        await addLoreItem(message, payload);
      } else {
        await listLoreItems(message);
      }
      break;

    case "borrar-lore":
    case "quitar-lore":
      await removeLoreItem(message, payload);
      break;

    case "lore-list":
    case "lores":
      await listLoreItems(message);
      break;

    case "personaje":
    case "modo":
      await configureCharacterMode(message, payload);
      break;

    case "excusas":
      await listExcuseCounts(message);
      break;

    case "reset-excusas":
      await resetExcuseCountsFromPayload(message, payload);
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

  const result = await joinGuildVoiceChannel(voiceChannel);
  if (result.ok) {
    await queueSpeech(message.guild.id, "listo");
    await sendReply(message, {
      content: `Listo, me uni a ${voiceChannel.name}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await sendReply(message, {
    content: result.message,
    allowedMentions: { repliedUser: false },
  });
}

async function joinMostPopulatedVoiceChannel(message) {
  const voiceChannel = findMostPopulatedVoiceChannel(message.guild);

  if (!voiceChannel) {
    await sendReply(message, {
      content: "No encontre un canal de voz con gente y permisos para entrar.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const result = await joinGuildVoiceChannel(voiceChannel);
  if (result.ok) {
    await queueSpeech(message.guild.id, "listo");
    await sendReply(message, {
      content: `Listo, entre al canal con mas gente: ${voiceChannel.name}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await sendReply(message, {
    content: result.message,
    allowedMentions: { repliedUser: false },
  });
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

  markIntentionalVoiceDisconnect(message.guild.id);
  destroyVoiceConnection(connection, message.guild.id);
  await sendReply(message, {
    content: "Sali del canal de voz.",
    allowedMentions: { repliedUser: false },
  });
}

async function configureAutoJoin(message, payload) {
  if (!(await canEditConfig(message))) return;

  const requestedMode = normalizeAutoJoinMode(payload || "status");
  const currentAutoJoinMode = await getGuildAutoJoinMode(message.guild.id);

  if (requestedMode === "status") {
    await sendReply(message, {
      content: `Autojoin actual en este servidor: ${describeAutoJoinMode(currentAutoJoinMode)}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await setGuildAutoJoinMode(message.guild.id, requestedMode);

  if (requestedMode === "most") {
    const voiceChannel = findMostPopulatedVoiceChannel(message.guild);
    if (voiceChannel) {
      const result = await joinGuildVoiceChannel(voiceChannel);
      await sendReply(message, {
        content: result.ok
          ? `Autojoin activado: voy a seguir el canal con mas gente. Ahora entre a ${voiceChannel.name}.`
          : `Autojoin activado, pero no pude entrar ahora: ${result.message}`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }
  }

  if (requestedMode === "first" && message.member?.voice?.channel) {
    await joinGuildVoiceChannel(message.member.voice.channel);
  }

  await sendReply(message, {
    content: `Autojoin en este servidor: ${describeAutoJoinMode(requestedMode)}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function joinGuildVoiceChannel(voiceChannel) {
  const permissions = voiceChannel.permissionsFor(client.user);
  if (
    !permissions?.has(PermissionFlagsBits.Connect) ||
    !permissions?.has(PermissionFlagsBits.Speak)
  ) {
    return { ok: false, message: "No tengo permiso para conectarme y hablar en ese canal de voz." };
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
    setupVoiceReceiver(connection, voiceChannel.guild.id);
    lastVoiceChannelByGuild.set(voiceChannel.guild.id, voiceChannel.id);
    rejoinAttemptsByGuild.delete(voiceChannel.guild.id);
    clearVoiceRejoinTimer(voiceChannel.guild.id);
    intentionalVoiceDisconnects.delete(voiceChannel.guild.id);
    scheduleLeaveIfAlone(voiceChannel.guild);
    return { ok: true, connection };
  } catch (error) {
    destroyVoiceConnection(connection, voiceChannel.guild.id);
    console.error("No pude entrar al canal de voz:", error);
    return {
      ok: false,
      message: "No pude conectarme al canal de voz. Revisa permisos o intenta otra vez.",
    };
  }
}

async function handleVoiceStateAutoJoin(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const autoJoinMode = await getGuildAutoJoinMode(guild.id);
  if (autoJoinMode === "off") return;

  scheduleLeaveIfAlone(guild);

  if (autoJoinMode === "first") {
    if (isAutoJoinOnCooldown(guild.id)) return;
    if (!newState.channel || oldState.channelId === newState.channelId) return;
    if (getVoiceConnection(guild.id)) return;

    markAutoJoinAttempt(guild.id);
    await debugLog(`autojoin first channel=${newState.channel.name}`);
    await joinGuildVoiceChannel(newState.channel);
    return;
  }

  if (autoJoinMode === "most") {
    const targetChannel = findMostPopulatedVoiceChannel(guild);
    const connection = getVoiceConnection(guild.id);

    if (!targetChannel) {
      if (autoJoinLeaveWhenEmpty && connection) {
        leaveVoiceConnectionAsEmpty(connection, guild.id, "autojoin most left empty guild");
      }
      return;
    }

    if (isAutoJoinOnCooldown(guild.id)) return;

    if (connection?.joinConfig?.channelId === targetChannel.id) return;

    markAutoJoinAttempt(guild.id);
    await debugLog(`autojoin most channel=${targetChannel.name}`);
    await joinGuildVoiceChannel(targetChannel);
  }
}

async function autoJoinMostOnReady() {
  for (const guild of client.guilds.cache.values()) {
    const autoJoinMode = await getGuildAutoJoinMode(guild.id);
    if (autoJoinMode !== "most") continue;

    const targetChannel = findMostPopulatedVoiceChannel(guild);
    if (!targetChannel) {
      await debugLog(`autojoin ready skipped empty guild=${guild.id}`);
      continue;
    }

    markAutoJoinAttempt(guild.id);
    await debugLog(`autojoin ready channel=${targetChannel.name}`);
    await joinGuildVoiceChannel(targetChannel);
  }
}

async function handleSelfVoiceReconnect(oldState, newState) {
  if (!rejoinOnDisconnect) return;

  const botId = client.user?.id;
  const stateUserId = newState.id || newState.member?.id || oldState.id || oldState.member?.id;
  if (!botId || stateUserId !== botId) return;

  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  if (newState.channelId) {
    lastVoiceChannelByGuild.set(guild.id, newState.channelId);
    rejoinAttemptsByGuild.delete(guild.id);
    clearVoiceRejoinTimer(guild.id);
    await debugLog(`self voice channel guild=${guild.id} channel=${newState.channelId}`);
    return;
  }

  const oldChannelId = oldState.channelId || lastVoiceChannelByGuild.get(guild.id);
  if (!oldChannelId) return;

  if (intentionalVoiceDisconnects.delete(guild.id)) {
    await debugLog(`rejoin skipped intentional guild=${guild.id}`);
    return;
  }

  const attempt = (rejoinAttemptsByGuild.get(guild.id) || 0) + 1;
  if (attempt > rejoinMaxAttempts) {
    await debugLog(`rejoin skipped max attempts guild=${guild.id} channel=${oldChannelId}`);
    return;
  }

  rejoinAttemptsByGuild.set(guild.id, attempt);
  activeReceivers.delete(guild.id);
  scheduleVoiceRejoin(guild, oldChannelId, attempt);
}

async function rejoinVoiceChannelById(guild, channelId, attempt) {
  rejoinTimersByGuild.delete(guild.id);

  const existingConnection = getVoiceConnection(guild.id);
  if (existingConnection) {
    const status = existingConnection.state?.status || "unknown";
    const currentChannelId = existingConnection.joinConfig?.channelId || "unknown";

    if (status === VoiceConnectionStatus.Ready && currentChannelId === channelId) {
      await debugLog(`rejoin skipped already ready guild=${guild.id} channel=${channelId}`);
      rejoinAttemptsByGuild.delete(guild.id);
      return;
    }

    await debugLog(
      `rejoin destroying stale connection guild=${guild.id} status=${status} channel=${currentChannelId}`,
    );
    destroyVoiceConnection(existingConnection, guild.id);
  }

  const voiceChannel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!voiceChannel || !isJoinableVoiceChannel(voiceChannel)) {
    await debugLog(`rejoin target unavailable guild=${guild.id} channel=${channelId}`);
    scheduleNextVoiceRejoin(guild, channelId, attempt);
    return;
  }

  if (autoJoinLeaveWhenEmpty && countHumanVoiceMembers(voiceChannel) < autoJoinMinMembers) {
    await debugLog(`rejoin skipped empty channel guild=${guild.id} channel=${channelId}`);
    rejoinAttemptsByGuild.delete(guild.id);
    return;
  }

  await debugLog(`rejoin attempt guild=${guild.id} channel=${voiceChannel.name} attempt=${attempt}`);
  const result = await joinGuildVoiceChannel(voiceChannel);
  if (!result.ok) {
    await debugLog(`rejoin attempt failed guild=${guild.id} message=${result.message}`);
    scheduleNextVoiceRejoin(guild, channelId, attempt);
  }
}

function scheduleVoiceRejoin(guild, channelId, attempt) {
  if (attempt > rejoinMaxAttempts) {
    debugLog(`rejoin skipped max attempts guild=${guild.id} channel=${channelId}`).catch(() => {});
    return;
  }

  const existingTimer = rejoinTimersByGuild.get(guild.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  debugLog(`rejoin scheduled guild=${guild.id} channel=${channelId} attempt=${attempt}`).catch(() => {});
  const timer = setTimeout(() => {
    rejoinVoiceChannelById(guild, channelId, attempt).catch((error) => {
      console.error("No pude reconectar al canal de voz:", error);
      debugLog(`rejoin failed: ${error.message}`).catch(() => {});
      scheduleNextVoiceRejoin(guild, channelId, attempt);
    });
  }, rejoinDelayMs);

  rejoinTimersByGuild.set(guild.id, timer);
}

function scheduleNextVoiceRejoin(guild, channelId, attempt) {
  const nextAttempt = attempt + 1;
  rejoinAttemptsByGuild.set(guild.id, nextAttempt);
  scheduleVoiceRejoin(guild, channelId, nextAttempt);
}

function scheduleLeaveIfAlone(guild) {
  if (!autoJoinLeaveWhenEmpty) return;

  const existingTimer = emptyVoiceCheckTimersByGuild.get(guild.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    emptyVoiceCheckTimersByGuild.delete(guild.id);
    leaveIfBotIsAlone(guild).catch((error) => {
      console.error("No pude verificar si el bot quedo solo:", error);
      debugLog(`empty voice check failed: ${error.message}`).catch(() => {});
    });
  }, autoJoinEmptyCheckDelayMs);

  emptyVoiceCheckTimersByGuild.set(guild.id, timer);
}

async function leaveIfBotIsAlone(guild) {
  const connection = getVoiceConnection(guild.id);
  if (!connection) return;

  const channelId = connection.joinConfig?.channelId || lastVoiceChannelByGuild.get(guild.id);
  if (!channelId) return;

  const voiceChannel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!voiceChannel || !isJoinableVoiceChannel(voiceChannel)) return;

  const humanMembers = countHumanVoiceMembers(voiceChannel);
  await debugLog(`empty voice check channel=${voiceChannel.name} humans=${humanMembers}`);

  if (humanMembers >= autoJoinMinMembers) return;

  leaveVoiceConnectionAsEmpty(connection, guild.id, "left voice channel because bot was alone");
}

function leaveVoiceConnectionAsEmpty(connection, guildId, reason) {
  markIntentionalVoiceDisconnect(guildId);
  destroyVoiceConnection(connection, guildId);
  debugLog(reason).catch(() => {});
}

function findMostPopulatedVoiceChannel(guild) {
  return [...guild.channels.cache.values()]
    .filter(isJoinableVoiceChannel)
    .map((channel) => ({
      channel,
      humanMembers: countHumanVoiceMembers(channel),
    }))
    .filter((candidate) => candidate.humanMembers >= autoJoinMinMembers)
    .sort((left, right) => {
      if (right.humanMembers !== left.humanMembers) {
        return right.humanMembers - left.humanMembers;
      }

      return left.channel.position - right.channel.position;
    })[0]?.channel || null;
}

function countHumanVoiceMembers(channel) {
  return channel.members?.filter(
    (member) => !member.user.bot && member.voice?.channelId === channel.id,
  ).size || 0;
}

function isJoinableVoiceChannel(channel) {
  if (typeof channel.isVoiceBased !== "function" || !channel.isVoiceBased()) return false;

  const permissions = channel.permissionsFor(client.user);
  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
      permissions?.has(PermissionFlagsBits.Connect) &&
      permissions?.has(PermissionFlagsBits.Speak),
  );
}

function isAutoJoinOnCooldown(guildId) {
  const lastAttemptAt = lastAutoJoinByGuild.get(guildId) || 0;
  return Date.now() - lastAttemptAt < autoJoinCooldownMs;
}

function markAutoJoinAttempt(guildId) {
  lastAutoJoinByGuild.set(guildId, Date.now());
}

function markIntentionalVoiceDisconnect(guildId) {
  intentionalVoiceDisconnects.add(guildId);
  clearVoiceRejoinTimer(guildId);
  rejoinAttemptsByGuild.delete(guildId);
}

function destroyVoiceConnection(connection, guildId) {
  try {
    connection.destroy();
  } catch (error) {
    debugLog(`voice destroy ignored: ${error.message}`).catch(() => {});
  }

  activeReceivers.delete(guildId);
}

function clearVoiceRejoinTimer(guildId) {
  const timer = rejoinTimersByGuild.get(guildId);
  if (!timer) return;

  clearTimeout(timer);
  rejoinTimersByGuild.delete(guildId);
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
  const store = await getGuildStore(message.guild.id);

  for (const keyword of parsed.keywords) {
    const trigger = getOrCreateTrigger(store, keyword);
    const before = trigger.responses.length;
    trigger.responses = uniqueValues([...trigger.responses, ...parsed.responses]);
    addedResponses += trigger.responses.length - before;
    addedKeywords += before === 0 ? 1 : 0;
  }

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Registrado en este servidor. Keywords: ${parsed.keywords.join(", ")}. Respuestas nuevas: ${addedResponses}.`,
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
  const store = await getGuildStore(message.guild.id);

  for (const keyword of parsed.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    const triggerIndex = store.triggers.findIndex(
      (trigger) => normalizeText(trigger.keyword) === normalizedKeyword,
    );

    if (triggerIndex === -1) continue;

    if (!parsed.responses.length) {
      store.triggers.splice(triggerIndex, 1);
      removedKeywords += 1;
      continue;
    }

    const trigger = store.triggers[triggerIndex];
    const responsesToRemove = new Set(parsed.responses.map(normalizeText));
    const before = trigger.responses.length;
    trigger.responses = trigger.responses.filter(
      (response) => !responsesToRemove.has(normalizeText(response)),
    );
    removedResponses += before - trigger.responses.length;

    if (!trigger.responses.length) {
      store.triggers.splice(triggerIndex, 1);
      removedKeywords += 1;
    }
  }

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Eliminado. Keywords removidas: ${removedKeywords}. Respuestas removidas: ${removedResponses}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function addAiTriggers(message, payload) {
  if (!(await canEditConfig(message))) return;

  const parsed = parseAiTriggerPayload(payload);
  if (!parsed) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} addai mamani => Mamani es malisimo en todos los juegos\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  let added = 0;
  let updated = 0;

  for (const keyword of parsed.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    const existing = store.aiTriggers.find(
      (trigger) => normalizeText(trigger.keyword) === normalizedKeyword,
    );

    if (existing) {
      existing.context = parsed.context;
      updated += 1;
    } else {
      store.aiTriggers.push({
        keyword: normalizedKeyword,
        context: parsed.context,
      });
      added += 1;
    }
  }

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Keyword AI registrada. Nuevas: ${added}. Actualizadas: ${updated}. Contexto: ${parsed.context}`,
    allowedMentions: { repliedUser: false },
  });
}

async function removeAiTriggers(message, payload) {
  if (!(await canEditConfig(message))) return;

  const keywords = parseList(payload);
  if (!keywords.length) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} removeai mamani\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  const keywordsToRemove = new Set(keywords.map(normalizeText));
  const before = store.aiTriggers.length;
  store.aiTriggers = store.aiTriggers.filter(
    (trigger) => !keywordsToRemove.has(normalizeText(trigger.keyword)),
  );
  const removed = before - store.aiTriggers.length;

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Keywords AI removidas: ${removed}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listAiTriggers(message) {
  const store = await getGuildStore(message.guild.id);
  const lines = store.aiTriggers.map((trigger) => `- ${trigger.keyword}: ${trigger.context}`);
  const content = lines.length
    ? `Keywords AI registradas:\n${lines.join("\n")}`
    : "No hay keywords AI registradas todavia.";

  await sendReply(message, {
    content: truncateDiscordMessage(content),
    allowedMentions: { repliedUser: false },
  });
}

async function clearAiTriggers(message) {
  if (!(await canEditConfig(message))) return;

  const store = await getGuildStore(message.guild.id);
  store.aiTriggers = [];
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: "Keywords AI limpiadas en este servidor.",
    allowedMentions: { repliedUser: false },
  });
}

async function listTriggers(message) {
  const store = await getGuildStore(message.guild.id);
  const lines = store.triggers.map((trigger) => {
    const responses = trigger.responses.join(", ");
    return `- ${trigger.keyword}: ${responses}`;
  });

  const content = lines.length
    ? `Keywords registradas en este servidor:\n${lines.join("\n")}`
    : "No hay keywords registradas en este servidor.";

  await sendReply(message, {
    content: truncateDiscordMessage(content),
    allowedMentions: { repliedUser: false },
  });
}

async function clearTriggers(message) {
  if (!(await canEditConfig(message))) return;

  const store = await getGuildStore(message.guild.id);
  store.triggers = [];
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: "Lista de keywords limpiada en este servidor.",
    allowedMentions: { repliedUser: false },
  });
}

async function upsertRoastTargetFromPayload(message, payload) {
  const resolved = await resolveRoastTargetFromPayload(message, payload);
  if (!resolved) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} molestar @usuario este es malo para los juegos\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await upsertRoastTarget(message, { ...resolved, level: 2 });
}

async function removeRoastTargetFromPayload(message, payload) {
  const resolved = await resolveRoastTargetFromPayload(message, payload, { noteRequired: false });
  if (!resolved) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} perdonar @usuario\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await removeRoastTarget(message, resolved);
}

async function resolveRoastTargetFromPayload(message, payload, { noteRequired = true } = {}) {
  const match = payload.match(/<@!?(\d+)>/) || payload.match(/\b(\d{15,25})\b/);
  const userId = match?.[1];
  if (!userId) return null;

  const member =
    message.guild.members.cache.get(userId) ||
    (await message.guild.members.fetch(userId).catch(() => null));
  const user =
    member?.user ||
    message.mentions?.users?.get(userId) ||
    (await client.users.fetch(userId).catch(() => null));
  if (!user) return null;

  const note = payload
    .replace(/<@!?\d+>/, "")
    .replace(userId, "")
    .trim();
  if (noteRequired && !cleanRoastNote(note)) return null;

  return { user, member, note };
}

async function upsertRoastTarget(message, { user, member = null, note, level = 2 }) {
  if (!(await canEditConfig(message))) return;

  if (user.bot) {
    await sendReply(message, {
      content: "A los bots no los gasto, ya bastante tienen con existir sin mate.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const cleanNote = cleanRoastNote(note);
  if (!cleanNote) {
    await sendReply(message, {
      content: "Dame un contexto para bardearlo, sino estoy tirando fruta.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  const cleanLevel = sanitizeRoastLevel(level);
  const displayName = cleanPromptField(member?.displayName || user.globalName || user.username);
  const existing = store.roastTargets.find((target) => target.userId === user.id);
  const target = {
    userId: user.id,
    displayName,
    note: cleanNote,
    level: cleanLevel,
  };

  if (existing) {
    Object.assign(existing, target);
  } else {
    store.roastTargets.push(target);
  }

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Listo, ${displayName} queda marcado para descanso nivel ${cleanLevel}: ${cleanNote}`,
    allowedMentions: { repliedUser: false },
  });
}

async function removeRoastTarget(message, { user }) {
  if (!(await canEditConfig(message))) return;

  const store = await getGuildStore(message.guild.id);
  const before = store.roastTargets.length;
  store.roastTargets = store.roastTargets.filter((target) => target.userId !== user.id);
  await saveGuildStore(message.guild.id);

  const displayName = cleanPromptField(user.globalName || user.username || user.id);
  await sendReply(message, {
    content: before === store.roastTargets.length
      ? `${displayName} no estaba marcado. Zafó por ahora.`
      : `${displayName} ya no queda marcado para bardo especial.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listRoastTargets(message) {
  const store = await getGuildStore(message.guild.id);
  const targets = store.roastTargets || [];

  if (!targets.length) {
    await sendReply(message, {
      content: "No hay nadie marcado para bardo especial. Discord en modo jardin de infantes.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const lines = [];
  for (const target of targets) {
    const member =
      message.guild.members.cache.get(target.userId) ||
      (await message.guild.members.fetch(target.userId).catch(() => null));
    lines.push(`- ${formatRoastTarget(target, member)}.`);
  }

  await sendReply(message, {
    content: truncateDiscordMessage(`Usuarios marcados para molestar:\n${lines.join("\n")}`),
    allowedMentions: { repliedUser: false },
  });
}

async function upsertNicknameFromPayload(message, payload) {
  const resolved = await resolveRoastTargetFromPayload(message, payload);
  if (!resolved) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} apodo @usuario el manco\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await upsertNickname(message, {
    user: resolved.user,
    member: resolved.member,
    nickname: resolved.note,
  });
}

async function removeNicknameFromPayload(message, payload) {
  const resolved = await resolveRoastTargetFromPayload(message, payload, { noteRequired: false });
  if (!resolved) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} quitar-apodo @usuario\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await removeNickname(message, resolved);
}

async function upsertNickname(message, { user, member = null, nickname }) {
  if (!(await canEditConfig(message))) return;

  const cleanNickname = cleanNicknameText(nickname);
  if (!cleanNickname) {
    await sendReply(message, {
      content: "Dame un apodo con algo de sustancia, no ese humo vacio.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  const displayName = cleanPromptField(member?.displayName || user.globalName || user.username);
  const existing = store.nicknames.find((entry) => entry.userId === user.id);
  const entry = {
    userId: user.id,
    displayName,
    nickname: cleanNickname,
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    store.nicknames.push(entry);
  }

  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Listo, ${displayName} ahora figura como "${cleanNickname}".`,
    allowedMentions: { repliedUser: false },
  });
}

async function removeNickname(message, { user }) {
  if (!(await canEditConfig(message))) return;

  const store = await getGuildStore(message.guild.id);
  const before = store.nicknames.length;
  store.nicknames = store.nicknames.filter((entry) => entry.userId !== user.id);
  await saveGuildStore(message.guild.id);

  const displayName = cleanPromptField(user.globalName || user.username || user.id);
  await sendReply(message, {
    content: before === store.nicknames.length
      ? `${displayName} no tenia apodo registrado. Increible, una persona sin lore.`
      : `Listo, borre el apodo de ${displayName}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listNicknames(message) {
  const store = await getGuildStore(message.guild.id);
  if (!store.nicknames.length) {
    await sendReply(message, {
      content: "No hay apodos registrados todavia.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const lines = store.nicknames.map((entry) => `- ${entry.displayName || entry.userId}: ${entry.nickname}`);
  await sendReply(message, {
    content: truncateDiscordMessage(`Apodos registrados:\n${lines.join("\n")}`),
    allowedMentions: { repliedUser: false },
  });
}

async function addLoreItem(message, text) {
  if (!(await canEditConfig(message))) return;

  const cleanText = cleanLoreText(text);
  if (!cleanText) {
    await sendReply(message, {
      content: "Dame una frase de lore, maestro. Algo que huela a server privado.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  const item = {
    id: createLoreId(store),
    text: cleanText,
  };

  store.lore.push(item);
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Lore registrado (${item.id}): ${item.text}`,
    allowedMentions: { repliedUser: false },
  });
}

async function removeLoreItem(message, id) {
  if (!(await canEditConfig(message))) return;

  const cleanId = cleanLoreId(id);
  if (!cleanId) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} borrar-lore id\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const store = await getGuildStore(message.guild.id);
  const before = store.lore.length;
  store.lore = store.lore.filter((item) => item.id !== cleanId);
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: before === store.lore.length
      ? `No encontre lore con ID ${cleanId}.`
      : `Listo, borre el lore ${cleanId}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listLoreItems(message) {
  const store = await getGuildStore(message.guild.id);
  if (!store.lore.length) {
    await sendReply(message, {
      content: "No hay lore privado registrado todavia.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const lines = store.lore.map((item) => `- ${item.id}: ${item.text}`);
  await sendReply(message, {
    content: truncateDiscordMessage(`Lore interno del server:\n${lines.join("\n")}`),
    allowedMentions: { repliedUser: false },
  });
}

async function configureCharacterMode(message, payload) {
  if (!(await canEditConfig(message))) return;

  const mode = normalizeCharacterMode(payload);
  const store = await getGuildStore(message.guild.id);

  if (mode === "status") {
    await sendReply(message, {
      content: `Personaje actual: ${describeCharacterMode(store.settings.characterMode)}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  if (!mode) {
    await sendReply(message, {
      content: `Modo invalido. Opciones: ${Object.keys(characterModeDefinitions).join(", ")}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  store.settings.characterMode = mode;
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: `Modo personaje activado: ${describeCharacterMode(mode)}.`,
    allowedMentions: { repliedUser: false },
  });
}

async function listExcuseCounts(message) {
  const store = await getGuildStore(message.guild.id);
  const ranking = [...store.excuseCounts].sort((left, right) => right.count - left.count);

  if (!ranking.length) {
    await sendReply(message, {
      content: `Todavia nadie tiro excusas con ${excuseKeywords.join(", ")}. Raro, capaz estan jugando bien por accidente.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const lines = ranking
    .slice(0, 15)
    .map((entry, index) => `${index + 1}. ${entry.displayName || entry.userId}: ${entry.count}`);
  await sendReply(message, {
    content: truncateDiscordMessage(`Ranking de excusas:\n${lines.join("\n")}`),
    allowedMentions: { repliedUser: false },
  });
}

async function resetExcuseCountsFromPayload(message, payload) {
  if (!payload) {
    await resetExcuseCounts(message, {});
    return;
  }

  const resolved = await resolveRoastTargetFromPayload(message, payload, { noteRequired: false });
  if (!resolved) {
    await sendReply(message, {
      content: `Uso: \`${commandPrefix} reset-excusas @usuario\` o \`${commandPrefix} reset-excusas\``,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await resetExcuseCounts(message, { user: resolved.user });
}

async function resetExcuseCounts(message, { user = null } = {}) {
  if (!(await canEditConfig(message))) return;

  const store = await getGuildStore(message.guild.id);

  if (user) {
    const before = store.excuseCounts.length;
    store.excuseCounts = store.excuseCounts.filter((entry) => entry.userId !== user.id);
    await saveGuildStore(message.guild.id);
    await sendReply(message, {
      content: before === store.excuseCounts.length
        ? "Ese no tenia excusas contadas. Milagro estadistico."
        : `Listo, resetee las excusas de ${cleanPromptField(user.globalName || user.username || user.id)}.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  store.excuseCounts = [];
  await saveGuildStore(message.guild.id);
  await sendReply(message, {
    content: "Ranking de excusas reseteado. Todos vuelven a ser inocentes hasta que digan lag.",
    allowedMentions: { repliedUser: false },
  });
}

async function handleClearMessagesCommand(message) {
  if (!(await canClearMessages(message))) return;

  const scanLimit = parseClearMessagesLimit(message.content);
  await debugLog(`clear messages scan limit=${scanLimit}`);

  const store = await getGuildStore(message.guild.id);
  const scannedMessages = await fetchMessagesForClear(message.channel, scanLimit);
  const messagesToDelete = scannedMessages.filter((candidate) =>
    isBotUsageMessage(candidate, store),
  );
  const result = await deleteMessagesForClear(messagesToDelete);

  await debugLog(
    `clear messages scanned=${scannedMessages.length} matched=${messagesToDelete.length} deleted=${result.deleted} skippedOld=${result.skippedOld} failed=${result.failed}`,
  );

  const parts = [`Limpieza lista: borre ${result.deleted} mensajes.`];
  if (result.skippedOld) {
    parts.push(`No toque ${result.skippedOld} mensajes de mas de 14 dias.`);
  }
  if (result.failed) {
    parts.push(`Fallaron ${result.failed}.`);
  }

  if (message.interaction) {
    await sendReply(message, {
      content: parts.join(" "),
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const notice = await message.channel.send(parts.join(" "));
  setTimeout(() => {
    notice.delete().catch(() => {});
  }, 5000);
}

async function sendHelp(message) {
  await sendReply(message, {
    content: [
      `Comandos slash privados:`,
      `\`/join\` - me uno a tu canal de voz.`,
      `\`/joinmost\` - entro al canal de voz con mas personas.`,
      `\`/autojoin modo:most\` - configuro entrada automatica en este servidor.`,
      `\`/leave\` - salgo del canal de voz.`,
      `\`/add keywords:viejo respuestas:mate | trueno\` - agrega keywords y respuestas.`,
      `\`/addai keywords:mamani contexto:Mamani es malisimo en todos los juegos\` - activa Codex por keyword.`,
      `\`/removeai keywords:mamani\` - elimina una keyword AI.`,
      `\`/listai\` - muestra las keywords AI.`,
      `\`/clearai\` - limpia todas las keywords AI.`,
      `\`/remove keywords:viejo\` - elimina una keyword completa.`,
      `\`/remove keywords:viejo respuesta:mate\` - elimina solo una respuesta.`,
      `\`/list\` - muestra lo registrado en este servidor.`,
      `\`/clear-keywords\` - limpia todas las keywords de este servidor.`,
      `\`/molestar usuario:@alguien contexto:malo para los juegos intensidad:3\` - registra bardo especial.`,
      `\`/dejar-de-molestar usuario:@alguien\` - saca el bardo especial.`,
      `\`/molestados\` - muestra los usuarios marcados.`,
      `\`/apodo usuario:@alguien apodo:el manco\` - registra apodos internos.`,
      `\`/lore texto:frase privada\` - guarda lore recurrente del server.`,
      `\`/personaje modo:bostero termo\` - cambia el personaje de Codex.`,
      `\`/excusas\` - muestra quien llora con lag, tecla o bug.`,
      `\`/clear limite:500\` - borra mensajes escritos del bot y de quienes usaron el bot en este canal.`,
      `Fallback visible: \`${commandPrefix} help\`.`,
    ].join("\n"),
    allowedMentions: { repliedUser: false },
  });
}

async function canEditConfig(message) {
  if (!requireManageGuild) return true;
  if (message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  await sendReply(message, {
    content: "Necesitas permiso de Manage Server para cambiar la configuracion de este servidor.",
    allowedMentions: { repliedUser: false },
  });
  return false;
}

async function canClearMessages(message) {
  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
    await sendReply(message, {
      content: "Necesitas permiso Manage Messages para usar !clear.",
      allowedMentions: { repliedUser: false },
    });
    return false;
  }

  const botMember = message.guild.members.me || (await message.guild.members.fetchMe());
  if (!message.channel?.permissionsFor || !message.channel?.messages?.fetch) {
    await sendReply(message, {
      content: "Necesito que uses este comando dentro de un canal de texto del servidor.",
      allowedMentions: { repliedUser: false },
    });
    return false;
  }

  const botPermissions = message.channel.permissionsFor(botMember);

  if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await sendReply(message, {
      content: "Necesito permiso Manage Messages en este canal para borrar mensajes.",
      allowedMentions: { repliedUser: false },
    });
    return false;
  }

  return true;
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

function normalizeAutoJoinMode(value) {
  const normalizedValue = normalizeText(value);

  if (["on", "si", "yes", "true", "first", "primero", "persona"].includes(normalizedValue)) {
    return "first";
  }

  if (["most", "mas", "popular", "mayoria", "lleno"].includes(normalizedValue)) {
    return "most";
  }

  if (["off", "no", "false", "apagado", "desactivar", "disable"].includes(normalizedValue)) {
    return "off";
  }

  return "status";
}

function normalizeCharacterMode(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue || ["status", "estado", "actual", "ver"].includes(normalizedValue)) {
    return "status";
  }

  if (["normal", "default", "base"].includes(normalizedValue)) return "normal";
  if (["bostero", "bostero termo", "boca", "termo"].includes(normalizedValue)) return "bostero-termo";
  if (["tio", "tio borracho", "borracho", "asado"].includes(normalizedValue)) return "tio-borracho";
  if (["relator", "relator futbol", "relator de futbol", "futbol"].includes(normalizedValue)) {
    return "relator-futbol";
  }
  if (["tecnico", "tecnico ascenso", "tecnico de ascenso", "ascenso"].includes(normalizedValue)) {
    return "tecnico-ascenso";
  }
  if (["npc", "kiosco", "npc kiosco", "npc de kiosco"].includes(normalizedValue)) {
    return "npc-kiosco";
  }

  return null;
}

function normalizeVoiceConfirmMode(value) {
  const normalizedValue = normalizeText(value);

  if (["false", "off", "no", "none", "0"].includes(normalizedValue)) return "off";
  if (["true", "all", "always", "si", "yes", "1"].includes(normalizedValue)) return "all";
  return "short";
}

function describeAutoJoinMode(mode) {
  if (mode === "first") return "activado, entro al canal cuando alguien entra y estoy desconectado";
  if (mode === "most") return "activado, sigo el canal de voz con mas personas";
  return "apagado";
}

function describeCharacterMode(mode) {
  const normalizedMode = characterModeDefinitions[mode] ? mode : "normal";
  return `${normalizedMode}: ${characterModeDefinitions[normalizedMode]}`;
}

function isClearMessagesCommand(content) {
  const trimmed = content.trim().toLowerCase();
  const normalizedCommand = clearMessagesCommand.toLowerCase();
  return trimmed === normalizedCommand || trimmed.startsWith(`${normalizedCommand} `);
}

function parseClearMessagesLimit(content) {
  const [, rawLimit] = content.trim().split(/\s+/);
  const parsedLimit = Number.parseInt(rawLimit || "", 10);
  const requestedLimit = Number.isFinite(parsedLimit) ? parsedLimit : clearScanLimit;
  return Math.max(1, Math.min(requestedLimit, clearMaxScanLimit));
}

function isBotUsageMessage(candidate, store) {
  if (candidate.author?.id === client.user.id) return true;
  if (candidate.author?.bot) return false;

  const content = candidate.content || "";
  if (isClearMessagesCommand(content) || isCommand(content)) return true;
  if (codexEnabled && containsKeyword(content, codexWakeWord)) return true;
  if (codexEnabled && findMatchingAiTrigger(content, store)) return true;

  return Boolean(findMatchingTrigger(content, store));
}

function findMatchingTrigger(content, store) {
  const normalizedContent = ` ${normalizeText(content)} `;
  const triggers = store?.triggers || [];
  return triggers.find((trigger) => {
    const normalizedKeyword = normalizeText(trigger.keyword);
    return normalizedKeyword && normalizedContent.includes(` ${normalizedKeyword} `);
  });
}

function findMatchingVoiceTrigger(content, store) {
  const triggers = store?.triggers || [];
  return findVoiceTriggerMatch(content, triggers)?.entry || null;
}

function findMatchingAiTrigger(content, store) {
  const normalizedContent = ` ${normalizeText(content)} `;
  const triggers = store?.aiTriggers || [];

  return triggers.find((trigger) => {
    const normalizedKeyword = normalizeText(trigger.keyword);
    return normalizedKeyword && normalizedContent.includes(` ${normalizedKeyword} `);
  });
}

function findMatchingVoiceAiTrigger(content, store) {
  const triggers = store?.aiTriggers || [];
  return findVoiceTriggerMatch(content, triggers)?.entry || null;
}

function containsKeyword(content, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return false;

  return ` ${normalizeText(content)} `.includes(` ${normalizedKeyword} `);
}

function findVoiceTriggerMatch(content, entries, options = {}) {
  const words = getNormalizedWords(content);
  if (!words.length) return null;

  for (const entry of entries) {
    for (const candidate of getVoiceTriggerCandidates(entry.keyword)) {
      const candidateWords = getNormalizedWords(candidate);
      if (!candidateWords.length) continue;

      const index = findPhraseIndex(words, candidateWords);
      if (index === -1) continue;

      const extraWords = words.length - candidateWords.length;
      if (extraWords > voiceTriggerMaxExtraWords) continue;

      const match = { entry, candidate, candidateWords, extraWords };
      if (!voiceMatchPassesFullConfirmation(match, options.fullTranscript)) continue;

      return match;
    }
  }

  return null;
}

function voiceMatchPassesFullConfirmation(match, fullTranscript) {
  if (!voiceMatchNeedsFullConfirmation(match)) return true;
  if (typeof fullTranscript !== "string") return true;

  return findPhraseIndex(getNormalizedWords(fullTranscript), match.candidateWords) !== -1;
}

function voiceMatchNeedsFullConfirmation(match) {
  if (voiceTriggerConfirmWithFull === "off") return false;
  if (voiceTriggerConfirmWithFull === "all") return true;

  const charCount = match.candidateWords.join("").length;
  return charCount <= voiceTriggerShortMaxChars;
}

function getNormalizedWords(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function findPhraseIndex(words, phraseWords) {
  if (!words.length || !phraseWords.length || phraseWords.length > words.length) return -1;

  for (let index = 0; index <= words.length - phraseWords.length; index += 1) {
    const matches = phraseWords.every((word, offset) => words[index + offset] === word);
    if (matches) return index;
  }

  return -1;
}

async function recordExcuseHits(guildId, userId, text, store, options = {}) {
  const matches = getExcuseMatches(text);
  if (!matches.length) return 0;

  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  const member =
    options.member ||
    guild?.members.cache.get(userId) ||
    (guild ? await guild.members.fetch(userId).catch(() => null) : null);
  const user = options.user || member?.user || (await client.users.fetch(userId).catch(() => null));
  const displayName = cleanPromptField(member?.displayName || user?.globalName || user?.username || userId);
  const entry = getOrCreateExcuseCount(store, userId, displayName);

  entry.count += matches.length;
  entry.displayName = displayName;
  entry.last = uniqueValues(matches).join(", ");
  entry.updatedAt = new Date().toISOString();

  await saveGuildStore(guildId);
  await debugLog(
    `excuse count guild=${guildId} user=${userId} hits=${matches.length} source=${options.source || "unknown"} words=${entry.last}`,
  );

  return matches.length;
}

function getOrCreateExcuseCount(store, userId, displayName) {
  let entry = store.excuseCounts.find((candidate) => candidate.userId === userId);

  if (!entry) {
    entry = {
      userId,
      displayName,
      count: 0,
      last: "",
      updatedAt: "",
    };
    store.excuseCounts.push(entry);
  }

  return entry;
}

function getExcuseMatches(text) {
  if (!excuseKeywordSet.size) return [];

  return normalizeText(text)
    .split(/\s+/)
    .filter((word) => excuseKeywordSet.has(word));
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

function parseAiTriggerPayload(payload) {
  const parts = payload.split("=>");
  let rawKeywords = parts[0]?.trim() || "";
  let rawContext = parts.slice(1).join("=>").trim();

  if (!rawContext) {
    const [firstWord = "", ...rest] = payload.trim().split(/\s+/);
    rawKeywords = firstWord;
    rawContext = rest.join(" ");
  }

  const keywords = parseList(rawKeywords);
  const context = cleanAiTriggerContext(rawContext);

  if (!keywords.length || !context) return null;
  return { keywords, context };
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

function parseVoiceKeywordAliases(value) {
  const aliases = new Map();

  for (const group of value.split(";")) {
    const [rawKeyword, rawAliases] = group.split(":");
    const keyword = normalizeText(rawKeyword || "");
    const parsedAliases = parseList(rawAliases || "");

    if (keyword && parsedAliases.length) {
      aliases.set(keyword, parsedAliases.map(normalizeText));
    }
  }

  return aliases;
}

function getOrCreateTrigger(store, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  let trigger = store.triggers.find(
    (candidate) => normalizeText(candidate.keyword) === normalizedKeyword,
  );

  if (!trigger) {
    trigger = { keyword: normalizedKeyword, responses: [] };
    store.triggers.push(trigger);
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

async function getGuildStore(guildId) {
  if (guildStores.has(guildId)) {
    return guildStores.get(guildId);
  }

  const storePath = getGuildStorePath(guildId);

  try {
    const rawData = await readFile(storePath, "utf8");
    const store = sanitizeStore(JSON.parse(rawData));
    guildStores.set(guildId, store);
    return store;
  } catch {
    const store = await createInitialGuildStore(guildId);
    guildStores.set(guildId, store);
    await saveStoreToDisk(storePath, store);
    return store;
  }
}

async function saveGuildStore(guildId) {
  const currentStore = guildStores.get(guildId) || (await getGuildStore(guildId));
  const store = sanitizeStore(currentStore);
  guildStores.set(guildId, store);
  await saveStoreToDisk(getGuildStorePath(guildId), store);
}

async function getGuildAutoJoinMode(guildId) {
  const store = await getGuildStore(guildId);
  return store.settings.autoJoinMode;
}

async function setGuildAutoJoinMode(guildId, autoJoinMode) {
  const store = await getGuildStore(guildId);
  store.settings.autoJoinMode = autoJoinMode;
  await saveGuildStore(guildId);
}

async function createInitialGuildStore(guildId) {
  return sanitizeStore({
    triggers: defaultTriggers,
    aiTriggers: [],
    roastTargets: [],
    nicknames: [],
    lore: [],
    excuseCounts: [],
    settings: {
      autoJoinMode: defaultAutoJoinMode,
      characterMode: defaultCharacterMode,
    },
  });
}

async function migrateLegacyStoresOnReady() {
  const guilds = [...client.guilds.cache.values()];
  if (!guilds.length) return;

  const hasAnyGuildStore = (
    await Promise.all(guilds.map((guild) => fileExists(getGuildStorePath(guild.id))))
  ).some(Boolean);

  if (hasAnyGuildStore) return;

  const legacyStore = await loadLegacyTriggerStore();
  if (!legacyStore?.triggers?.length) return;

  for (const guild of guilds) {
    const store = sanitizeStore({
      triggers: legacyStore.triggers,
      aiTriggers: legacyStore.aiTriggers || [],
      roastTargets: legacyStore.roastTargets || [],
      nicknames: legacyStore.nicknames || [],
      lore: legacyStore.lore || [],
      excuseCounts: legacyStore.excuseCounts || [],
      settings: {
        autoJoinMode: defaultAutoJoinMode,
        characterMode: defaultCharacterMode,
      },
    });

    guildStores.set(guild.id, store);
    await saveStoreToDisk(getGuildStorePath(guild.id), store);
  }

  await debugLog(`legacy triggers migrated to guild stores count=${guilds.length}`);
}

async function loadLegacyTriggerStore() {
  if (legacyTriggerStoreLoaded) return legacyTriggerStore;

  legacyTriggerStoreLoaded = true;

  try {
    const rawData = await readFile(dataFilePath, "utf8");
    legacyTriggerStore = sanitizeStore(JSON.parse(rawData));
  } catch {
    legacyTriggerStore = null;
  }

  return legacyTriggerStore;
}

function getGuildStorePath(guildId) {
  return join(guildDataDirPath, `${guildId}.json`);
}

async function saveStoreToDisk(storePath, store) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
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

  return {
    triggers: sanitizedTriggers,
    aiTriggers: sanitizeAiTriggers(store?.aiTriggers),
    roastTargets: sanitizeRoastTargets(store?.roastTargets),
    nicknames: sanitizeNicknames(store?.nicknames),
    lore: sanitizeLoreItems(store?.lore),
    excuseCounts: sanitizeExcuseCounts(store?.excuseCounts),
    settings: sanitizeGuildSettings(store?.settings),
  };
}

function sanitizeAiTriggers(aiTriggers) {
  if (!Array.isArray(aiTriggers)) return [];

  const seen = new Set();
  const sanitizedAiTriggers = [];

  for (const trigger of aiTriggers) {
    const keyword = normalizeText(trigger?.keyword || "");
    const context = cleanAiTriggerContext(trigger?.context || "");

    if (!keyword || !context || seen.has(keyword)) continue;

    seen.add(keyword);
    sanitizedAiTriggers.push({ keyword, context });
  }

  return sanitizedAiTriggers.slice(0, 100);
}

function sanitizeRoastTargets(roastTargets) {
  if (!Array.isArray(roastTargets)) return [];

  const seen = new Set();
  const sanitizedTargets = [];

  for (const target of roastTargets) {
    const userId = String(target?.userId || "").replace(/\D/g, "");
    const note = cleanRoastNote(target?.note || target?.context || "");

    if (!userId || !note || seen.has(userId)) continue;

    seen.add(userId);
    sanitizedTargets.push({
      userId,
      displayName: cleanPromptField(target?.displayName || ""),
      note,
      level: sanitizeRoastLevel(target?.level),
    });
  }

  return sanitizedTargets.slice(0, 100);
}

function sanitizeNicknames(nicknames) {
  if (!Array.isArray(nicknames)) return [];

  const seen = new Set();
  const sanitizedNicknames = [];

  for (const entry of nicknames) {
    const userId = String(entry?.userId || "").replace(/\D/g, "");
    const nickname = cleanNicknameText(entry?.nickname || entry?.apodo || "");

    if (!userId || !nickname || seen.has(userId)) continue;

    seen.add(userId);
    sanitizedNicknames.push({
      userId,
      displayName: cleanPromptField(entry?.displayName || ""),
      nickname,
    });
  }

  return sanitizedNicknames.slice(0, 100);
}

function sanitizeLoreItems(lore) {
  if (!Array.isArray(lore)) return [];

  const seen = new Set();
  const sanitizedLore = [];

  for (const item of lore) {
    const id = cleanLoreId(item?.id || "");
    const text = cleanLoreText(item?.text || "");

    if (!id || !text || seen.has(id)) continue;

    seen.add(id);
    sanitizedLore.push({ id, text });
  }

  return sanitizedLore.slice(0, 80);
}

function sanitizeExcuseCounts(excuseCounts) {
  if (!Array.isArray(excuseCounts)) return [];

  const seen = new Set();
  const sanitizedCounts = [];

  for (const entry of excuseCounts) {
    const userId = String(entry?.userId || "").replace(/\D/g, "");
    const count = Number.parseInt(entry?.count || "0", 10);

    if (!userId || !Number.isFinite(count) || count <= 0 || seen.has(userId)) continue;

    seen.add(userId);
    sanitizedCounts.push({
      userId,
      displayName: cleanPromptField(entry?.displayName || ""),
      count,
      last: cleanPromptField(entry?.last || ""),
      updatedAt: cleanPromptField(entry?.updatedAt || ""),
    });
  }

  return sanitizedCounts.slice(0, 100);
}

function sanitizeGuildSettings(settings) {
  const autoJoinMode = normalizeAutoJoinMode(settings?.autoJoinMode || defaultAutoJoinMode);
  const characterMode = normalizeCharacterMode(settings?.characterMode || defaultCharacterMode);

  return {
    autoJoinMode: autoJoinMode === "status" ? defaultAutoJoinMode : autoJoinMode,
    characterMode: characterMode && characterMode !== "status" ? characterMode : defaultCharacterMode,
  };
}

function truncateDiscordMessage(content) {
  if (content.length <= 1900) return content;
  return `${content.slice(0, 1880)}\n...`;
}

async function fetchMessagesForClear(channel, limit) {
  const fetchedMessages = [];
  let before;

  while (fetchedMessages.length < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, limit - fetchedMessages.length),
      before,
    });

    if (!batch.size) break;

    const messages = [...batch.values()];
    fetchedMessages.push(...messages);
    before = messages[messages.length - 1]?.id;

    if (!before) break;
  }

  return fetchedMessages;
}

async function deleteMessagesForClear(messages) {
  let deleted = 0;
  let skippedOld = 0;
  let failed = 0;

  for (const batch of chunkArray(messages, 100)) {
    const freshMessages = batch.filter((candidate) => {
      const isFresh = Date.now() - candidate.createdTimestamp < bulkDeleteMaxAgeMs;
      if (!isFresh) skippedOld += 1;
      return isFresh;
    });

    if (!freshMessages.length) continue;

    try {
      if (freshMessages.length === 1) {
        await freshMessages[0].delete();
        deleted += 1;
      } else {
        const deletedMessages = await freshMessages[0].channel.bulkDelete(freshMessages, true);
        deleted += deletedMessages.size;
        failed += freshMessages.length - deletedMessages.size;
      }
    } catch (error) {
      failed += freshMessages.length;
      await debugLog(`clear delete failed: ${error.message}`);
    }
  }

  return { deleted, skippedOld, failed };
}

function chunkArray(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
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

  const segmentKey = `${guildId}:${userId}`;
  if (activeVoiceSegments.has(segmentKey)) {
    await debugLog(`voice ignored active segment user=${userId}`);
    return;
  }

  activeVoiceSegments.add(segmentKey);

  try {
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

  let decodeError = null;
  await new Promise((resolve) => {
    let settled = false;
    const settle = (error = null) => {
      if (settled) return;
      settled = true;
      decodeError = error;
      decoder.removeAllListeners("end");
      decoder.removeAllListeners("error");
      opusStream.removeAllListeners("error");
      resolve();
    };

    decoder.once("end", () => settle());
    decoder.once("error", (error) => {
      opusStream.destroy();
      settle(error);
    });
    opusStream.once("error", (error) => {
      decoder.destroy();
      settle(error);
    });
  });

  if (decodeError) {
    await debugLog(`voice decoder recovered user=${userId} bytes=${totalBytes} error=${decodeError.message}`);
  }

  const minBytes = 48000 * 2 * 2 * 0.2;
  if (totalBytes < minBytes) {
    await debugLog(`voice ignored short bytes=${totalBytes}`);
    return;
  }

  const rawFile = await writeRawVoice(Buffer.concat(chunks));
  const wavFile = rawFile.replace(/\.pcm$/i, ".wav");

  try {
    await convertRawToWav(rawFile, wavFile);
    const store = await getGuildStore(guildId);
    const transcript = await transcribeWav(wavFile, { store });
    await debugLog(`voice transcript=${JSON.stringify(transcript)}`);
    await recordExcuseHits(guildId, userId, transcript, store, { source: "voice" });
    let fullTranscript = null;
    const getFullTranscript = async () => {
      if (fullTranscript !== null) return fullTranscript;
      fullTranscript = await transcribeWav(wavFile, { grammar: false });
      await debugLog(`voice full transcript=${JSON.stringify(fullTranscript)}`);
      return fullTranscript;
    };

    if (codexEnabled && containsKeyword(transcript, codexWakeWord)) {
      const confirmedTranscript = await getFullTranscript();
      if (voiceWakeConfirmWithFull && !containsKeyword(confirmedTranscript, codexWakeWord)) {
        await debugLog(
          `codex wake ignored unconfirmed transcript=${JSON.stringify(transcript)} full=${JSON.stringify(confirmedTranscript)}`,
        );
      } else {
        const question = extractCodexQuestion(transcript, confirmedTranscript);

        await debugLog(
          `codex wake transcript=${JSON.stringify(confirmedTranscript)} question=${JSON.stringify(question)}`,
        );
        await handleCodexVoiceQuestion(guildId, userId, question);
        return;
      }
    }

    const aiTriggerMatch = codexEnabled ? findVoiceTriggerMatch(transcript, store.aiTriggers || []) : null;
    if (aiTriggerMatch) {
      const confirmedTranscript = voiceMatchNeedsFullConfirmation(aiTriggerMatch)
        ? await getFullTranscript()
        : undefined;
      const confirmedMatch = findVoiceTriggerMatch(transcript, store.aiTriggers || [], {
        fullTranscript: confirmedTranscript,
      });

      if (!confirmedMatch) {
        await debugLog(
          `voice ai trigger ignored unconfirmed keyword=${aiTriggerMatch.entry.keyword} transcript=${JSON.stringify(transcript)} full=${JSON.stringify(confirmedTranscript)}`,
        );
      } else {
        const aiTrigger = confirmedMatch.entry;
        await debugLog(`voice ai trigger matched keyword=${aiTrigger.keyword}`);
        await handleCodexVoiceQuestion(
          guildId,
          userId,
          buildAiTriggerQuestion(aiTrigger, transcript),
          { aiTrigger, sourceText: transcript },
        );
        return;
      }
    }

    const triggerMatch = findVoiceTriggerMatch(transcript, store.triggers || []);
    if (!triggerMatch) return;
    const confirmedTranscript = voiceMatchNeedsFullConfirmation(triggerMatch)
      ? await getFullTranscript()
      : undefined;
    const confirmedTriggerMatch = findVoiceTriggerMatch(transcript, store.triggers || [], {
      fullTranscript: confirmedTranscript,
    });
    if (!confirmedTriggerMatch) {
      await debugLog(
        `voice trigger ignored unconfirmed keyword=${triggerMatch.entry.keyword} transcript=${JSON.stringify(transcript)} full=${JSON.stringify(confirmedTranscript)}`,
      );
      return;
    }

    const trigger = confirmedTriggerMatch.entry;
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
  } finally {
    activeVoiceSegments.delete(segmentKey);
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
  const keywords = useGrammar ? getVoiceKeywords(options.store) : [];
  const stdout = await transcribeWithVoskWorker(wavFile, keywords, { grammar: useGrammar });

  return normalizeText(stdout);
}

function getVoiceKeywords(store) {
  const triggers = store?.triggers || [];
  const aiTriggers = store?.aiTriggers || [];
  const keywords = triggers.flatMap((trigger) =>
    getVoiceTriggerCandidates(trigger.keyword),
  );
  keywords.push(...aiTriggers.flatMap((trigger) => getVoiceTriggerCandidates(trigger.keyword)));
  keywords.push(...excuseKeywords);
  if (codexEnabled && codexWakeWord) {
    keywords.push(codexWakeWord);
  }

  return uniqueValues(keywords);
}

function getVoiceTriggerCandidates(keyword) {
  const normalizedKeyword = normalizeText(keyword);
  const aliases = uniqueValues([
    ...(builtInVoiceKeywordAliases.get(normalizedKeyword) || []),
    ...(voiceKeywordAliases.get(normalizedKeyword) || []),
  ]).map(normalizeText);

  if (aliases.length) return aliases;
  return normalizedKeyword ? [normalizedKeyword] : [];
}

function formatVoiceKeywordAliases() {
  const aliasLines = [];
  const keywords = uniqueValues([
    ...builtInVoiceKeywordAliases.keys(),
    ...voiceKeywordAliases.keys(),
  ]);

  for (const keyword of keywords) {
    const aliases = getVoiceTriggerCandidates(keyword);
    if (aliases.length) {
      aliasLines.push(`${keyword} -> ${aliases.join(",")}`);
    }
  }

  return aliasLines.join("; ");
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

function buildAiTriggerQuestion(trigger, sourceText) {
  return [
    `Lore disponible para esta respuesta: ${trigger.context}.`,
    `Palabra que aparecio en el chat o voz: ${trigger.keyword}.`,
    `Texto original: ${cleanAiTriggerContext(sourceText)}.`,
    "Hace un remate corto usando ese lore si queda natural. No repitas literal el lore: converti el contexto en una chicana nueva.",
    "No anuncies que aparecio la palabra ni arranques siempre nombrandola.",
  ].join(" ");
}

async function handleCodexVoiceQuestion(guildId, userId, question, options = {}) {
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

  let stopHoldMusic = null;

  try {
    await debugLog(`codex question=${question}`);
    stopHoldMusic = await startCodexHoldMusic(guildId);
    const answer = await queryCodexCli(question, {
      guildId,
      userId,
      aiTrigger: options.aiTrigger,
      sourceText: options.sourceText,
    });
    const spokenAnswer = sanitizeCodexAnswer(answer);

    if (stopHoldMusic) {
      await stopHoldMusic({ keepSpeechLock: true });
      stopHoldMusic = null;
    }

    await debugLog(`codex answer=${spokenAnswer}`);
    if (options.aiTrigger && spokenAnswer) {
      recordAiTriggerAnswer(guildId, options.aiTrigger.keyword, spokenAnswer);
    }

    const spoke = await queueSpeech(guildId, spokenAnswer || "Codex no devolvio una respuesta.");
    if (!spoke && options.message) {
      await sendReply(options.message, {
        content: spokenAnswer || "Codex no devolvio una respuesta.",
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    if (stopHoldMusic) {
      await stopHoldMusic({ keepSpeechLock: true });
      stopHoldMusic = null;
    }

    console.error("No pude consultar Codex CLI:", error.message);
    await debugLog(`codex failed: ${error.message}`);
    const spoke = await queueSpeech(guildId, "No pude consultar Codex ahora.");
    if (!spoke && options.message) {
      await sendReply(options.message, {
        content: "No pude consultar Codex ahora.",
        allowedMentions: { repliedUser: false },
      });
    }
  } finally {
    if (stopHoldMusic) {
      await stopHoldMusic();
    }

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

function recordAiTriggerAnswer(guildId, keyword, answer) {
  const key = getAiTriggerMemoryKey(guildId, keyword);
  const cleanedAnswer = cleanAiTriggerContext(answer);
  if (!key || !cleanedAnswer) return;

  const previousAnswers = recentAiTriggerAnswers.get(key) || [];
  const nextAnswers = [
    cleanedAnswer,
    ...previousAnswers.filter((entry) => normalizeText(entry) !== normalizeText(cleanedAnswer)),
  ].slice(0, 5);

  recentAiTriggerAnswers.set(key, nextAnswers);
}

function formatRecentAiTriggerAnswers(guildId, keyword) {
  const key = getAiTriggerMemoryKey(guildId, keyword);
  const answers = key ? recentAiTriggerAnswers.get(key) || [] : [];
  if (!answers.length) return "";

  return answers
    .slice(0, 5)
    .map((answer) => `"${cleanPromptField(answer)}"`)
    .join("; ");
}

function getAiTriggerMemoryKey(guildId, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  if (!guildId || !normalizedKeyword) return "";
  return `${guildId}:${normalizedKeyword}`;
}

async function startCodexHoldMusic(guildId) {
  if (!codexHoldMusicEnabled) return null;

  const connection = getVoiceConnection(guildId);
  if (!connection) {
    await debugLog("hold music skipped no connection");
    return null;
  }

  await ensureCodexHoldMusic();

  const player = getAudioPlayer(guildId);
  connection.subscribe(player);
  activeSpeechGuilds.add(guildId);

  const ffmpeg = new prism.FFmpeg({
    args: [
      "-stream_loop",
      "-1",
      "-analyzeduration",
      "0",
      "-loglevel",
      "0",
      "-i",
      holdMusicPath,
      "-filter:a",
      `volume=${codexHoldMusicVolume}`,
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

  let stopped = false;
  player.play(resource);
  await debugLog("hold music started");

  return async ({ keepSpeechLock = false } = {}) => {
    if (stopped) return;

    stopped = true;
    player.stop(true);
    await entersState(player, AudioPlayerStatus.Idle, 1000).catch(() => {});
    await debugLog("hold music stopped");

    if (!keepSpeechLock) {
      setTimeout(() => {
        activeSpeechGuilds.delete(guildId);
      }, 350);
    }
  };
}

async function ensureCodexHoldMusic() {
  if (!codexHoldMusicEnabled || (await fileExists(holdMusicPath))) return;

  await mkdir(dirname(holdMusicPath), { recursive: true });
  await writeFile(holdMusicPath, buildElevatorMusicWav());
  await debugLog("hold music generated");
}

function buildElevatorMusicWav() {
  const sampleRate = 24000;
  const durationSeconds = 12;
  const totalSamples = sampleRate * durationSeconds;
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  const bpm = 96;
  const beatSeconds = 60 / bpm;
  const chordSeconds = beatSeconds * 2;
  const chords = [
    [60, 64, 67, 71],
    [57, 60, 64, 67],
    [62, 65, 69, 72],
    [55, 59, 62, 65],
  ];
  const melody = [76, 79, 83, 81, 79, 76, 74, 72, 74, 76, 79, 76, 72, 74, 71, 72];

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const time = sampleIndex / sampleRate;
    const chordIndex = Math.floor(time / chordSeconds) % chords.length;
    const chord = chords[chordIndex];
    const chordTime = time % chordSeconds;
    const beatIndex = Math.floor(time / beatSeconds) % melody.length;
    const beatTime = time % beatSeconds;

    let sample = 0;

    for (const note of chord) {
      sample += Math.sin(2 * Math.PI * midiToFrequency(note) * time) * 0.035;
      sample += Math.sin(2 * Math.PI * midiToFrequency(note + 12) * time) * 0.012;
    }

    const bassNote = chord[0] - 12;
    sample += Math.sin(2 * Math.PI * midiToFrequency(bassNote) * time) * 0.08;

    const melodyEnvelope = pluckEnvelope(beatTime, beatSeconds);
    sample += Math.sin(2 * Math.PI * midiToFrequency(melody[beatIndex]) * time) * 0.16 * melodyEnvelope;

    const chordEnvelope = 0.55 + 0.45 * Math.sin(Math.PI * chordTime / chordSeconds);
    const tremolo = 0.82 + 0.18 * Math.sin(2 * Math.PI * 5.2 * time);
    sample = Math.tanh(sample * chordEnvelope * tremolo * 1.8);

    buffer.writeInt16LE(Math.round(sample * 32767), 44 + sampleIndex * 2);
  }

  return buffer;
}

function pluckEnvelope(time, duration) {
  const attack = 0.035;
  const release = 0.42;

  if (time < attack) return time / attack;
  return Math.max(0, 1 - (time - attack) / (duration * release));
}

function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

async function queryCodexCli(question, context = {}) {
  await mkdir(codexDirPath, { recursive: true });

  const outputFile = join(codexDirPath, `${Date.now()}-${randomUUID()}.txt`);
  const prompt = await buildCodexPrompt(question, context);
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

async function buildCodexPrompt(question, context = {}) {
  const [skill, discordContext] = await Promise.all([
    loadCodexSkill(),
    buildDiscordVoiceContext(context.guildId, context.userId),
  ]);
  const aiTriggerRecentAnswers = context.aiTrigger
    ? formatRecentAiTriggerAnswers(context.guildId, context.aiTrigger.keyword)
    : "";
  const aiTriggerVariationHint = context.aiTrigger ? pickRandomResponse(aiTriggerVariationHints) : "";

  return [
    "Sos una presencia de voz dentro de un canal de Discord: respondes como un amigo del grupo, no como asistente.",
    `Responde en espanol claro, hablado y natural. Maximo ${codexMaxWords} palabras.`,
    "No uses markdown, listas, tablas, emojis ni bloques de codigo.",
    "No anuncies reglas internas ni expliques que estas usando contexto.",
    "Si falta contexto, da la mejor respuesta breve y practica sin ponerte formal.",
    skill ? `Skill local del bot:\n${skill}` : "",
    discordContext,
    context.aiTrigger
      ? [
          "Lore contextual activo:",
          `Palabra de referencia: ${context.aiTrigger.keyword}`,
          `Lore: ${context.aiTrigger.context}`,
          context.sourceText ? `Texto original: ${cleanAiTriggerContext(context.sourceText)}` : "",
          aiTriggerRecentAnswers ? `Ultimas respuestas a evitar: ${aiTriggerRecentAnswers}` : "",
          aiTriggerVariationHint ? `Variacion obligatoria para esta respuesta: ${aiTriggerVariationHint}` : "",
          "Regla: no empieces siempre con el nombre ni con 'aparecio'. Responde como una reaccion natural.",
          "Regla anti-loop: si el lore tiene dos imagenes fuertes, no uses siempre esas dos; inventa otro angulo del mismo bardo.",
        ].filter(Boolean).join("\n")
      : "",
    `Pregunta del usuario: ${question}`,
  ].filter(Boolean).join("\n\n");
}

async function loadCodexSkill() {
  try {
    const content = (await readFile(codexSkillPath, "utf8")).trim();
    return content.slice(0, 6000);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      await debugLog(`codex skill ignored: ${error.message}`);
    }

    return "";
  }
}

async function buildDiscordVoiceContext(guildId, userId) {
  if (!guildId) return "";

  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return "Contexto vivo de Discord: no pude leer el servidor actual.";

  const store = await getGuildStore(guildId);
  const requester =
    guild.members.cache.get(userId) ||
    (userId ? await guild.members.fetch(userId).catch(() => null) : null);
  const requesterRoastTarget = findRoastTarget(store, userId);
  const requesterNickname = findNickname(store, userId);
  const connection = getVoiceConnection(guildId);
  const botVoiceChannelId = connection?.joinConfig?.channelId || lastVoiceChannelByGuild.get(guildId);
  const botVoiceChannel = botVoiceChannelId
    ? guild.channels.cache.get(botVoiceChannelId) ||
      (await guild.channels.fetch(botVoiceChannelId).catch(() => null))
    : null;
  const requesterVoiceChannel = requester?.voice?.channel || null;

  const lines = [
    "Contexto vivo de Discord:",
    `Servidor: ${cleanPromptField(guild.name)} (${guild.id})`,
    `Modo personaje de Codex: ${describeCharacterMode(store.settings.characterMode)}`,
    `Usuario que pregunto: ${formatDiscordMember(requester, userId)}`,
    requesterVoiceChannel
      ? `Canal de voz del usuario: ${cleanPromptField(requesterVoiceChannel.name)} (${requesterVoiceChannel.id})`
      : "Canal de voz del usuario: desconocido o no cacheado",
  ];

  if (requesterNickname) {
    lines.push(`Apodo del usuario que pregunto: ${formatNicknameEntry(requesterNickname, requester)}`);
  }

  if (requesterRoastTarget) {
    lines.push(`Ficha para molestar al usuario que pregunto: ${formatRoastTarget(requesterRoastTarget, requester)}`);
  }

  lines.push(`Apodos registrados en este servidor (${store.nicknames.length}): ${formatStoredNicknameList(store.nicknames)}`);
  lines.push(`Lore privado del servidor (${store.lore.length}): ${formatLoreList(store.lore)}`);
  lines.push(`Ranking de excusas (${store.excuseCounts.length}): ${formatExcuseRanking(store.excuseCounts)}`);
  lines.push(`Keywords AI registradas (${store.aiTriggers.length}): ${formatAiTriggerList(store.aiTriggers)}`);
  lines.push(
    `Fichas de bardo registradas en este servidor (${store.roastTargets.length}): ${formatStoredRoastTargetList(store.roastTargets)}`,
  );

  if (!botVoiceChannel || typeof botVoiceChannel.isVoiceBased !== "function" || !botVoiceChannel.isVoiceBased()) {
    lines.push("Canal de voz donde esta el bot: no conectado o no disponible");
    lines.push("Usuarios conectados en el canal del bot: desconocido");
    return lines.join("\n");
  }

  const connectedMembers = [...(botVoiceChannel.members?.values() || [])]
    .filter((member) => member.voice?.channelId === botVoiceChannel.id)
    .sort((left, right) => formatDiscordMember(left).localeCompare(formatDiscordMember(right)));
  const humanMembers = connectedMembers.filter((member) => !member.user.bot);
  const botMembers = connectedMembers.filter((member) => member.user.bot);
  const connectedRoastTargets = humanMembers
    .map((member) => ({ member, target: findRoastTarget(store, member.id) }))
    .filter(({ target }) => target);
  const connectedNicknames = humanMembers
    .map((member) => ({ member, nickname: findNickname(store, member.id) }))
    .filter(({ nickname }) => nickname);

  lines.push(`Canal de voz donde esta el bot: ${cleanPromptField(botVoiceChannel.name)} (${botVoiceChannel.id})`);
  lines.push(
    `Usuarios humanos conectados en ese canal (${humanMembers.length}): ${formatDiscordMemberList(humanMembers)}`,
  );
  lines.push(`Bots conectados en ese canal (${botMembers.length}): ${formatDiscordMemberList(botMembers)}`);
  lines.push(
    `Apodos de usuarios conectados (${connectedNicknames.length}): ${formatNicknameList(connectedNicknames)}`,
  );
  lines.push(
    `Usuarios marcados para molestar en ese canal (${connectedRoastTargets.length}): ${formatRoastTargetList(connectedRoastTargets)}`,
  );
  lines.push("Regla: si preguntan quien esta conectado, usa solo esta lista y no inventes usuarios.");

  return lines.join("\n");
}

function formatDiscordMemberList(members) {
  const limit = 30;
  const visibleMembers = members.slice(0, limit).map((member) => formatDiscordMember(member));
  const hiddenCount = members.length - visibleMembers.length;

  if (!visibleMembers.length) return "ninguno";
  return `${visibleMembers.join(", ")}${hiddenCount > 0 ? `, y ${hiddenCount} mas` : ""}`;
}

function formatDiscordMember(member, fallbackId = "desconocido") {
  if (!member) return `desconocido (${fallbackId})`;

  const displayName = cleanPromptField(member.displayName || member.user?.globalName || member.user?.username);
  const username = cleanPromptField(member.user?.tag || member.user?.username);

  if (!displayName && !username) return `desconocido (${member.id || fallbackId})`;
  if (!username || displayName === username) return displayName || username;

  return `${displayName} (@${username})`;
}

function findRoastTarget(store, userId) {
  if (!userId) return null;
  return (store?.roastTargets || []).find((target) => target.userId === userId) || null;
}

function findNickname(store, userId) {
  if (!userId) return null;
  return (store?.nicknames || []).find((entry) => entry.userId === userId) || null;
}

function formatRoastTargetList(items) {
  if (!items.length) return "ninguno";

  const limit = 12;
  const visibleItems = items
    .slice(0, limit)
    .map(({ target, member }) => formatRoastTarget(target, member));
  const hiddenCount = items.length - visibleItems.length;

  return `${visibleItems.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatStoredRoastTargetList(targets) {
  if (!targets.length) return "ninguna";

  const limit = 20;
  const visibleTargets = targets.slice(0, limit).map((target) => formatRoastTarget(target));
  const hiddenCount = targets.length - visibleTargets.length;

  return `${visibleTargets.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatNicknameList(items) {
  if (!items.length) return "ninguno";

  const limit = 20;
  const visibleItems = items
    .slice(0, limit)
    .map(({ nickname, member }) => formatNicknameEntry(nickname, member));
  const hiddenCount = items.length - visibleItems.length;

  return `${visibleItems.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatStoredNicknameList(nicknames) {
  if (!nicknames.length) return "ninguno";

  const limit = 20;
  const visibleNicknames = nicknames.slice(0, limit).map((entry) => formatNicknameEntry(entry));
  const hiddenCount = nicknames.length - visibleNicknames.length;

  return `${visibleNicknames.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatNicknameEntry(entry, member = null) {
  const label = member
    ? formatDiscordMember(member)
    : cleanPromptField(entry.displayName || entry.userId);
  return `${label}: "${entry.nickname}"`;
}

function formatLoreList(lore) {
  if (!lore.length) return "ninguno";

  const limit = 18;
  const visibleLore = lore.slice(0, limit).map((item) => `${item.id}: ${item.text}`);
  const hiddenCount = lore.length - visibleLore.length;

  return `${visibleLore.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatAiTriggerList(aiTriggers) {
  if (!aiTriggers.length) return "ninguna";

  const limit = 20;
  const visibleTriggers = aiTriggers
    .slice(0, limit)
    .map((trigger) => `${trigger.keyword}: ${trigger.context}`);
  const hiddenCount = aiTriggers.length - visibleTriggers.length;

  return `${visibleTriggers.join("; ")}${hiddenCount > 0 ? `; y ${hiddenCount} mas` : ""}`;
}

function formatExcuseRanking(excuseCounts) {
  if (!excuseCounts.length) return "nadie conto excusas todavia";

  const ranking = [...excuseCounts]
    .sort((left, right) => right.count - left.count)
    .slice(0, 10)
    .map((entry, index) => {
      const last = entry.last ? `, ultima: ${entry.last}` : "";
      return `${index + 1}) ${entry.displayName || entry.userId}: ${entry.count}${last}`;
    });

  return ranking.join("; ");
}

function formatRoastTarget(target, member = null) {
  const label = member
    ? formatDiscordMember(member)
    : cleanPromptField(target.displayName || target.userId);
  return `${label}: nivel ${target.level}; ${target.note}`;
}

function cleanRoastNote(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function cleanAiTriggerContext(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function cleanNicknameText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function cleanLoreText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function cleanLoreId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 16);
}

function createLoreId(store) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    if (!store.lore.some((item) => item.id === id)) return id;
  }

  return String(Date.now()).slice(-8);
}

function sanitizeRoastLevel(value) {
  const parsedLevel = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedLevel)) return 2;
  return Math.max(1, Math.min(parsedLevel, 3));
}

function cleanPromptField(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
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
  activeSpeechGuilds.add(guildId);
  let audio = null;

  try {
    audio = await synthesizeSpeech(text);

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

    if (audio?.temporary) {
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

  const guildResponses = [];
  for (const guild of client.guilds.cache.values()) {
    const store = await getGuildStore(guild.id);
    guildResponses.push(...store.triggers.flatMap((trigger) => trigger.responses));
  }

  const phrases = uniqueValues([
    "listo",
    ...guildResponses,
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
  if (message.interaction?.isRepliable()) {
    const interactionPayload = {
      ...payload,
      allowedMentions: payload.allowedMentions || { repliedUser: false },
    };

    if (interactionPayload.ephemeral !== false && interactionPayload.flags === undefined) {
      interactionPayload.flags = MessageFlags.Ephemeral;
    }

    delete interactionPayload.ephemeral;
    delete interactionPayload.tts;

    try {
      if (message.interaction.deferred && !message.interaction.replied) {
        delete interactionPayload.flags;
        return await message.interaction.editReply(interactionPayload);
      }

      if (message.interaction.replied) {
        return await message.interaction.followUp(interactionPayload);
      }

      return await message.interaction.reply(interactionPayload);
    } catch (interactionError) {
      await debugLog(`interaction reply failed: ${interactionError.message}`);
      console.error("No pude responder la interaction:", interactionError.message);
      return null;
    }
  }

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
