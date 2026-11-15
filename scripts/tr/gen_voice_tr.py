#!/usr/bin/env python
"""Generate Turkish voice lines with edge-tts (free). Usage: python scripts/tr/gen_voice_tr.py [outdir]
Optional loudness match to 44.1 kHz mp3 128k via ffmpeg if available."""
import asyncio, shutil, subprocess, sys
from pathlib import Path
import edge_tts

TEXTS = {
    "splash-voice": "Kelimelerin dünyasına hoş geldin.",
    "voice-galaxy-hello": "Bu senin kelime gökyüzün. Öğrendiğin her kelime, bir yıldız yakar.",
    "voice-galaxy-lit": "Bugünün yıldızları yandı.",
}
VOICES = {"emel": "tr-TR-EmelNeural", "ahmet": "tr-TR-AhmetNeural"}
RATE, PITCH = "-8%", "-2Hz"
TARGET_LUFS = "-16"  # override by editing after measuring the originals

async def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    ff = shutil.which("ffmpeg")
    for name, text in TEXTS.items():
        for tag, voice in VOICES.items():
            dst = out / f"{name}-{tag}.mp3"
            await edge_tts.Communicate(text, voice, rate=RATE, pitch=PITCH).save(str(dst))
            if ff:
                tmp = dst.with_suffix(".tmp.mp3")
                subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(dst), "-af",
                                f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=7", "-ar", "44100",
                                "-b:a", "128k", str(tmp)], check=True)
                tmp.replace(dst)
            print("wrote", dst)

if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1] if len(sys.argv) > 1 else ".local/voice-tr")))
