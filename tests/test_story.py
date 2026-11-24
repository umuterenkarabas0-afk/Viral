"""Hikâye modu birim testleri (ağ ve tarayıcı gerektirmez).

    python -m unittest discover -s tests
"""
import unittest
from pathlib import Path

import numpy as np

from viral.script import parse_markup
from viral.piper_tts import PiperTTS
from viral.story import (LineClip, align_units, apply_voice_profile, build_timeline, load_episode, load_series, normalize_shots,
                         strip_markup, tnorm)

SERIES = Path(__file__).resolve().parent.parent / "content" / "series" / "cebimdeki-not"


def fake_clip(shot_idx, say, style="n", by=None, sr=48000):
    units, speak = parse_markup(say)
    words = speak.split()
    dur = 0.35 * len(words) + 0.3
    audio = np.zeros(int(dur * sr), dtype=np.float32)
    audio[int(0.1 * sr):int((dur - 0.1) * sr)] = 0.1
    bnd = [(w, 0.1 + i * 0.35, 0.1 + i * 0.35 + 0.3) for i, w in enumerate(words)]
    spans = align_units(units, bnd, dur)
    return LineClip(shot_idx, style, by, audio, units, spans, 0.1, dur - 0.1, {"say": say, "v": style, "by": by}, strip_markup(say))


class StoryTests(unittest.TestCase):
    def test_tnorm_and_strip(self):
        self.assertEqual(tnorm("İSTANBUL'da"), "istanbulda")
        self.assertEqual(strip_markup("Saat {08:47|sekizi kırk yedi}, *vapur* kalktı."), "Saat 08:47, vapur kalktı.")

    def test_align_merges_split_tokens(self):
        units, _ = parse_markup("Defne'ydi {08:47|sekiz kırk yedi} tamam")
        bnd = [("Defne'ydi", 0.1, 0.5), ("sekiz", 0.6, 0.8), ("kırk", 0.8, 1.0), ("yedi", 1.0, 1.2), ("tamam", 1.3, 1.6)]
        spans = align_units(units, bnd, 2.0)
        self.assertEqual(len(spans), 3)
        self.assertAlmostEqual(spans[1][0], 0.6)
        self.assertAlmostEqual(spans[1][1], 1.2)
        self.assertAlmostEqual(spans[2][0], 1.3)

    def test_all_episodes_parse(self):
        series = load_series(SERIES)
        for n in range(1, series["episodes"] + 1):
            ep = load_episode(series, n)
            shots = normalize_shots(ep)
            self.assertGreaterEqual(len(shots), 8, n)
            for sh in shots:
                self.assertIn("set", sh)
                if sh.get("cam") and True in sh["cam"]:  # YAML 'on' anahtarı build_timeline'da düzeltilir
                    pass

    def test_timeline_resolves_words_and_cliff(self):
        series = load_series(SERIES)
        ep = load_episode(series, 1)
        shots = normalize_shots(ep)
        clips = [fake_clip(sh["idx"], ln["say"], ln.get("v", "n"), ln.get("by")) for sh in shots for ln in sh["lines"]]
        tl, placements = build_timeline(series, ep, shots, clips)
        self.assertEqual(len(tl["shots"]), len(shots))
        starts = [s["start"] for s in tl["shots"]]
        self.assertEqual(starts, sorted(starts))
        self.assertGreater(tl["cliff"]["t"], tl["shots"][-1]["start"])
        self.assertLess(tl["cliff"]["t"], tl["meta"]["duration"])
        # kamera 'on' anahtarı korunur
        self.assertEqual(tl["shots"][3]["cam"].get("on"), "kerem")
        # el yazısı notu: karakter işaretleri metinle uyumlu
        note = next(s for s in tl["shots"] if s.get("prop", {}).get("marks"))
        for c0, c1, s, e in note["prop"]["marks"]:
            self.assertLess(c0, c1)
            self.assertLessEqual(s, e)
        # @kelime zamanları çekim içinde
        for c in tl["cues"]:
            sh = tl["shots"][c["shot"]]
            self.assertGreaterEqual(c["t"], sh["start"] - 0.05)

    def test_piper_word_assignment(self):
        spans = [(0.0, 0.3), (0.35, 0.6), (0.7, 0.9), (1.0, 1.4)]
        # bir belirteç iki fonem-kelimesine açılabilir (ör. "08:47" → "sekiz kırk yedi")
        w = PiperTTS._assign(["Saat", "sekizkırk", "geçti."], [1, 2, 1], spans)
        self.assertEqual([t for t, _, _ in w], ["Saat", "sekizkırk", "geçti."])
        self.assertEqual((w[1][1], w[1][2]), (0.35, 0.9))
        # sayılar tutmazsa sıralı orantılı eşleme: her belirteç bir aralık alır, sıra korunur
        w = PiperTTS._assign(["a", "bb", "ccc"], [1, 1, 1], spans)
        self.assertEqual(len(w), 3)
        self.assertTrue(all(w[i][1] <= w[i + 1][1] for i in range(2)))
        self.assertEqual(PiperTTS._phoneme_words(list("^ab cd, ef.$")), 3)

    def test_voice_profile_switch(self):
        series = load_series(SERIES)
        self.assertIs(apply_voice_profile(series, None), series)
        self.assertIs(apply_voice_profile(series, "edge"), series)
        p = apply_voice_profile(series, "piper")
        self.assertEqual(p["voice"]["engine"], "piper")
        self.assertEqual(p["id"], "cebimdeki-not-piper")
        self.assertEqual(series["id"], "cebimdeki-not")  # orijinal değişmez
        for st in ("n", "note", "nuri", "stranger", "old", "shout", "twist"):
            self.assertIn(st, p["voice"]["styles"])
        with self.assertRaises(ValueError):
            apply_voice_profile(series, "yok")


if __name__ == "__main__":
    unittest.main()
