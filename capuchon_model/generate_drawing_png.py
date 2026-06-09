from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HEIGHT = 17.0
BASE_DIAMETER = 17.2
TOP_DIAMETER = 13.2
TOP_CONE_HEIGHT = 15.0
LOWER_STRAIGHT_HEIGHT = HEIGHT - TOP_CONE_HEIGHT

RECESS_HEIGHT = 3.8
RECESS_DIAMETER = 14.5
RECESS_BOTTOM_FROM_BASE = 3.7
RECESS_TOP = RECESS_BOTTOM_FROM_BASE + RECESS_HEIGHT

INNER_HOLE_DIAMETER = 9.5
INNER_ENTRY_DIAMETER = 11.0
INNER_ENTRY_HEIGHT = 2.0
NOMINAL_WALL = 2.8
INNER_CAVITY_DEPTH = 14.5

RIDGE_WIDTH = 3.0
RIDGE_PROTRUSION = 0.45

OUT_DIR = Path(__file__).resolve().parent
MODEL_NAME = "capuchon_17mm"


def outer_cone_radius(z: float) -> float:
    if z <= LOWER_STRAIGHT_HEIGHT:
        return BASE_DIAMETER / 2
    t = (z - LOWER_STRAIGHT_HEIGHT) / TOP_CONE_HEIGHT
    return (BASE_DIAMETER / 2) + t * ((TOP_DIAMETER / 2) - (BASE_DIAMETER / 2))


def main() -> None:
    w, h = 1600, 1200
    img = Image.new("RGB", (w, h), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 34)
        small = ImageFont.truetype("arial.ttf", 24)
        tiny = ImageFont.truetype("arial.ttf", 20)
    except OSError:
        font = ImageFont.load_default()
        small = ImageFont.load_default()
        tiny = ImageFont.load_default()

    scale = 48
    ox, oy = 520, 190

    def py(z: float) -> float:
        return oy + (HEIGHT - z) * scale

    rb = BASE_DIAMETER / 2
    rt = TOP_DIAMETER / 2
    rr = RECESS_DIAMETER / 2
    ri = INNER_HOLE_DIAMETER / 2
    re = INNER_ENTRY_DIAMETER / 2

    left = lambda r: ox - r * scale
    right = lambda r: ox + r * scale

    outer = [
        (left(rb), py(0)),
        (left(rb), py(LOWER_STRAIGHT_HEIGHT)),
        (left(outer_cone_radius(RECESS_BOTTOM_FROM_BASE)), py(RECESS_BOTTOM_FROM_BASE)),
        (left(rr), py(RECESS_BOTTOM_FROM_BASE)),
        (left(rr), py(RECESS_TOP)),
        (left(outer_cone_radius(RECESS_TOP)), py(RECESS_TOP)),
        (left(rt), py(HEIGHT)),
        (right(rt), py(HEIGHT)),
        (right(outer_cone_radius(RECESS_TOP)), py(RECESS_TOP)),
        (right(rr), py(RECESS_TOP)),
        (right(rr), py(RECESS_BOTTOM_FROM_BASE)),
        (right(outer_cone_radius(RECESS_BOTTOM_FROM_BASE)), py(RECESS_BOTTOM_FROM_BASE)),
        (right(rb), py(LOWER_STRAIGHT_HEIGHT)),
        (right(rb), py(0)),
    ]
    draw.polygon(outer, fill=(231, 229, 220), outline=(20, 20, 20))
    draw.line(outer + [outer[0]], fill=(20, 20, 20), width=4)

    inner_w = ri * scale
    entry_w = re * scale
    inner_top_y = py(INNER_CAVITY_DEPTH)
    inner_entry_y = py(INNER_ENTRY_HEIGHT)
    inner_poly = [
        (ox - entry_w, py(0)),
        (ox - entry_w, inner_entry_y),
        (ox - inner_w, inner_entry_y),
        (ox - inner_w, inner_top_y),
        (ox + inner_w, inner_top_y),
        (ox + inner_w, inner_entry_y),
        (ox + entry_w, inner_entry_y),
        (ox + entry_w, py(0)),
    ]
    draw.polygon(inner_poly, fill="white", outline=(20, 20, 20))

    for ydash in range(int(inner_top_y), int(py(0)), 22):
        draw.line((ox - inner_w, ydash, ox - inner_w, ydash + 10), fill=(90, 90, 90), width=2)
        draw.line((ox + inner_w, ydash, ox + inner_w, ydash + 10), fill=(90, 90, 90), width=2)

    def dim_line(a, b, text_label, text_pos, anchor="mm"):
        draw.line([a, b], fill=(25, 25, 25), width=3)
        for p, q in ((a, b), (b, a)):
            angle = math.atan2(q[1] - p[1], q[0] - p[0])
            tip = p
            wing1 = (tip[0] + 16 * math.cos(angle + 0.45), tip[1] + 16 * math.sin(angle + 0.45))
            wing2 = (tip[0] + 16 * math.cos(angle - 0.45), tip[1] + 16 * math.sin(angle - 0.45))
            draw.polygon([tip, wing1, wing2], fill=(25, 25, 25))
        draw.text(text_pos, text_label, fill=(15, 15, 15), font=small, anchor=anchor)

    draw.text((55, 48), "Capuchon - dibujo tecnico v1", fill=(10, 10, 10), font=font)
    draw.text((55, 91), "Unidades en milimetros. Modelo generado desde estas cotas.", fill=(70, 70, 70), font=tiny)

    dim_line((right(rb), py(0) + 60), (left(rb), py(0) + 60), "Ø17.2 base", (ox, py(0) + 88))
    dim_line((right(rt), py(HEIGHT) - 54), (left(rt), py(HEIGHT) - 54), "Ø13.2 arriba", (ox, py(HEIGHT) - 74))
    dim_line(
        (right(rr), py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2)),
        (left(rr), py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2)),
        "Ø14.5 receso",
        (ox, py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2) - 20),
    )
    dim_line((ox - entry_w, py(0) - 22), (ox + entry_w, py(0) - 22), "boca Ø11", (ox, py(0) - 48))
    dim_line((ox - inner_w, py(INNER_ENTRY_HEIGHT) - 44), (ox + inner_w, py(INNER_ENTRY_HEIGHT) - 44), "luego Ø9.5", (ox, py(INNER_ENTRY_HEIGHT) - 66))
    dim_line((390, py(0)), (390, py(INNER_ENTRY_HEIGHT)), "2", (365, (py(0) + py(INNER_ENTRY_HEIGHT)) / 2), "mm")
    dim_line((1025, py(HEIGHT)), (1025, py(0)), "17 alto", (1055, (py(HEIGHT) + py(0)) / 2), "lm")
    dim_line((250, py(RECESS_TOP)), (250, py(RECESS_BOTTOM_FROM_BASE)), "3.8", (220, (py(RECESS_TOP) + py(RECESS_BOTTOM_FROM_BASE)) / 2), "mm")
    dim_line((305, py(RECESS_BOTTOM_FROM_BASE)), (305, py(0)), "3.7", (275, (py(RECESS_BOTTOM_FROM_BASE) + py(0)) / 2), "mm")
    dim_line((190, py(HEIGHT)), (190, py(RECESS_TOP)), f"{HEIGHT - RECESS_TOP:.1f}", (150, (py(HEIGHT) + py(RECESS_TOP)) / 2), "mm")

    draw.text((1090, 190), "Cono superior: 15 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 225), "Base recta asumida: 2 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 260), "Boca inicial: Ø11 x 2 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 295), "Luego hueco interior: Ø9.5", fill=(20, 20, 20), font=small)
    draw.text((1090, 350), "Linea exterior: 3 mm ancho", fill=(20, 20, 20), font=small)
    draw.text((1090, 385), "Sobresale: 0.45 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 435), "Aristas rectas.", fill=(80, 80, 80), font=tiny)
    draw.text((1090, 462), f"Pared nominal indicada: {NOMINAL_WALL:g} mm", fill=(80, 80, 80), font=tiny)

    top_cx, top_cy = 1380, 850
    top_scale = 17
    top_r = (TOP_DIAMETER / 2) * top_scale
    ridge_h = RIDGE_WIDTH * top_scale
    ridge_x = math.sqrt(max(0, top_r * top_r - (ridge_h / 2) * (ridge_h / 2)))
    draw.text((top_cx, top_cy - top_r - 42), "Vista superior", fill=(20, 20, 20), font=small, anchor="mm")
    draw.ellipse(
        (top_cx - top_r, top_cy - top_r, top_cx + top_r, top_cy + top_r),
        fill=(231, 229, 220),
        outline=(20, 20, 20),
        width=3,
    )
    draw.rectangle(
        (top_cx - ridge_x, top_cy - ridge_h / 2, top_cx + ridge_x, top_cy + ridge_h / 2),
        fill=(198, 198, 188),
        outline=(20, 20, 20),
        width=2,
    )
    dim_line(
        (top_cx + top_r + 30, top_cy - ridge_h / 2),
        (top_cx + top_r + 30, top_cy + ridge_h / 2),
        "3",
        (top_cx + top_r + 55, top_cy),
        "lm",
    )
    draw.text((top_cx, top_cy + top_r + 38), "+0.45 mm exterior", fill=(80, 80, 80), font=tiny, anchor="mm")

    path = OUT_DIR / f"{MODEL_NAME}_dibujo.png"
    img.save(path)
    print(path)


if __name__ == "__main__":
    main()
