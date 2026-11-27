"""ElevenLabs yardımcıları: abonelik/kredi durumu, ses kütüphanesinde arama, sesi hesaba ekleme.

  python -m viral.el_tools status
  python -m viral.el_tools search --lang tr --gender female
  python -m viral.el_tools add <public_owner_id> <voice_id> [--name "Ad"]
  python -m viral.el_tools pick --lang tr --gender female        # en uygununu seç + hesaba ekle, voice_id yazdır
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.parse

from .tts import _el_request


def status() -> dict:
    s = _el_request("GET", "/v1/user/subscription")
    used, limit = s.get("character_count", 0), s.get("character_limit", 0)
    reset = s.get("next_character_count_reset_unix")
    print(f"[el] paket={s.get('tier')} kullanılan={used} limit={limit} kalan={limit - used}"
          + (f" yenilenme={dt.datetime.fromtimestamp(reset, dt.timezone.utc).isoformat()}" if reset else ""))
    return s


def search(lang="tr", gender="female", page_size=40, extra: dict | None = None) -> list[dict]:
    q = {"page_size": page_size, "language": lang, "gender": gender, "sort": "cloned_by_count"}
    q.update(extra or {})
    r = _el_request("GET", "/v1/shared-voices?" + urllib.parse.urlencode(q))
    return r.get("voices", [])


def score(v: dict) -> float:
    """Anlatım (hikâye) için uygunluk puanı."""
    s = float(v.get("cloned_by_count") or 0) ** 0.5 + float(v.get("usage_character_count_1y") or 0) ** 0.25
    txt = " ".join(str(v.get(k) or "") for k in ("use_case", "descriptive", "description", "name", "accent")).lower()
    for kw, w in (("narrat", 40), ("story", 35), ("hikaye", 35), ("audiobook", 25), ("anlat", 30), ("calm", 8), ("warm", 8),
                  ("young", 10), ("genç", 10), ("emotional", 10), ("drama", 12), ("istanbul", 6), ("standard", 6)):
        if kw in txt:
            s += w
    for kw, w in (("conversational", -5), ("news", -10), ("advert", -15), ("meditation", -20), ("asmr", -30), ("child", -30), ("old", -15)):
        if kw in txt:
            s += w
    if str(v.get("age") or "") in ("young", "middle_aged"):
        s += 10
    if v.get("free_users_allowed") is False:
        s -= 5
    return s


def add(public_owner_id: str, voice_id: str, name: str) -> str:
    r = _el_request("POST", f"/v1/voices/add/{public_owner_id}/{voice_id}", {"new_name": name})
    vid = r.get("voice_id") or voice_id
    print(f"[el] ses hesaba eklendi: {name} → {vid}")
    return vid


def pick(lang="tr", gender="female", name="Deniz (TR)") -> str:
    # zaten hesapta varsa onu kullan
    mine = _el_request("GET", "/v1/voices").get("voices", [])
    for v in mine:
        if v.get("name") == name:
            print(f"[el] hesapta mevcut: {name} → {v['voice_id']}")
            return v["voice_id"]
    cands = search(lang, gender)
    native = [v for v in cands if (v.get("language") or "").lower().startswith(lang)]
    cands = sorted(native or cands, key=score, reverse=True)
    for v in cands[:12]:
        print(f"  aday {score(v):7.1f}  {v.get('voice_id')}  {v.get('name')!r} yaş={v.get('age')} aksan={v.get('accent')} "
              f"kullanım={v.get('use_case')} tanım={v.get('descriptive')} klon={v.get('cloned_by_count')} "
              f"ücretsiz={v.get('free_users_allowed')} | {(v.get('description') or '')[:90]}")
    for v in cands:
        try:
            return add(v["public_owner_id"], v["voice_id"], name)
        except Exception as e:  # kütüphane sesi eklenemezse (paket/limit) sıradakini dene
            print(f"[el] eklenemedi ({v.get('name')}): {str(e)[:200]}")
    raise RuntimeError("Uygun ses bulunamadı")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    s = sub.add_parser("search"); s.add_argument("--lang", default="tr"); s.add_argument("--gender", default="female")
    a = sub.add_parser("add"); a.add_argument("owner"); a.add_argument("voice"); a.add_argument("--name", default="Deniz (TR)")
    p = sub.add_parser("pick"); p.add_argument("--lang", default="tr"); p.add_argument("--gender", default="female"); p.add_argument("--name", default="Deniz (TR)")
    args = ap.parse_args(argv)
    if args.cmd == "status":
        status()
    elif args.cmd == "search":
        for v in sorted(search(args.lang, args.gender), key=score, reverse=True):
            print(json.dumps({k: v.get(k) for k in ("voice_id", "public_owner_id", "name", "age", "accent", "language", "use_case", "descriptive", "cloned_by_count", "free_users_allowed", "description")}, ensure_ascii=False))
    elif args.cmd == "add":
        print(add(args.owner, args.voice, args.name))
    elif args.cmd == "pick":
        vid = pick(args.lang, args.gender, args.name)
        print(f"VOICE_ID={vid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
