import base64
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from viral import tts


def _align(text, step=0.05):
    chars = list(text)
    return {"characters": chars, "character_start_times_seconds": [i * step for i in range(len(chars))],
            "character_end_times_seconds": [(i + 1) * step for i in range(len(chars))]}


class ElevenLabsAlignTest(unittest.TestCase):
    def test_word_starts_from_chars(self):
        text = "Merhaba, dünya! Çok güzel."
        ws = tts._el_word_starts(["Merhaba,", "dünya!", "Çok", "güzel."], _align(text))
        self.assertEqual(len(ws), 4)
        self.assertAlmostEqual(ws[0], 0.0)
        self.assertAlmostEqual(ws[1], text.index("dünya") * 0.05)
        self.assertAlmostEqual(ws[3], text.index("güzel") * 0.05)
        self.assertEqual(ws, sorted(ws))

    def test_missing_word_returns_none(self):
        self.assertIsNone(tts._el_word_starts(["yok", "kelime"], _align("bambaşka bir metin")))
        self.assertIsNone(tts._el_word_starts(["a"], None))


@unittest.skipUnless(subprocess.run(["which", "ffmpeg"], capture_output=True).returncode == 0, "ffmpeg yok")
class ElevenLabsSynthTest(unittest.TestCase):
    def test_synthesize_mocked(self):
        with tempfile.TemporaryDirectory() as d:
            mp3 = Path(d) / "t.mp3"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=f=220:d=1", "-ar", "44100", str(mp3)], check=True)
            text = "Selam dünya"
            resp = {"audio_base64": base64.b64encode(mp3.read_bytes()).decode(), "alignment": _align(text)}
            calls = []

            def fake(method, path, body=None, timeout=120):
                calls.append((path, body))
                return resp

            with mock.patch.object(tts, "CACHE", Path(d) / "cache"), mock.patch.object(tts, "_el_request", fake), \
                    mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "x"}):
                v = tts.Voice(engine="elevenlabs")
                self.assertEqual(v.engine, "elevenlabs")
                r = v.say(text, ["Selam", "dünya"], 1.5)
                self.assertEqual(r.sr, tts.SR)
                self.assertAlmostEqual(len(r.audio) / r.sr, 1.0, delta=0.1)
                self.assertEqual(len(r.word_starts), 2)
                self.assertEqual(calls[0][1]["voice_settings"]["speed"], 1.2)  # 0.7–1.2'ye kırpıldı
                self.assertIn("/with-timestamps", calls[0][0])
                v.say(text, ["Selam", "dünya"], 1.5)  # önbellekten
                self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
