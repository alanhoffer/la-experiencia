# Agente Local Con Codex SDK

Este prototipo usa `@openai/codex-sdk`, que controla el Codex CLI local. Usa la cuenta que ya está logueada en `codex login status`; no usa `OPENAI_API_KEY`.

## Uso

```powershell
cd C:\Users\anxio\OneDrive\Escritorio\VIEJO\codex_agent
npm run ask -- "tu pedido"
```

Para empezar un hilo nuevo:

```powershell
npm run ask -- --new "tu pedido"
```

Para borrar el `threadId` local:

```powershell
npm run reset-thread
```

## Persistencia

- `state.json`: guarda el `threadId` del SDK para continuar el mismo hilo.
- `memory.md`: hechos y preferencias duraderas.
- `rules.md`: reglas que el agente debe seguir siempre.
- `transcripts/`: historial local de prompts/respuestas.

Esto no entrena un modelo nuevo. Es persistencia por contexto, thread reutilizable y archivos Markdown.
