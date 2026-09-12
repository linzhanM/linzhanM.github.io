"""The paper teaser's stage, shared by the two homepage recordings.

Everything here is render_teaser_unimate.py's (~/Downloads/claude_blender_code,
the SIGGRAPH representative image) lifted out so render_unimate_video.py and
render_dimo_video.py lay the same stage: the graph-paper floor that dissolves
outward into the composite's background, the white world with a vertical
gradient for glossy rays, the sun key with the two soft area lights, EEVEE with
raytracing under the Standard view transform, film transparent. Plus what a
video needs that a still does not: bounding boxes over a whole clip, and a
camera fitted to how those boxes project.

Imported by path from the scripts beside it (Blender's -P gives no package).
"""

import math
import os

import bpy
from mathutils import Vector


def log(*a):
    print("[video]", *a)


def srgb_to_linear(hex_color):
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def evaluated_bbox(objs, frame):
    """World bbox of the evaluated (deformed) meshes at one frame."""
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != "MESH":
            continue
        eo = o.evaluated_get(deps)
        me = eo.to_mesh()
        mw = eo.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        eo.to_mesh_clear()
    return lo, hi


def clip_bbox(objs, frames, step=3):
    """Bbox over the whole clip, sampled every `step` frames — the envelope
    the lab frames on (frameEnvelope), so nothing is cropped mid-motion."""
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for f in range(0, frames, step):
        a, b = evaluated_bbox(objs, f)
        lo = Vector(map(min, lo, a))
        hi = Vector(map(max, hi, b))
    return lo, hi


def build_floor(fx0, fx1, fy0, fy1, cell, bg_linear, back=None, depth_pad=None):
    """The teaser's stage: lit graph paper under the figures (cells in the
    composite's own colour, so the paper dissolves into the page as the
    teaser's does into white), fading outward to transparency along an
    ellipse pushed back behind the figures, where the key light throws the
    shadows. `cell` is the grid pitch in metres."""
    fcx, fcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
    fw, fd = fx1 - fx0, fy1 - fy0
    bpy.ops.mesh.primitive_plane_add(size=2, location=(fcx, fcy, -0.001))
    floor = bpy.context.active_object
    floor.scale = (fw / 2 + 8.0, fd / 2 + 8.0, 1)
    bpy.ops.object.transform_apply(scale=True)
    gm = bpy.data.materials.new("stage_mat")
    gm.use_nodes = True
    nt = gm.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Roughness"].default_value = 1.0
    line = float(os.environ.get("GRID_LINE", 0.03))
    coord = nt.nodes.new("ShaderNodeTexCoord")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.0
    paper = (*[min(1.0, c * 1.02) for c in bg_linear], 1.0)
    brick.inputs["Color1"].default_value = paper
    brick.inputs["Color2"].default_value = paper
    brick.inputs["Mortar"].default_value = (0.775, 0.775, 0.795, 1.0)
    brick.inputs["Scale"].default_value = 1.0 / cell
    brick.inputs["Brick Width"].default_value = 1.0
    brick.inputs["Row Height"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = line
    brick.inputs["Mortar Smooth"].default_value = 0.15
    nt.links.new(coord.outputs["Object"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], dif.inputs["Color"])
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    if hasattr(gm, "surface_render_method"):
        gm.surface_render_method = "BLENDED"
    if hasattr(gm, "blend_method"):
        gm.blend_method = "BLEND"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "DIVIDE"
    mx.inputs[1].default_value = fw * 0.5 + 1.6 * (fw / 9.7)
    nt.links.new(sep.outputs["X"], mx.inputs[0])
    ybias = nt.nodes.new("ShaderNodeMath"); ybias.operation = "SUBTRACT"
    ybias.inputs[1].default_value = float(os.environ.get("GRID_BACK", back if back is not None else 1.9))
    nt.links.new(sep.outputs["Y"], ybias.inputs[0])
    my = nt.nodes.new("ShaderNodeMath"); my.operation = "DIVIDE"
    my.inputs[1].default_value = fd * 0.5 + float(os.environ.get("GRID_DEPTH", depth_pad if depth_pad is not None else 0.4))
    nt.links.new(ybias.outputs[0], my.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(mx.outputs[0], comb.inputs["X"])
    nt.links.new(my.outputs[0], comb.inputs["Y"])
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    nt.links.new(comb.outputs["Vector"], ln.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.66
    mr.inputs["From Max"].default_value = 1.0
    mr.clamp = True
    nt.links.new(ln.outputs["Value"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    mixsh = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ramp.outputs["Color"], mixsh.inputs["Fac"])
    nt.links.new(dif.outputs["BSDF"], mixsh.inputs[1])
    nt.links.new(clear.outputs["BSDF"], mixsh.inputs[2])
    nt.links.new(mixsh.outputs["Shader"], out.inputs["Surface"])
    floor.data.materials.append(gm)
    return floor


def build_lights_and_world(center, span, accents=()):
    """The teaser's three-point rig — a warm sun key, a broad cool fill, a
    high rim — and its world: flat white for diffuse rays, a vertical
    gradient for glossy ones. `accents` adds coloured area lights on top,
    (name, hex colour, energy, (dx, dy, dz) from the centre as shares of
    `span`) — DIMO's pink rim and blue fill."""
    scene = bpy.context.scene
    sd = bpy.data.lights.new("Key", type="SUN")
    sd.energy = float(os.environ.get("KEY_ENERGY", 1.85))
    sd.angle = math.radians(4.5)
    sd.color = (1.0, 0.985, 0.96)
    sun = bpy.data.objects.new("Key", sd)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((1.15, 0.85, -1.7)).normalized().to_track_quat("-Z", "Y").to_euler()

    # The teaser's energies are for its ~10 m stage; an area light's irradiance
    # falls with distance squared, so a stage a tenth the size (the ducks)
    # takes a hundredth of the watts or it blows out to white.
    scale = (span / 9.7) ** 2

    def area(name, color, energy, size, size_y, loc):
        d = bpy.data.lights.new(name, type="AREA")
        d.shape = "RECTANGLE"
        d.size, d.size_y, d.energy, d.color = size, size_y * min(1.0, span / 9.7), energy * scale, color
        o = bpy.data.objects.new(name, d)
        scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (center - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        return o

    lift = span / 9.7   # the teaser's heights, as shares of its stage
    area("Fill", (0.95, 0.97, 1.0), float(os.environ.get("FILL_ENERGY", 130)), span * 0.9, 6.0,
         (center.x - span * 0.35, center.y - span * 0.5, center.z + 3.0 * lift))
    area("Rim", (1.0, 0.99, 0.97), float(os.environ.get("RIM_ENERGY", 190)), span * 0.8, 4.0,
         (center.x + span * 0.2, center.y + span * 0.55, center.z + 5.0 * lift))
    for name, hex_color, energy, (dx, dy, dz) in accents:
        area(name, srgb_to_linear(hex_color), energy, span * 0.5, 3.0,
             (center.x + dx * span, center.y + dy * span, center.z + dz * span))

    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    wt = world.node_tree
    for nd in list(wt.nodes):
        wt.nodes.remove(nd)
    w_out = wt.nodes.new("ShaderNodeOutputWorld")
    bg = wt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 0.6
    lp = wt.nodes.new("ShaderNodeLightPath")
    geo = wt.nodes.new("ShaderNodeNewGeometry")
    sep = wt.nodes.new("ShaderNodeSeparateXYZ")
    wt.links.new(geo.outputs["Incoming"], sep.inputs["Vector"])
    mr = wt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = float(os.environ.get("GRAD_LOW", 0.32))
    mr.inputs["To Max"].default_value = float(os.environ.get("GRAD_HIGH", 1.35))
    wt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    bg_glossy = wt.nodes.new("ShaderNodeBackground")
    bg_glossy.inputs["Color"].default_value = (1.0, 0.995, 0.985, 1.0)
    wt.links.new(mr.outputs["Result"], bg_glossy.inputs["Strength"])
    mix = wt.nodes.new("ShaderNodeMixShader")
    wt.links.new(lp.outputs["Is Glossy Ray"], mix.inputs["Fac"])
    wt.links.new(bg.outputs["Background"], mix.inputs[1])
    wt.links.new(bg_glossy.outputs["Background"], mix.inputs[2])
    wt.links.new(mix.outputs["Shader"], w_out.inputs["Surface"])


def fit_camera(center, boxes, elev_ratio, fill_h, fill_v, azim_deg=0.0, lens=50.0, sensor=36.0, vfov_deg=None):
    """Fit the camera to the clip envelopes as they PROJECT, not to the floor:
    a still can be cropped afterwards, a video cannot. With the direction
    fixed (azimuth, and elevation as height over horizontal distance), the
    distance is solved by bisection so every envelope corner sits within
    fill_h of the width and fill_v of the height — above 1 lets the envelope
    overflow, as the live thumbnails' pad does. `vfov_deg` sets a vertical
    field of view instead of the lens (the DIMO lab's 22°)."""
    from bpy_extras.object_utils import world_to_camera_view as w2c
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    if vfov_deg is not None:
        cam_data.sensor_fit = "VERTICAL"
        cam_data.sensor_height = sensor
        cam_data.lens = (sensor / 2) / math.tan(math.radians(vfov_deg) / 2)
    else:
        cam_data.lens = lens
        cam_data.sensor_width = sensor
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    azim = math.radians(azim_deg)
    sin_a, cos_a = math.sin(azim), math.cos(azim)
    corners = [Vector((x, y, z)) for lo, hi in boxes for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]

    def place(dist):
        cam.location = (center.x + sin_a * dist, center.y - cos_a * dist, center.z + dist * elev_ratio)
        cam.rotation_euler = (center - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()

    def overflow(dist):
        place(dist)
        us = [w2c(scene, cam, c) for c in corners]
        w = max(abs(u.x - 0.5) for u in us) * 2 / fill_h
        h = max(abs(u.y - 0.5) for u in us) * 2 / fill_v
        return max(w, h)

    lo, hi = 0.2, 80.0
    for _ in range(48):
        mid = (lo + hi) / 2
        if overflow(mid) > 1:
            lo = mid
        else:
            hi = mid
    place(hi)
    log(f"camera dist {hi:.2f}")
    return cam, hi


def configure_render(res_x, res_y, samples, fps=30):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    for attr, val in (("use_raytracing", True), ("shadow_ray_count", 4), ("shadow_step_count", 16),
                      ("use_shadows", True), ("use_volumetric_shadows", False)):
        if hasattr(scene.eevee, attr):
            try:
                setattr(scene.eevee, attr, val)
            except Exception:
                pass
    rt = getattr(scene.eevee, "ray_tracing_options", None)
    if rt is not None:
        for attr, val in (("use_denoise", True), ("resolution_scale", "1"),
                          ("screen_trace_quality", 0.5), ("trace_max_roughness", 1.0)):
            if hasattr(rt, attr):
                try:
                    setattr(rt, attr, val)
                except Exception:
                    pass
    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = samples
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"


def render_frames(frames, out_dir, prefix):
    scene = bpy.context.scene
    for f in frames:
        scene.frame_set(f)
        scene.render.filepath = os.path.join(out_dir, f"{prefix}_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
