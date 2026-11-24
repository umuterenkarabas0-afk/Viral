"""Claude ile otomatik mini dizi yazımı (hikâye formatı).

1) Dizi incelemesi (bible): başlık, karakterler (3D parametreleriyle), bölüm bölüm olay örgüsü + her bölümün
   gerçek "bilgi" kancası.
2) Her bölüm için senaryo YAML'ı (content/series/balikci-kuponu/b01.yaml birebir format örneğidir).
3) Bölümler üretim kuyruğuna (content/topics.yaml) sırayla eklenir; GitHub Actions her çalıştırmada sıradakini üretir.

Gerekli: ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import yaml

from .script import STORY_GFX, STORY_SETS, load_script, validate_story
from .writer import DEFAULT_MODEL, _client, _extract_yaml, slugify

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE_DIR = ROOT / "content" / "series" / "balikci-kuponu"

SYSTEM = f"""Sen viral Türkçe kısa video (YouTube Shorts / Reels / TikTok) mini dizileri yazan bir senaristsin.
Her bölüm ~45 saniyelik, 3D animasyonlu, merak uyandıran bir hikâye + içine gömülü GERÇEK bir bilgi içerir.
Çıktın otomatik bir 3D animasyon motoruna doğrudan gider.

KURALLAR
- Dil: doğal, akıcı, konuşma dilinde Türkçe. Seslendirme ElevenLabs ile yapılır: kısa, net cümleler; sayıları yazıyla
  ya da {{gösterilen|okunan}} işaretiyle ver.
- Her bölüm 6-8 sahne, toplam 75-95 kelime (≈45 sn). İlk sahne 3 saniyede kanca atar; son sahne mutlaka bir
  merak kancasıyla biter ve "Devamı N. bölümde." der (final bölümde devam yok).
- Her bölümde tam bir "Bilgi:" sahnesi (set: void, gfx: fact) olur. Bilgi DOĞRU, iyi bilinen ve doğrulanabilir olmalı;
  emin olmadığın sayıyı yazma, gerekirse "yaklaşık" de. Hikâye kurgudur ama bilgi gerçektir.
- Gerçek kişi, marka logosu ya da gerçek bir şirketin taklidi yok; kurumlar/takımlar kurgusal olsun.
- İşaretleme: *vurgu*, !tehlike!, {{gösterilen|okunan}}. Sahne başına en fazla 1-2 vurgu.
- Motorun çizebildiği setler: {', '.join(sorted(STORY_SETS))}. (deck = teknenin güvertesi; lighthouse = fener adası:
  shot.target 'lighthouse' ise dış, değilse fenerin içi; void = infografik boşluğu.)
- Zaman: dawn | day | dusk | night | storm. Ruh hâli (mood, müziği belirler): calm | tension | reveal | fact | triumph | cliff.
- Oyuncular (actors) yalnızca cast'teki id'ler; pozlar: stand | haul | hold | read | shock | kneel | sit | walk | cheer | look | point.
- Kullanılabilir nesneler (props): boat, net, bottle_in_net, net_pile, fish_pile, bottle, coupon_unroll, coupon_back, coupon_hand,
  gulls, lighthouse_far, lighthouse_on, bottle_drift, village, confetti, kiosk, coupon_counter, tv, tables, tea, lamp,
  coupon_table, photo, notebook, bottles_many, probability_grid, money_rain, cork_seal, fingerprint, depth_column.
- Çekim hedefleri (shot.target): boat, riza (veya başka oyuncu id'si), face, hands, net, bottle, coupon, note, lighthouse, gulls,
  village, tv, room, kiosk, door, table, photo, notebook, grid, cork. shot.type: establish | push | pull | orbit | closeup | low | over | track.
  from/to: {{yaw, pitch, dist}} (dist, hedefin kadraj ölçüsünün çarpanıdır; 0.5 = yakın, 1 = orta, 3+ = geniş).
- gfx tipleri: {', '.join(sorted(STORY_GFX))}. at_word, o sahnenin say metninde geçen bir kelimenin başı olmalı.
- cues: flash | shake | heartbeat | knock (at_word ile).
- seo: çekici başlık (emoji olabilir), 1-2 cümle açıklama, 8-10 hashtag.

ÇIKTI: Yalnızca istenen biçim (JSON ya da YAML). Açıklama yazma."""


def _stream(client, model: str, messages: list[dict], *, effort: str = "high", fmt: dict | None = None, max_tokens: int = 64000) -> str:
    cfg: dict = {"effort": effort}
    if fmt:
        cfg["format"] = fmt
    with client.beta.messages.stream(
        model=model, max_tokens=max_tokens, system=SYSTEM, messages=messages, output_config=cfg,
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise RuntimeError("Model isteği reddetti")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Yanıt max_tokens sınırında kesildi")
    return "".join(b.text for b in msg.content if b.type == "text")


BIBLE_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "premise": {"type": "string"},
        "cast": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "name": {"type": "string"}, "age": {"type": "integer"},
            "skin": {"type": "string"}, "hair": {"type": "string"}, "beard": {"type": "boolean"}, "mustache": {"type": "boolean"},
            "cap": {"type": ["string", "null"]}, "coat": {"type": ["string", "null"]}, "sweater": {"type": "string"},
            "pants": {"type": "string"}, "glasses": {"type": "boolean"}, "tie": {"type": ["string", "null"]}},
            "required": ["id", "name", "age", "skin", "hair", "beard", "mustache", "cap", "coat", "sweater", "pants", "glasses", "tie"],
            "additionalProperties": False}},
        "episodes": {"type": "array", "items": {"type": "object", "properties": {
            "n": {"type": "integer"}, "title": {"type": "string"}, "plot": {"type": "string"}, "fact": {"type": "string"},
            "cliffhanger": {"type": "string"}}, "required": ["n", "title", "plot", "fact", "cliffhanger"], "additionalProperties": False}},
    },
    "required": ["id", "title", "premise", "cast", "episodes"],
    "additionalProperties": False,
}


def write_bible(client, model: str, premise: str, episodes: int) -> dict:
    ex = (EXAMPLE_DIR / "series.yaml").read_text(encoding="utf-8")
    text = _stream(client, model, [{"role": "user", "content": (
        f"Şu fikirden {episodes} bölümlük bir mini dizi incelemesi (bible) yaz: {premise}\n"
        "Her bölüm bir öncekinin merak kancasından devam etsin, final tatmin edici bir çözüm sunsun. Her bölüm için gerçek, "
        "doğrulanabilir ve hikâyeyle bağlantılı bir bilgi seç. Karakter renkleri hex olsun. Ana karakterin id'si 'riza' "
        "olmak zorunda değil ama ascii/küçük harf olmalı.\n\nÖrnek dizi tanımı:\n" + ex)}],
        effort="high", fmt={"type": "json_schema", "schema": BIBLE_SCHEMA}, max_tokens=32000)
    return json.loads(text)


def write_episode(client, model: str, bible: dict, n: int, out_dir: Path) -> Path:
    example = (EXAMPLE_DIR / "b01.yaml").read_text(encoding="utf-8")
    ep = next(e for e in bible["episodes"] if e["n"] == n)
    total = len(bible["episodes"])
    nxt = next((e for e in bible["episodes"] if e["n"] == n + 1), None)
    user = (
        f"Dizi incelemesi (JSON):\n{json.dumps(bible, ensure_ascii=False)}\n\n"
        f"Şimdi {n}. bölümün ({ep['title']}) senaryo YAML'ını yaz. id: {bible['id']}-b{n:02d}. "
        f"series: {{ id: {bible['id']}, title: \"{bible['title']}\", episode: {n}, total: {total}, next_title: "
        f"{json.dumps(nxt['title'], ensure_ascii=False) if nxt else 'null'} }}. cast_ref: series.yaml.\n"
        "Aşağıdaki örnek bölümün formatını birebir izle (alanlar, işaretleme, gfx/shot yapısı); içeriği kopyalama.\n\n"
        f"--- ÖRNEK BÖLÜM ---\n{example}\n--- ÖRNEK SONU ---"
    )
    messages = [{"role": "user", "content": user}]
    errs: list[str] = []
    for attempt in range(3):
        text = _stream(client, model, messages)
        raw = _extract_yaml(text)
        try:
            data = yaml.safe_load(raw)
            errs = validate_story(data) if isinstance(data, dict) else ["kök bir eşleme olmalı"]
            if isinstance(data, dict):
                ids = set(c["id"] for c in bible["cast"])
                for i, sc in enumerate(data.get("scenes") or []):
                    for a in (sc.get("actors") or {}):
                        if a not in ids:
                            errs.append(f"scenes[{i}].actors: '{a}' cast'te yok")
                if n == total and any(g.get("type") == "cliff" for sc in data.get("scenes", [])[-1:] for g in sc.get("gfx", []) or []):
                    pass  # finalde de kapanış kartı kullanılabilir
        except yaml.YAMLError as e:
            data, errs = None, [f"YAML ayrıştırılamadı: {e}"]
        if not errs:
            data["id"] = f"{bible['id']}-b{n:02d}"
            data["format"] = "story"
            data["cast_ref"] = "series.yaml"
            data.setdefault("meta", {}).update({"generated_by": model, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
            p = out_dir / f"b{n:02d}.yaml"
            p.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=160), encoding="utf-8")
            load_script(p)  # cast birleştirme kontrolü
            print(f"[series] bölüm {n} yazıldı: {p}")
            return p
        print(f"[series] bölüm {n} deneme {attempt + 1}: {len(errs)} hata, onarım isteniyor")
        messages += [{"role": "assistant", "content": text},
                     {"role": "user", "content": "YAML şu hataları içeriyor, düzeltip TAMAMINI yeniden ver:\n- " + "\n- ".join(errs)}]
    raise RuntimeError(f"Bölüm {n} üretilemedi: " + "; ".join(errs))


def write_series(premise: str, episodes: int = 8, *, queue: str | None = "content/topics.yaml", model: str | None = None,
                 out_root: str | Path = "content/series") -> list[Path]:
    model = model or DEFAULT_MODEL
    client = _client()
    bible = write_bible(client, model, premise, episodes)
    bible["id"] = slugify(bible.get("id") or bible["title"])
    out_dir = Path(out_root) / bible["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    cast = {c.pop("id"): c for c in bible["cast"]}
    series = {"id": bible["id"], "title": bible["title"], "premise": bible["premise"],
              "episodes": [{"n": e["n"], "file": f"b{e['n']:02d}.yaml", "title": e["title"], "plot": e["plot"], "fact": e["fact"]} for e in bible["episodes"]],
              "cast": cast}
    (out_dir / "series.yaml").write_text(yaml.safe_dump(series, allow_unicode=True, sort_keys=False, width=160), encoding="utf-8")
    bible["cast"] = [{"id": k, **v} for k, v in cast.items()]
    paths = [write_episode(client, model, bible, e["n"], out_dir) for e in sorted(bible["episodes"], key=lambda e: e["n"])]
    if queue:
        enqueue_series(out_dir, queue)
    return paths


def enqueue_series(series_dir: str | Path, queue: str = "content/topics.yaml", front: bool = False):
    """Dizinin bölümlerini üretim kuyruğuna sırayla ekler (zaten varsa atlar)."""
    from .autopilot import _load, _save
    sd = Path(series_dir)
    ser = yaml.safe_load((sd / "series.yaml").read_text(encoding="utf-8"))
    qp = Path(queue)
    q = _load(qp)
    q.setdefault("topics", [])
    have = {t.get("script") for t in q["topics"]}
    new = []
    for e in ser["episodes"]:
        sp = str(sd / e["file"])
        if sp not in have:
            new.append({"title": f"{ser['title']} · Bölüm {e['n']}/{len(ser['episodes'])}: {e['title']}", "status": "pending",
                        "script": sp, "series": ser["id"], "episode": e["n"]})
    q["topics"] = (new + q["topics"]) if front else (q["topics"] + new)
    _save(qp, q)
    return new


def propose_series(n: int = 3, exclude: list[str] | None = None, *, model: str | None = None) -> list[str]:
    """Kuyruk boşalınca yeni mini dizi fikirleri önerir."""
    client = _client()
    text = _stream(client, model or DEFAULT_MODEL, [{"role": "user", "content": (
        f"Merak uyandıran, 8 bölümlük Türkçe mini dizi için {n} özgün olay örgüsü fikri öner. Her biri tek cümle olsun; "
        "deniz, liman köyü, fener, kahvehane, ev gibi mekânlarda geçebilsin ve her bölüme gerçek bir bilgi gömülebilsin. "
        "Daha önce yapılanları tekrarlama:\n" + "\n".join(f"- {e}" for e in (exclude or [])))}],
        effort="medium", fmt={"type": "json_schema", "schema": {"type": "object", "properties": {"ideas": {"type": "array", "items": {"type": "string"}}},
                                                                   "required": ["ideas"], "additionalProperties": False}}, max_tokens=8000)
    return [i.strip() for i in json.loads(text).get("ideas", []) if i.strip()][:n]
