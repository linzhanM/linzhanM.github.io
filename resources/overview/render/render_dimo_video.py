"""The homepage's DIMO thumbnail, rendered in Blender as a video.

    ./resources/overview/render/render_dimo_video.sh             # the driver
    blender -b --factory-startup -P render_dimo_video.py         # frames only

What the live thumbnail plays (resources/overview/dimo, ?embed): the nine
robot ducks, then the nine UR5e arms, each body playing one of the object's
clips, on the DIMO lab's own layout — three staggered ranks, its spacings, the
ducks in its MICRODUCK_ORDER — seen as the lab sees them (0.42 rad up, straight
on, a 22° lens fitted to the clips' whole envelope). On the paper teaser's
stage (teaser_stage.py), the same one the UniMate recording beside it stands
on, with DIMO's pink rim and blue fill over the teaser's lights, and its two
finishes on every part: a painted shell with a clearcoat, or anodised metal,
by how dark the part's colour is (its rigs.js materialFor). No key points or
trails: those are the lab's overlays, not the model's.

Each clip is its own file in dimo/resources/glbs-raw/ (the project tree,
gitignored): the skinned model with that motion, 90 keys at 30 fps. Frames land
in OUT_DIR as duck_####.png and arm_####.png (film transparent, 0..89); the
driver loops each twice, fades the cut between them in the composite's ivory
as the live thumbnail does, and encodes. The gripper the lab hangs off the
UR5e's flange is a catalog primitive, not in the file, so the arm ends at the
flange here.

Env: RES_X/RES_Y (3840x2160), OUT_DIR, SAMPLES, BG, FRAMES (a comma list, for
a look), ONLY (duck | arm), FILL, and per object YAW_DUCK / YAW_ARM in degrees
(the way each faces; the lab yaws the UR5e −90°).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from teaser_stage import (  # noqa: E402
    build_floor, build_lights_and_world, clip_bbox, configure_render, fit_camera, log, render_frames,
    srgb_to_linear,
)

RAW = os.environ.get("RAW", os.path.normpath(os.path.join(HERE, "..", "..", "..", "dimo", "resources", "glbs-raw")))
CLIP_FRAMES = 90   # every clip: 90 keys at 30 fps (source.seconds 2.97)

# The lab's stages (resources/overview/dimo/js/examples.js): the clips in the
# order the bodies stand, front rank first and left to right; ranks, stagger,
# spacing and depth verbatim. The ducks stand in MICRODUCK_ORDER (play dead
# and electric slide in front, back away at the back); the arms in the
# catalog's clip order.
OBJECTS = [
    dict(name="duck", prefix="microduck_", clips=[
        "play_dead", "devastated_sit_down", "electric_slide",
        "curious_head_tilts", "shy_turn_away", "excited_head_wag",
        "angry_head_snaps", "laugh", "startled_back_away",
    ], ranks=[3, 3, 3], stagger=0.5, spacing=0.36, depth=0.5, yaw=float(os.environ.get("YAW_DUCK", 0))),
    dict(name="arm", prefix="ur5e_", clips=[
        "dispense", "inspect_orbit", "machine_tend",
        "palletize", "peg_insert", "polish",
        "pour", "spray_paint", "weld_weave",
    ], ranks=[3, 3, 3], stagger=0.5, spacing=1.1, depth=1.4, yaw=float(os.environ.get("YAW_ARM", -90))),
]

RES_X = int(os.environ.get("RES_X", 3840))
RES_Y = int(os.environ.get("RES_Y", 2160))
OUT_DIR = os.environ.get("OUT_DIR", os.path.expanduser("~/Downloads/lab_renders/dimo-blender"))
SAMPLES = int(os.environ.get("SAMPLES", 64))
# The lab's camera: 0.42 rad of elevation as height over horizontal distance,
# straight on (the embed's azimuth 0), a 22° vertical lens, fitted to the
# clips' envelope with only a hair of inset — so FILL is 1 less that hair.
CAM_ELEV_RATIO = math.tan(float(os.environ.get("CAM_ELEV", 0.42)))
FILL = float(os.environ.get("FILL", 0.96))
VFOV = float(os.environ.get("VFOV", 22))
# The lab's paper: a cell is FLOOR_VIEW_SHARE of the view's half-height at the
# target, so both objects lay the same paper on screen whatever their size.
FLOOR_VIEW_SHARE = 0.456
BG = os.environ.get("BG", "#F0EEE6")
BG_LINEAR = srgb_to_linear(BG)

# DIMO's finishes (rigs.js materialFor): by the part's colour, dark parts are
# anodised metal, light ones painted shell under a clearcoat.
FINISH = {
    "shell": dict(roughness=0.42, metallic=0.04, coat=0.55, coat_rough=0.28),
    "metal": dict(roughness=0.38, metallic=0.62, coat=0.0, coat_rough=0.0),
}
# Its two coloured lights (viewer.js): a pink rim from behind the left
# shoulder, a blue fill from the front left — as shares of the stage span.
ACCENTS = [
    ("PinkRim", "#ff5c8a", 60.0, (-0.45, 0.6, 0.45)),
    ("BlueFill", "#3b82f6", 40.0, (-0.6, -0.5, 0.25)),
]


def rank_slots(ranks):
    """(rank, k, count) per body, front rank first — the lab's rankSlots."""
    return [(rank, k, count) for rank, count in enumerate(ranks) for k in range(count)]


def spot(obj, i):
    """The lab's layout: x across the rank, alternate ranks half a step over;
    the front rank toward the camera (lab +z is Blender −y)."""
    rank, k, count = rank_slots(obj["ranks"])[i]
    n_ranks = len(obj["ranks"])
    shift = ((0.5 if rank % 2 else -0.5) * obj["stagger"]) if n_ranks > 1 else 0
    x = (k - (count - 1) / 2 + shift) * obj["spacing"]
    z_lab = ((n_ranks - 1) / 2 - rank) * obj["depth"]
    return Vector((x, -z_lab, 0))


def finish_materials(objs):
    """Re-cast every part's material as DIMO does: its colour kept, the finish
    by that colour's darkness. Maps, if any, stay linked."""
    seen = set()
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in seen or not m.use_nodes:
                continue
            seen.add(m.name)
            p = next((x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
            if p is None:
                continue
            bc = p.inputs["Base Color"]
            c = bc.default_value
            lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            # rigs.js judges HSL lightness of the sRGB colour; linear luminance
            # 0.13 is about sRGB lightness 0.4.
            f = FINISH["metal"] if (not bc.is_linked and lum < 0.13) else FINISH["shell"]
            p.inputs["Roughness"].default_value = f["roughness"]
            p.inputs["Metallic"].default_value = f["metallic"]
            if "Coat Weight" in p.inputs:
                p.inputs["Coat Weight"].default_value = f["coat"]
                p.inputs["Coat Roughness"].default_value = f["coat_rough"]
            if "Specular IOR Level" in p.inputs:
                p.inputs["Specular IOR Level"].default_value = 0.5


def build_object(obj):
    """Import each clip's file — the model with that motion — and stand it on
    its spot. Returns the bodies' meshes and their envelopes."""
    bodies = []
    for i, clip in enumerate(obj["clips"]):
        path = os.path.join(RAW, f"{obj['prefix']}{clip}.glb")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in new if o.type == "ARMATURE")
        parts = [o for o in new if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
        for o in new:
            if o is not arm and o not in parts:
                bpy.data.objects.remove(o, do_unlink=True)   # the importer's bone-shape icosphere
        root = bpy.data.objects.new(f"{obj['name']}_{i}", None)
        bpy.context.scene.collection.objects.link(root)
        for o in [arm] + [p for p in parts if p.parent is None]:
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_world = mw
        root.matrix_world = Matrix.Translation(spot(obj, i)) @ Matrix.Rotation(math.radians(obj["yaw"]), 4, "Z")
        bodies.append((root, parts))
    bpy.context.view_layer.update()
    finish_materials([p for _, parts in bodies for p in parts])
    boxes = [clip_bbox(parts, CLIP_FRAMES) for _, parts in bodies]
    log(f"{obj['name']}: {len(bodies)} bodies")
    return bodies, boxes


def render_object(obj, frames):
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    scene.frame_start = 0
    scene.frame_end = CLIP_FRAMES - 1

    bodies, boxes = build_object(obj)
    xs = [v for lo, hi in boxes for v in (lo.x, hi.x)]
    ys = [v for lo, hi in boxes for v in (lo.y, hi.y)]
    zs = [hi.z for lo, hi in boxes]
    # The lab aims at the middle of the bodies' sweep, over the floor.
    center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(zs) * 0.45))
    cam, dist = fit_camera(center, boxes, CAM_ELEV_RATIO, FILL, FILL, vfov_deg=VFOV)
    half_h = dist * math.sqrt(1 + CAM_ELEV_RATIO ** 2) * math.tan(math.radians(VFOV) / 2)
    cell = FLOOR_VIEW_SHARE * half_h
    span = max(xs) - min(xs)
    build_floor(min(xs) - span * 0.1, max(xs) + span * 0.1, min(ys) - span * 0.15, max(ys) + span * 0.1,
                cell, BG_LINEAR, back=span * 0.2, depth_pad=span * 0.06)
    build_lights_and_world(center, max(span * 1.4, 2.0), accents=ACCENTS)
    configure_render(RES_X, RES_Y, SAMPLES)
    render_frames(frames, OUT_DIR, obj["name"])
    log(f"{obj['name']}: wrote {len(frames)} frames to {OUT_DIR}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.context.scene.render.fps = 30
    frames = [int(f) for f in os.environ["FRAMES"].split(",")] if os.environ.get("FRAMES") else list(range(CLIP_FRAMES))
    only = os.environ.get("ONLY")
    for obj in OBJECTS:
        if only and obj["name"] != only:
            continue
        render_object(obj, frames)


if __name__ == "__main__":
    main()
