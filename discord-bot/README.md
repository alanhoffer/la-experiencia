# VIEJO Discord Bot

Bot de Discord que responde por voz cuando detecta keywords en texto o conversaciones de voz. Tambien puede consultar al Codex CLI cuando escucha la palabra `experiencia` seguida de una pregunta.

## Setup

1. En Discord Developer Portal, crea una app y agrega un bot.
2. En la pestana del bot, activa `Message Content Intent`.
3. Invita el bot al servidor con permisos:
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
COOLDOWN_MS=1500
DISCORD_TTS=false
REQUIRE_MANAGE_GUILD_FOR_CONFIG=true
TTS_PROVIDER=edge
EDGE_TTS_VOICE=es-AR-TomasNeural
EDGE_TTS_RATE=+0%
VOICE_SILENCE_MS=450
VOICE_TRIGGER_COOLDOWN_MS=3500
CODEX_ENABLED=true
CODEX_WAKE_WORD=experiencia
CODEX_MODEL=gpt-5.5
CODEX_REASONING_EFFORT=low
CODEX_TIMEOUT_MS=90000
CODEX_MAX_WORDS=45
CODEX_WAKE_COOLDOWN_MS=8000
```

`REQUIRE_MANAGE_GUILD_FOR_CONFIG=true` hace que `add`, `remove` y `clear` solo funcionen para usuarios con permiso `Manage Server`.

`COMMAND_PREFIX` es solo para administrar el bot. Las palabras que disparan respuestas se guardan aparte en `data/triggers.json`.

`TTS_PROVIDER=edge` usa voces neuronales en espanol. Algunas voces buenas: `es-AR-TomasNeural`, `es-AR-ElenaNeural`, `es-PY-TaniaNeural`, `es-PY-MarioNeural`, `es-ES-ElviraNeural`, `es-MX-DaliaNeural`.

`VOICE_SILENCE_MS` controla cuanto silencio espera el bot antes de transcribir lo que acabas de decir. Menos delay, menor valor. Si empieza a cortar frases, subilo a `600`.

Las respuestas de voz se cachean en `data/tts-cache`, asi la primera vez puede tardar un poco mas, pero las siguientes salen mucho mas rapido.

`VOICE_TRIGGER_COOLDOWN_MS` evita que una sola palabra hablada dispare varias respuestas seguidas. Subilo si todavia repite, bajalo si queres respuestas mas frecuentes.

`CODEX_WAKE_WORD=experiencia` activa una ruta especial de voz: si decis `experiencia` y despues una pregunta, el bot consulta `codex exec` y lee la respuesta en voz. Ejemplo: `experiencia que es node js`.

`CODEX_MODEL`, `CODEX_REASONING_EFFORT`, `CODEX_TIMEOUT_MS` y `CODEX_MAX_WORDS` controlan el modelo del Codex CLI, el esfuerzo de razonamiento, el tiempo maximo de espera y el largo de la respuesta hablada.

## Comandos

```text
!bot join
```

El bot se une al canal de voz donde esta la persona que tiro el comando.

```text
!bot leave
```

El bot sale del canal de voz.

```text
!bot add viejo, bro => mate | trueno | relampago
```

Agrega una o varias keywords con una o varias respuestas. Las keywords se separan con coma. Las respuestas se separan con `|` o coma.

```text
!bot remove viejo
```

Elimina una keyword completa.

```text
!bot remove viejo => mate
```

Elimina solo esa respuesta de la keyword.

```text
!bot list
```

Muestra todas las keywords y respuestas registradas.

```text
!bot clear
```

Limpia todas las keywords.

Cuando alguien dice o escribe una keyword registrada, por ejemplo `viejo`, el bot dice una respuesta random en el canal de voz donde ya esta conectado. No manda texto por cada keyword.

Si alguien dice `experiencia` seguido de una pregunta, el bot consulta al Codex CLI y responde por voz:

```text
experiencia como puedo mejorar este bot
```

## Datos

Las keywords y respuestas se guardan en:

```text
data/triggers.json
```

Ejemplo:

```json
{
  "triggers": [
    {
      "keyword": "viejo",
      "responses": ["mate", "trueno"]
    }
  ]
}
```

## Sobre voz real

`!bot join` hace que el bot entre al canal de voz. Desde ahi recibe audio, transcribe con Vosk y reproduce respuestas con voz neuronal de Edge TTS.
