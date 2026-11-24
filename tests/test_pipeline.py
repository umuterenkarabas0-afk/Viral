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


class StoryTests(unittest.TestCase):
    def _clips(self, script):
        segs = build_segments(script)
        sr = 48000
        clips = []
        for seg in segs:
            spoken = [w for u in seg.units for w in u.spoken]
            dur = 0.35 * len(spoken) + 0.2
            audio = np.zeros(int(dur * sr), dtype=np.float32)
            audio[int(0.1 * sr):int((dur - 0.1) * sr)] = 0.1
            clips.append(VoiceClip(seg, audio, sr, align_words(audio, sr, spoken), 0.1, dur - 0.1))
        return clips

    def test_all_episodes_valid_and_build(self):
        for i in range(1, 9):
            script = load_script(f"content/series/balikci-kuponu/b0{i}.yaml")
            self.assertEqual(validate_script(script), [], f"bölüm {i}")
            self.assertIn("riza", script["cast"])
            tl, _ = build_timeline(script, self._clips(script), bpm=84, outro_hold=3.2)
            self.assertEqual(tl["format"], "story")
            self.assertEqual(tl["series"]["episode"], i)
            for s in tl["segments"]:
                self.assertEqual(s["kind"], "scene")
                for g in s["gfx"]:
                    self.assertGreaterEqual(g["t0"], s["start"] - 1e-6)
                    self.assertLessEqual(g["t0"], s["end"])
            self.assertTrue(any(g["type"] == "cliff" for g in tl["segments"][-1]["gfx"]))
            self.assertEqual(tl["captions"][0]["style"], "hook")

    def test_story_validation_catches_errors(self):
        from viral.script import validate_story
        bad = {"title": "x", "series": {"title": "s", "episode": 1, "total": 2},
               "scenes": [{"say": "a b", "set": "mars"}, {"say": "c d"}, {"say": "e f", "gfx": [{"type": "fact", "at_word": "zzz"}]}]}
        errs = validate_story(bad)
        self.assertTrue(any("set geçersiz" in e for e in errs))
        self.assertTrue(any("at_word" in e for e in errs))
        self.assertTrue(any("cliff" in e for e in errs))

    def test_elevenlabs_alignment_words(self):
        from viral.tts import _word_times_from_alignment
        text = "Rıza'nın elleri titredi. Çünkü — o yazı!"
        chars = list(text)
        st = [i * 0.05 for i in range(len(chars))]
        en = [s + 0.05 for s in st]
        wt = _word_times_from_alignment(text, {"characters": chars, "character_start_times_seconds": st, "character_end_times_seconds": en})
        # '—' tek başına noktalama: kelime sayılmaz (altyazı birimleriyle aynı kural)
        units, speak = parse_markup(text)
        spoken = [w for u in units for w in u.spoken]
        self.assertEqual(len(wt), len(spoken))
        self.assertAlmostEqual(wt[0][0], 0.0)
        self.assertTrue(all(a < b for a, b in wt))

    def test_prng_matches_renderer(self):
        from viral.story_sound import mulberry32
        r = mulberry32(10)
        self.assertAlmostEqual(r(), 0.5019920116756111)
        self.assertAlmostEqual(r(), 0.9174868050031364)


if __name__ == "__main__":
    unittest.main()
