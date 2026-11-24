# Mini dizi (hikâye modu) senaryo şeması

Bir dizi klasörü: `series.yaml` (ortak tanımlar) + `ep01.yaml … epNN.yaml` (çekim listeleri).

```bash
python -m viral series content/series/cebimdeki-not --ep 1            # tek bölüm
python -m viral series content/series/cebimdeki-not --ep all          # hepsi
python -m viral series content/series/cebimdeki-not --ep 3 --no-render --stills 2,10,20   # hızlı önizleme
```

Çıktı: `output/<dizi>/epNN/` → `<dizi>-bolum-NN.mp4`, `cover.jpg`, `captions.srt`, `post.txt`, `audio.wav`, `stems/`, `timeline.json`.

## series.yaml

| alan | açıklama |
|---|---|
| `voice.name` | Edge TTS sesi (varsayılan `tr-TR-AhmetNeural`) |
| `voice.styles.<stil>` | `rate`, `pitch`, `volume` — replik stilleri: `n` (anlatıcı), `note`, `nuri`, `stranger`, `old`, `shout`, `twist` |
| `voice_profiles.<ad>` | alternatif ses profili (`--voice <ad>`); çıktı `output/<id>-<ad>/` altına gider |
| `voice_profiles.piper` | `engine: piper`, `styles.<stil>`: `model` (dfki, fahrettin, fettah, eren), `rate`, `length` (fonem süresi çarpanı), `noise`, `noise_w`, `semitones` (perde), `gain_db`, `pause` (cümle arası sn), `takes` (en anlaşılır çekim seçimi); `speakers.<id>`: konuşmacıya özel geçersiz kılma |
| `theme` | `accent`, `accent2`, `danger`, `paper`, `ink` renkleri |
| `cast.<id>` | prosedürel 3D karakter: `skin`, `hair{style,color}`, `eyes`, `brows`, `mustache`, `beard`, `glasses`, `stubble`, `old`, `female`, `build{height,width}`, `outfits{ad: {top, coat, jacket, vest, apron, skirt, pants, shoes, scarf, cap, hat, beret, sunglasses, fakeMustache, tray, stripes, lanyard}}`, `default` |

Saç stilleri: `messy, bob, short_f, sides, bald, side, curly, bun, long, short`.

## epNN.yaml

```yaml
episode: 1
title: "50 Liralık Palto"
hook: "BU NOT YARINI BİLİYORDU"            # ilk 2,5 sn'deki kanca yazısı
cliff: { question: "Sence parayı kim ödedi?", next: "BÖLÜM 2", final: false }
seo: { title, description }
shots:
  - set: market          # office | market | room | pier | street | bookshop | square | cafe | deck | insert
    time: day            # morning | day | evening | sunset | dawn | night | rain
    grade: normal        # sepia (geçmiş) | nightvision (kamera kaydı)
    mood: mystery        # müzik: mystery | comedy | tension | warm | reveal | quiet
    cut: whip            # bu çekime giriş: cut | whip | flash | fade | glitch
    label: { place: "KADIKÖY BİT PAZARI", time: "PAZAR · 11:40" }   # daktilo konum etiketi
    tag: { who: kerem, name: "KEREM · 27", sub: "..." }            # karakter tanıtım kartı
    bubble: { who: defne, text: "...", at_word: "teorisi" }        # konuşma balonu
    overlay: { type: suspects|rec|photo|photojoin|network|bigtext, ... }
    extras: 7            # figüran sayısı;  crowd: stare | readnotes
    props: [crates, cart, padlock, tripod, cat_top, ...]           # mekâna özel aksesuarlar
    prop: { type: note|notes_many|notes_pair|map|book|book_margin|pen_write|pen_shake, surface: wood|coat|cloth|deck|hand|market_cloth, hand: nuri|kerem|twist }
    cast:
      - { who: kerem, outfit: coat, at: [x, z], face: 15 | <id>, do: idle | [[zaman, eylem], ...],
          expr: ..., look: cam|around|up|floor|hand|<id>|<çapa>, hold: note|photo|pen|tea|tea2|bowl|phone|umbrella_red|simit2|coat_folded|coat_hanger,
          pose: sit|crouch|lying, walk: [[x,z], [x,z]] }
    same: true           # önceki çekimin oyuncularını devral;  acts: { kerem: { expr: shock } }
    cam: { shot: wide|full|medium|close|ecu|low|high|ots|two|insert|custom, on: <id>, to: <id>, angle: derece,
           move: push|pull|orbit|crane|track|pan|shake|static, amt: 0.25, pos/look/fov (custom) }
    fx:  [ { type: shake|flash|glitch|flicker|ferry_depart|rain_start|pigeons|books|cat_jump|mustache_fall|dots|join|holdhands, at_word: "..." } ]
    sfx: [ { type: paper|thud|horn|gulls|lock|clock|meow|purr|hiss|books|heartbeat|pigeons|spill|rimshot|match|dots|tick|boing|squeak|sting_comedy|door|crumple|thunder, at_word|at, delay } ]
    lines:
      - say: "Metin; *vurgu*, !tehlike!, {08:47|sekizi kırk yedi}"
        v: n | note | nuri | stranger | old | shout | twist
        by: <id>         # ekranda konuşan (ağız animasyonu + altyazıda isim)
        write: true      # insert notunda el yazısı kelime kelime yazılır
    hold: 0.3            # son replikten sonra ek bekleme (sn)
    end: true            # son çekim (son kart + vuruş)
```

Zaman referansları: sayı (çekim başından saniye), `"@kelime"` (o kelimenin söylendiği an), `"%50"` (çekim yüzdesi).

Eylemler: `idle, talk, walk, run, sneak, push_cart, surprised, shock, shout, point, give, show, read, pocket, lock, type, headdesk,
sit, sit_talk, laugh, cover, breathe, embarrassed, search, eat, phone, pet, duck, lying, sleep, crouch, grip, reach, hang, fold, slip,
write, write_stuck, headhands, shy, lean, rail, wave, thumbsup, whisper, wink`.

İfadeler: `neutral, smile, bored, sleepy, surprised, shock, horror, confused, curious, suspicious, determined, nervous, embarrassed,
blush, laugh, knowing, tired, worried, sad, sad_smile, hopeful, kind, excited, annoyed, dreamy, awkward, guilty, focused, sleep, dead, shout, wink`.
