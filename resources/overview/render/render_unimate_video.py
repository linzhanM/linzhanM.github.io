"""The homepage's UniMate thumbnail, rendered in Blender as a video.

    ./resources/overview/render/render_unimate_video.sh          # the driver
    blender -b --factory-startup -P render_unimate_video.py      # frames only

The paper teaser's own renderer, animated: this is render_teaser_unimate.py
(~/Downloads/claude_blender_code — the SIGGRAPH representative image) with
its bottom two rows, the same rigs at the same rot_z and heights, the same
stage (teaser_stage.py: graph-paper floor dissolving into the background,
white world with a glossy gradient, three lights), the same steel skeleton
overlaid on the mesh through two passes — but each rig plays its clip instead
of standing as three keyframe instances, and every frame is written out for
ffmpeg. The phone shows this in place of the live lab (index.html); the
desktop shows the lab itself, so the two should read as one stage.

Frames land in OUT_DIR as mesh_####.png and skel_####.png (film transparent);
the driver composites the skeleton over the mesh, lays both over BG, and
encodes. Env: RES_X/RES_Y (3840x2160), OUT_DIR, SAMPLES, BG (composite colour,
for the floor cells), FRAMES (a comma list to render only some, for a look),
CAM_ELEV_RATIO, FILL_H, FILL_V, CAM_TARGET_Z, GAP, ROW_DEPTH, GRID_CELL — the
rest is edited here, as in the teaser: this file IS the composition.

Needs the teaser's compiled skeleton utility (util_render_skeleton, Python 3.11
bytecode beside the teaser script) and the seven uncompressed rigs in
resources/overview/unimate/resources/glbs-raw/ (gitignored; the paper teaser's
own assets).
"""

import glob
import importlib.util
import math
import os
import sys
import types

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from teaser_stage import (  # noqa: E402
    build_floor, build_lights_and_world, clip_bbox, configure_render, evaluated_bbox, fit_camera, log,
    render_frames, srgb_to_linear,
)

TEASER_DIR = os.environ.get("TEASER_DIR", os.path.expanduser("~/Downloads/claude_blender_code"))
RIGS = os.environ.get("RIGS", os.path.normpath(os.path.join(HERE, "..", "unimate", "resources", "glbs-raw")))

# The teaser's CONFIG_FULL, ground rows only (the flyers were added to the
# thumbnail and taken back out on 2026-09-12): name, file, rot_z, target
# height, row (0 front, 1 back) and left-to-right order within it. rot_z and
# height are the teaser's values unchanged.
CONFIG = [
    dict(name="radar", glb="radar-extend.glb", rot_z=70, height=1.8, row=0),
    dict(name="spot", glb="quadruped_spot_arm-step_reach.glb", rot_z=-60, height=1.82, row=0),
    dict(name="flower", glb="flower-close.glb", rot_z=25, height=1.5, row=0),
    dict(name="baymax", glb="baymax-punch.glb", rot_z=90, height=1.75, row=1),
    dict(name="go2", glb="go2-rear_up.glb", rot_z=-65, height=2.05, row=1),
    dict(name="g1", glb="g1-pick_up.glb", rot_z=35, height=2.55, row=1),
    dict(name="mixamo", glb="mixamo-high_kick.glb", rot_z=0, height=2.15, row=1),
]
ROW_Y = [0.0, float(os.environ.get("ROW_DEPTH", 2.9))]   # the teaser's two ground rows, 2.9 apart
CLIP_FRAMES = 60            # every rig: 60 keys at 30 fps (unimate/README.md)

# Framing, settled on four frames of the loop (0, 20, 40, 59) tiled side by
# side on 2026-09-12. The teaser fits a still it crops afterwards, so its
# values (elevation 0.7265, fill 0.9, aim at z 1.62, gap 0.45) left this
# 16:9 frame half empty. A steeper camera (0.9; 1.3 and 1.6 foreshortened
# the rigs) and, as the live thumbnail's pad 0.765 does, a fit that lets the
# loop's envelope overflow the frame — 1.3 of the width, 1.12 of the height:
# the extremes never coincide, and at 1.25 the front row's feet left the
# bottom edge. Aimed lower (z 1.05) so that row rises off it.
RES_X = int(os.environ.get("RES_X", 3840))
RES_Y = int(os.environ.get("RES_Y", 2160))
OUT_DIR = os.environ.get("OUT_DIR", os.path.expanduser("~/Downloads/lab_renders/unimate-blender"))
SAMPLES = int(os.environ.get("SAMPLES", 64))
CAM_AZIM = float(os.environ.get("CAM_AZIM", 0))
CAM_ELEV_RATIO = float(os.environ.get("CAM_ELEV_RATIO", 0.9))
FILL_H = float(os.environ.get("FILL_H", 1.3))
FILL_V = float(os.environ.get("FILL_V", 1.12))
CAM_TARGET_Z = float(os.environ.get("CAM_TARGET_Z", 1.05))
GAP = float(os.environ.get("GAP", 0.3))
GRID_CELL = float(os.environ.get("GRID_CELL", 0.75))
BONE_T, JOINT_T = 0.008, 0.017
SKEL_REF_H = float(os.environ.get("SKEL_REF_H", 1.25))
BONE_ROUGH, JOINT_ROUGH = 0.34, 0.28
BONE_METAL, JOINT_METAL = 0.6, 0.8
BONE_TINT = (0.66, 0.645, 0.62, 1.0)
BONE_RIM = (1.0, 0.99, 0.97, 1.0)
JOINT_TINT = (0.105, 0.105, 0.115, 1.0)
JOINT_RIM = (0.55, 0.56, 0.62, 1.0)
BONE_COL = (0.70, 0.65, 0.60, 1.0)
JOINT_COL = (0.10, 0.09, 0.08, 1.0)

# The composite background (the driver lays the frames over it): the homepage's
# --ivory-medium, the plate every thumbnail sits on.
BG = os.environ.get("BG", "#F0EEE6")
BG_LINEAR = srgb_to_linear(BG)


def load_uskel():
    def _stub(modname, attrs):
        m = types.ModuleType(modname)
        for a in attrs:
            setattr(m, a, lambda *a, **kw: None)
        sys.modules[modname] = m
    _stub("data_process", [])
    _stub("data_process.util_render_bpy",
          ["add_camera", "choose_main_mesh", "clear_scene", "find_meshes", "load_armature", "smooth_meshes"])
    _stub("data_process.util_render_blender",
          ["clear_normal_maps", "fix_materials", "set_materials_opaque", "setup_lighting"])
    py = os.path.join(TEASER_DIR, "util_render_skeleton.py")
    if os.path.exists(py):
        spec = importlib.util.spec_from_file_location("util_render_skeleton", py)
    else:
        pyc = glob.glob(os.path.join(TEASER_DIR, "__pycache__", "util_render_skeleton.*.pyc"))
        if not pyc:
            raise SystemExit(f"util_render_skeleton not found beside {TEASER_DIR}")
        spec = importlib.util.spec_from_file_location("util_render_skeleton", pyc[0])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["util_render_skeleton"] = mod
    spec.loader.exec_module(mod)
    return mod


def ground_anchor(objs):
    """Mean x/y of the lowest 30% of the mesh at frame 0 — feet, base, stem;
    a bbox centre wobbles when an arm or dish extends sideways."""
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    lo, hi = evaluated_bbox(objs, 0)
    zcut = lo.z + 0.3 * (hi.z - lo.z)
    xs = ys = 0.0
    n = 0
    for o in objs:
        if o.type != "MESH":
            continue
        eo = o.evaluated_get(deps)
        me = eo.to_mesh()
        mw = eo.matrix_world
        for vi in range(0, len(me.vertices), 13):
            w = mw @ me.vertices[vi].co
            if w.z < zcut:
                xs += w.x
                ys += w.y
                n += 1
        eo.to_mesh_clear()
    if n == 0:
        return (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    return xs / n, ys / n


def build_character(cfg, uskel):
    """Import one rig, give it the teaser's skeleton, normalise it under an
    empty (rotation, height, grounding) and return (root empty, its meshes,
    its skeleton object)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(RIGS, cfg["glb"]))
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.type == "MESH" and o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)
            new.remove(o)
    arm = next(o for o in new if o.type == "ARMATURE")
    parts = [o for o in new if o.type == "MESH" and len(o.data.vertices)]

    # The clip's envelope sets the scale (the lab sizes a rig by its tallest
    # frame) and the ground (its lowest point over the loop stands on the floor).
    lo, hi = clip_bbox(parts, CLIP_FRAMES)
    hmax = hi.z - lo.z

    # Skeleton radius exactly as the teaser's: BONE_T × SKEL_REF_H in world
    # units for every character, whatever its bone statistics.
    bls = []
    for pb in arm.pose.bones:
        hw = arm.matrix_world @ pb.head
        tw = arm.matrix_world @ pb.tail
        bls.append((tw - hw).length)
    mean_bone = sum(bls) / len(bls) if bls else 1.0
    uskel.build_skeleton_geometry(
        arm,
        bone_thickness=BONE_T * SKEL_REF_H / cfg["height"] * hmax / mean_bone,
        joint_thickness=JOINT_T * SKEL_REF_H / cfg["height"] * hmax / mean_bone,
        bone_color=BONE_COL, joint_color=JOINT_COL)
    skel = bpy.data.objects.get("SkeletonObj")
    if skel is not None:
        skel.name = f"{cfg['name']}_skel"

    # One empty carries the whole rig: the armature, its meshes and the
    # skeleton keep their world matrices under it, so rotation, scale and
    # placement are one transform on the parent.
    root = bpy.data.objects.new(f"{cfg['name']}_root", None)
    bpy.context.scene.collection.objects.link(root)
    for o in [arm] + [p for p in parts if p.parent is None] + ([skel] if skel else []):
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_world = mw
    s = cfg["height"] / hmax
    root.matrix_world = Matrix.Rotation(math.radians(cfg["rot_z"]), 4, "Z") @ Matrix.Scale(s, 4)
    bpy.context.view_layer.update()

    lo, hi = clip_bbox(parts, CLIP_FRAMES)
    ax, ay = ground_anchor(parts)
    root.matrix_world = Matrix.Translation((-ax, ROW_Y[cfg["row"]] - ay, -lo.z)) @ root.matrix_world
    bpy.context.view_layer.update()
    log(f"{cfg['name']}: height {hmax:.2f} -> {cfg['height']}, {len(parts)} meshes, skeleton {'yes' if skel else 'no'}")
    return root, parts, skel


def pack_rows(chars):
    """Per row, a uniform GAP between the rigs' clip envelopes, the row
    centred on x = 0 — the teaser's auto-pack, on envelopes so no rig ever
    crosses its neighbour over the loop."""
    rows = {}
    for cfg, root, parts, skel in chars:
        rows.setdefault(cfg["row"], []).append((cfg, root, parts))
    for row, items in rows.items():
        spans = []
        for cfg, root, parts in items:
            lo, hi = clip_bbox(parts, CLIP_FRAMES)
            spans.append((lo.x, hi.x))
        order = list(range(len(items)))   # CONFIG order is left to right
        total = sum(spans[i][1] - spans[i][0] for i in order) + GAP * (len(order) - 1)
        cur = -total / 2
        for i in order:
            shift = cur - spans[i][0]
            root = items[i][1]
            root.matrix_world = Matrix.Translation((shift, 0, 0)) @ root.matrix_world
            cur += (spans[i][1] - spans[i][0]) + GAP
    bpy.context.view_layer.update()


def style_skeleton_materials():
    """The teaser's brushed-steel bones and gunmetal joints, verbatim."""
    for m in bpy.data.materials:
        base = m.name.split(".")[0]
        if base not in ("Skeleton_Bone_Mat", "Skeleton_Joint_Mat") or not m.use_nodes:
            continue
        nt = m.node_tree
        p = next((x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if p is None:
            continue
        is_bone = base == "Skeleton_Bone_Mat"
        p.inputs["Metallic"].default_value = BONE_METAL if is_bone else JOINT_METAL
        p.inputs["Roughness"].default_value = BONE_ROUGH if is_bone else JOINT_ROUGH
        if "Specular IOR Level" in p.inputs:
            p.inputs["Specular IOR Level"].default_value = 0.85
        if "Coat Weight" in p.inputs:
            p.inputs["Coat Weight"].default_value = 0.1 if is_bone else 0.15
            p.inputs["Coat Roughness"].default_value = 0.2
        for l in list(p.inputs["Base Color"].links):
            nt.links.remove(l)
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.32
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.15
        ramp.color_ramp.elements[1].position = 0.85
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MIX"
        mix.inputs["Color1"].default_value = BONE_TINT if is_bone else JOINT_TINT
        mix.inputs["Color2"].default_value = BONE_RIM if is_bone else JOINT_RIM
        nt.links.new(lw.outputs["Fresnel"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], mix.inputs["Fac"])
        nt.links.new(mix.outputs["Color"], p.inputs["Base Color"])


def polish_materials():
    """The teaser's gentle PBR pass: only unlinked values, nudged into a band;
    maps are never touched."""
    ROUGH_LO, ROUGH_HI, ROUGH_MULT = 0.17, 0.80, 0.94
    SPEC_MIN, COAT, COAT_ROUGH = 0.5, 0.05, 0.25
    for m in bpy.data.materials:
        base = m.name.split(".")[0]
        if base.startswith("Skeleton_") or base == "stage_mat" or not m.use_nodes:
            continue
        p = next((x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if p is None:
            continue
        r = p.inputs.get("Roughness")
        if r is not None and not r.is_linked:
            r.default_value = min(max(r.default_value * ROUGH_MULT, ROUGH_LO), ROUGH_HI)
        sp = p.inputs.get("Specular IOR Level")
        if sp is not None and not sp.is_linked:
            sp.default_value = max(sp.default_value, SPEC_MIN)
        if "Coat Weight" in p.inputs and not p.inputs["Coat Weight"].is_linked:
            p.inputs["Coat Weight"].default_value = max(p.inputs["Coat Weight"].default_value, COAT)
            p.inputs["Coat Roughness"].default_value = COAT_ROUGH
        bc = p.inputs.get("Base Color")
        if bc is not None and not bc.is_linked:
            c = bc.default_value
            lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            if lum < 0.02:
                k = 0.025 / max(lum, 1e-4)
                bc.default_value = (min(c[0] * k, 0.05), min(c[1] * k, 0.05), min(c[2] * k, 0.05), c[3])


def main():
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    scene.frame_end = CLIP_FRAMES - 1
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    uskel = load_uskel()
    chars = []
    for cfg in CONFIG:
        root, parts, skel = build_character(cfg, uskel)
        chars.append((cfg, root, parts, skel))
    pack_rows(chars)

    # The stage under every envelope.
    xs, ys, boxes = [], [], []
    for cfg, root, parts, skel in chars:
        lo, hi = clip_bbox(parts, CLIP_FRAMES)
        xs += [lo.x, hi.x]
        ys += [lo.y, hi.y]
        boxes.append((lo, hi))
    floor = build_floor(min(xs) - 0.6, max(xs) + 0.6, min(ys) - 1.0, max(ys) + 0.8, GRID_CELL, BG_LINEAR)
    # Aimed at the content's own centre; CAM_TARGET_Z as the teaser's kind.
    center = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, CAM_TARGET_Z))
    fit_camera(center, boxes, CAM_ELEV_RATIO, FILL_H, FILL_V, azim_deg=CAM_AZIM)
    build_lights_and_world(center, max(max(xs) - min(xs) + 1.2, 8.0))
    style_skeleton_materials()
    polish_materials()
    configure_render(RES_X, RES_Y, SAMPLES)

    frames = [int(f) for f in os.environ["FRAMES"].split(",")] if os.environ.get("FRAMES") else list(range(CLIP_FRAMES))
    skels = [skel for _, _, _, skel in chars if skel is not None]
    meshes = [p for _, _, parts, _ in chars for p in parts]

    # Two passes, as the teaser: the beauty pass with skeletons hidden, then
    # the skeletons alone over nothing, for the driver to lay over it — the
    # X-ray skeleton that reads through the mesh.
    for sk in skels:
        sk.hide_render = True
    render_frames(frames, OUT_DIR, "mesh")
    for m in meshes:
        m.hide_render = True
    floor.hide_render = True
    for sk in skels:
        sk.hide_render = False
    render_frames(frames, OUT_DIR, "skel")
    log(f"wrote {len(frames)} frames x 2 passes to {OUT_DIR}")


if __name__ == "__main__":
    main()
