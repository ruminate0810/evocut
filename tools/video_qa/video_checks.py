"""Generic media diagnostics; no business campaign or publishing dependency."""
import subprocess
from pathlib import Path


def detect_black_and_decode(video: Path) -> list[str]:
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-hide_banner", "-xerror", "-err_detect", "explode", "-i", str(video),
        "-vf", "blackdetect=d=0.08:pix_th=0.1:pic_th=0.99", "-f", "null", "-",
    ], check=True, text=True, capture_output=True)
    return [line for line in result.stderr.splitlines() if "black_start:" in line]
