#!/opt/pgs-ocr/bin/python3
"""OCR a short PGS .sup sample. Prints concatenated text on stdout only."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from struct import unpack

from PIL import Image, ImageOps

MAX_IMAGES = 24
SEGMENT_PDS = 0x14
SEGMENT_ODS = 0x15
SEGMENT_END = 0x80


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in {"-h", "--help"}:
        print("usage: pgs-ocr SAMPLE.sup", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"pgs-ocr: missing sample {path}", file=sys.stderr)
        return 1
    text = ocr_sup(path.read_bytes())
    sys.stdout.write(text)
    if text and not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def ocr_sup(data: bytes) -> str:
    images = decode_pgs_images(data)
    lines: list[str] = []
    seen: set[str] = set()
    for image in images:
        digest = hashlib.sha1(image.tobytes()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        if is_blank(image):
            continue
        line = tesseract(image).strip()
        if line:
            lines.append(line)
        if len(lines) >= MAX_IMAGES:
            break
    return "\n".join(lines)


def decode_pgs_images(data: bytes) -> list[Image.Image]:
    palette: dict[int, tuple[int, int, int, int]] = {}
    objects: dict[int, tuple[int, int, bytes]] = {}
    images: list[Image.Image] = []
    offset = 0
    while offset + 13 <= len(data):
        if data[offset : offset + 2] != b"PG":
            offset += 1
            continue
        seg_type = data[offset + 10]
        size = unpack(">H", data[offset + 11 : offset + 13])[0]
        payload = data[offset + 13 : offset + 13 + size]
        offset += 13 + size
        if len(payload) < size:
            break
        if seg_type == SEGMENT_PDS:
            palette = parse_pds(payload)
        elif seg_type == SEGMENT_ODS:
            parsed = parse_ods(payload)
            if parsed:
                objects[parsed[0]] = (parsed[1], parsed[2], parsed[3])
        elif seg_type == SEGMENT_END and objects:
            for width, height, rle in objects.values():
                image = render_object(width, height, rle, palette)
                if image is not None:
                    images.append(image)
                    if len(images) >= MAX_IMAGES:
                        return images
            objects = {}
    return images


def parse_pds(payload: bytes) -> dict[int, tuple[int, int, int, int]]:
    palette: dict[int, tuple[int, int, int, int]] = {}
    if len(payload) < 2:
        return palette
    index = 2
    while index + 5 <= len(payload):
        entry_id = payload[index]
        y, cr, cb, alpha = payload[index + 1 : index + 5]
        palette[entry_id] = ycbcr_to_rgba(y, cb, cr, alpha)
        index += 5
    return palette


def parse_ods(payload: bytes) -> tuple[int, int, int, bytes] | None:
    if len(payload) < 7:
        return None
    object_id = unpack(">H", payload[0:2])[0]
    sequence = payload[3]
    data = payload[4:]
    if not sequence & 0x40:
        return None
    if len(data) < 7:
        return None
    width, height = unpack(">HH", data[3:7])
    return object_id, width, height, data[7:]


def render_object(
    width: int,
    height: int,
    rle: bytes,
    palette: dict[int, tuple[int, int, int, int]],
) -> Image.Image | None:
    if width <= 0 or height <= 0 or width * height > 8_000_000:
        return None
    pixels = decode_rle(rle, width, height)
    if pixels is None:
        return None
    rgba = bytearray(width * height * 4)
    for i, color_id in enumerate(pixels):
        r, g, b, a = palette.get(color_id, (0, 0, 0, 0))
        base = i * 4
        rgba[base : base + 4] = bytes((r, g, b, a))
    return Image.frombytes("RGBA", (width, height), bytes(rgba))


def decode_rle(data: bytes, width: int, height: int) -> list[int] | None:
    pixels: list[int] = []
    line: list[int] = []
    index = 0
    while index < len(data) and len(pixels) < width * height:
        first = data[index]
        index += 1
        if first != 0:
            line.append(first)
        else:
            if index >= len(data):
                break
            second = data[index]
            index += 1
            if second == 0:
                if len(line) < width:
                    line.extend([0] * (width - len(line)))
                pixels.extend(line[:width])
                line = []
                continue
            if second & 0x40:
                if index >= len(data):
                    break
                count = ((second & 0x3F) << 8) | data[index]
                index += 1
            else:
                count = second & 0x3F
            if second & 0x80:
                if index >= len(data):
                    break
                color = data[index]
                index += 1
            else:
                color = 0
            line.extend([color] * max(count, 1))
        if len(line) >= width:
            pixels.extend(line[:width])
            line = line[width:]
    if line:
        if len(line) < width:
            line.extend([0] * (width - len(line)))
        pixels.extend(line[:width])
    needed = width * height
    if len(pixels) < needed:
        pixels.extend([0] * (needed - len(pixels)))
    return pixels[:needed]


def ycbcr_to_rgba(y: int, cb: int, cr: int, alpha: int) -> tuple[int, int, int, int]:
    red = y + 1.402 * (cr - 128)
    green = y - 0.34414 * (cb - 128) - 0.71414 * (cr - 128)
    blue = y + 1.772 * (cb - 128)

    def clamp(value: float) -> int:
        return max(0, min(255, int(value)))

    return clamp(red), clamp(green), clamp(blue), alpha


def is_blank(image: Image.Image) -> bool:
    extrema = image.getextrema()
    if not extrema or len(extrema) < 4:
        return True
    return extrema[3][1] == 0


def prepare_for_ocr(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.split()[-1]
    lo, hi = alpha.getextrema()
    if hi - lo >= 32:
        # Outline-on-transparent PGS: alpha is the glyph, colors are a halo Tesseract cannot read.
        glyphs = alpha.point(lambda a: 0 if a > 64 else 255)
    else:
        glyphs = ImageOps.invert(rgba.convert("L"))
    rgb = glyphs.convert("RGB")
    if rgb.height < 160:
        rgb = rgb.resize((rgb.width * 2, rgb.height * 2), Image.Resampling.LANCZOS)
    return rgb


def tesseract(image: Image.Image) -> str:
    prepared = prepare_for_ocr(image)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
        path = handle.name
    try:
        prepared.save(path)
        result = subprocess.run(
            ["tesseract", path, "stdout", "--psm", "13", "-l", "eng"],
            check=False,
            capture_output=True,
            text=True,
        )
        return (result.stdout or "").strip()
    finally:
        os.unlink(path)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"pgs-ocr: {error}", file=sys.stderr)
        raise SystemExit(1)
