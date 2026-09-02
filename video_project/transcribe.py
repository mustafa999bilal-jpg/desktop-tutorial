import json
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")

segments, info = model.transcribe(
    "audio_extracted.mp3",
    word_timestamps=True,
    vad_filter=True,
)

print(f"Detected language: {info.language} (p={info.language_probability:.2f})")

result = []
for seg in segments:
    words = []
    if seg.words:
        for w in seg.words:
            words.append({"word": w.word, "start": w.start, "end": w.end, "prob": w.probability})
    result.append({
        "id": seg.id,
        "start": seg.start,
        "end": seg.end,
        "text": seg.text,
        "words": words,
    })
    print(f"[{seg.start:.2f}-{seg.end:.2f}] {seg.text}")

with open("transcript.json", "w", encoding="utf-8") as f:
    json.dump({"language": info.language, "segments": result}, f, ensure_ascii=False, indent=2)
