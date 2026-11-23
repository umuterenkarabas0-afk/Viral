"""Komut satırı.

  python -m viral make content/scripts/akdeniz-baliklari.yaml
  python -m viral make <yaml> --no-render --stills 1.5,8,20      # hızlı önizleme
  python -m viral write "Uzayın en tuhaf 10 gezegeni"              # Claude ile senaryo yaz
  python -m viral auto                                             # kuyruktan sıradaki konuyu üret
  python -m viral voices                                           # Türkçe Google seslerini listele
  python -m viral series content/series/cebimdeki-not --ep 1       # mini dizi bölümü (Edge TTS + 3D)
  python -m viral series content/series/cebimdeki-not --ep all
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
    m.add_argument("--tts", default="auto", choices=["auto", "google", "espeak"])
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

    a = sub.add_parser("auto", help="Kuyruktaki sıradaki konuyu yaz + üret")
    a.add_argument("--queue", default="content/topics.yaml")
    a.add_argument("--count", type=int, default=1)
    a.add_argument("--tts", default="google")
    a.add_argument("--workers", type=int)
    a.add_argument("--handle")

    sub.add_parser("voices", help="Türkçe Google TTS seslerini listele")

    se = sub.add_parser("series", help="Mini dizi bölüm(ler)i üret (hikâye modu)")
    se.add_argument("series_dir")
    se.add_argument("--ep", default="1", help="bölüm no, '1,3,5' veya 'all'")
    se.add_argument("--out", default="output")
    se.add_argument("--workers", type=int)
    se.add_argument("--no-render", action="store_true")
    se.add_argument("--stills", help="virgülle ayrılmış saniyeler (önizleme kareleri)")
    se.add_argument("--scale", type=float, help="3D katman çözünürlük ölçeği (varsayılan 0.75)")
    se.add_argument("--keep-frames", action="store_true")

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
        from .story import load_series, make_episode
        n_eps = load_series(args.series_dir).get("episodes", 10)
        eps = list(range(1, n_eps + 1)) if args.ep == "all" else [int(x) for x in args.ep.split(",")]
        stills = [float(x) for x in args.stills.split(",")] if args.stills else None
        for n in eps:
            r = make_episode(args.series_dir, n, args.out, render_video=not args.no_render, workers=args.workers, stills=stills,
                             keep_frames=args.keep_frames, scale=args.scale)
            print(r)
    elif args.cmd == "voices":
        from .tts import list_voices
        for v in list_voices():
            print(v["name"], v.get("ssmlGender"), v.get("naturalSampleRateHertz"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
