"""Hızlı birim testleri (ağ ve tarayıcı gerektirmez).

    python -m unittest discover -s tests
"""
import unittest

import numpy as np

from viral.align import align_words
from viral.script import build_segments, load_script, number_words, parse_markup, syllables, turkish_upper, validate_script
from viral.timeline import VoiceClip, build_timeline, to_srt


class MarkupTests(unittest.TestCase):
    def test_emphasis_danger_swap(self):
        units, speak = parse_markup("Bu *bıyık* çok !zehirli! ve {600|altı yüz} kilo var!")
        disp = [u.display for u in units]
        self.assertEqual(disp, ["Bu", "bıyık", "çok", "zehirli", "ve", "600", "kilo", "var"])
        self.assertEqual(units[1].style, "emph")
        self.assertEqual(units[3].style, "danger")
        self.assertEqual(units[5].spoken, ["altı", "yüz"])
        self.assertEqual(speak, "Bu bıyık çok zehirli ve altı yüz kilo var!")

    def test_exclamation_is_not_danger(self):
        units, _ = parse_markup("Bir balık var! Peki hangisi?")
        self.assertTrue(all(u.style is None for u in units))

    def test_turkish(self):
        self.assertEqual(turkish_upper("istanbul ılık"), "İSTANBUL ILIK")
        self.assertEqual(number_words("600"), "altı yüz")
        self.assertEqual(number_words("1250"), "bin iki yüz elli")
        self.assertEqual(syllables("halüsinasyon"), 5)


class AlignTests(unittest.TestCase):
    def test_phrases_follow_pauses(self):
        sr = 48000
        t = np.arange(int(sr * 2.0)) / sr
        a = 0.3 * np.sin(2 * np.pi * 220 * t)
        a[int(0.9 * sr):int(1.15 * sr)] = 0  # virgül duraklaması
        a[: int(0.1 * sr)] = 0
        words = ["Bir,", "iki", "üç."]
        spans = align_words(a.astype(np.float32), sr, words)
        self.assertAlmostEqual(spans[0][1], 0.9, delta=0.08)
        self.assertGreater(spans[1][0], 1.05)
        self.assertTrue(all(s < e for s, e in spans))

    def test_marks(self):
        a = np.zeros(48000, dtype=np.float32)
        a[4800:40000] = 0.2
        spans = align_words(a, 48000, ["a", "b"], [0.1, 0.5])
        self.assertAlmostEqual(spans[1][0], 0.5)


class ScriptTests(unittest.TestCase):
    def test_example_script_builds_timeline(self):
        script = load_script("content/scripts/akdeniz-baliklari.yaml")
        self.assertEqual(validate_script(script), [])
        segs = build_segments(script)
        clips = []
        sr = 48000
        for seg in segs:
            spoken = [w for u in seg.units for w in u.spoken]
            dur = 0.3 * len(spoken) + 0.2
            audio = np.zeros(int(dur * sr), dtype=np.float32)
            audio[int(0.1 * sr):int((dur - 0.1) * sr)] = 0.1
            spans = align_words(audio, sr, spoken)
            clips.append(VoiceClip(seg, audio, sr, spans, 0.1, dur - 0.1))
        tl, placements = build_timeline(script, clips)
        self.assertEqual(len(tl["segments"]), 12)
        ends = [s["end"] for s in tl["segments"]]
        self.assertEqual(ends, sorted(ends))
        for a, b in zip(tl["segments"], tl["segments"][1:]):
            self.assertAlmostEqual(a["end"], b["start"], places=3)
            # sınırlar 8'lik nota ızgarasında (100 BPM → 0.3 sn)
            self.assertAlmostEqual((a["end"] / 0.3) % 1.0 if (a["end"] / 0.3) % 1.0 < 0.5 else 1 - (a["end"] / 0.3) % 1.0, 0, places=4)
        self.assertTrue(any(c["type"] == "dream" for c in tl["cues"]))
        self.assertIn("-->", to_srt(tl))
        item = next(s for s in tl["segments"] if s.get("rank") == 10)
        self.assertIn("callout", item)
        self.assertGreaterEqual(item["callout"]["t0"], item["start"])


class EdgeBoundaryTests(unittest.TestCase):
    def test_maps_service_words_to_spoken_tokens(self):
        from viral.tts import map_boundaries
        words = ["Venüs'te", "yüzey", "dört", "yüz", "derece.", "*Kurşunu*", "eritir!"]
        bounds = [(0.1, 0.4, "Venüs'te"), (0.5, 0.3, "yüzey"), (0.85, 0.2, "dört"), (1.06, 0.18, "yüz"),
                  (1.3, 0.4, "derece"), (2.2, 0.4, "Kurşunu"), (2.65, 0.4, "eritir")]
        st, en = map_boundaries(words, bounds)
        self.assertEqual(len(st), len(words))
        self.assertAlmostEqual(st[0], 0.1)
        self.assertAlmostEqual(st[5], 2.2)
        self.assertTrue(all(a < b for a, b in zip(st, en)))
        self.assertEqual(st, sorted(st))

    def test_missing_boundary_is_interpolated(self):
        from viral.tts import map_boundaries
        st, en = map_boundaries(["bir", "iki", "üç"], [(0.0, 0.2, "bir"), (1.0, 0.2, "üç")])
        self.assertGreater(st[1], 0.15)
        self.assertLess(st[1], 1.0)

    def test_danger_before_exclamation(self):
        units, speak = parse_markup("yüzeyi kurşunu !eritiyor!!")
        self.assertEqual(units[-1].display, "eritiyor")
        self.assertEqual(units[-1].style, "danger")
        self.assertEqual(speak, "yüzeyi kurşunu eritiyor!")


class SpaceScriptTests(unittest.TestCase):
    def _fake_clips(self, script):
        segs = build_segments(script)
        clips, sr = [], 48000
        for seg in segs:
            spoken = [w for u in seg.units for w in u.spoken]
            dur = 0.3 * len(spoken) + 0.2
            audio = np.zeros(int(dur * sr), dtype=np.float32)
            audio[int(0.1 * sr):int((dur - 0.1) * sr)] = 0.1
            clips.append(VoiceClip(seg, audio, sr, align_words(audio, sr, spoken), 0.1, dur - 0.1))
        return clips

    def test_space_script_builds_timeline(self):
        script = load_script("content/scripts/gunes-sistemi-tuhaf-yerler.yaml")
        self.assertEqual(validate_script(script), [])
        tl, _ = build_timeline(script, self._fake_clips(script))
        self.assertEqual(tl["environment"], "space")
        self.assertEqual(tl["subjects"]["sun"]["kind"], "star")
        self.assertEqual(tl["subjects"]["jupiter"]["kind"], "planet")
        self.assertEqual(sum(1 for s in tl["subjects"].values() if s["kind"] == "planet"), 11)
        types = {c["type"] for c in tl["cues"]}
        self.assertTrue({"axis", "reveal", "sfx", "shake"} <= types)
        io = next(s for s in tl["segments"] if s["id"] == "io")
        self.assertEqual(io["scene"]["companion"]["ref"], "jupiter")
        self.assertIn("subtitle", io)
        for s in tl["segments"]:
            if s.get("callout"):
                self.assertLess(s["callout"]["t0"], s["end"] - 0.4, s["id"])

    def test_space_validation_requires_planet(self):
        script = load_script("content/scripts/gunes-sistemi-tuhaf-yerler.yaml")
        script["items"][0].pop("planet")
        self.assertTrue(any("planet" in e for e in validate_script(script)))


class SpaceSoundTests(unittest.TestCase):
    def test_sfx_generators_are_finite(self):
        from viral import sound_space as SP
        for name, fn in SP.NAMED.items():
            x = fn()
            self.assertTrue(np.all(np.isfinite(x)), name)
            self.assertGreater(np.abs(x).max(), 1e-4, name)
        for x in (SP.sfx_warp(), SP.sfx_impact(), SP.sfx_blip(), SP.sfx_scan(), SP.sfx_data()):
            self.assertTrue(np.all(np.isfinite(x)))

    def test_place_sfx_on_timeline(self):
        from viral import sound_space as SP
        tl = {"segments": [
            {"kind": "hook", "start": 0, "end": 2, "title": {"at": 1.0}, "subject": {"ref": "sun"}},
            {"kind": "item", "rank": 1, "start": 2, "end": 4, "chips": [{}], "callout": {"t0": 2.5}},
            {"kind": "outro", "start": 4, "end": 6}],
            "cues": [{"type": "sfx", "name": "wind", "t": 2.2}]}
        buf = np.zeros((int(6 * SP.SR), 2))
        SP.place_sfx(tl, buf, 2.4)
        self.assertTrue(np.all(np.isfinite(buf)))
        self.assertGreater(np.abs(buf).max(), 0.01)


if __name__ == "__main__":
    unittest.main()
