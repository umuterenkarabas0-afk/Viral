# Viral Shorts Engine 🎬🐟

Merak uyandıran **Türkçe bilgi videolarını** (YouTube Shorts · Instagram Reels · TikTok) **otomatik ve sürekli** üreten sistem.

İki format var:

| Format | Örnek | Süre |
|---|---|---|
| **Mini dizi (story)** — 3D animasyonlu, bölüm sonu merak kancalı hikâye + her bölümde gerçek bir bilgi | [`content/series/balikci-kuponu/`](content/series/balikci-kuponu) — *Balıkçının Kuponu* (8 bölüm) | ~45 sn |
| Geri sayım (countdown) — "en ilginç 10 …" | [`content/scripts/akdeniz-baliklari.yaml`](content/scripts/akdeniz-baliklari.yaml) | ~60 sn |

## Mini dizi formatı (story)

- **3D**: Three.js ile tamamen prosedürel dünya — zaman dilimine göre gökyüzü (şafak/gündüz/gün batımı/gece/fırtına,
  bulutlar, yıldızlar, şimşek), Gerstner dalgalı deniz (güneş parıltısı, köpük, fener yansıması), dalgada salınan
  Karadeniz kayığı, ağ + balıklar, mantarlı şişe, **kıvrılarak açılan kupon**, el yazısı not, martılar, yamaçta köy ve
  iskele, fener adası (dönen ışık huzmesi), bayi, kahvehane (canlı maç yayını olan TV), ev, fenerin içi, infografik boşluğu
- **Karakterler**: iskeletli, stilize animasyon karakterleri (göz kırpma, kaş/ağız ifadesi) ve pozlar:
  `stand haul hold read shock kneel sit walk cheer look point`. Kadro `series.yaml` içinde renk/aksesuar parametreleriyle tanımlanır.
- **Motion graphics**: dizi rozeti + 8 bölümlük ilerleme çubuğu, harf harf düşen kinetik başlık, daktilo mekân/saat yazısı,
  3D noktaya bağlı etiketler, damga, **BİLGİ** kartı (rakamlar karışarak yerine oturur), el yazısı alıntı, sayaç, skor bandı,
  bölüm sonu **"DEVAMI BÖLÜM N"** merak kancası kartı, kelime kelime vurgulu altyazı
- **Kamera**: establish / push / pull / orbit / closeup / low / over çekimleri, whip-zoom-rise-spin geçişleri (hareket
  bulanıklığı), el kamerası titreşimi, sarsıntı, kalp atışı nabzı, alan derinliği
- **Ses tasarımı (tamamı kodla sentez, `viral/story_sound.py`)**: sahnenin ruh hâline (`calm tension reveal fact triumph cliff`)
  göre beste — drone, saat-tik ostinato, nabız bas, müzik kutusu motifi, "braam" vurgusu, zafer arpeji, merak kancasında
  sub-drop + tik-tak; atmosfer — dalga, tekneye çarpan su, rüzgâr, martı, ahşap gıcırtısı, yağmur, gök gürültüsü
  (görüntüdeki şimşeklerle aynı deterministik zamanlama), kahvehane uğultusu, stadyum, duvar saati, cırcır böceği;
  efektler — whoosh, impact, daktilo, damga, kâğıt hışırtısı, cam tıngırtısı, kalp atışı, kapı vuruşu, sayaç, düdük
- **Seslendirme**: **ElevenLabs** (`eleven_multilingual_v2`, Türkçe). `/with-timestamps` karakter hizalaması sayesinde
  altyazılar kelimesi kelimesine senkron. Sahneler arası tonlama sürekliliği için `previous_text/next_text` gönderilir.
  Google TTS alternatif motor olarak duruyor (`--tts google`).

```bash
python -m viral make content/series/balikci-kuponu/b01.yaml                 # tek bölüm (ElevenLabs)
python -m viral make content/series/balikci-kuponu/b01.yaml --no-render --stills 2,12,24   # hızlı önizleme
python -m viral series "Bir deniz fenerinde kaybolan bekçinin sırrı" --episodes 8           # Claude ile yeni dizi + kuyruğa ekle
python -m viral voices                                                       # ElevenLabs seslerini listele
```

Ses seçimi: senaryoda `voice: { engine: elevenlabs, name: <voice_id veya ad>, speaking_rate: 1.0, settings: {stability, style} }`
ya da ortam değişkeni `ELEVENLABS_VOICE_ID` (varsayılan: hazır "Brian" anlatıcı sesi). Model: `ELEVENLABS_MODEL`.

### Sahne YAML'ı (özet)

```yaml
scenes:
  - id: reveal
    say: "Rıza'nın elleri titredi. Çünkü o yazı, !kendi el yazısıydı!."
    set: deck            # sea | deck | harbor | kiosk | coffeehouse | home | lighthouse | void
    time: dawn           # dawn | day | dusk | night | storm
    mood: reveal         # müziği belirler
    shot: { type: push, target: face, from: { yaw: 0.55, pitch: 0.1, dist: 1.4 }, to: { yaw: 0.25, pitch: 0.04, dist: 0.5 } }
    actors: { riza: { pose: shock } }
    props: [boat]
    cues: [ { type: shake, at_word: "kendi" }, { type: heartbeat, at_word: "titredi", dur: 2.4 } ]
    gfx:  [ { type: stamp, text: "AYNI EL YAZISI", tone: danger, at_word: "kendi" } ]
```

- **3D animasyon**: Three.js ile tamamen prosedürel sahne: su altı ortamı, kostik ışıklar, ışık huzmeleri, Posidonia çayırları, kabarcıklar ve parametrelerle üretilen, yüzme animasyonlu 3D balıklar
- **Motion graphics**: sıralama vurgusu (#10 → #1), harf harf isim animasyonu, bilgi kartları, 3D noktaya bağlı callout çizgileri, ilerleme çubuğu, geçişlerde hareket bulanıklığı, "rüya" (halüsinasyon) efekti
- **Türkçe seslendirme**: Google Cloud Text-to-Speech (Chirp3-HD / WaveNet)
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
viral/pipeline.py ── tts.py (Google TTS) ── align.py (kelime zamanları)
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

Anahtar yoksa `--tts auto` yalnızca **önizleme** için `espeak-ng`'ye düşer (robotik ses); üretim için `--tts google` kullanın.

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

1. `content/topics.yaml` kuyruğundan sıradaki bölümü/konuyu alır (kuyruk boşalırsa Claude yeni bir mini dizi yazar)
2. Senaryo yoksa Claude ile yazar ve doğrular (geçersizse otomatik onarım ister)
3. Videoyu üretir; MP4 + kapak + SRT + paylaşım metnini **Artifact** ve **GitHub Release** olarak yayınlar
4. Güncellenen kuyruğu ve yeni senaryoyu repoya commit'ler

Gerekli repo secret'ları: `ELEVENLABS_API_KEY` (seslendirme), `ANTHROPIC_API_KEY` (yeni dizi/senaryo yazımı).
İsteğe bağlı: `GOOGLE_TTS_API_KEY`, repo değişkeni `ELEVENLABS_VOICE_ID`.

İş akışı günde iki kez (05:17 ve 14:47 UTC) kuyruktaki sıradaki bölümü üretir. Kuyruk boşalınca Claude yeni bir
8 bölümlük mini dizi tasarlar (dizi incelemesi → bölüm senaryoları → doğrulama/onarım) ve bölümleri kuyruğa ekler.

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
