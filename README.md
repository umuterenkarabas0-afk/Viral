# Viral Shorts Engine 🎬🪐🐟

Merak uyandıran **Türkçe bilgi videolarını** (YouTube Shorts · Instagram Reels · TikTok) **otomatik ve sürekli** üreten sistem.
Konu → senaryo → seslendirme → 3D animasyon → altyazı → ses tasarımı → MP4 hattının tamamı kodla çalışır.

- **3D animasyon (iki görsel dünya)**, Three.js ile tamamen prosedürel:
  - **Uzay** (`environment: space`): GPU'da bake edilen prosedürel gezegen ve uydular (5 katman krater, kalkan volkanlar,
    kanyonlar, kutup başlıkları, çift renkli yüzeyler, ekvator sırtı, kaplan çizgileri, metan gölleri, gaz devi bantları,
    girdap fırtınalar, kutup altıgeni, Venüs V-desenleri, bulut katmanı), halkalar (gölgeli, Cassini boşluklu), atmosfer
    saçılması, kalın pus, volkan/gayzer parçacık püskürmeleri, granülasyonlu ve protuberanslı Güneş, nebula + Samanyolu
    gökyüzü, 7000 yıldız, lens parlaması
  - **Okyanus** (`environment: ocean`): su altı ortamı, kostik ışıklar, ışık huzmeleri, Posidonia, parametrik 3D balıklar
- **Motion graphics**: #10 → #1 sıralama vurgusu, harf harf isim animasyonu, bilgi kartları, 3D noktaya bağlı callout
  çizgileri, holografik tarama ızgarası, dönüş ekseni + yön oku grafiği, pus altını tarayarak gösterme, ilerleme çubuğu,
  hareket bulanıklıklı geçişler (zoom/whip/spin/rise)
- **Türkçe seslendirme**: **Microsoft Edge TTS — Emel** (`tr-TR-EmelNeural`), anahtar gerektirmez; kelime sınırları
  doğrudan servisten alınır. (İsteğe bağlı: Google Cloud TTS, çevrimdışı önizleme için espeak)
- **Altyazı**: kelime kelime senkronlu, vurgulu/tehlike renkli, videoya gömülü + ayrıca `captions.srt`
- **Ses tasarımı tamamen kodla sentezlenir** (hazır örnek yok): tema başına müzik (uzay: D minör sinematik pad, FM cam-çan
  arpeji + ping-pong yankı, nabız bası, sinematik davullar, yıldız çanları), atmosfer (derin uzay uğultusu, kozmik rüzgar,
  pulsar sinyalleri / su altı basıncı, kabarcıklar), geçiş whoosh/warp'ları, vuruşlar, riser, UI blipleri, tarama ve veri
  sesleri, sahneye özel efektler (plazma kükremesi, buz çanları, volkan gürlemesi, gayzer, lav, metan yağmuru, Neptün
  rüzgarı, sıcaklık cızırtısı); seslendirmeye göre ducking, -14 LUFS / -1 dBTP mastering
- **Süre**: ~60 sn (konuşma hızı otomatik ayarlanır), 1080×1920, 30 fps, H.264 + AAC
- **Otomasyon**: konu kuyruğu → Claude ile senaryo + 3D parametre yazımı → üretim → GitHub Actions ile her gün

## Mimari

```
content/topics.yaml ──► viral/writer.py (Claude, dünya: space|ocean) ──► content/scripts/<id>.yaml
                                                          │
                          ┌───────────────────────────────┘
                          ▼
viral/pipeline.py ── tts.py (Edge TTS Emel + kelime sınırları) ── align.py
        │            timeline.py (müzik ızgarasına oturan sahne sınırları, cue'lar)
        │            sound.py / sound_space.py (sentez müzik + atmosfer + SFX + miks + loudness)
        ▼
output/<id>/timeline.json ──► renderer/render.mjs (headless Chromium, paralel işçiler)
                                   ├── src/main.js        yönetmen + post + overlay
                                   ├── src/spacestage.js  uzay kamera/ışık/kompozisyon
                                   ├── src/planet.js      prosedürel gezegen (bake + kare shader'ı)
                                   ├── src/star.js        Güneş   ·  src/space.js  gökyüzü/yıldız/toz
                                   └── src/ocean.js, fish.js   okyanus dünyası
        ▼
output/<id>/<id>.mp4 · cover.jpg · captions.srt · post.txt (başlık/açıklama/hashtag)
```

Render deterministiktir: her kare yalnızca zaman `t`'nin fonksiyonudur. Kareler paralel işçilerle üretilir, yarıda kalan
render kaldığı yerden devam eder. Gezegen dokuları ilk göründükleri karede bake edilir; her işçi yalnızca kendi kare
aralığında gerekenleri üretir.

## Kurulum

```bash
pip install -r requirements.txt
npm install
npx playwright install --with-deps chromium   # (Chromium yoksa)
sudo apt-get install -y ffmpeg
```

Seslendirme için ek anahtar gerekmez (Edge TTS `speech.platform.bing.com` adresine bağlanır; proxy arkasındaysanız
`HTTPS_PROXY` otomatik kullanılır). Ses seçenekleri:

```bash
python -m viral voices                   # Edge: tr-TR-EmelNeural, tr-TR-AhmetNeural
python -m viral voices --engine google   # Google Cloud TTS (GOOGLE_TTS_API_KEY gerekir)
```

Senaryoda: `voice: { name: tr-TR-EmelNeural, speaking_rate: 1.12 }` — hız, videonun ~60 sn'ye oturması için otomatik
ayarlanır (Edge'de 0,9–1,4).

## Kullanım

```bash
# Senaryodan video üret
python -m viral make content/scripts/gunes-sistemi-tuhaf-yerler.yaml

# Hızlı önizleme: ses + timeline + belirli saniyelerden kareler (tam render yok)
python -m viral make content/scripts/gunes-sistemi-tuhaf-yerler.yaml --no-render --stills 1.5,10,30

# Claude ile yeni senaryo yaz (dünya konudan otomatik seçilir; ANTHROPIC_API_KEY gerekli)
python -m viral write "Güneş Sistemi'nin en ilginç 10 uydusu"
python -m viral write "Okyanusun en zehirli 7 balığı" --world ocean

# Sürekli üretim: kuyruktaki sıradaki konu → senaryo → video
python -m viral auto --count 1
```

Çıktılar `output/<id>/` altında: `<id>.mp4`, `cover.jpg`, `captions.srt`, `post.txt` / `post.json`
(başlık, açıklama, hashtag), `audio.wav`, `stems/` (ses, müzik, efekt kanalları), `timeline.json`.

### Render hızı

GPU'suz makinede (SwiftShader) 3D katman 0,75 ölçekte + FXAA ile render edilir, yazılar tam 1080p keskinliktedir.
4 çekirdekte 60 sn'lik video ≈ 25–35 dk sürer. GPU'lu makinede `node renderer/render.mjs --gpu` (tam çözünürlük + MSAA).
`--workers N` paralel tarayıcı sayısıdır.

## Senaryo formatı

Tam örnekler: [`content/scripts/gunes-sistemi-tuhaf-yerler.yaml`](content/scripts/gunes-sistemi-tuhaf-yerler.yaml) (uzay),
[`content/scripts/akdeniz-baliklari.yaml`](content/scripts/akdeniz-baliklari.yaml) (okyanus)

```yaml
environment: space            # space | ocean
hook:   { say: "...", subject: sun, title: { kicker, big, at_word }, cues: [...] }
bodies: { sun: { type: star }, jupiter: { type: gas, ... } }    # açılış/arka plan cisimleri
items:
  - id, rank, name, subtitle (ya da latin)
    say: "Metin; *vurgu*, !tehlike!, {600|altı yüz}"
    chips:   [ { icon: flame, text: "465°C", tone: danger } ]   # en fazla 2-3
    callout: { anchor: volcano, text: "...", at_word: "...", zoom: 0.6 }
    env:     { palette: warm }                                  # uzay: default|warm|cool|violet|gold|deep|teal
    focus:   { lat: 18, lon: 226 }                              # kameranın baktığı yüzey noktası
    camera:  { yaw: [a, b], pitch: [a, b], dist: [a, b], roll }
    scene:   { sun: { az, el, show, x, y, size }, companion: { ref, x, y, size, dist, rot }, offset: [x, y] }
    cues:    [ { type: axis|reveal|shake|flash|sfx, name, at_word } ]
    planet:  { ...prosedürel gezegen parametreleri... }         # okyanusta: fish: {...}
outro:  { say: "...", cta: { question, comment, follow } }
seo:    { title, description, hashtags }
```

**Gezegen parametreleri** (`renderer/src/planet.js` → `PLANET_DEFAULTS`):
`type: rocky|gas`, `colors` (4 renk), `albedo`, `terrain`, `craters`, `volcanoes`, `canyons`, `spots` (lav için `emissive`,
halka tortusu için `ring`), `caps`, `twotone`, `ridge`, `stripes`, `fractures`, `lakes`, `haze`, gaz devleri için `bands`,
`storms`, `hexagon`, `vshape`, `clouds`, `streaks`; ortak `atmosphere`, `rings` (`saturn|thin|faint`), `plumes`
(`umbrella|jet`, `along: stripes`), `emissive`, `tilt`, `spin` (negatif = ters dönüş), `displace`, `relief`.

**Balık parametreleri** (`renderer/src/fish.js` → `FISH_DEFAULTS`): gövde oranları, renkler, desen katmanları, yüzgeçler,
bıyıklar, göz, ağız, yüzme stili.

**Cue'lar** kelimeye (`at_word`) bağlanır; hem görüntü hem ses aynı zamanlamayı kullanır:
`axis` (dönüş ekseni + yön oku), `reveal` (pusun altını tarar), `dream`, `flash`, `shake`,
`sfx` (`sun, ice, whirl, chime, rumble, storm, geyser, lava, rain, wind, heat`).

## Otomatik üretim (GitHub Actions)

`.github/workflows/produce.yml` her gün 05:17 UTC'de (ve elle "Run workflow" ile) çalışır:

1. `content/topics.yaml` kuyruğundan sıradaki konuyu alır (kuyruk boşalırsa Claude her iki dünyadan yeni konular önerir)
2. Senaryo yoksa Claude ile yazar ve doğrular (geçersizse otomatik onarım ister)
3. Videoyu üretir; MP4 + kapak + SRT + paylaşım metnini **Artifact** ve **GitHub Release** olarak yayınlar
4. Güncellenen kuyruğu ve yeni senaryoyu repoya commit'ler

Gerekli repo secret'ı: `ANTHROPIC_API_KEY` (yalnızca yeni senaryo yazımı için). Seslendirme anahtarsız çalışır.
Günde birden fazla video için `cron` satırı çoğaltılabilir ya da "Run workflow" ile `count` artırılabilir.

Senaryo yazımı `claude-opus-5-5` ile yapılır; modelin reddettiği nadir isteklerde sunucu tarafı yedek model
(`fallbacks: "default"`) devreye girer.

> Not: Platformlara (TikTok/YouTube/Instagram) otomatik **yükleme** bu sürümde yoktur; Release'teki MP4 ve
> `post.txt` ile yüklenir. Her platformun kendi API onay süreci olduğundan ayrı bir adım olarak eklenebilir.

## Genişletme

Yeni bir görsel dünya için `renderer/src/` altına bir sahne yönetmeni (örn. `spacestage.js` gibi) ve ortam ekleyip
`main.js`'de `environment` değerine bağlamak, `viral/writer.py`'de `EXAMPLES` ve `WORLD_GUIDE`'a örnek senaryo + parametre
rehberi eklemek yeterli; senaryo/ses/altyazı/otomasyon hattı değişmeden çalışır.

## Testler

```bash
python -m unittest discover -s tests
```
