const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  recognition: null,
  isListening: false,
  shouldRestart: false,
  isSpeaking: false,
  lastTriggerAt: 0,
  voices: [],
};

const elements = {
  body: document.body,
  toggleButton: document.querySelector("#toggle-listening"),
  testVoiceButton: document.querySelector("#test-voice"),
  statusText: document.querySelector("#status-text"),
  supportText: document.querySelector("#support-text"),
  transcript: document.querySelector("#transcript"),
  lastWord: document.querySelector("#last-word"),
  lastHeard: document.querySelector("#last-heard"),
  history: document.querySelector("#history-list"),
  keywordInput: document.querySelector("#keyword-input"),
  languageSelect: document.querySelector("#language-select"),
  voiceSelect: document.querySelector("#voice-select"),
  wordBank: document.querySelector("#word-bank"),
};

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

function normalizeText(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getKeyword() {
  return normalizeText(elements.keywordInput.value || "viejo") || "viejo";
}

function getWords() {
  const words = elements.wordBank.value
    .split(/\n|,/)
    .map((word) => word.trim())
    .filter(Boolean);

  return words.length ? words : fallbackWords;
}

function pickRandomWord() {
  const words = getWords().filter((word) => normalizeText(word) !== getKeyword());
  const bank = words.length ? words : fallbackWords;
  return bank[Math.floor(Math.random() * bank.length)];
}

function updateStatus(message, detail = "") {
  elements.statusText.textContent = message;
  elements.supportText.textContent = detail;
}

function setListeningUi(isListening) {
  elements.body.classList.toggle("listening", isListening);
  elements.toggleButton.querySelector("span:last-child").textContent = isListening
    ? "Detener escucha"
    : "Activar micrófono";
}

function populateVoices() {
  const synth = window.speechSynthesis;
  if (!synth) return;

  state.voices = synth.getVoices();
  const currentValue = elements.voiceSelect.value;
  const spanishVoices = state.voices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
  const otherVoices = state.voices.filter((voice) => !voice.lang.toLowerCase().startsWith("es"));
  const orderedVoices = [...spanishVoices, ...otherVoices];

  elements.voiceSelect.innerHTML = '<option value="">Voz automática</option>';

  for (const voice of orderedVoices) {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    elements.voiceSelect.append(option);
  }

  elements.voiceSelect.value = currentValue;
}

function getSelectedVoice() {
  const selectedName = elements.voiceSelect.value;
  const language = elements.languageSelect.value.slice(0, 2).toLowerCase();

  if (selectedName) {
    return state.voices.find((voice) => voice.name === selectedName) || null;
  }

  return (
    state.voices.find((voice) => voice.lang.toLowerCase().startsWith(language)) ||
    state.voices.find((voice) => voice.default) ||
    null
  );
}

function speak(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }

    state.isSpeaking = true;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getSelectedVoice();
    utterance.lang = elements.languageSelect.value;
    utterance.rate = 1;
    utterance.pitch = 0.96;
    utterance.volume = 1;

    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      state.isSpeaking = false;
      resolve();
    };

    utterance.onerror = () => {
      state.isSpeaking = false;
      resolve();
    };

    window.speechSynthesis.speak(utterance);
  });
}

function addHistory(heard, response) {
  const item = document.createElement("li");
  item.textContent = `"${heard}" → ${response}`;
  elements.history.prepend(item);

  while (elements.history.children.length > 6) {
    elements.history.lastElementChild.remove();
  }
}

async function triggerResponse(heardText) {
  const now = Date.now();
  if (state.isSpeaking || now - state.lastTriggerAt < 1300) return;

  state.lastTriggerAt = now;
  const response = pickRandomWord();

  elements.lastWord.textContent = response;
  elements.lastHeard.textContent = `Escuché "${getKeyword()}" en: ${heardText}`;
  addHistory(heardText, response);
  updateStatus("Respondiendo", `Dije: ${response}`);

  await speak(response);

  if (state.isListening) {
    updateStatus("Escuchando", `Decí "${getKeyword().toUpperCase()}" para activar una respuesta.`);
  }
}

function handleResult(event) {
  let phrase = "";

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    phrase += event.results[index][0].transcript;
  }

  const cleanPhrase = normalizeText(phrase);
  const keyword = getKeyword();

  elements.transcript.textContent = phrase.trim() || "Escuchando...";

  const words = cleanPhrase.split(" ");
  if (words.includes(keyword)) {
    triggerResponse(phrase.trim());
  }
}

function createRecognition() {
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = elements.languageSelect.value;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isListening = true;
    setListeningUi(true);
    updateStatus("Escuchando", `Decí "${getKeyword().toUpperCase()}" para activar una respuesta.`);
  };

  recognition.onresult = handleResult;

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.shouldRestart = false;
      state.isListening = false;
      setListeningUi(false);
      updateStatus("Permiso bloqueado", "Habilitá el micrófono para localhost y volvé a intentar.");
      return;
    }

    updateStatus("Reintentando escucha", `Detalle del navegador: ${event.error}`);
  };

  recognition.onend = () => {
    state.isListening = false;
    setListeningUi(false);

    if (state.shouldRestart) {
      window.setTimeout(() => {
        if (!state.isSpeaking && state.shouldRestart) {
          startListening();
        }
      }, 260);
    } else {
      updateStatus("En pausa", "Activá el micrófono para volver a escuchar.");
    }
  };

  return recognition;
}

function startListening() {
  if (!SpeechRecognition) {
    updateStatus("No soportado", "Usá Chrome o Edge para probar esta versión.");
    return;
  }

  if (state.isListening) return;

  if (state.recognition) {
    state.recognition.onend = null;
    state.recognition.abort();
  }

  state.shouldRestart = true;
  state.recognition = createRecognition();

  try {
    state.recognition.start();
  } catch (error) {
    updateStatus("No pude iniciar", error.message || "El navegador rechazó el inicio de escucha.");
  }
}

function stopListening() {
  state.shouldRestart = false;

  if (state.recognition) {
    state.recognition.stop();
  }

  state.isListening = false;
  setListeningUi(false);
  updateStatus("En pausa", "Activá el micrófono para volver a escuchar.");
}

function checkSupport() {
  const hasSynthesis = "speechSynthesis" in window;

  if (!SpeechRecognition && !hasSynthesis) {
    elements.toggleButton.disabled = true;
    elements.testVoiceButton.disabled = true;
    updateStatus("No soportado", "Este navegador no tiene reconocimiento ni síntesis de voz web.");
    return;
  }

  if (!SpeechRecognition) {
    elements.toggleButton.disabled = true;
    updateStatus("Reconocimiento no soportado", "Probá en Chrome o Edge para activar el micrófono.");
    return;
  }

  if (!hasSynthesis) {
    elements.testVoiceButton.disabled = true;
    updateStatus("Voz no soportada", "El micrófono puede escuchar, pero este navegador no puede hablar.");
    return;
  }

  updateStatus("Listo", `Activá el micrófono y decí "${getKeyword().toUpperCase()}".`);
}

elements.toggleButton.addEventListener("click", () => {
  if (state.isListening || state.shouldRestart) {
    stopListening();
  } else {
    startListening();
  }
});

elements.testVoiceButton.addEventListener("click", async () => {
  const word = pickRandomWord();
  elements.lastWord.textContent = word;
  elements.lastHeard.textContent = "Prueba manual de la voz.";
  updateStatus("Probando voz", `Dije: ${word}`);
  await speak(word);
  checkSupport();
});

elements.languageSelect.addEventListener("change", () => {
  if (state.isListening || state.shouldRestart) {
    stopListening();
    window.setTimeout(startListening, 300);
  }
});

elements.keywordInput.addEventListener("input", () => {
  if (!state.isListening) {
    checkSupport();
  }
});

if ("speechSynthesis" in window) {
  populateVoices();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
}

checkSupport();
