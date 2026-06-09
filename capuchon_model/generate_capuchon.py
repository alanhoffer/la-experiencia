from __future__ import annotations

import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


# Units are millimeters.
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

SEGMENTS = 160
BEVEL_MM = 0.0

RIDGE_WIDTH = 3.0
RIDGE_PROTRUSION = 0.45
TOP_CAP_RINGS = 6

OUT_DIR = Path(__file__).resolve().parent
MODEL_NAME = "capuchon_17mm"


def outer_cone_radius(z: float) -> float:
    if z <= LOWER_STRAIGHT_HEIGHT:
        return BASE_DIAMETER / 2
    t = (z - LOWER_STRAIGHT_HEIGHT) / TOP_CONE_HEIGHT
    return (BASE_DIAMETER / 2) + t * ((TOP_DIAMETER / 2) - (BASE_DIAMETER / 2))


def make_ring_vertices(radius: float, z: float) -> list[tuple[float, float, float]]:
    return [
        (radius * math.cos((i / SEGMENTS) * math.tau), radius * math.sin((i / SEGMENTS) * math.tau), z)
        for i in range(SEGMENTS)
    ]


def ridge_strength_from_y(y: float) -> float:
    half_width = RIDGE_WIDTH / 2
    return 1.0 if abs(y) <= half_width else 0.0


def make_outer_ring_vertices(radius: float, z: float, top: bool = False) -> list[tuple[float, float, float]]:
    verts: list[tuple[float, float, float]] = []
    for i in range(SEGMENTS):
        theta = (i / SEGMENTS) * math.tau
        base_y = radius * math.sin(theta)
        strength = ridge_strength_from_y(base_y)
        ridge_radius = outer_cone_radius(z) + RIDGE_PROTRUSION
        effective_radius = radius + ((ridge_radius - radius) * strength)
        x = effective_radius * math.cos(theta)
        y = effective_radius * math.sin(theta)
        z_value = z + (RIDGE_PROTRUSION * strength if top else 0.0)
        verts.append((x, y, z_value))
    return verts


def bridge(faces: list[tuple[int, int, int, int]], a: int, b: int) -> None:
    for i in range(SEGMENTS):
        faces.append((a + i, a + ((i + 1) % SEGMENTS), b + ((i + 1) % SEGMENTS), b + i))


def add_raised_top_cap(
    verts: list[tuple[float, float, float]], faces: list[tuple[int, ...]], outer_top_start: int
) -> None:
    rt = TOP_DIAMETER / 2
    center = len(verts)
    verts.append((0.0, 0.0, HEIGHT + RIDGE_PROTRUSION))

    top_ring_starts: list[int] = []
    for ring_index in range(1, TOP_CAP_RINGS + 1):
        fraction = ring_index / (TOP_CAP_RINGS + 1)
        ring_start = len(verts)
        top_ring_starts.append(ring_start)
        for i in range(SEGMENTS):
            theta = (i / SEGMENTS) * math.tau
            boundary_y = rt * math.sin(theta)
            boundary_strength = ridge_strength_from_y(boundary_y)
            boundary_radius = rt + (RIDGE_PROTRUSION * boundary_strength)
            x = fraction * boundary_radius * math.cos(theta)
            y = fraction * boundary_radius * math.sin(theta)
            z = HEIGHT + (RIDGE_PROTRUSION * ridge_strength_from_y(y))
            verts.append((x, y, z))

    first_ring = top_ring_starts[0]
    for i in range(SEGMENTS):
        faces.append((center, first_ring + i, first_ring + ((i + 1) % SEGMENTS)))

    for inner_start, outer_start in zip(top_ring_starts, top_ring_starts[1:]):
        for i in range(SEGMENTS):
            faces.append(
                (
                    inner_start + i,
                    outer_start + i,
                    outer_start + ((i + 1) % SEGMENTS),
                    inner_start + ((i + 1) % SEGMENTS),
                )
            )

    last_inner = top_ring_starts[-1]
    for i in range(SEGMENTS):
        faces.append(
            (
                last_inner + i,
                outer_top_start + i,
                outer_top_start + ((i + 1) % SEGMENTS),
                last_inner + ((i + 1) % SEGMENTS),
            )
        )


def create_cap_mesh() -> bpy.types.Object:
    rb = BASE_DIAMETER / 2
    rt = TOP_DIAMETER / 2
    rr = RECESS_DIAMETER / 2
    ri = INNER_HOLE_DIAMETER / 2
    re = INNER_ENTRY_DIAMETER / 2

    # The user-provided groove location has a small conflict with total height.
    # This v1 preserves total height and the 3.8 mm groove, starting 3.7 mm above the base.
    outer_profile = [
        (0.0, rb),
        (LOWER_STRAIGHT_HEIGHT, rb),
        (RECESS_BOTTOM_FROM_BASE, outer_cone_radius(RECESS_BOTTOM_FROM_BASE)),
        (RECESS_BOTTOM_FROM_BASE, rr),
        (RECESS_TOP, rr),
        (RECESS_TOP, outer_cone_radius(RECESS_TOP)),
        (HEIGHT, rt),
    ]

    # Bottom entry starts wider: Ø11 for 2 mm, then the inner bore continues at Ø9.5.
    inner_profile = [
        (0.0, re),
        (INNER_ENTRY_HEIGHT, re),
        (INNER_ENTRY_HEIGHT, ri),
        (INNER_CAVITY_DEPTH, ri),
    ]

    verts: list[tuple[float, float, float]] = []
    ring_starts: list[int] = []

    for z, radius in outer_profile:
        ring_starts.append(len(verts))
        verts.extend(make_outer_ring_vertices(radius, z, top=(z == HEIGHT)))

    inner_starts: list[int] = []
    for z, radius in inner_profile:
        inner_starts.append(len(verts))
        verts.extend(make_ring_vertices(radius, z))

    faces: list[tuple[int, ...]] = []

    # Outer shell.
    for a, b in zip(ring_starts, ring_starts[1:]):
        bridge(faces, a, b)

    # Inner cavity, normals facing inward.
    for a, b in zip(inner_starts, inner_starts[1:]):
        for i in range(SEGMENTS):
            faces.append((a + i, b + i, b + ((i + 1) % SEGMENTS), a + ((i + 1) % SEGMENTS)))

    # Raised exterior top: the center line is 3 mm wide and protrudes only outside.
    outer_top = ring_starts[-1]
    add_raised_top_cap(verts, faces, outer_top)

    # Closed inner cavity ceiling, with normals facing the hollow interior.
    inner_top = inner_starts[-1]
    faces.append(tuple(inner_top + i for i in reversed(range(SEGMENTS))))

    # Bottom annular face.
    outer_bottom = ring_starts[0]
    inner_bottom = inner_starts[0]
    for i in range(SEGMENTS):
        faces.append(
            (
                inner_bottom + i,
                inner_bottom + ((i + 1) % SEGMENTS),
                outer_bottom + ((i + 1) % SEGMENTS),
                outer_bottom + i,
            )
        )

    mesh = bpy.data.meshes.new(f"{MODEL_NAME}_mesh")
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00001)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.00001)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    obj = bpy.data.objects.new("Capuchon 17mm", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    if BEVEL_MM > 0:
        bevel = obj.modifiers.new(f"Tiny edge softening {BEVEL_MM:g}mm", "BEVEL")
        bevel.width = BEVEL_MM
        bevel.segments = 2
        bevel.affect = "EDGES"
        bevel.harden_normals = True

    return obj


def create_materials(obj: bpy.types.Object) -> None:
    mat = bpy.data.materials.new("matte warm grey plastic")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.66, 0.66, 0.62, 1)
        bsdf.inputs["Roughness"].default_value = 0.72
        bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.append(mat)


def add_dimension_label(text: str, location: tuple[float, float, float], size: float = 0.55) -> bpy.types.Object:
    bpy.ops.object.text_add(location=location, rotation=(math.radians(90), 0, 0))
    txt = bpy.context.object
    txt.name = f"Dimension - {text}"
    txt.data.body = text
    txt.data.align_x = "CENTER"
    txt.data.align_y = "CENTER"
    txt.data.size = size
    txt.data.extrude = 0.005
    mat = bpy.data.materials.get("dimension black") or bpy.data.materials.new("dimension black")
    mat.diffuse_color = (0.02, 0.02, 0.02, 1)
    txt.data.materials.append(mat)
    return txt


def make_scene_annotations() -> None:
    add_dimension_label("H 17 mm", (11.5, 0, 8.5), 0.65)
    add_dimension_label("Base Ø17.2", (0, -10.8, -0.45), 0.55)
    add_dimension_label("Top Ø13.2", (0, -9.1, 17.5), 0.55)
    add_dimension_label("Receso Ø14.5 x 3.8 alto", (0, -9.6, (RECESS_BOTTOM_FROM_BASE + RECESS_TOP) / 2), 0.45)
    add_dimension_label("Boca Ø11 x 2mm; luego Ø9.5", (0, -6.3, 0.75), 0.42)


def dimension_material() -> bpy.types.Material:
    mat = bpy.data.materials.get("dimension black") or bpy.data.materials.new("dimension black")
    mat.diffuse_color = (0.02, 0.02, 0.02, 1)
    return mat


def add_dimension_line(
    name: str, points: list[tuple[float, float, float]], width: float = 0.025
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = width
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (co[0], co[1], co[2], 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(dimension_material())
    return obj


def make_scene_annotations() -> None:
    y = -11.2

    add_dimension_line("Medida alto cuerpo 17", [(10.4, y, 0), (10.4, y, HEIGHT)])
    add_dimension_label("alto cuerpo 17 mm", (11.1, y, HEIGHT / 2), 0.5)

    add_dimension_line("Medida alto total 17.45", [(12.5, y, 0), (12.5, y, HEIGHT + RIDGE_PROTRUSION)])
    add_dimension_label("alto total con relieve 17.45 mm", (13.4, y, (HEIGHT + RIDGE_PROTRUSION) / 2), 0.42)

    add_dimension_line("Medida base diam 17.2", [(-BASE_DIAMETER / 2, y, -0.7), (BASE_DIAMETER / 2, y, -0.7)])
    add_dimension_label("base diam 17.2 mm", (0, y, -1.25), 0.48)

    add_dimension_line("Medida top diam 13.2", [(-TOP_DIAMETER / 2, y, 17.15), (TOP_DIAMETER / 2, y, 17.15)])
    add_dimension_label("arriba diam 13.2 mm", (0, y, 17.75), 0.46)

    add_dimension_line("Medida cono 15", [(9.2, y, LOWER_STRAIGHT_HEIGHT), (9.2, y, HEIGHT)])
    add_dimension_label("cono superior 15 mm", (9.9, y, (LOWER_STRAIGHT_HEIGHT + HEIGHT) / 2), 0.42)

    add_dimension_line("Medida base recta 2", [(-9.2, y, 0), (-9.2, y, LOWER_STRAIGHT_HEIGHT)])
    add_dimension_label("base recta 2 mm", (-10.0, y, 1.0), 0.4)

    add_dimension_line("Medida receso diam 14.5", [(-RECESS_DIAMETER / 2, y, 5.6), (RECESS_DIAMETER / 2, y, 5.6)])
    add_dimension_label("receso diam 14.5 mm", (0, y, 6.15), 0.44)

    add_dimension_line("Medida receso alto 3.8", [(-9.8, y, RECESS_BOTTOM_FROM_BASE), (-9.8, y, RECESS_TOP)])
    add_dimension_label("receso alto 3.8 mm", (-10.7, y, (RECESS_BOTTOM_FROM_BASE + RECESS_TOP) / 2), 0.38)

    add_dimension_line("Medida receso desde base 3.7", [(-8.9, y, 0), (-8.9, y, RECESS_BOTTOM_FROM_BASE)])
    add_dimension_label("3.7 mm desde base", (-7.8, y, RECESS_BOTTOM_FROM_BASE / 2), 0.34)

    add_dimension_line("Medida boca diam 11", [(-INNER_ENTRY_DIAMETER / 2, y, 0.55), (INNER_ENTRY_DIAMETER / 2, y, 0.55)])
    add_dimension_label("boca diam 11 mm x 2 mm alto", (0, y, 1.05), 0.38)

    add_dimension_line("Medida hueco diam 9.5", [(-INNER_HOLE_DIAMETER / 2, y, 2.55), (INNER_HOLE_DIAMETER / 2, y, 2.55)])
    add_dimension_label("luego hueco diam 9.5 mm", (0, y, 3.05), 0.38)

    add_dimension_line("Medida profundidad hueco 14.5", [(6.0, y, 0), (6.0, y, INNER_CAVITY_DEPTH)])
    add_dimension_label("profundidad interior 14.5 mm", (7.0, y, INNER_CAVITY_DEPTH / 2), 0.36)

    add_dimension_line("Medida nervadura ancho 3", [(0, -RIDGE_WIDTH / 2, HEIGHT + 1.0), (0, RIDGE_WIDTH / 2, HEIGHT + 1.0)])
    add_dimension_label("nervadura exterior 3 mm ancho", (0, 0, HEIGHT + 1.45), 0.42)

    add_dimension_line("Medida nervadura relieve 0.45", [(2.2, 0, HEIGHT), (2.2, 0, HEIGHT + RIDGE_PROTRUSION)])
    add_dimension_label("sobresale 0.45 mm", (3.3, 0, HEIGHT + 0.25), 0.34)
    add_dimension_label("aristas rectas; no toca interior", (0, 2.7, HEIGHT + 0.85), 0.34)


def setup_scene(obj: bpy.types.Object) -> None:
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, HEIGHT / 2))
    target = bpy.context.object
    target.name = "View target"

    bpy.ops.object.light_add(type="AREA", location=(-12, -22, 28))
    light = bpy.context.object
    light.name = "Key softbox"
    light.data.energy = 1100
    light.data.size = 8

    bpy.ops.object.light_add(type="POINT", location=(18, 12, 18))
    fill = bpy.context.object
    fill.name = "Fill light"
    fill.data.energy = 120

    bpy.ops.object.camera_add(location=(26, -34, 22), rotation=(math.radians(61), 0, math.radians(39)))
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    constraint = camera.constraints.new(type="TRACK_TO")
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    constraint.target = target
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 34
    camera.data.dof.use_dof = True
    camera.data.dof.focus_object = target
    camera.data.dof.aperture_fstop = 8

    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 96
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.look = "None"
    bpy.context.scene.view_settings.exposure = 0
    bpy.context.scene.view_settings.gamma = 1
    bpy.context.scene.world.color = (1, 1, 1)
    bpy.context.scene.world.use_nodes = True
    bg = bpy.context.scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (1, 1, 1, 1)
        bg.inputs["Strength"].default_value = 0.28
    bpy.context.scene.render.resolution_x = 1600
    bpy.context.scene.render.resolution_y = 1200

    # Put the model on a small neutral base for the preview only.
    bpy.ops.mesh.primitive_plane_add(size=28, location=(0, 0, -0.02))
    plane = bpy.context.object
    plane.name = "preview ground"
    mat = bpy.data.materials.new("preview ground light")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.88, 0.88, 0.86, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
    plane.data.materials.append(mat)
    obj.select_set(True)


def write_svg() -> None:
    rb = BASE_DIAMETER / 2
    rt = TOP_DIAMETER / 2
    rr = RECESS_DIAMETER / 2
    scale = 24
    ox, oy = 260, 60

    def x(radius: float) -> float:
        return ox + radius * scale

    def y(z: float) -> float:
        return oy + (HEIGHT - z) * scale

    left = lambda radius: ox - radius * scale
    right = lambda radius: ox + radius * scale

    outer = [
        (left(rb), y(0)),
        (left(rb), y(LOWER_STRAIGHT_HEIGHT)),
        (left(outer_cone_radius(RECESS_BOTTOM_FROM_BASE)), y(RECESS_BOTTOM_FROM_BASE)),
        (left(rr), y(RECESS_BOTTOM_FROM_BASE)),
        (left(rr), y(RECESS_TOP)),
        (left(outer_cone_radius(RECESS_TOP)), y(RECESS_TOP)),
        (left(rt), y(HEIGHT)),
        (right(rt), y(HEIGHT)),
        (right(outer_cone_radius(RECESS_TOP)), y(RECESS_TOP)),
        (right(rr), y(RECESS_TOP)),
        (right(rr), y(RECESS_BOTTOM_FROM_BASE)),
        (right(outer_cone_radius(RECESS_BOTTOM_FROM_BASE)), y(RECESS_BOTTOM_FROM_BASE)),
        (right(rb), y(LOWER_STRAIGHT_HEIGHT)),
        (right(rb), y(0)),
    ]
    outer_points = " ".join(f"{px:.2f},{py:.2f}" for px, py in outer)

    ri = INNER_HOLE_DIAMETER / 2
    re = INNER_ENTRY_DIAMETER / 2
    inner_w = ri * scale
    entry_w = re * scale
    inner_top_y = y(INNER_CAVITY_DEPTH)
    inner_bottom_y = y(0)
    inner_entry_y = y(INNER_ENTRY_HEIGHT)

    def line(x1, y1, x2, y2, klass="dim") -> str:
        return f'<line class="{klass}" x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" />'

    def text(label, tx, ty, size=16, anchor="middle") -> str:
        return f'<text x="{tx:.2f}" y="{ty:.2f}" font-size="{size}" text-anchor="{anchor}">{label}</text>'

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="820" height="620" viewBox="0 0 820 620">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#222" />
    </marker>
    <style>
      .body {{ fill:#e7e5dc; stroke:#111; stroke-width:2; }}
      .cut {{ fill:#ffffff; stroke:#111; stroke-width:1.6; stroke-dasharray:5 4; }}
      .dim {{ stroke:#222; stroke-width:1.4; marker-start:url(#arrow); marker-end:url(#arrow); }}
      .guide {{ stroke:#777; stroke-width:1; stroke-dasharray:4 4; }}
      text {{ font-family: Arial, Helvetica, sans-serif; fill:#111; }}
      .note {{ fill:#4d4d4d; font-size:13px; }}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="28" y="34" font-size="22" font-weight="700">Capuchon - dibujo tecnico v1</text>
  <text x="28" y="56" class="note">Unidades en milimetros. Receso ubicado a 3.7 mm desde la base y alto 3.8 mm.</text>

  <polygon class="body" points="{outer_points}" />
  <path class="cut" d="M {ox-entry_w:.2f},{inner_bottom_y:.2f}
                       L {ox-entry_w:.2f},{inner_entry_y:.2f}
                       L {ox-inner_w:.2f},{inner_entry_y:.2f}
                       L {ox-inner_w:.2f},{inner_top_y:.2f}
                       L {ox+inner_w:.2f},{inner_top_y:.2f}
                       L {ox+inner_w:.2f},{inner_entry_y:.2f}
                       L {ox+entry_w:.2f},{inner_entry_y:.2f}
                       L {ox+entry_w:.2f},{inner_bottom_y:.2f}
                       Z" />
  {line(ox, y(0) + 20, ox, y(HEIGHT) - 20, "guide")}
  {line(right(rb), y(0), 680, y(0), "guide")}
  {line(right(rt), y(HEIGHT), 650, y(HEIGHT), "guide")}
  {line(650, y(HEIGHT), 650, y(0))}
  {text("17 alto", 682, (y(HEIGHT)+y(0))/2 + 5, 16, "start")}

  {line(left(rb), y(0)+34, right(rb), y(0)+34)}
  {text("Ø17.2 base", ox, y(0)+58, 16)}

  {line(left(rt), y(HEIGHT)-26, right(rt), y(HEIGHT)-26)}
  {text("Ø13.2 arriba", ox, y(HEIGHT)-38, 16)}

  {line(left(rr), y((RECESS_BOTTOM_FROM_BASE+RECESS_TOP)/2), right(rr), y((RECESS_BOTTOM_FROM_BASE+RECESS_TOP)/2))}
  {text("Ø14.5 receso", ox, y((RECESS_BOTTOM_FROM_BASE+RECESS_TOP)/2)-9, 14)}

  {line(96, y(RECESS_BOTTOM_FROM_BASE), 96, y(RECESS_TOP))}
  {text("3.8", 77, (y(RECESS_BOTTOM_FROM_BASE)+y(RECESS_TOP))/2+5, 14)}
  {line(125, y(0), 125, y(RECESS_BOTTOM_FROM_BASE))}
  {text("3.7", 107, (y(0)+y(RECESS_BOTTOM_FROM_BASE))/2+5, 14)}
  {line(72, y(RECESS_TOP), 72, y(HEIGHT))}
  {text(f"{HEIGHT-RECESS_TOP:.1f}", 45, (y(RECESS_TOP)+y(HEIGHT))/2+5, 14)}

  {line(ox-entry_w, y(0)-24, ox+entry_w, y(0)-24)}
  {text("boca Ø11", ox, y(0)-38, 14)}
  {line(ox-inner_w, y(INNER_ENTRY_HEIGHT)-22, ox+inner_w, y(INNER_ENTRY_HEIGHT)-22)}
  {text("luego Ø9.5", ox, y(INNER_ENTRY_HEIGHT)-32, 14)}
  {line(139, y(0), 139, y(INNER_ENTRY_HEIGHT))}
  {text("2", 121, (y(0)+y(INNER_ENTRY_HEIGHT))/2+5, 14)}

  {text("Cono superior: 15 mm de alto", 560, 126, 15, "start")}
  {text("Base recta asumida: 2 mm", 560, 150, 15, "start")}
  {text("Boca inicial: Ø11 x 2 mm", 560, 174, 15, "start")}
  {text("Hueco interior despues: Ø9.5", 560, 198, 15, "start")}
  {text("Linea exterior: 3 mm ancho", 560, 222, 15, "start")}
  {text("Sobresale: 0.45 mm", 560, 246, 15, "start")}
  {text("Aristas rectas; no toca interior.", 560, 274, 13, "start")}
</svg>
'''
    (OUT_DIR / f"{MODEL_NAME}_dibujo.svg").write_text(svg, encoding="utf-8")


def render_svg_to_png_with_pillow() -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ModuleNotFoundError:
        print("Pillow is not available inside Blender Python; skipping drawing PNG here.")
        return

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

    scale = 54
    ox, oy = 520, 130

    def px(r: float) -> float:
        return ox + r * scale

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
    dim_line((right(rr), py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2)), (left(rr), py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2)), "Ø14.5 receso", (ox, py((RECESS_TOP + RECESS_BOTTOM_FROM_BASE) / 2) - 20))
    dim_line((ox - entry_w, py(0) - 22), (ox + entry_w, py(0) - 22), "boca Ø11", (ox, py(0) - 48))
    dim_line((ox - inner_w, py(INNER_ENTRY_HEIGHT) - 44), (ox + inner_w, py(INNER_ENTRY_HEIGHT) - 44), "luego Ø9.5", (ox, py(INNER_ENTRY_HEIGHT) - 66))
    dim_line((390, py(0)), (390, py(INNER_ENTRY_HEIGHT)), "2", (365, (py(0) + py(INNER_ENTRY_HEIGHT)) / 2), "mm")
    dim_line((1225, py(HEIGHT)), (1225, py(0)), "17 alto", (1260, (py(HEIGHT) + py(0)) / 2), "lm")
    dim_line((250, py(RECESS_TOP)), (250, py(RECESS_BOTTOM_FROM_BASE)), "3.8", (220, (py(RECESS_TOP) + py(RECESS_BOTTOM_FROM_BASE)) / 2), "mm")
    dim_line((305, py(RECESS_BOTTOM_FROM_BASE)), (305, py(0)), "3.7", (275, (py(RECESS_BOTTOM_FROM_BASE) + py(0)) / 2), "mm")
    dim_line((190, py(HEIGHT)), (190, py(RECESS_TOP)), f"{HEIGHT - RECESS_TOP:.1f}", (150, (py(HEIGHT) + py(RECESS_TOP)) / 2), "mm")

    draw.text((1090, 190), "Cono superior: 15 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 225), "Base recta asumida: 2 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 260), "Boca inicial: Ø11 x 2 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 295), "Luego hueco interior: Ø9.5", fill=(20, 20, 20), font=small)
    draw.text((1090, 350), "Linea exterior: 3 mm ancho", fill=(20, 20, 20), font=small)
    draw.text((1090, 385), "Sobresale: 0.45 mm", fill=(20, 20, 20), font=small)
    draw.text((1090, 435), "Aristas rectas; no toca interior.", fill=(80, 80, 80), font=tiny)

    img.save(OUT_DIR / f"{MODEL_NAME}_dibujo.png")


def main() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    obj = create_cap_mesh()
    create_materials(obj)
    make_scene_annotations()
    setup_scene(obj)

    write_svg()
    render_svg_to_png_with_pillow()

    blend_path = OUT_DIR / f"{MODEL_NAME}.blend"
    stl_path = OUT_DIR / f"{MODEL_NAME}.stl"
    glb_path = OUT_DIR / f"{MODEL_NAME}.glb"
    preview_path = OUT_DIR / f"{MODEL_NAME}_preview.png"

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.wm.stl_export(filepath=str(stl_path), export_selected_objects=True, global_scale=1.0)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True)

    bpy.context.scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)

    print(f"Generated: {blend_path}")
    print(f"Generated: {stl_path}")
    print(f"Generated: {glb_path}")
    print(f"Generated: {preview_path}")
    print(f"Generated: {OUT_DIR / (MODEL_NAME + '_dibujo.png')}")
    print(f"Generated: {OUT_DIR / (MODEL_NAME + '_dibujo.svg')}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    main()
