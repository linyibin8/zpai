#!/usr/bin/env python3
"""
生成 zpai 的 AppIcon 图片集（程序化绘制，无需外部素材）。
输出到 Assets.xcassets/AppIcon.appiconset/，并更新 Contents.json。

用法：python3 generate_app_icons.py [项目目录]
"""
import json
import os
import struct
import sys
import zlib


def make_png(width: int, height: int, pixels: bytes) -> bytes:
    """用标准库生成 PNG（避免依赖 Pillow）。pixels 为 RGBA 行优先。"""
    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = b""
    stride = width * 4
    for y in range(height):
        raw += b"\x00" + pixels[y * stride:(y + 1) * stride]
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def render_icon(size: int) -> bytes:
    """绘制 zpai 图标：深蓝底 + 白色相机/镜头 + 'z' 字样示意。"""
    w = h = size
    stride = w * 4
    buf = bytearray(stride * h)
    # 背景渐变蓝
    for y in range(h):
        for x in range(w):
            t = y / h
            r = int(30 + t * 20)
            g = int(90 + t * 40)
            b = int(200 + t * 40)
            i = (y * w + x) * 4
            buf[i] = r
            buf[i + 1] = g
            buf[i + 2] = b
            buf[i + 3] = 255
    # 中心白色圆角矩形（取景框）
    cx, cy = w // 2, h // 2
    half = int(min(w, h) * 0.30)
    for y in range(cy - half, cy + half):
        if y < 0 or y >= h:
            continue
        for x in range(cx - half, cx + half):
            if x < 0 or x >= w:
                continue
            # 圆角
            dx = abs(x - cx) - (half - int(half * 0.25))
            dy = abs(y - cy) - (half - int(half * 0.25))
            if dx > 0 and dy > 0 and (dx * dx + dy * dy) > (int(half * 0.25)) ** 2:
                continue
            i = (y * w + x) * 4
            buf[i] = 255
            buf[i + 1] = 255
            buf[i + 2] = 255
            buf[i + 3] = 255
    # 中心圆点（镜头）
    rad = int(min(w, h) * 0.12)
    for y in range(cy - rad, cy + rad):
        for x in range(cx - rad, cx + rad):
            if x < 0 or x >= w or y < 0 or y >= h:
                continue
            if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
                i = (y * w + x) * 4
                buf[i] = 40
                buf[i + 1] = 100
                buf[i + 2] = 220
                buf[i + 3] = 255
    return bytes(buf)


def main():
    project_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    iconset = os.path.join(project_dir, "Assets.xcassets", "AppIcon.appiconset")
    os.makedirs(iconset, exist_ok=True)

    size = 1024
    png = make_png(size, size, render_icon(size))
    filename = "icon-1024.png"
    with open(os.path.join(iconset, filename), "wb") as f:
        f.write(png)

    contents = {
        "images": [
            {
                "filename": filename,
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            }
        ],
        "info": {"author": "xcode", "version": 1},
    }
    with open(os.path.join(iconset, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump(contents, f, indent=2)

    print(f"OK generated {filename} ({size}x{size}) at {iconset}")


if __name__ == "__main__":
    main()
