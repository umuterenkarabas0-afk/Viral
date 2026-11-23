"""Sürekli üretim: konu kuyruğundan sıradakini al → senaryo yaz → video üret → kuyruğu güncelle.

content/topics.yaml biçimi:
  topics:
    - { title: "Karadeniz'in en ilginç 10 balığı", status: pending }
    - { title: "...", status: done, script: content/scripts/x.yaml, video: output/x/x.mp4, date: 2026-11-23 }
Kuyruk boşalırsa Claude yeni konular önerir. Senaryo yolu verilmiş (script:) bir konu doğrudan üretilir.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import yaml

from .pipeline import log, make


def _load(p: Path) -> dict:
    if p.exists():
        return yaml.safe_load(p.read_text(encoding="utf-8")) or {"topics": []}
    return {"topics": []}


def _save(p: Path, q: dict):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(q, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")


def run(queue: str = "content/topics.yaml", *, count: int = 1, tts: str = "google", workers: int | None = None,
        handle: str | None = None, out_root: str = "output") -> list[dict]:
    qp = Path(queue)
    q = _load(qp)
    q.setdefault("topics", [])
    results = []
    for _ in range(count):
        pending = [t for t in q["topics"] if t.get("status", "pending") in ("pending", "scripted", "failed")]
        if not pending:
            from .writer import propose_topics
            done = [t["title"] for t in q["topics"]]
            new = propose_topics(10, done)
            log(f"Kuyruk boştu; {len(new)} yeni konu eklendi")
            q["topics"] += [{"title": t, "status": "pending"} for t in new]
            _save(qp, q)
            pending = [t for t in q["topics"] if t.get("status") == "pending"]
        topic = pending[0]
        try:
            if not topic.get("script") or not Path(topic["script"]).exists():
                from .writer import write_script
                topic["script"] = str(write_script(topic["title"]))
                topic["status"] = "scripted"
                _save(qp, q)
            r = make(topic["script"], out_root, tts=tts, workers=workers, handle=handle)
            topic.update({"status": "done", "video": r.get("video"), "date": dt.date.today().isoformat(), "duration": r.get("duration")})
            topic.pop("error", None)
            results.append(r)
        except Exception as e:  # kuyruk takılmasın: hata kaydedilir, sonraki çalıştırmada yeniden denenir
            topic["status"] = "failed"
            topic["error"] = str(e)[:500]
            log(f"HATA: {topic['title']}: {e}")
            _save(qp, q)
            raise
        _save(qp, q)
    return results
