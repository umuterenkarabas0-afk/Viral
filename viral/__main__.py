"""Komut satırı.

  python -m viral make content/scripts/akdeniz-baliklari.yaml
  python -m viral make <yaml> --no-render --stills 1.5,8,20      # hızlı önizleme
  python -m viral write "Uzayın en tuhaf 10 gezegeni"              # Claude ile senaryo yaz
  python -m viral auto                                             # kuyruktan sıradaki konuyu üret
  python -m viral voices                                           # Türkçe Edge seslerini listele (Emel, Ahmet)
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
    m.add_argument("--tts", default="auto", choices=["auto", "edge", "google", "espeak"], help="auto = Edge (Emel)")
    m.add_argument("--workers", type=int)
    m.add_argument("--target", type=float, default=60.0, help="hedef süre (sn)")
    m.add_argument("--no-render", action="store_true")
    m.add_argument("--stills", help="virgülle ayrılmış saniyeler (önizleme kareleri)")
    m.add_argument("--gpu", action="store_true", help="donanım GPU'su ile render")
    m.add_argument("--handle", help="videoda gösterilecek kanal adı (@...)")
    m.add_argument("--keep-frames", action="store_true")

    w = sub.add_parser("write", help="Claude ile yeni senaryo YAML'ı yaz")
    w.add_argument("topic")
    w.add_argument("--out-dir", default="content/scripts")
    w.add_argument("--model")
    w.add_argument("--world", choices=["ocean", "space"], help="görsel dünya (varsayılan: konudan otomatik)")

    a = sub.add_parser("auto", help="Kuyruktaki sıradaki konuyu yaz + üret")
    a.add_argument("--queue", default="content/topics.yaml")
    a.add_argument("--count", type=int, default=1)
    a.add_argument("--tts", default="edge", choices=["auto", "edge", "google", "espeak"])
    a.add_argument("--workers", type=int)
    a.add_argument("--handle")

    v = sub.add_parser("voices", help="Türkçe sesleri listele")
    v.add_argument("--engine", default="edge", choices=["edge", "google"])

    args = ap.parse_args(argv)
    if args.cmd == "make":
        from .pipeline import make
        stills = [float(x) for x in args.stills.split(",")] if args.stills else None
        r = make(args.script, args.out, tts=args.tts, workers=args.workers, target=args.target, render=not args.no_render,
                 stills=stills, gpu=args.gpu, handle=args.handle, keep_frames=args.keep_frames)
        print(r)
    elif args.cmd == "write":
        from .writer import write_script
        p = write_script(args.topic, args.out_dir, model=args.model, world=args.world)
        print(p)
    elif args.cmd == "auto":
        from .autopilot import run
        run(args.queue, count=args.count, tts=args.tts, workers=args.workers, handle=args.handle)
    elif args.cmd == "voices":
        if args.engine == "edge":
            from .tts import list_edge_voices
            for v in list_edge_voices():
                print(v["ShortName"], v.get("Gender"))
        else:
            from .tts import list_voices
            for v in list_voices():
                print(v["name"], v.get("ssmlGender"), v.get("naturalSampleRateHertz"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
