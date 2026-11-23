"""Claude ile otomatik senaryo yazımı.

Bir konu başlığından, renderer'ın doğrudan kullanabileceği senaryo YAML'ı üretir:
Türkçe metin + altyazı işaretlemesi + görsel dünyaya göre prosedürel 3D parametreler.

Görsel dünyalar:
  ocean  → su altı ortamı + prosedürel 3D balıklar   (örnek: content/scripts/akdeniz-baliklari.yaml)
  space  → uzay ortamı + prosedürel gezegen/uydu/Güneş (örnek: content/scripts/gunes-sistemi-tuhaf-yerler.yaml)
Dünya, konudan otomatik seçilir (ya da kuyrukta `world:` ile belirtilir).

Gerekli: ANTHROPIC_API_KEY (veya `ant auth login` profili).
"""
from __future__ import annotations

import datetime as dt
import re
import unicodedata
from pathlib import Path

import yaml

from .script import validate_script

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = {
    "ocean": ROOT / "content" / "scripts" / "akdeniz-baliklari.yaml",
    "space": ROOT / "content" / "scripts" / "gunes-sistemi-tuhaf-yerler.yaml",
}
EXAMPLE = EXAMPLES["ocean"]
WORLDS = tuple(EXAMPLES)
DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM = """Sen viral, merak uyandıran Türkçe kısa video (YouTube Shorts / Instagram Reels / TikTok) senaristisin.
Çıktın, otomatik bir 3D animasyon motoruna doğrudan giden bir YAML dosyasıdır.

KURALLAR
- Dil: doğal, akıcı, konuşma dilinde Türkçe. Seslendirme Microsoft Edge TTS (Emel sesi) ile yapılacak: kısa cümleler,
  net noktalama. Sayıları okunuşuyla ver: {465|dört yüz altmış beş}.
- Süre: toplam ~60 saniye ≈ 125-135 kelime. Hook ≈ 5 sn (10-13 kelime), her madde ≈ 4-5 sn (9-13 kelime), kapanış ≈ 2 sn.
- Format: geri sayım (10'dan 1'e veya 5'ten 1'e). En çarpıcı bilgi 1 numarada; hook o bilgiyi isim vermeden ima etsin
  ("sona kadar izle" etkisi).
- DOĞRULUK HER ŞEYDEN ÖNCE GELİR: yalnızca bilimsel olarak iyi bilinen, doğrulanabilir bilgiler kullan (ör. NASA, ESA,
  hakemli kaynaklar). Emin olmadığın sayıları yazma; gerekirse "yaklaşık", "-e kadar", "bilim insanlarına göre ... olabilir"
  gibi ifadelerle yumuşat. Popüler ama teknik olarak yanlış iddialardan kaçın. Yazmadan önce her iddiayı kendi içinde kontrol et.
- Altyazı işaretlemesi (say alanlarında): *vurgu*, !tehlike!, {gösterilecek|okunacak} (örn. {600|altı yüz}).
  Her maddede 1-2 vurgu yeterli.
- callout.at_word ve cue.at_word, say metninde geçen bir kelimenin başı olmalı ve maddenin SON kelimesi olmamalı
  (callout'un ekranda kalacak zamanı olsun).
- chips: en fazla 2 kısa bilgi kartı (en çok ~22 karakter); icon şu listeden: ruler, depth, weight, warning, clock, heart,
  star, pin, fish, eye, bolt, skull, sparkle, dna, globe, wave, calendar, food, sound, thermo, temple, crown, swap, planet,
  moon, sun, rocket, wind, volcano, snowflake, drop, flame, rotate, mountain, orbit, telescope, gauge. tone: danger|gold.
- id'ler ascii, küçük harf, tire ile.
- seo: çekici başlık (emoji olabilir), 1-2 cümlelik açıklama, 6-10 hashtag.

ÇIKTI: Yalnızca geçerli YAML. Açıklama, markdown çiti veya başka metin YAZMA."""

WORLD_GUIDE = {
    "ocean": """GÖRSEL DÜNYA: environment: ocean (su altı + prosedürel balık).
- Her madde bir balık (ya da balık gövdesiyle temsil edilebilecek bir deniz canlısı: yılan balığı, müren vb.) olmalı.
- Her balık için 'fish' parametrelerini türün gerçek görünümüne göre dikkatle seç: gövde oranları (height=yarı yükseklik/boy,
  width=yarı genişlik/boy), baş profili (noseTop/noseBottom: 1=sivri, 2=yuvarlak, 3=dik alın), renkler (back/side/belly),
  desenler (hstripes, vbars, spots, blotches, ocellus, patch, band, diagonal, scribble, wavy, mottle), yüzgeç tipleri
  (dorsal/anal: spiny|rounded|falcate|triangle|long|tall|sail; caudal: forked|lunate|emarginate|truncate|rounded|pointed),
  yüzme stili (carangiform|thunniform|anguilliform|labriform). Ayırt edici özelliği (bıyık, leke, şerit) mutlaka ekle.
- env.habitat: sand | seabed | meadow | reef | rocky | open ; env.palette: default | warm | deep | open.
- callout.anchor: head | eye | mouth | gill | body | belly | tail | dorsal | pectoral | spot | barbels.
- cue tipleri: dream (renk kayması), flash, shake.""",
    "space": """GÖRSEL DÜNYA: environment: space (uzay + prosedürel gök cisimleri).
- Her madde bir gezegen, uydu, cüce gezegen, asteroit, ötegezegen ya da bir gök cisminin belirli bir bölgesi olmalı ve
  'planet' parametreleriyle çizilmeli. Açılış için Güneş'i (bodies altında type: star) ya da bir maddeyi kullanabilirsin.
- planet.type: rocky (kayalık/buzlu yüzey) | gas (gaz devi / bulutla kaplı gezegen). Renkler gerçeğe yakın olsun.
  rocky: colors [koyu, orta, açık, vurgu], albedo{scale,contrast,accent}, terrain{scale,amount,ridged},
    craters{density 0-1, size, depth}, volcanoes[{lat,lon,size(derece),height,caldera}], canyons[{from:[lat,lon],to:[lat,lon],
    width,depth}], spots[{lat,lon,size,color,soft,ring,emissive,height,opacity}] (lav için emissive>0), caps{north,south,color},
    twotone{lat,lon,color}, ridge{height,width,lon0,lon1}, stripes{count,spacing,length,width,depth,angle,color} (güney kutbu
    çatlakları), fractures{amount,scale,color}, lakes{lat,coverage,scale,color}, haze{color,amount} (kalın pus),
    displace (0-1, kabartmayı geometrik yapar), relief (normal şiddeti).
  gas: colors [4 bant rengi], bands{count,turbulence,contrast,streaks,flow (negatif = ters yön)}, storms[{lat,lon,size,aspect,
    swirl,color}], hexagon{size,color,edgeColor} (kuzey kutbu), vshape (Venüs V-desenleri), clouds{color,coverage,scale,
    stretch,speed,opacity,lat:[a,b,c,d]}, streaks{color,speed,intensity} (rüzgar çizgileri).
  ortak: atmosphere{color,intensity,thickness,scatter,rim}, rings{style: saturn|thin|faint, inner, outer, color, color2,
    opacity}, plumes[{lat,lon,kind: umbrella|jet,height,spread,color,count,size,rate,opacity,along: stripes}],
    emissive{color,strength}, tilt (derece), spin (rad/sn, negatif = ters dönüş), wrap, specular{amount,power}.
- focus{lat,lon}: kameranın baktığı nokta. camera{yaw:[a,b],pitch:[a,b],dist:[a,b],roll} (radyan; dist 1.2-1.8 arası).
- scene: sun{az,el (derece; az<0 = ışık soldan), show,x,y,size,dist}, companion{ref (bodies ya da başka madde id'si),x,y,
  size,dist,rot:[x,y,z]} (ör. uydunun arkasında ana gezegeni), offset:[x,y].
- env.palette (gökyüzü/nebula): default | warm | cool | violet | gold | deep | teal. Maddeler arasında çeşitlendir.
- callout.anchor: north_pole | south_pole | volcano | storm | spot | plume | ridge | lakes | hexagon | stripes | twotone |
  {lat, lon}. Odak noktası callout'u görecek şekilde seçilmeli.
- cue tipleri: axis (dönüş ekseni + yön oku grafiği), reveal (pusun altını tarayarak gösterir), shake, flash,
  sfx {name: sun|ice|whirl|chime|rumble|storm|geyser|lava|rain|wind|heat} (sahneye özel ses efekti).""",
}

SPACE_WORDS = ("uzay", "gezegen", "güneş", "yıldız", "galaksi", "evren", "kara delik", "uydu", "ay'", "ayın", "mars", "jüpiter",
               "satürn", "venüs", "merkür", "neptün", "uranüs", "plüton", "asteroit", "kuyruklu", "nasa", "astronot",
               "ötegezegen", "nebula", "kozmik", "samanyolu", "yörünge", "roket")


def detect_world(topic: str) -> str:
    t = topic.replace("İ", "i").replace("I", "ı").lower()
    return "space" if any(w in t for w in SPACE_WORDS) else "ocean"


def slugify(s: str) -> str:
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = unicodedata.normalize("NFKD", s.translate(tr)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "video"


def _client():
    import anthropic  # gecikmeli import: yalnızca bu komutlar için gerekli
    return anthropic.Anthropic(max_retries=4)


def _ask(client, model: str, messages: list[dict], world: str = "ocean") -> str:
    """Akış (streaming) ile tek istek; reddedilirse sunucu tarafı yedek modele düşer."""
    with client.beta.messages.stream(
        model=model,
        max_tokens=64000,
        system=SYSTEM + "\n\n" + WORLD_GUIDE[world],
        messages=messages,
        output_config={"effort": "high"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError(f"Model isteği reddetti: {getattr(msg, 'stop_details', None)}")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Yanıt max_tokens sınırında kesildi")
    return "".join(b.text for b in msg.content if b.type == "text")


def _extract_yaml(text: str) -> str:
    m = re.search(r"```(?:yaml)?\s*\n(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip()


def _check(data, world: str = "ocean") -> list[str]:
    if not isinstance(data, dict):
        return ["Kök bir YAML eşlemesi (mapping) olmalı"]
    if data.get("environment", world) != world:
        return [f"environment '{world}' olmalı"]
    data["environment"] = world
    errs = validate_script(data)
    for i, it in enumerate(data.get("items") or []):
        say = it.get("say", "").casefold()
        co = it.get("callout")
        if co and co.get("at_word") and co["at_word"].casefold()[:4] not in say:
            errs.append(f"items[{i}].callout.at_word '{co['at_word']}' say metninde yok")
        for c in it.get("cues") or []:
            if c.get("at_word") and c["at_word"].casefold()[:4] not in say:
                errs.append(f"items[{i}].cues.at_word '{c['at_word']}' say metninde yok")
        if world == "space" and isinstance(it.get("planet"), dict) and it["planet"].get("type", "rocky") not in ("rocky", "gas"):
            errs.append(f"items[{i}].planet.type rocky|gas olmalı")
    return errs


def write_script(topic: str, out_dir: str | Path = "content/scripts", *, model: str | None = None, items: int = 10,
                 world: str | None = None) -> Path:
    model = model or DEFAULT_MODEL
    world = world if world in WORLDS else detect_world(topic)
    client = _client()
    example = EXAMPLES[world].read_text(encoding="utf-8")
    what = "Balık" if world == "ocean" else "Gezegen/uydu (planet), kamera, ışık ve sahne"
    user = (
        f"Konu: {topic}\nMadde sayısı: {items}\nGörsel dünya: {world}\n\n"
        "Aşağıdaki örnek senaryo formatını birebir izle (alan adları, yapı, işaretleme). "
        f"{what} parametrelerini yeni konuya göre baştan tasarla; örnekten kopyalama.\n\n"
        f"--- ÖRNEK SENARYO ---\n{example}\n--- ÖRNEK SONU ---"
    )
    messages = [{"role": "user", "content": user}]
    last_err: list[str] = []
    for attempt in range(3):
        text = _ask(client, model, messages, world)
        raw = _extract_yaml(text)
        try:
            data = yaml.safe_load(raw)
            errs = _check(data, world)
        except yaml.YAMLError as e:
            data, errs = None, [f"YAML ayrıştırılamadı: {e}"]
        if not errs:
            sid = slugify(data.get("id") or topic)
            data["id"] = sid
            data.setdefault("meta", {})
            data["meta"].update({"generated_by": model, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                                 "topic": topic, "world": world})
            out = Path(out_dir) / f"{sid}.yaml"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")
            print(f"[writer] senaryo yazıldı: {out}")
            return out
        last_err = errs
        print(f"[writer] deneme {attempt + 1}: {len(errs)} hata, onarım isteniyor")
        messages += [
            {"role": "assistant", "content": text},
            {"role": "user", "content": "YAML şu hataları içeriyor, düzeltip YAML'ın TAMAMINI yeniden ver:\n- " + "\n- ".join(errs)},
        ]
    raise RuntimeError("Geçerli senaryo üretilemedi: " + "; ".join(last_err))


def propose_topics(n: int = 10, exclude: list[str] | None = None, *, model: str | None = None,
                   worlds: tuple[str, ...] = WORLDS) -> list[dict]:
    """Kuyruk boşaldığında yeni, merak uyandıran konular önerir: [{title, world}, ...]."""
    client = _client()
    ex = "\n".join(f"- {e}" for e in (exclude or []))
    desc = {"space": "uzay (gezegenler, uydular, Güneş, cüce gezegenler, ötegezegenler; prosedürel gök cisimleriyle çizilebilir)",
            "ocean": "deniz (balıklar ve balık gövdesiyle çizilebilen deniz canlıları)"}
    with client.beta.messages.stream(
        model=model or DEFAULT_MODEL,
        max_tokens=16000,
        system="Türkçe viral bilgi videoları için konu editörüsün.",
        messages=[{"role": "user", "content": (
            f"{n} adet merak uyandıran, geri sayım formatına uygun Türkçe video konusu öner. Konular şu görsel dünyalardan "
            "birine girmeli: " + "; ".join(f"{w} = {desc[w]}" for w in worlds) + ". Dünyaları dengeli dağıt "
            "(örn. 'Güneş Sistemi'nin en büyük 10 uydusu', 'Okyanusun en zehirli 7 balığı'). Yalnızca doğrulanabilir bilgilerle "
            "işlenebilecek konular seç. Daha önce yapılanları tekrarlama:\n" + ex)}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": {
            "type": "object",
            "properties": {"topics": {"type": "array", "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "world": {"type": "string", "enum": list(worlds)}},
                "required": ["title", "world"], "additionalProperties": False}}},
            "required": ["topics"], "additionalProperties": False}}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError(f"Model isteği reddetti: {getattr(msg, 'stop_details', None)}")
    import json
    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    out = []
    for t in json.loads(text).get("topics", []):
        title = (t.get("title") or "").strip()
        if title:
            out.append({"title": title, "world": t.get("world") if t.get("world") in worlds else detect_world(title)})
    return out[:n]
