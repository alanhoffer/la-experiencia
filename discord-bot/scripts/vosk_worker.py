import json
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel


def transcribe(model, audio_path, keywords, use_grammar=True):
    with wave.open(audio_path, "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        if use_grammar:
            grammar = json.dumps(sorted(set(keywords + ["[unk]"])), ensure_ascii=False)
            recognizer = KaldiRecognizer(model, sample_rate, grammar)
        else:
            recognizer = KaldiRecognizer(model, sample_rate)

        while True:
            data = wav_file.readframes(4000)
            if not data:
                break
            recognizer.AcceptWaveform(data)

    result = json.loads(recognizer.FinalResult())
    return result.get("text", "")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: vosk_worker.py <model_path>")

    SetLogLevel(-1)
    model = Model(sys.argv[1])

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
            text = transcribe(
                model,
                payload["audio"],
                payload.get("keywords", []),
                payload.get("grammar", True),
            )
            response = {"id": payload.get("id"), "text": text}
        except Exception as error:
            response = {"id": payload.get("id") if "payload" in locals() else None, "error": str(error)}

        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
