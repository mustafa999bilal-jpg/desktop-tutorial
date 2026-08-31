# Video Shorts Processing

Pipeline for turning `raw_video.mp4` into a vertical short/reel.

## Files

- `raw_video.mp4` — the original clip.
- `process.sh` — full pipeline: cuts silence (auto-editor), crops/scales to
  9:16 (1080x1920), then auto zooms in ~15% on every detected speech segment
  (a common "keyword sentence" emphasis effect), with a 0.2s ease in/out.
- `final_short.mp4` — output of `process.sh` on `raw_video.mp4`.
- `captions_template.srt` — subtitle file with the correct timestamps for
  the 3 speech segments in `final_short.mp4`, with placeholder text.
- `burn_captions.sh` — burns an `.srt` onto the video styled yellow with a
  white outline (the classic shorts/reels caption look).

## Why the captions are placeholders

Generating an accurate `.srt` requires speech-to-text. This sandbox's
network egress policy blocks every ASR model host that was tried
(`huggingface.co`, `openaipublic.azureedge.net`, `alphacephei.com`/Vosk,
`ggml.ggerganov.com`), so no speech recognition model could be downloaded
here. The rest of the pipeline (silence removal, 9:16 crop, auto zoom) needs
no external model and is fully done.

## Finishing the captions

1. Open `captions_template.srt` and replace each `[الجملة N - ...]`
   placeholder with the real spoken words (the timestamps already match
   `final_short.mp4`'s 3 sentences: 0–3.9s, 4.3–7.0s, 7.5–8.8s).
2. Run:
   ```bash
   ./burn_captions.sh captions_template.srt final_short.mp4 final_short_captioned.mp4
   ```

## Re-running the whole pipeline

```bash
./process.sh raw_video.mp4 final_short.mp4
```
