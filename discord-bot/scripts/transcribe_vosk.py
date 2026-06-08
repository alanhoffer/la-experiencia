import json
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel


def main():
    if len(sys.argv) < 3:
        print("")
        return

    model_path = sys.argv[1]
    audio_path = sys.argv[2]
    keywords = [item.strip() for item in sys.argv[3:] if item.strip()]

    SetLogLevel(-1)
    model = Model(model_path)

    with wave.open(audio_path, "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        grammar = json.dumps(sorted(set(keywords + ["[unk]"])), ensure_ascii=False)
        recognizer = KaldiRecognizer(model, sample_rate, grammar)

        while True:
            data = wav_file.readframes(4000)
            if not data:
                break
            recognizer.AcceptWaveform(data)

    result = json.loads(recognizer.FinalResult())
    print(result.get("text", ""))


if __name__ == "__main__":
    main()
