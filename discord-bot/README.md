# VIEJO Discord Bot

Bot de Discord que responde por voz cuando detecta keywords en texto o conversaciones de voz. Tambien puede consultar al Codex CLI cuando escucha la palabra `experiencia` seguida de una pregunta.

## Setup

1. En Discord Developer Portal, crea una app y agrega un bot.
2. En la pestana del bot, activa `Message Content Intent`.
3. Invita el bot al servidor con scopes `bot` y `applications.commands`, y permisos:
   - View Channels
   - Send Messages
   - Read Message History
   - Connect
   - Speak
   - Send TTS Messages, solo si usas `DISCORD_TTS=true`
4. Copia `.env.example` a `.env` y pega tu token nuevo:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Instala y ejecuta:

   ```powershell
   npm install
   python -m pip install vosk edge-tts
   New-Item -ItemType Directory -Path models -Force
   Invoke-WebRequest -Uri "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip" -OutFile "models/vosk-model-small-es-0.42.zip"
   Expand-Archive -LiteralPath "models/vosk-model-small-es-0.42.zip" -DestinationPath "models" -Force
   npm start
   ```

## Configuracion

Edita `.env`:

```env
DISCORD_TOKEN=pon_tu_token_del_bot
COMMAND_PREFIX=!bot
AUTO_JOIN_VOICE=most
AUTO_JOIN_MIN_MEMBERS=1
AUTO_JOIN_COOLDOWN_MS=5000
AUTO_JOIN_LEAVE_WHEN_EMPTY=true
AUTO_JOIN_EMPTY_CHECK_DELAY_MS=1200
REJOIN_ON_DISCONNECT=true
REJOIN_DELAY_MS=1500
REJOIN_MAX_ATTEMPTS=5
CLEAR_MESSAGES_COMMAND=!clear
CLEAR_SCAN_LIMIT=1000
CLEAR_MAX_SCAN_LIMIT=2000
COOLDOWN_MS=1500
DISCORD_TTS=false
REQUIRE_MANAGE_GUILD_FOR_CONFIG=true
TTS_PROVIDER=edge
EDGE_TTS_VOICE=es-AR-TomasNeural
EDGE_TTS_RATE=+0%
VOICE_SILENCE_MS=450
VOICE_TRIGGER_COOLDOWN_MS=3500
VOICE_TRIGGER_MAX_EXTRA_WORDS=1
VOICE_TRIGGER_CONFIRM_WITH_FULL=short
VOICE_TRIGGER_SHORT_MAX_CHARS=4
VOICE_WAKE_CONFIRM_WITH_FULL=true
VOICE_KEYWORD_ALIASES=peti:piti,pete,pedi,pity,petit
CODEX_ENABLED=true
CODEX_WAKE_WORD=experiencia
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=low
CODEX_TIMEOUT_MS=90000
CODEX_MAX_WORDS=20
CODEX_WAKE_COOLDOWN_MS=8000
CODEX_HOLD_MUSIC=true
CODEX_HOLD_MUSIC_VOLUME=0.18
```

`REQUIRE_MANAGE_GUILD_FOR_CONFIG=true` hace que `add`, `remove`, `clear` y `autojoin` solo funcionen para usuarios con permiso `Manage Server`.

`COMMAND_PREFIX` es solo el fallback visible para administrar el bot y es global. El camino recomendado son los slash commands `/`, porque sus respuestas son privadas para quien ejecuta el comando. Las palabras que disparan respuestas se guardan por servidor en `data/guilds/<server-id>.json`.

`AUTO_JOIN_VOICE` es el modo inicial para servidores nuevos. Despues, `!bot autojoin on|most|off` guarda el modo propio de cada servidor. Por defecto queda en `most`, asi al arrancar entra al canal con mas gente y sigue ese canal mientras haya personas:

- `off`: apagado.
- `on`: entra al canal cuando alguien entra y el bot esta desconectado.
- `most`: sigue el canal de voz con mas personas.

`AUTO_JOIN_MIN_MEMBERS` define cuanta gente real tiene que haber para considerar un canal. `AUTO_JOIN_LEAVE_WHEN_EMPTY=true` hace que el bot salga si no queda nadie en el modo `most`. `AUTO_JOIN_EMPTY_CHECK_DELAY_MS` retrasa un poco el chequeo para darle tiempo a Discord a actualizar la lista de miembros.

`REJOIN_ON_DISCONNECT=true` hace que si alguien desconecta al bot de un canal de voz, vuelva al ultimo canal donde estaba. `!bot leave` cuenta como salida manual y no dispara rejoin.

`CLEAR_MESSAGES_COMMAND=!clear` borra en el canal actual mensajes escritos del bot y mensajes de usuarios que usaron el bot con comandos, keywords de este servidor o `experiencia`. Por defecto escanea los ultimos `1000` mensajes recientes; tambien podes usar `/clear limite:500` o `!clear 500`.

`TTS_PROVIDER=edge` usa voces neuronales en espanol. Algunas voces buenas: `es-AR-TomasNeural`, `es-AR-ElenaNeural`, `es-PY-TaniaNeural`, `es-PY-MarioNeural`, `es-ES-ElviraNeural`, `es-MX-DaliaNeural`.

`VOICE_SILENCE_MS` controla cuanto silencio espera el bot antes de transcribir lo que acabas de decir. Menos delay, menor valor. Si empieza a cortar frases, subilo a `600`.

Las respuestas de voz se cachean en `data/tts-cache`, asi la primera vez puede tardar un poco mas, pero las siguientes salen mucho mas rapido.

`VOICE_TRIGGER_COOLDOWN_MS` evita que una sola palabra hablada dispare varias respuestas seguidas. Subilo si todavia repite, bajalo si queres respuestas mas frecuentes.

`VOICE_TRIGGER_MAX_EXTRA_WORDS=1` reduce falsos positivos: una keyword hablada solo dispara si la transcripcion queda sola o con muy pocas palabras alrededor. `VOICE_TRIGGER_CONFIRM_WITH_FULL=short` hace una segunda transcripcion libre para confirmar keywords cortas como `peti`, `mati` o `hola`; opciones: `off`, `short`, `all`. `VOICE_WAKE_CONFIRM_WITH_FULL=true` evita que `experiencia` active Codex si la transcripcion libre no confirma la wake word.

`VOICE_KEYWORD_ALIASES` permite mapear keywords a palabras foneticas que Vosk si conoce. Por ejemplo, `peti` no existe en el vocabulario del modelo chico, entonces se escucha con aliases como `piti`, `pete` o `pedi`.

`CODEX_WAKE_WORD=experiencia` activa una ruta especial de voz: si decis `experiencia` y despues una pregunta, el bot consulta `codex exec` y lee la respuesta en voz. Ejemplo: `experiencia que es node js`.

`CODEX_MODEL`, `CODEX_REASONING_EFFORT`, `CODEX_TIMEOUT_MS` y `CODEX_MAX_WORDS` controlan el modelo del Codex CLI, el esfuerzo de razonamiento, el tiempo maximo de espera y el largo de la respuesta hablada.

`CODEX_SKILL.md` es la skill local que se inyecta en cada consulta a Codex. Ahi podes registrar reglas fijas para la IA. El bot tambien le pasa contexto vivo del servidor, del usuario que pregunto y de los usuarios conectados al canal de voz donde esta el bot. Para listar todos los miembros del servidor completo hace falta activar el intent privilegiado `GuildMembers` en codigo y en Discord Developer Portal; para el canal de voz actual alcanza con `GuildVoiceStates`, que ya esta configurado.

`CODEX_HOLD_MUSIC=true` activa la musica de espera mientras Codex procesa la pregunta. `CODEX_HOLD_MUSIC_VOLUME` controla el volumen.

## Comandos

```text
/join
```

El bot se une al canal de voz donde esta la persona que tiro el comando. La respuesta es privada.

```text
/joinmost
```

El bot entra al canal de voz con mas personas.

```text
/autojoin modo:on
```

Activa entrada automatica: si alguien entra a un canal de voz y el bot esta desconectado, entra a ese canal.

```text
/autojoin modo:most
```

Activa modo automatico para seguir el canal de voz con mas personas.

```text
/autojoin modo:off
```

Apaga el autojoin.

```text
/leave
```

El bot sale del canal de voz.

```text
/add keywords:viejo, bro respuestas:mate | trueno | relampago
```

Agrega una o varias keywords con una o varias respuestas en este servidor. Las keywords se separan con coma. Las respuestas se separan con `|` o coma.

```text
/addai keywords:mamani contexto:Mamani es malisimo en todos los juegos
```

Agrega una o varias keywords que activan Codex en vez de responder con una frase fija. Cuando alguien escribe o dice `mamani`, el bot genera una respuesta usando ese contexto. Requiere permiso `Manage Server`.

```text
/removeai keywords:mamani
```

Elimina una keyword AI.

```text
/listai
```

Muestra las keywords AI registradas.

```text
/clearai
```

Limpia todas las keywords AI del servidor.

```text
/remove keywords:viejo
```

Elimina una keyword completa.

```text
/remove keywords:viejo respuesta:mate
```

Elimina solo esa respuesta de la keyword.

```text
/list
```

Muestra todas las keywords y respuestas registradas en este servidor.

```text
/clear-keywords
```

Limpia todas las keywords de este servidor.

```text
/molestar usuario:@alguien contexto:es malo para los juegos intensidad:3
```

Marca a un usuario para que Codex lo descanse mas cuando hable o cuando este en el canal. Requiere permiso `Manage Server`.

```text
/dejar-de-molestar usuario:@alguien
```

Saca a un usuario de la lista de bardo especial. Requiere permiso `Manage Server`.

```text
/molestados
```

Muestra los usuarios marcados para bardo especial en este servidor.

```text
/apodo usuario:@pepe apodo:el manco
```

Registra un apodo interno para que Codex lo use en respuestas y descansos. Requiere permiso `Manage Server`.

```text
/quitar-apodo usuario:@pepe
```

Borra el apodo interno de ese usuario. Requiere permiso `Manage Server`.

```text
/apodos
```

Muestra los apodos registrados en este servidor.

```text
/lore texto:la noche que pepe culpo al teclado
```

Registra lore privado del server para que Codex lo use como chiste recurrente. Requiere permiso `Manage Server`.

```text
/borrar-lore id:abc12345
```

Borra una frase de lore por ID. Requiere permiso `Manage Server`.

```text
/lore-list
```

Muestra el lore privado registrado.

```text
/personaje modo:bostero-termo
```

Cambia el modo personaje de Codex. Opciones: `normal`, `bostero-termo`, `tio-borracho`, `relator-futbol`, `tecnico-ascenso`, `npc-kiosco`. Requiere permiso `Manage Server`.

```text
/excusas
```

Muestra el ranking de excusas. El bot suma puntos automaticamente cuando lee o escucha `lag`, `tecla` o `bug`.

```text
/reset-excusas usuario:@pepe
```

Resetea el contador de excusas de un usuario. Sin usuario, resetea todo el ranking. Requiere permiso `Manage Server`.

```text
/clear
```

Borra mensajes escritos del bot y mensajes escritos por usuarios para usar el bot en este canal. Requiere permiso `Manage Messages`.

```text
/clear limite:500
```

Hace lo mismo, pero escaneando los ultimos 500 mensajes del canal.

Los comandos slash no publican una respuesta visible para todo el canal. Solo la persona que ejecuto el comando ve el resultado. Los comandos viejos con `!bot` y `!clear` siguen funcionando como fallback visible.

Cuando alguien dice o escribe una keyword registrada, por ejemplo `viejo`, el bot dice una respuesta random en el canal de voz donde ya esta conectado. No manda texto por cada keyword.

Si alguien dice `experiencia` seguido de una pregunta, el bot consulta al Codex CLI y responde por voz:

```text
experiencia como puedo mejorar este bot
```

## Datos

Las keywords, respuestas, keywords AI, fichas de bardo, apodos, lore, personaje y contador de excusas se guardan por servidor en:

```text
data/guilds/<server-id>.json
```

Ejemplo:

```json
{
  "settings": {
    "autoJoinMode": "most",
    "characterMode": "bostero-termo"
  },
  "triggers": [
    {
      "keyword": "viejo",
      "responses": ["mate", "trueno"]
    }
  ],
  "aiTriggers": [
    {
      "keyword": "mamani",
      "context": "Mamani es malisimo en todos los juegos"
    }
  ],
  "roastTargets": [
    {
      "userId": "123456789012345678",
      "displayName": "Juan",
      "note": "es malo para los juegos",
      "level": 3
    }
  ],
  "nicknames": [
    {
      "userId": "123456789012345678",
      "displayName": "Juan",
      "nickname": "el manco"
    }
  ],
  "lore": [
    {
      "id": "abc12345",
      "text": "Juan culpo al teclado tres partidas seguidas"
    }
  ],
  "excuseCounts": [
    {
      "userId": "123456789012345678",
      "displayName": "Juan",
      "count": 7,
      "last": "lag",
      "updatedAt": "2026-06-09T00:00:00.000Z"
    }
  ]
}
```

`data/triggers.json` queda como archivo legado: si no existe todavia un archivo por servidor y el bot esta en un solo Discord, se usa para migrar las keywords actuales.

## Sobre voz real

`!bot join` hace que el bot entre al canal de voz. Desde ahi recibe audio, transcribe con Vosk y reproduce respuestas con voz neuronal de Edge TTS.
