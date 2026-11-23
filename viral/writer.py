"""Claude ile otomatik senaryo yazımı.

Bir konu başlığından, renderer'ın doğrudan kullanabileceği senaryo YAML'ı üretir:
Türkçe metin + altyazı işaretlemesi + her tür için prosedürel 3D balık parametreleri.
Örnek senaryo (content/scripts/akdeniz-baliklari.yaml) birebir referans olarak verilir.

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
EXAMPLE = ROOT / "content" / "scripts" / "akdeniz-baliklari.yaml"
DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM = """Sen viral, merak uyandıran Türkçe kısa video (YouTube Shorts / Instagram Reels / TikTok) senaristisin.
Çıktın, otomatik bir 3D animasyon motoruna doğrudan giden bir YAML dosyasıdır.

KURALLAR
- Dil: doğal, akıcı, konuşma dilinde Türkçe. Seslendirme Google TTS ile yapılacak: kısa cümleler, net noktalama.
- Süre: toplam ~60 saniye. Hook ≈ 5 sn, her madde ≈ 4-5 sn (12-20 kelime), kapanış ≈ 3 sn.
- Format: geri sayım (10'dan 1'e veya 5'ten 1'e). En çarpıcı bilgi 1 numarada; hook o bilgiyi isim vermeden ima etsin
  ("sona kadar izle" etkisi).
- DOĞRULUK HER ŞEYDEN ÖNCE GELİR: yalnızca bilimsel olarak iyi bilinen, doğrulanabilir bilgiler kullan. Emin olmadığın
  sayıları yazma; gerekirse "yaklaşık", "-e kadar", "bazı vakalarda" gibi ifadelerle yumuşat. Abartılı, yanlış yönlendiren
  iddialardan kaçın. Yazmadan önce her iddiayı kendi içinde kontrol et.
- Altyazı işaretlemesi (say alanlarında): *vurgu*, !tehlike!, {gösterilecek|okunacak} (örn. {600|altı yüz}).
  Her maddede 1-2 vurgu yeterli.
- Görseller: motor şu an YALNIZCA deniz ortamı (ocean) + prosedürel balık (fish) çizebilir. Bu yüzden her madde bir balık
  (ya da balık gövdesiyle temsil edilebilecek bir deniz canlısı: yılan balığı, müren vb.) olmalı.
- Her balık için 'fish' parametrelerini türün gerçek görünümüne göre dikkatle seç: gövde oranları (height=yarı yükseklik/boy,
  width=yarı genişlik/boy), baş profili (noseTop/noseBottom: 1=sivri, 2=yuvarlak, 3=dik alın), renkler (back/side/belly),
  desenler (hstripes, vbars, spots, blotches, ocellus, patch, band, diagonal, scribble, wavy, mottle), yüzgeç tipleri
  (dorsal/anal: spiny|rounded|falcate|triangle|long|tall|sail; caudal: forked|lunate|emarginate|truncate|rounded|pointed),
  yüzme stili (carangiform|thunniform|anguilliform|labriform). Tanınabilirlik için ayırt edici özelliği (bıyık, leke, şerit,
  yüzgeç rengi) mutlaka ekle.
- env.habitat: sand | seabed | meadow | reef | rocky | open ; env.palette: default | warm | deep | open.
- callout.anchor: head | eye | mouth | gill | body | belly | tail | dorsal | pectoral | spot | barbels (spot yalnızca ocellus
  deseni varsa; barbels yalnızca barbels tanımlıysa). callout.at_word, say metninde geçen bir kelimenin başı olmalı.
- chips: en fazla 2 kısa bilgi kartı; icon şu listeden: ruler, depth, weight, warning, clock, heart, star, pin, fish, eye,
  bolt, skull, sparkle, dna, globe, wave, calendar, food, sound, thermo, temple, crown, swap. tone: danger|gold (isteğe bağlı).
- id'ler ascii, küçük harf, tire ile (örn. mavi-yuzgecli-orkinos değil 'orkinos').
- seo: çekici başlık (emoji olabilir), 1-2 cümlelik açıklama, 6-10 hashtag.

ÇIKTI: Yalnızca geçerli YAML. Açıklama, markdown çiti veya başka metin YAZMA."""


def slugify(s: str) -> str:
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = unicodedata.normalize("NFKD", s.translate(tr)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "video"


def _client():
    import anthropic  # gecikmeli import: yalnızca bu komutlar için gerekli
    return anthropic.Anthropic(max_retries=4)


def _ask(client, model: str, messages: list[dict]) -> str:
    """Akış (streaming) ile tek istek; reddedilirse sunucu tarafı yedek modele düşer."""
    with client.beta.messages.stream(
        model=model,
        max_tokens=64000,
        system=SYSTEM,
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


def _check(data) -> list[str]:
    if not isinstance(data, dict):
        return ["Kök bir YAML eşlemesi (mapping) olmalı"]
    errs = validate_script(data)
    for i, it in enumerate(data.get("items") or []):
        if not isinstance(it.get("fish"), dict):
            errs.append(f"items[{i}].fish eksik")
        co = it.get("callout")
        if co and co.get("at_word") and co["at_word"].casefold()[:4] not in it.get("say", "").casefold():
            errs.append(f"items[{i}].callout.at_word '{co['at_word']}' say metninde yok")
    return errs


def write_script(topic: str, out_dir: str | Path = "content/scripts", *, model: str | None = None, items: int = 10) -> Path:
    model = model or DEFAULT_MODEL
    client = _client()
    example = EXAMPLE.read_text(encoding="utf-8")
    user = (
        f"Konu: {topic}\nMadde sayısı: {items}\n\n"
        "Aşağıdaki örnek senaryo formatını birebir izle (alan adları, yapı, işaretleme). "
        "Balık parametrelerini yeni türlere göre baştan tasarla; örnekten kopyalama.\n\n"
        f"--- ÖRNEK SENARYO ---\n{example}\n--- ÖRNEK SONU ---"
    )
    messages = [{"role": "user", "content": user}]
    last_err: list[str] = []
    for attempt in range(3):
        text = _ask(client, model, messages)
        raw = _extract_yaml(text)
        try:
            data = yaml.safe_load(raw)
            errs = _check(data)
        except yaml.YAMLError as e:
            data, errs = None, [f"YAML ayrıştırılamadı: {e}"]
        if not errs:
            sid = slugify(data.get("id") or topic)
            data["id"] = sid
            data.setdefault("meta", {})
            data["meta"].update({"generated_by": model, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "topic": topic})
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


def propose_topics(n: int = 10, exclude: list[str] | None = None, *, model: str | None = None) -> list[str]:
    """Kuyruk boşaldığında yeni, merak uyandıran konu başlıkları önerir."""
    client = _client()
    ex = "\n".join(f"- {e}" for e in (exclude or []))
    with client.beta.messages.stream(
        model=model or DEFAULT_MODEL,
        max_tokens=16000,
        system="Türkçe viral bilgi videoları için konu editörüsün.",
        messages=[{"role": "user", "content": (
            f"Deniz balıkları ve deniz canlıları hakkında {n} adet merak uyandıran, geri sayım formatına uygun Türkçe video konusu öner "
            "(örn. 'Karadeniz'in en ilginç 10 balığı', 'Okyanusun en zehirli 7 balığı'). Her biri yalnızca balık/balık benzeri "
            "canlılarla görselleştirilebilmeli. Daha önce yapılanları tekrarlama:\n" + ex)}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": {
            "type": "object",
            "properties": {"topics": {"type": "array", "items": {"type": "string"}}},
            "required": ["topics"], "additionalProperties": False}}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    import json
    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    return [t.strip() for t in json.loads(text).get("topics", []) if t.strip()][:n]
