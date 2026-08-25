#!/opt/whisper-lid/bin/python3
"""Identify the spoken language of a short WAV clip. Prints JSON on stdout only."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in {"-h", "--help"}:
        print("usage: whisper-lid CLIP.wav", file=sys.stderr)
        return 2
    clip = Path(sys.argv[1])
    if not clip.is_file():
        print(f"whisper-lid: missing clip {clip}", file=sys.stderr)
        return 1

    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    cache = Path(os.environ.get("WHISPER_LID_CACHE") or os.path.join(os.environ.get("CONFIG_DIR", "/config"), "whisper"))
    cache.mkdir(parents=True, exist_ok=True)
    model_name = os.environ.get("WHISPER_LID_MODEL", "tiny")
    audio = decode_audio(str(clip), sampling_rate=16000)
    language, probability = detect(audio, model_name, cache)
    sys.stdout.write(json.dumps({"language": language, "probability": probability}) + "\n")
    return 0


def detect(audio: object, model_name: str, cache: Path) -> tuple[str, float]:
    nvidia = Path("/dev/nvidia0").exists() or Path("/dev/nvidiactl").exists()
    attempts: list[tuple[str, str]] = []
    if nvidia:
        attempts.append(("cuda", "float16"))
    attempts.append(("cpu", "int8"))
    last_error: Exception | None = None
    for device, compute_type in attempts:
        try:
            model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                download_root=str(cache),
            )
            language, probability, _unused = model.detect_language(audio)
            return str(language), float(probability)
        except Exception as error:  # CUDA wheels or a missing GPU can fail; try CPU next.
            last_error = error
            continue
    raise RuntimeError(last_error or "faster-whisper could not load a model.")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"whisper-lid: {error}", file=sys.stderr)
        raise SystemExit(1)
