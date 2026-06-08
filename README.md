# VIEJO Listener

App web local que escucha el micrófono y responde con voz una palabra aleatoria cada vez que detecta la palabra clave `viejo`.

## Cómo probar

1. Levantá un servidor local en esta carpeta:

   ```powershell
   python -m http.server 4173
   ```

2. Abrí `http://localhost:4173`.
3. Tocá `Activar micrófono`, aceptá el permiso y decí `viejo`.

Chrome o Edge son la mejor opción para este prototipo porque soportan mejor `SpeechRecognition`. La respuesta hablada usa `SpeechSynthesis`, que está mucho más extendido.
