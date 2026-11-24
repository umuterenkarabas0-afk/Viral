# Viral Shorts Engine 🎬🐟

Merak uyandıran **Türkçe bilgi videolarını** (YouTube Shorts · Instagram Reels · TikTok) **otomatik ve sürekli** üreten sistem.

- **3D animasyon**: Three.js ile tamamen prosedürel sahne: su altı ortamı, kostik ışıklar, ışık huzmeleri, Posidonia çayırları, kabarcıklar ve parametrelerle üretilen, yüzme animasyonlu 3D balıklar
- **Motion graphics**: sıralama vurgusu (#10 → #1), harf harf isim animasyonu, bilgi kartları, 3D noktaya bağlı callout çizgileri, ilerleme çubuğu, geçişlerde hareket bulanıklığı, "rüya" (halüsinasyon) efekti
- **Türkçe seslendirme**: Google Cloud Text-to-Speech (Chirp3-HD / WaveNet) veya **Piper** (yerel, ücretsiz, anahtarsız)
- **Altyazı**: kelime kelime senkronlu, vurgulu, videoya gömülü + ayrıca `captions.srt`
- **Ses tasarımı tamamen kodla sentezlenir**: müzik (pluck arpej, pad, bas, davullar), su altı atmosferi, whoosh geçişleri, impact vurguları, riser, kabarcık/pop/sparkle efektleri; seslendirmeye göre ducking, -14 LUFS mastering
- **Süre**: ~60 sn (konuşma hızı otomatik ayarlanır), 1080×1920, 30 fps, H.264 + AAC
- **Otomasyon**: konu kuyruğu → Claude ile senaryo + 3D parametre yazımı → üretim → GitHub Actions ile her gün

## Mimari

```
content/topics.yaml ──► viral/writer.py (Claude) ──► content/scripts/<id>.yaml
                                                          │
                          ┌───────────────────────────────┘
                          ▼
viral/pipeline.py ── tts.py (Google TTS / Piper) ── align.py (kelime zamanları)
        │            timeline.py (müzik ızgarasına oturan sahne sınırları)
        │            sound.py (sentez müzik + SFX + miks + loudness)
        ▼
output/<id>/timeline.json ──► renderer/render.mjs (headless Chromium, paralel işçiler)
                                   └── renderer/src/*.js (Three.js sahne + DOM motion graphics)
        ▼
output/<id>/<id>.mp4 · cover.jpg · captions.srt · post.txt (başlık/açıklama/hashtag)
```

Render deterministiktir: her kare yalnızca zaman `t`'nin fonksiyonudur. Bu sayede kareler paralel işçilerle
üretilir ve yarıda kalan bir render kaldığı yerden devam eder.

## Kurulum

```bash
pip install -r requirements.txt
npm install
npx playwright install --with-deps chromium   # (Chromium yoksa)
sudo apt-get install -y ffmpeg
```

### Google TTS anahtarı

1. Google Cloud'da bir projede **Cloud Text-to-Speech API**'yi etkinleştirin, bir **API anahtarı** oluşturun.
2. Anahtarı `GOOGLE_TTS_API_KEY` ortam değişkeni olarak verin (GitHub Actions'ta repo secret olarak).
   Alternatif: `gcloud auth print-access-token` ile alınan token (`GOOGLE_TTS_ACCESS_TOKEN`).

Anahtar yoksa `--tts auto` **Piper**'a düşer (aşağıya bakın); Piper da kullanılamazsa yalnızca önizleme için
`espeak-ng` (robotik ses) kullanılır.

### Piper (ücretsiz, yerel seslendirme)

[Piper](https://github.com/OHF-Voice/piper1-gpl) bilgisayarda çalışan nöral bir TTS'tir: API anahtarı, kota ya da
ücret yoktur. 60 sn'lik ses CPU'da birkaç saniyede üretilir. Ses modeli ilk kullanımda `.cache/piper/` altına
indirilir (~63 MB, huggingface.co).

```bash
python -m viral make content/scripts/akdeniz-baliklari.yaml --tts piper
python -m viral voices --engine piper     # resmi Türkçe Piper sesleri
```

- **Kelime zamanları** Piper'ın fonem hizalamasından gelir (bu yüzden `onnx` paketi gerekir); kelime sayısı
  tutmazsa `align.py` devreye girer.
- Varsayılan ses `tr_TR-dfki-medium`; değiştirmek için `PIPER_VOICE` ortam değişkeni ya da senaryoda
  `voice: { engine: piper, name: <ses adı | model.onnx yolu | .onnx URL'si>, speaker: 0 }`.
  URL verilirse yanındaki `.onnx.json` da aynı adresten indirilir; topluluğun eğittiği Türkçe sesler bu yolla kullanılabilir.
- dfki sesi doğal olarak yavaş konuştuğu için hız sınırı Piper'da 1,6'dır (Google'da 1,3).

> ⚠️ **Lisans**: Resmi tek Türkçe Piper sesi olan `tr_TR-dfki-medium`, **CC BY-NC-SA 4.0** lisanslı bir veri
> setiyle eğitilmiştir, yani **ticari olmayan** kullanım içindir. Para kazanan (monetize) bir kanalda ticari
> kullanıma izin veren bir model kullanın ya da kendi sesinizle bir Piper modeli eğitin. Piper yazılımının kendisi GPL-3.0'dır;
> ürettiği ses dosyaları bu lisanstan etkilenmez.

```bash
python -m viral voices     # kullanılabilir Türkçe sesleri listeler
```

Varsayılan ses tercihi: `tr-TR-Chirp3-HD-Charon` → diğer Chirp3-HD → `tr-TR-Wavenet-E` …
Senaryoda değiştirmek için: `voice: { name: tr-TR-Wavenet-B, speaking_rate: 1.1 }`.
SSML `<mark>` destekleyen seslerde (WaveNet/Standard) kelime zamanları doğrudan Google'dan gelir; Chirp3-HD'de
Türkçe hece sayısı + sessizlik analizine dayalı hizalama kullanılır.

## Kullanım

```bash
# Senaryodan video üret
python -m viral make content/scripts/akdeniz-baliklari.yaml --tts google

# Hızlı önizleme: ses + timeline + belirli saniyelerden kareler (render yok)
python -m viral make content/scripts/akdeniz-baliklari.yaml --no-render --stills 1.5,10,30

# Claude ile yeni senaryo yaz (ANTHROPIC_API_KEY gerekli)
python -m viral write "Karadeniz'in en ilginç 10 balığı"

# Sürekli üretim: kuyruktaki sıradaki konu → senaryo → video
python -m viral auto --count 1
```

Çıktılar `output/<id>/` altında: `<id>.mp4`, `cover.jpg`, `captions.srt`, `post.txt` / `post.json`
(başlık, açıklama, hashtag), `audio.wav`, `stems/` (ses, müzik, efekt kanalları), `timeline.json`.

### Render hızı

GPU'suz makinede (SwiftShader) 3D katman 0,75 ölçekte + FXAA ile render edilir, yazılar tam 1080p keskinliktedir.
4 çekirdekte 60 sn'lik video ≈ 15–25 dk sürer. GPU'lu makinede `node renderer/render.mjs --gpu` (tam çözünürlük + MSAA).
`--workers N` paralel tarayıcı sayısıdır.

## Senaryo formatı

Tam örnek: [`content/scripts/akdeniz-baliklari.yaml`](content/scripts/akdeniz-baliklari.yaml)

```yaml
hook:   { say: "...", subject: <item-id>, title: { kicker, big, at_word }, cues: [ { type: dream, at_word } ] }
items:
  - id, rank, name, latin
    say: "Metin; *vurgu*, !tehlike!, {600|altı yüz}"
    chips:   [ { icon: ruler, text: "~20 cm" } ]           # en fazla 3
    callout: { anchor: barbels, text: "...", at_word: "bıyık" }
    env:     { habitat: sand|seabed|meadow|reef|rocky|open, palette: default|warm|deep|open }
    camera:  { yaw: [başlangıç, bitiş], pitch: [...], dist: [...] }   # isteğe bağlı
    fish:    { ...prosedürel 3D balık parametreleri... }
outro:  { say: "...", cta: { question, comment, follow } }
seo:    { title, description, hashtags }
```

**Balık parametreleri** (`renderer/src/fish.js` → `FISH_DEFAULTS`): gövde oranları (`height`, `width`, `maxAt`,
`noseTop`, `noseBottom`, `peduncle`, `belly`, `keel`), renkler (`back/side/belly`), desen katmanları
(`hstripes`, `vbars`, `spots`, `blotches`, `ocellus`, `patch`, `band`, `diagonal`, `scribble`, `wavy`, `mottle`),
yüzgeçler (`dorsal/anal`: spiny|rounded|falcate|triangle|long|tall; `caudal`: forked|lunate|emarginate|truncate|rounded|pointed;
`pectoral`, `pelvic`, `finlets`), `barbels`, göz, ağız, yüzme stili (`carangiform|thunniform|anguilliform|labriform`).

**Cue'lar**: `dream` (renk kayması + dalgalanma + psikedelik ses), `flash`, `shake` — `at_word` ile kelimeye bağlanır;
hem görüntü hem ses tasarımı aynı zamanlamayı kullanır.

## Otomatik üretim (GitHub Actions)

`.github/workflows/produce.yml` her gün 05:17 UTC'de (ve elle "Run workflow" ile) çalışır:

1. `content/topics.yaml` kuyruğundan sıradaki konuyu alır (kuyruk boşalırsa Claude yeni konular önerir)
2. Senaryo yoksa Claude ile yazar ve doğrular (geçersizse otomatik onarım ister)
3. Videoyu üretir; MP4 + kapak + SRT + paylaşım metnini **Artifact** ve **GitHub Release** olarak yayınlar
4. Güncellenen kuyruğu ve yeni senaryoyu repoya commit'ler

Gerekli repo secret'ları: `ANTHROPIC_API_KEY`; isteğe bağlı `GOOGLE_TTS_API_KEY`.
Seslendirme `auto` modundadır: Google anahtarı varsa Google, yoksa Piper kullanılır. Zorlamak için
repo **değişkeni** (Settings → Secrets and variables → Actions → Variables) `VIRAL_TTS=piper` veya `google`;
Piper sesi için `PIPER_VOICE`.

Senaryo yazımı `claude-opus-5-5` ile yapılır; modelin reddettiği nadir isteklerde sunucu tarafı yedek model
(`fallbacks: "default"`) devreye girer.

> Not: Platformlara (TikTok/YouTube/Instagram) otomatik **yükleme** bu sürümde yoktur; Release'teki MP4 ve
> `post.txt` ile yüklenir. Her platformun kendi API onay süreci olduğundan ayrı bir adım olarak eklenebilir.

## Genişletme

Görsel kit şu an **okyanus ortamı + prosedürel balık** üzerine kurulu (deniz canlıları kanalı). Yeni konu
türleri için `renderer/src/` altına yeni bir özne (ör. `planet.js`) ve ortam (ör. `space.js`) ekleyip
`main.js`'deki özne kaydına bağlamak yeterli; senaryo/ses/altyazı/otomasyon hattı değişmeden çalışır.

## Testler

```bash
python -m unittest discover -s tests
```
