#!/usr/bin/env python3
"""gTTS ile Türkçe metni MP3'e çevirir.

Kullanım:
    python tools/gtts_tr.py "Merhaba, bugün hava çok güzel."            # → merhaba-bugun-hava-cok-guzel.mp3
    python tools/gtts_tr.py "Merhaba dünya" -o selam.mp3
    python tools/gtts_tr.py -f metin.txt -o anlatim.mp3                 # dosyadan
    echo "Yavaş okunacak metin" | python tools/gtts_tr.py -o yavas.mp3 --slow   # stdin'den

Gereksinim: pip install gTTS  (internet bağlantısı gerekir; Google Translate'in TTS uç noktasını kullanır)
Uzun metinler gTTS tarafından otomatik parçalanır ve tek MP3'te birleştirilir.
"""
from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

try:
    from gtts import gTTS
    from gtts.tts import gTTSError
except ImportError:
    sys.exit("gTTS kurulu değil. Kurmak için:  pip install gTTS")

TR_ASCII = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def slugify(text: str, max_len: int = 40) -> str:
    """Metinden Türkçe karakterleri sadeleştirilmiş, dosya adına uygun bir kısaltma üretir."""
    s = text.translate(TR_ASCII).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len].rstrip("-") or "ses"


def read_text(args: argparse.Namespace) -> str:
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if args.text:
        return " ".join(args.text)
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def text_to_mp3(text: str, output: str | Path, slow: bool = False, tld: str = "com") -> Path:
    """Türkçe metni MP3 dosyasına yazar ve dosya yolunu döndürür."""
    text = text.strip()
    if not text:
        raise ValueError("Metin boş.")
    # Önce belleğe yaz: istek yarıda kalırsa diskte boş/yarım MP3 bırakmayalım.
    buf = io.BytesIO()
    gTTS(text=text, lang="tr", slow=slow, tld=tld).write_to_fp(buf)
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(buf.getvalue())
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="gTTS ile Türkçe metni MP3'e çevirir.")
    ap.add_argument("text", nargs="*", help="Seslendirilecek metin (verilmezse -f veya stdin kullanılır)")
    ap.add_argument("-f", "--file", help="Metnin okunacağı UTF-8 .txt dosyası")
    ap.add_argument("-o", "--output", help="Çıktı MP3 yolu (varsayılan: metinden türetilir)")
    ap.add_argument("--slow", action="store_true", help="Daha yavaş okuma")
    ap.add_argument("--tld", default="com", help="Google alan adı (ör. com, com.tr); varsayılan: com")
    args = ap.parse_args(argv)

    try:
        text = read_text(args)
    except OSError as e:
        print(f"Hata: dosya okunamadı: {e}", file=sys.stderr)
        return 1
    if not text.strip():
        ap.error("Metin verilmedi. Metni argüman olarak, -f ile dosyadan ya da stdin'den verin.")

    output = args.output or f"{slugify(text)}.mp3"
    if not output.lower().endswith(".mp3"):
        output += ".mp3"

    try:
        out = text_to_mp3(text, output, slow=args.slow, tld=args.tld)
    except gTTSError as e:
        print(f"Hata: gTTS isteği başarısız oldu (internet bağlantısını kontrol edin): {e}", file=sys.stderr)
        return 2

    print(f"✓ {out}  ({out.stat().st_size / 1024:.1f} KB, {len(text.strip())} karakter)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
