"""Edge (Microsoft) TTS yardımcılarının birim testleri (ağ gerektirmez).

    python -m unittest discover -s tests
"""
import unittest

from viral.tts import edge_rate, map_word_boundaries


class EdgeBoundaryTests(unittest.TestCase):
    def test_one_to_one_with_punctuation(self):
        words = ["Onuncu", "sırada", "barbunya."]
        b = [(0.10, 0.40, "Onuncu"), (0.55, 0.35, "sırada"), (0.95, 0.50, "barbunya")]
        self.assertEqual(map_word_boundaries(words, b), [0.10, 0.55, 0.95])

    def test_service_splits_word(self):
        # servis "Akdeniz'de" kelimesini ikiye bölerse kelime ilk parçanın başında başlar
        words = ["Akdeniz'de,", "bir", "balık"]
        b = [(0.0, 0.5, "Akdeniz"), (0.5, 0.2, "de"), (0.8, 0.2, "bir"), (1.1, 0.3, "balık")]
        self.assertEqual(map_word_boundaries(words, b), [0.0, 0.8, 1.1])

    def test_service_merges_words(self):
        # iki kelime tek sınırda gelirse ikinci kelime harf oranına göre içeride başlar
        words = ["on", "balık"]
        b = [(1.0, 0.7, "on balık")]
        starts = map_word_boundaries(words, b)
        self.assertAlmostEqual(starts[0], 1.0)
        self.assertAlmostEqual(starts[1], 1.0 + 0.7 * 2 / 7)

    def test_turkish_case_and_punctuation_boundaries_ignored(self):
        words = ["İşte", "IŞIK!"]
        b = [(0.0, 0.3, "işte"), (0.3, 0.0, "!"), (0.4, 0.3, "ışık")]
        self.assertEqual(map_word_boundaries(words, b), [0.0, 0.4])

    def test_mismatch_falls_back(self):
        words = ["600", "kilo"]
        b = [(0.0, 0.2, "altı"), (0.2, 0.2, "yüz"), (0.5, 0.3, "kilo")]
        self.assertIsNone(map_word_boundaries(words, b))  # align.py kendi hizalamasını yapar
        self.assertIsNone(map_word_boundaries(words, []))

    def test_monotonic(self):
        words = "Peki hangisi? İşte Akdeniz'e özgü on balık.".split()
        b, t = [], 0.0
        for w in ["Peki", "hangisi", "İşte", "Akdeniz'e", "özgü", "on", "balık"]:
            b.append((t, 0.3, w))
            t += 0.4
        s = map_word_boundaries(words, b)
        self.assertEqual(len(s), len(words))
        self.assertEqual(s, sorted(s))

    def test_rate_string(self):
        self.assertEqual(edge_rate(1.1), "+10%")
        self.assertEqual(edge_rate(1.0), "+0%")
        self.assertEqual(edge_rate(0.9), "-10%")
        self.assertEqual(edge_rate(1.234), "+23%")


if __name__ == "__main__":
    unittest.main()
