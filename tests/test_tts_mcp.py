"""Google TTS MCP sunucusu testleri (ağ gerektirmez; Google API'si sahte sunucuyla taklit edilir).

    python -m unittest tests.test_tts_mcp
"""
import asyncio
import base64
import io
import json
import os
import re
import sys
import tempfile
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from viral import tts
from viral import tts_mcp as m

ROOT = Path(__file__).resolve().parents[1]

FAKE_VOICES = [
    {"name": "tr-TR-Chirp3-HD-Charon", "languageCodes": ["tr-TR"], "ssmlGender": "MALE", "naturalSampleRateHertz": 24000},
    {"name": "tr-TR-Chirp3-HD-Aoede", "languageCodes": ["tr-TR"], "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000},
    {"name": "tr-TR-Wavenet-E", "languageCodes": ["tr-TR"], "ssmlGender": "MALE", "naturalSampleRateHertz": 24000},
    {"name": "tr-TR-Standard-A", "languageCodes": ["tr-TR"], "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000},
    {"name": "en-US-Neural2-A", "languageCodes": ["en-US"], "ssmlGender": "MALE", "naturalSampleRateHertz": 24000},
]
SEC_PER_WORD = 0.25


# --------------------------------------------------------------------------- sahte ses üretimi

def make_wav(seconds: float, sr: int = 24000) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(round(seconds * sr)))
    return out.getvalue()


def make_mp3(frames: int, id3: bool = False, xing: bool = False) -> bytes:
    """MPEG-2 Layer III, 32 kb/s, 24 kHz mono: 96 baytlık çerçeve = 576 örnek = 24 ms."""
    h = (0x7FF << 21) | (2 << 19) | (1 << 17) | (1 << 16) | (4 << 12) | (1 << 10) | (3 << 6)
    frame = h.to_bytes(4, "big") + b"\x00" * 92
    info = h.to_bytes(4, "big") + b"\x00" * 9 + b"Info" + b"\x00" * 79 if xing else b""
    tag = b"ID3\x04\x00\x00\x00\x00\x00\x05" + b"\x00" * 5 if id3 else b""
    return tag + info + frame * frames


def make_ogg_opus(granule: int, pre_skip: int = 312) -> bytes:
    head = b"OggS\x00\x02" + (0).to_bytes(8, "little") + b"\x00" * 14 + b"OpusHead\x01\x01" + pre_skip.to_bytes(2, "little")
    last = b"OggS\x00\x04" + granule.to_bytes(8, "little") + b"\x00" * 14
    return head + b"\x00" * 50 + last


def fake_synthesize(path: str, body: dict) -> dict:
    """Google text:synthesize taklidi: kelime başına 0.25 sn, işaretler kelime başında."""
    inp = body["input"]
    src = inp.get("ssml") or inp.get("text")
    marks = re.findall(r'<mark name="([^"]+)"/>', src)
    n = len(re.sub(r"<[^>]+>", " ", src).split())
    dur = n * SEC_PER_WORD
    enc = body["audioConfig"]["audioEncoding"]
    if enc == "LINEAR16":
        audio = make_wav(dur, body["audioConfig"].get("sampleRateHertz", 24000))
    elif enc == "MP3":
        audio = make_mp3(round(dur / 0.024), id3=True, xing=True)
    else:
        audio = make_ogg_opus(int(dur * 48000) + 312)
    resp = {"audioContent": base64.b64encode(audio).decode()}
    if body.get("enableTimePointing"):
        assert path.startswith("/v1beta1/"), path
        resp["timepoints"] = [{"markName": name, "timeSeconds": i * SEC_PER_WORD} for i, name in enumerate(marks)]
    return resp


def fake_request(method: str, path: str, body: dict | None = None) -> dict:
    if path.startswith("/v1/voices"):
        lang = re.search(r"languageCode=([^&]*)", path)
        lang = lang.group(1) if lang else ""
        return {"voices": [v for v in FAKE_VOICES if not lang or any(c.startswith(lang) for c in v["languageCodes"])]}
    return fake_synthesize(path, body)


def long_text(sentences: int) -> str:
    s = "Akdeniz'in derinliklerinde yaşayan bu balık, bıyıklarıyla kumu yoklayarak avını bulur ve gece avlanır."
    return " ".join(f"{s[:-1]} {i}." for i in range(sentences))


class TempDirs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        patches = [
            mock.patch.object(m, "OUTPUT_DIR", (base / "out").resolve()),
            mock.patch.object(m, "CACHE", base / "cache"),
            mock.patch.object(m, "DEFAULT_VOICE", None),
            mock.patch.object(m, "DEFAULT_LANG", "tr-TR"),
            mock.patch.object(tts, "_VOICES", {}),
        ]
        self.req = mock.patch.object(tts, "_request", side_effect=fake_request)
        patches.append(self.req)
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)


# --------------------------------------------------------------------------- birim testleri

class SplitTests(unittest.TestCase):
    def test_chunks_fit_and_keep_words(self):
        text = long_text(150)  # ~15 KB
        for overhead in (0, m._MARK_OVERHEAD):
            chunks = m.split_text(text, m.CHUNK_BYTES, overhead)
            self.assertGreater(len(chunks), 1)
            self.assertEqual([w for c in chunks for w in c], text.split())
            for c in chunks:
                self.assertTrue(c[-1].endswith("."), "parçalar cümle sonunda bitmeli")
                self.assertLessEqual(sum(len(w.encode()) + 1 + overhead for w in c) + 15, m.CHUNK_BYTES)
        # işaretli SSML gerçekten sınırın altında
        n = 0
        for c in m.split_text(text, m.CHUNK_BYTES, m._MARK_OVERHEAD):
            self.assertLessEqual(len(m.marked_ssml(c, n).encode()), m.MAX_INPUT_BYTES)
            n += len(c)

    def test_single_long_sentence_is_split_by_words(self):
        text = " ".join(["kelime"] * 2000)  # nokta yok, ~14 KB
        chunks = m.split_text(text, 1000)
        self.assertGreater(len(chunks), 10)
        self.assertEqual(sum(map(len, chunks)), 2000)

    def test_marked_ssml_escapes(self):
        self.assertEqual(m.marked_ssml(["a<b", "&"], 3), '<speak><mark name="w3"/>a&lt;b <mark name="w4"/>&amp;</speak>')


class ContainerTests(unittest.TestCase):
    def test_mp3_duration_and_concat(self):
        a, b = make_mp3(50, id3=True, xing=True), make_mp3(25, id3=True, xing=True)
        self.assertAlmostEqual(m.mp3_duration(a), 1.2, places=6)   # Xing çerçevesi sayılmaz
        joined = m.concat_audio([a, b], "MP3")
        self.assertNotIn(b"ID3", joined)
        self.assertNotIn(b"Info", joined)
        self.assertEqual(len(joined), 75 * 96)
        self.assertAlmostEqual(m.mp3_duration(joined), 1.8, places=6)

    def test_wav_concat(self):
        joined = m.concat_audio([make_wav(1.0), make_wav(0.5)], "LINEAR16")
        self.assertAlmostEqual(m.wav_duration(joined), 1.5, places=4)

    def test_ogg_opus_duration(self):
        self.assertAlmostEqual(m.ogg_opus_duration(make_ogg_opus(48000 * 2 + 312)), 2.0, places=6)

    def test_voice_names(self):
        self.assertEqual(m.voice_language("tr-TR-Chirp3-HD-Charon"), "tr-TR")
        self.assertEqual(m.voice_family("tr-TR-Chirp3-HD-Charon"), "Chirp3-HD")
        self.assertEqual(m.voice_family("tr-TR-Wavenet-E"), "Wavenet")
        self.assertIsNone(m.voice_language("Kore"))


class SynthesizeTests(TempDirs):
    def test_default_voice(self):
        s = m.synthesize(text="Merhaba dünya.")
        self.assertEqual(s.voice, "tr-TR-Chirp3-HD-Charon")
        self.assertEqual(s.language_code, "tr-TR")
        self.assertEqual(s.chunks, 1)
        self.assertAlmostEqual(s.duration, 0.504, places=3)  # 2 kelime = 0.5 sn → 21 çerçeve × 24 ms

    def test_word_timings_pick_mark_voice(self):
        s = m.synthesize(text="Bir iki üç dört.", word_timings=True, audio_encoding="LINEAR16")
        self.assertEqual(s.voice, "tr-TR-Wavenet-E")
        self.assertEqual([t["start"] for t in s.timepoints], [0.0, 0.25, 0.5, 0.75])
        self.assertEqual(s.timepoints[-1]["word"], "dört.")

    def test_word_timings_across_chunks(self):
        text = long_text(150)
        s = m.synthesize(text=text, word_timings=True, audio_encoding="LINEAR16")
        words = text.split()
        self.assertGreater(s.chunks, 1)
        self.assertEqual([t["word"] for t in s.timepoints], words)
        # sahte sunucu kelime başına 0.25 sn → parçalar arası kaydırma doğruysa i * 0.25
        for i, t in enumerate(s.timepoints):
            self.assertAlmostEqual(t["start"], i * SEC_PER_WORD, places=3)
        self.assertAlmostEqual(s.duration, len(words) * SEC_PER_WORD, places=3)
        for call in tts._request.call_args_list:
            if "synthesize" in call.args[1]:
                self.assertEqual(call.args[1], "/v1beta1/text:synthesize")
                self.assertLessEqual(len(call.args[2]["input"]["ssml"].encode()), m.MAX_INPUT_BYTES)

    def test_long_plain_text_mp3(self):
        s = m.synthesize(text=long_text(150))
        self.assertGreater(s.chunks, 1)
        self.assertNotIn(b"ID3", s.audio)
        self.assertAlmostEqual(s.duration, len(long_text(150).split()) * SEC_PER_WORD, delta=0.02 * s.chunks)

    def test_ssml_marks(self):
        s = m.synthesize(ssml='<speak><mark name="a"/>Bir <mark name="b"/>iki</speak>', voice="tr-TR-Wavenet-E", word_timings=True)
        self.assertEqual(s.timepoints, [{"mark": "a", "start": 0.0}, {"mark": "b", "start": 0.25}])

    def test_errors(self):
        with self.assertRaisesRegex(ValueError, "tam olarak biri"):
            m.synthesize()
        with self.assertRaisesRegex(ValueError, "tam olarak biri"):
            m.synthesize(text="a", ssml="<speak>a</speak>")
        with self.assertRaisesRegex(ValueError, "desteklemiyor"):
            m.synthesize(text="a", voice="tr-TR-Chirp3-HD-Charon", word_timings=True)
        with self.assertRaisesRegex(ValueError, "OGG_OPUS"):
            m.synthesize(text=long_text(150), audio_encoding="OGG_OPUS")
        with self.assertRaisesRegex(ValueError, "5000"):
            m.synthesize(ssml="<speak>" + "a " * 3000 + "</speak>")
        with self.assertRaisesRegex(ValueError, "<mark"):
            m.synthesize(ssml="<speak>a</speak>", word_timings=True)

    def test_request_body_and_cache(self):
        kw = dict(text="Merhaba.", voice="tr-TR-Wavenet-E", speaking_rate=1.1, pitch=-2, effects_profile="headphone-class-device")
        m.synthesize(**kw)
        body = tts._request.call_args.args[2]
        self.assertEqual(tts._request.call_args.args[1], "/v1/text:synthesize")
        self.assertEqual(body["voice"], {"languageCode": "tr-TR", "name": "tr-TR-Wavenet-E"})
        self.assertEqual(body["audioConfig"], {"audioEncoding": "MP3", "speakingRate": 1.1, "pitch": -2,
                                               "effectsProfileId": ["headphone-class-device"]})
        n = tts._request.call_count
        s = m.synthesize(**kw)
        self.assertEqual(tts._request.call_count, n)  # önbellekten
        self.assertEqual(s.cached_chunks, 1)

    def test_other_language_and_voice_list(self):
        s = m.synthesize(text="Hello.", language_code="en-US")
        self.assertEqual(s.voice, "en-US-Neural2-A")
        r = m.tool_list_voices(name_contains="chirp3")
        self.assertEqual([v["name"] for v in r["voices"]], ["tr-TR-Chirp3-HD-Aoede", "tr-TR-Chirp3-HD-Charon"])
        self.assertFalse(r["voices"][0]["word_timings"])
        self.assertEqual(m.tool_list_voices(language_code="", limit=2)["total"], len(FAKE_VOICES))
        self.assertEqual(m.tool_list_languages()["languages"], [{"code": "en-US", "voices": 1}, {"code": "tr-TR", "voices": 4}])

    def test_output_path(self):
        out = m.OUTPUT_DIR
        self.assertEqual(m.output_path("a/b.mp3", "MP3", b""), out / "a/b.mp3")
        self.assertEqual(m.output_path("giris.mp3", "LINEAR16", b""), out / "giris.wav")
        self.assertEqual(m.output_path("bolum.1", "MP3", b""), out / "bolum.1.mp3")
        self.assertEqual(m.output_path(None, "OGG_OPUS", b"x").parent, out)
        for bad in ("../x.mp3", "/etc/x.mp3", "a/../../x.mp3"):
            with self.assertRaises(ValueError):
                m.output_path(bad, "MP3", b"")


# --------------------------------------------------------------------------- uçtan uca (stdio MCP)

class _FakeGoogle(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("X-Goog-Api-Key") != "test-key":
            return self._send({"error": {"message": "bad key"}}, 403)
        self._send(fake_request("GET", self.path))

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self._send(fake_synthesize(self.path, body))

    def log_message(self, *a):
        pass


try:
    import mcp  # noqa: F401
    HAVE_MCP = True
except ImportError:
    HAVE_MCP = False


@unittest.skipUnless(HAVE_MCP, "mcp paketi kurulu değil (pip install -r requirements-mcp.txt)")
class StdioServerTests(unittest.TestCase):
    def test_end_to_end(self):
        from mcp.client.client import Client
        from mcp.client.stdio import StdioServerParameters

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), _FakeGoogle)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.shutdown)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = Path(tmp.name) / "out"
        env = {
            "PATH": os.environ.get("PATH", ""),
            "PYTHONPATH": str(ROOT),
            "GOOGLE_TTS_ENDPOINT": f"http://127.0.0.1:{httpd.server_port}",
            "GOOGLE_TTS_API_KEY": "test-key",
            "GOOGLE_TTS_MCP_OUTPUT_DIR": str(out),
            "VIRAL_CACHE": str(Path(tmp.name) / "cache"),
            "NO_PROXY": "127.0.0.1,localhost",
        }
        params = StdioServerParameters(command=sys.executable, args=["-m", "viral", "mcp"], env=env, cwd=tmp.name)

        async def run():
            async with Client(params) as c:
                names = sorted(t.name for t in (await c.list_tools()).tools)
                self.assertEqual(names, ["list_languages", "list_voices", "synthesize_speech"])

                r = await c.call_tool("list_voices", {"name_contains": "Wavenet"})
                self.assertFalse(r.is_error, r.content)
                self.assertEqual(r.structured_content["voices"][0]["name"], "tr-TR-Wavenet-E")

                r = await c.call_tool("synthesize_speech", {"text": "Merhaba dünya, nasılsın?", "word_timings": True,
                                                            "audio_encoding": "LINEAR16", "filename": "deneme/selam"})
                self.assertFalse(r.is_error, r.content)
                res = r.structured_content
                self.assertEqual(res["path"], str((out / "deneme/selam.wav").resolve()))
                self.assertTrue(Path(res["path"]).is_file())
                self.assertEqual(res["voice"], "tr-TR-Wavenet-E")
                self.assertEqual([t["word"] for t in res["word_timings"]], ["Merhaba", "dünya,", "nasılsın?"])
                self.assertAlmostEqual(res["duration_seconds"], 0.75, places=3)

                r = await c.call_tool("synthesize_speech", {"text": "x", "filename": "../kacak.mp3"})
                self.assertTrue(r.is_error)
                self.assertIn("..", r.content[0].text)

                r = await c.call_tool("synthesize_speech", {"text": "x", "speaking_rate": 9})
                self.assertTrue(r.is_error)

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
