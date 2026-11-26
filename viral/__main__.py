"""Komut satırı.

  python -m viral make content/series/balikci-kuponu/b01.yaml       # mini dizi bölümü
  python -m viral series "Bir balıkçının Süper Toto kazanması" --episodes 8
  python -m viral make content/scripts/akdeniz-baliklari.yaml
  python -m viral make <yaml> --no-render --stills 1.5,8,20      # hızlı önizleme
  python -m viral write "Uzayın en tuhaf 10 gezegeni"              # Claude ile senaryo yaz
  python -m viral auto                                             # kuyruktan sıradaki konuyu üret
  python -m viral voices                                           # Türkçe Google seslerini listele
"""
from __future__ import annotations

import argparse
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="viral", description="Otomatik 3D bilgi videosu üretimi")
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("make", help="Bir senaryodan video üret")
    m.add_argument("script")
    m.add_argument("--out", default="output")
    m.add_argument("--tts", default="auto", choices=["auto", "elevenlabs", "google", "piper", "espeak"])
    m.add_argument("--workers", type=int)
    m.add_argument("--target", type=float, help="hedef süre (sn); varsayılan: hikâye 45, geri sayım 60")
    m.add_argument("--no-render", action="store_true")
    m.add_argument("--stills", help="virgülle ayrılmış saniyeler (önizleme kareleri)")
    m.add_argument("--gpu", action="store_true", help="donanım GPU'su ile render")
    m.add_argument("--handle", help="videoda gösterilecek kanal adı (@...)")
    m.add_argument("--keep-frames", action="store_true")

    w = sub.add_parser("write", help="Claude ile yeni senaryo YAML'ı yaz")
    w.add_argument("topic")
    w.add_argument("--out-dir", default="content/scripts")
    w.add_argument("--model")

    a = sub.add_parser("auto", help="Kuyruktaki sıradaki konuyu yaz + üret")
    a.add_argument("--queue", default="content/topics.yaml")
    a.add_argument("--count", type=int, default=1)
    a.add_argument("--tts", default="auto")
    a.add_argument("--workers", type=int)
    a.add_argument("--handle")

    sr = sub.add_parser("series", help="Claude ile N bölümlük mini dizi senaryoları yaz ve kuyruğa ekle")
    sr.add_argument("premise", help="dizinin konusu / olay örgüsü fikri")
    sr.add_argument("--episodes", type=int, default=8)
    sr.add_argument("--queue", default="content/topics.yaml")
    sr.add_argument("--model")

    vo = sub.add_parser("voices", help="Kullanılabilir sesleri listele")
    vo.add_argument("--engine", default="elevenlabs", choices=["elevenlabs", "google"])

    args = ap.parse_args(argv)
    if args.cmd == "make":
        from .pipeline import make
        stills = [float(x) for x in args.stills.split(",")] if args.stills else None
        r = make(args.script, args.out, tts=args.tts, workers=args.workers, target=args.target, render=not args.no_render,
                 stills=stills, gpu=args.gpu, handle=args.handle, keep_frames=args.keep_frames)
        print(r)
    elif args.cmd == "write":
        from .writer import write_script
        p = write_script(args.topic, args.out_dir, model=args.model)
        print(p)
    elif args.cmd == "auto":
        from .autopilot import run
        run(args.queue, count=args.count, tts=args.tts, workers=args.workers, handle=args.handle)
    elif args.cmd == "series":
        from .series_writer import write_series
        for p in write_series(args.premise, args.episodes, queue=args.queue, model=args.model):
            print(p)
    elif args.cmd == "voices":
        if args.engine == "elevenlabs":
            from .tts import list_elevenlabs_voices
            for v in list_elevenlabs_voices():
                print(v["voice_id"], v.get("name"), v.get("category"), (v.get("labels") or {}).get("description", ""))
        else:
            from .tts import list_voices
            for v in list_voices():
                print(v["name"], v.get("ssmlGender"), v.get("naturalSampleRateHertz"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
