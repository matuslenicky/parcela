# Builds a 3D campsite in Blender from <camp dir>/camp.json and renders it.
#   blender -b --factory-startup -P kempy/build_camp.py -- kempy/<camp> [--samples 24] [--res 1600x1000] [--no-render]
# Output in the camp dir: camp.blend, camp.glb, render_3d.png (oblique), render_top.png (plan view).
# camp.json coordinates are pixels of the camp's own map image; pxPerM and origin convert them to metres
# (Blender x = east, y = north, so image y is flipped).
import bpy, bmesh, json, math, os, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
CAMP = os.path.abspath(argv[0])
OPT = {'samples': 24, 'res': '1600x1000', 'render': True}
i = 1
while i < len(argv):
    a = argv[i]
    if a == '--samples': OPT['samples'] = int(argv[i + 1]); i += 1
    elif a == '--res': OPT['res'] = argv[i + 1]; i += 1
    elif a == '--no-render': OPT['render'] = False
    i += 1
D = json.load(open(os.path.join(CAMP, 'camp.json'), encoding='utf-8'))
S = D['pxPerM']; OX, OY = D['origin']
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)

def P(p):  # image px -> metres
    return ((p[0] - OX) / S, -(p[1] - OY) / S)

def srgb(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[k:k + 2], 16) / 255 for k in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)

MATS = {}
def mat(name, hexc, rough=0.85, metal=0.0, emit=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(hexc)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = srgb(hexc); b.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = srgb(hexc)
    MATS[name] = m
    return m

PAL = {
    'outside': ('#86b46a', .95), 'inside': ('#9cc77c', .95), 'meadow': ('#a9cf86', .95), 'asphalt': ('#5b6066', .8),
    'gravel': ('#c8b48f', .95), 'water': ('#58b4e0', .12), 'bank': ('#7aa36a', .95), 'line': ('#f4f4f0', .6),
    'wall': ('#f4ecd8', .85), 'roof': ('#d9625a', .7), 'door': ('#6b5e55', .7), 'window': ('#3d5a6c', .15),
    'trunk': ('#7a5c45', .9), 'leaf1': ('#3f8f4f', .9), 'leaf2': ('#4f9e57', .9), 'leaf3': ('#357a45', .9), 'pine': ('#2f6e45', .9),
    'hedge': ('#4a8a4f', .95), 'play': ('#d9c49a', .95), 'white': ('#f5f5f2', .5), 'tent': ('#e8a33d', .8),
    'tent2': ('#4f8fbf', .8), 'car': ('#c94f4f', .45), 'car2': ('#5d7fa3', .45), 'glass': ('#2c3a44', .1), 'tyre': ('#2a2a2a', .9),
    'parcel_line': ('#ffffff', .6), 'label': ('#ffffff', .5), 'sand': ('#e9dcb8', .95), 'wood': ('#a07a55', .8),
}
def M(n): c, r = PAL[n]; return mat('m_' + n, c, r)
for t, info in D['types'].items():
    mat('m_type_' + t, info['color'], .9)

def link(obj, coll):
    coll.objects.link(obj); return obj
def new_coll(name):
    c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c

class MB:
    """Collects geometry with material names, then makes one mesh object."""
    def __init__(s): s.bm = bmesh.new(); s.mats = []
    def mi(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)
    def face(s, vs, m):
        try:
            f = s.bm.faces.new(vs); f.material_index = s.mi(m); return f
        except ValueError:
            return None
    def prism(s, pts, z0, z1, side, top=None):
        if area(pts) < 0: pts = pts[::-1]
        lo = [s.bm.verts.new((x, y, z0)) for x, y in pts]; hi = [s.bm.verts.new((x, y, z1)) for x, y in pts]
        n = len(pts)
        for k in range(n):
            j = (k + 1) % n; s.face([lo[k], lo[j], hi[j], hi[k]], side)
        s.face(hi, top or side)
    def flat(s, pts, z, m):
        if area(pts) < 0: pts = pts[::-1]
        s.face([s.bm.verts.new((x, y, z)) for x, y in pts], m)
    def obj(s, name, coll, smooth=False):
        me = bpy.data.meshes.new(name)
        s.bm.normal_update()
        for f in s.bm.faces:          # flat pieces must face the sky, otherwise Cycles shades them black
            if f.normal.z < -0.01 and f.calc_center_median().z > 0.001: f.normal_flip()
        s.bm.to_mesh(me); s.bm.free()
        for m in s.mats: me.materials.append(M(m) if not m.startswith('type_') else MATS['m_' + m])
        for p in me.polygons: p.use_smooth = smooth
        return link(bpy.data.objects.new(name, me), coll)

def area(pts):
    return sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts))) / 2

def ribbon(pts, w, closed=False):
    """Left/right offsets of a polyline (metres) with mitred joins; returns list of quads."""
    n = len(pts); L = []; R = []
    for k in range(n):
        p = Vector(pts[k])
        if closed or 0 < k < n - 1:
            a = Vector(pts[k - 1]) if (k > 0 or closed) else p
            b = Vector(pts[(k + 1) % n]) if (k < n - 1 or closed) else p
            d1 = (p - a).normalized(); d2 = (b - p).normalized()
            t = (d1 + d2); t = t.normalized() if t.length > 1e-6 else d1
            nrm = Vector((-t.y, t.x)); miter = w / 2 / max(0.35, nrm.dot(Vector((-d1.y, d1.x))))
        else:
            d = (Vector(pts[1]) - p).normalized() if k == 0 else (p - Vector(pts[k - 1])).normalized()
            nrm = Vector((-d.y, d.x)); miter = w / 2
        L.append(p + nrm * miter); R.append(p - nrm * miter)
    quads = []
    rng = range(n) if closed else range(n - 1)
    for k in rng:
        j = (k + 1) % n
        quads.append([R[k], R[j], L[j], L[k]])
    return quads

def rect(c, w, h, ang_deg):
    """Rectangle corners in metres; c in metres, w/h metres, ang in image degrees (clockwise)."""
    a = -math.radians(ang_deg); ca, sa = math.cos(a), math.sin(a)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((c[0] + dx * ca - dy * sa, c[1] + dx * sa + dy * ca))
    return out

def polyline_len_points(pts, step):
    """Yields (point, direction) every `step` metres along a polyline."""
    acc = 0.0
    for k in range(len(pts) - 1):
        a = Vector(pts[k]); b = Vector(pts[k + 1]); seg = (b - a); L = seg.length
        if L < 1e-6: continue
        d = seg / L; t = (step - acc) if acc > 0 else step / 2
        while t < L:
            yield a + d * t, d
            t += step
        acc = (acc + L) % step

# ---------------------------------------------------------------- scene reset
sc = bpy.context.scene
C_GROUND = new_coll('01 Teren'); C_ROADS = new_coll('02 Cesty a plochy'); C_BUILD = new_coll('03 Budovy')
C_PARC = new_coll('04 Parcely'); C_GREEN = new_coll('05 Zelen'); C_PROPS = new_coll('06 Vybavenie')

ex = D['extent']; x0, y1 = P((ex[0], ex[1])); x1, y0 = P((ex[2], ex[3]))
CX, CY = (x0 + x1) / 2, (y0 + y1) / 2

# ---------------------------------------------------------------- ground
mb = MB()
G = 90  # extra meadow around the map so the oblique camera never sees the void
mb.prism([(x0 - G, y0 - G), (x1 + G, y0 - G), (x1 + G, y1 + G), (x0 - G, y1 + G)], -1.0, 0.0, 'outside')
bnd = [P(p) for p in D['boundary']]
mb.flat(bnd, 0.012, 'inside')
mb.obj('teren', C_GROUND)

# water as a sunken ribbon with banks
for wtr in D.get('water', []):
    pts = [P(p) for p in wtr['pts']]; w = wtr['w'] / S
    mb = MB()
    for q in ribbon(pts, w + 1.2):
        mb.face([mb.bm.verts.new((v.x, v.y, 0.03)) for v in q], 'bank')
    for q in ribbon(pts, w):
        mb.face([mb.bm.verts.new((v.x, v.y, 0.05)) for v in q], 'water')
    mb.obj('voda ' + wtr.get('name', ''), C_GROUND)

for lk in D.get('lakes', []):
    mb = MB(); mb.flat([P(p) for p in lk['pts']], 0.05, 'water'); mb.obj('jazero', C_GROUND)

# ---------------------------------------------------------------- areas, roads
for a in D.get('areas', []):
    mb = MB(); kind = a['kind']
    z = {'meadow': 0.03, 'asphalt': 0.05, 'play': 0.04, 'gravel': 0.04}.get(kind, 0.03)
    mb.flat([P(p) for p in a['pts']], z, kind if kind in PAL else 'meadow')
    mb.obj('plocha ' + a['name'], C_ROADS)

for ri, r in enumerate(D.get('roads', [])):
    # each road a hair higher than the previous one: coplanar overlaps render as black patches in Cycles
    pts = [P(p) for p in r['pts']]; w = r['w'] / S; z = (0.06 if r['kind'] == 'asphalt' else 0.05) + ri * 0.003
    mb = MB()
    for q in ribbon(pts, w, r.get('closed', False)):
        mb.face([mb.bm.verts.new((v.x, v.y, z)) for v in q], r['kind'])
    if r.get('dash') and r['kind'] == 'asphalt':
        loop = pts + ([pts[0]] if r.get('closed') else [])
        for p, d in polyline_len_points(loop, 3.0):
            nrm = Vector((-d.y, d.x)) * 0.07; dd = d * 0.75
            q = [p - dd - nrm, p + dd - nrm, p + dd + nrm, p - dd + nrm]
            mb.face([mb.bm.verts.new((v.x, v.y, z + 0.01)) for v in q], 'line')
    mb.obj('cesta ' + r['name'], C_ROADS)

for rb in D.get('roundabouts', []):
    c = Vector(P(rb['c'])); r = rb['r'] / S; w = rb['w'] / S; n = 40
    mb = MB()
    ring_o = [c + Vector((math.cos(t), math.sin(t))) * (r + w / 2) for t in [2 * math.pi * k / n for k in range(n)]]
    ring_i = [c + Vector((math.cos(t), math.sin(t))) * (r - w / 2) for t in [2 * math.pi * k / n for k in range(n)]]
    for k in range(n):
        j = (k + 1) % n
        mb.face([mb.bm.verts.new((v.x, v.y, 0.065)) for v in (ring_i[k], ring_o[k], ring_o[j], ring_i[j])], 'asphalt')
    mb.prism([(v.x, v.y) for v in ring_i], 0.0, 0.18, 'white', 'meadow')
    mb.obj('kruhovy objazd', C_ROADS)

# ---------------------------------------------------------------- hedge along the boundary
if D.get('hedge', True):
    mb = MB()
    for q in ribbon(bnd, 0.7, True):
        pts2 = [(v.x, v.y) for v in q]
        mb.prism(pts2, 0.0, 0.9, 'hedge')
    mb.obj('ziva ploty', C_GREEN)

for k, bx in enumerate(D.get('boxes', [])):
    mb = MB(); mb.prism(rect(P(bx['c']), bx['w'] / S, bx['d'] / S, bx.get('ang', 0)), bx.get('z', 0.0), bx['height'], bx.get('mat', 'wood'))
    mb.obj('plosina %d' % k, C_PROPS)

# ---------------------------------------------------------------- buildings
for b in D.get('buildings', []):
    c = P(b['c']); w = b['w'] / S; d = b['d'] / S; hgt = b['height']; ang = b.get('ang', 0)
    wall_h = hgt * 0.62
    mb = MB()
    mb.prism(rect(c, w, d, ang), 0.0, wall_h, 'wall')
    # gable roof along the longer side
    a = -math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    def rot(dx, dy): return (c[0] + dx * ca - dy * sa, c[1] + dx * sa + dy * ca)
    ov = 0.45; hw, hd = w / 2 + ov, d / 2 + ov
    if w >= d:
        A = [rot(-hw, -hd), rot(hw, -hd), rot(hw, 0), rot(-hw, 0)]; B = [rot(-hw, hd), rot(hw, hd), rot(hw, 0), rot(-hw, 0)]
        ridge = [rot(-hw, 0), rot(hw, 0)]
    else:
        A = [rot(-hw, -hd), rot(-hw, hd), rot(0, hd), rot(0, -hd)]; B = [rot(hw, -hd), rot(hw, hd), rot(0, hd), rot(0, -hd)]
        ridge = [rot(0, -hd), rot(0, hd)]
    zr = hgt; ze = wall_h - 0.05
    for side in (A, B):
        v = [mb.bm.verts.new((side[0][0], side[0][1], ze)), mb.bm.verts.new((side[1][0], side[1][1], ze)),
             mb.bm.verts.new((side[2][0], side[2][1], zr)), mb.bm.verts.new((side[3][0], side[3][1], zr))]
        mb.face(v, 'roof'); mb.face(v[::-1], 'roof')
    # gable ends
    if w >= d:
        for sx in (-w / 2, w / 2):
            p1, p2, p3 = rot(sx, -d / 2), rot(sx, d / 2), rot(sx, 0)
            v = [mb.bm.verts.new((p1[0], p1[1], wall_h)), mb.bm.verts.new((p2[0], p2[1], wall_h)), mb.bm.verts.new((p3[0], p3[1], zr - 0.1))]
            mb.face(v, 'wall'); mb.face(v[::-1], 'wall')
    else:
        for sy in (-d / 2, d / 2):
            p1, p2, p3 = rot(-w / 2, sy), rot(w / 2, sy), rot(0, sy)
            v = [mb.bm.verts.new((p1[0], p1[1], wall_h)), mb.bm.verts.new((p2[0], p2[1], wall_h)), mb.bm.verts.new((p3[0], p3[1], zr - 0.1))]
            mb.face(v, 'wall'); mb.face(v[::-1], 'wall')
    # door and two windows on the south face
    for dx, wdt, z0, z1, m in ((-w * 0.22, 1.0, 0.0, 2.05, 'door'), (w * 0.12, 1.1, 1.0, 1.9, 'window'), (w * 0.32, 1.1, 1.0, 1.9, 'window')):
        p1, p2 = rot(dx - wdt / 2, -d / 2 - 0.03), rot(dx + wdt / 2, -d / 2 - 0.03)
        mb.face([mb.bm.verts.new((p1[0], p1[1], z0 + 0.02)), mb.bm.verts.new((p2[0], p2[1], z0 + 0.02)),
                 mb.bm.verts.new((p2[0], p2[1], z1)), mb.bm.verts.new((p1[0], p1[1], z1))], m)
    mb.obj('budova ' + b['name'], C_BUILD)

# ---------------------------------------------------------------- parcels + labels
font_mat = M('label')
for p in D['parcels']:
    c = P(p['c']); w = p['w'] / S; h = p['h'] / S; t = p['t']
    mb = MB()
    corners = rect(c, w, h, p['ang'])
    if p.get('flat'):
        mb.flat(corners, 0.075, 'type_' + t)
    else:
        mb.prism(corners, 0.0, 0.09, 'type_' + t)
    ob = mb.obj('parcela ' + p['id'], C_PARC)
    ob['parcel_id'] = p['id']; ob['parcel_type'] = t
    cu = bpy.data.curves.new('txt_' + p['id'], 'FONT'); cu.body = p['id']
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.size = min(w / (0.62 * len(p['id']) + 0.6), h * 0.32) if not p.get('flat') else h * 0.55; cu.extrude = 0.02
    cu.font = bpy.data.fonts.load('C:/Windows/Fonts/arialbd.ttf', check_existing=True) if os.path.exists('C:/Windows/Fonts/arialbd.ttf') else cu.font
    to = bpy.data.objects.new('stitok ' + p['id'], cu); to.data.materials.append(font_mat)
    to.location = (c[0], c[1], 0.12 if not p.get('flat') else 0.1)
    to.rotation_euler = (0, 0, -math.radians(p['ang']))
    link(to, C_PARC)

# ---------------------------------------------------------------- greenery
# one mesh object per tree kind keeps the scene light
buckets = {}
def bucket(kind):
    if kind not in buckets: buckets[kind] = MB()
    return buckets[kind]
def put_tree(x, y, r, kind):
    mb = bucket(kind)
    if kind == 'pine':
        h = r * 3.4
        mi_t, mi_l = mb.mi('trunk'), mb.mi('pine')
        before = set(mb.bm.faces)
        bmesh.ops.create_cone(mb.bm, cap_ends=True, segments=7, radius1=0.25, radius2=0.18, depth=h * 0.3, matrix=Matrix.Translation((x, y, h * 0.15)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_t
        before = set(mb.bm.faces)
        for rr, zz, hh in ((r, h * 0.42, h * 0.55), (r * 0.72, h * 0.66, h * 0.45), (r * 0.45, h * 0.86, h * 0.32)):
            bmesh.ops.create_cone(mb.bm, cap_ends=True, segments=8, radius1=rr, radius2=0.0, depth=hh, matrix=Matrix.Translation((x, y, zz)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_l
    else:
        leaf = kind
        mi_t, mi_l = mb.mi('trunk'), mb.mi(leaf)
        before = set(mb.bm.faces)
        bmesh.ops.create_cone(mb.bm, cap_ends=True, segments=7, radius1=0.3, radius2=0.22, depth=r * 1.3, matrix=Matrix.Translation((x, y, r * 0.65)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_t
        before = set(mb.bm.faces)
        bmesh.ops.create_icosphere(mb.bm, subdivisions=2, radius=r, matrix=Matrix.Translation((x, y, r * 2.0)) @ Matrix.Diagonal((1, 1, 0.85, 1)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_l

for x, y, r in D.get('trees', []):
    mx, my = P((x, y)); put_tree(mx, my, max(1.6, r / S * 0.9), random.choice(['leaf1', 'leaf2', 'leaf3']))
for x, y in D.get('conifers', []):
    mx, my = P((x, y)); put_tree(mx, my, random.uniform(1.4, 2.0), 'pine')
tr = D.get('treeRow')
if tr:
    a = Vector(tr['from']); b = Vector(tr['to']); n = int((b - a).length / tr['step'])
    for k in range(n + 1):
        p = a + (b - a) * (k / max(1, n)); jx = random.uniform(-1, 1) * tr['jitter']; jy = random.uniform(-1, 1) * tr['jitter']
        mx, my = P((p.x + jx, p.y + jy)); put_tree(mx, my, random.uniform(1.4, 2.1), 'pine' if k % 3 else random.choice(['leaf1', 'leaf3']))
for kind, mb in buckets.items():
    mb.obj('stromy ' + kind, C_GREEN)

# ---------------------------------------------------------------- props (caravans, tents, cars)
def prop(kind, c, ang):
    mb = MB(); a = ang
    if kind in ('caravan', 'motorhome'):
        L, W, H = (6.8, 2.4, 2.6) if kind == 'caravan' else (7.2, 2.35, 2.9)
        mb.prism(rect(c, L, W, a), 0.35, H, 'white')
        # window band
        band = rect(c, L + 0.02, W + 0.02, a)
        mb.prism(band, H * 0.62, H * 0.8, 'glass')
        for dx in (-L * 0.25, L * 0.25) if kind == 'motorhome' else (0,):
            pass
        if kind == 'motorhome':
            cab = rect((c[0] + math.cos(-math.radians(a)) * (L / 2 + 0.6), c[1] + math.sin(-math.radians(a)) * (L / 2 + 0.6)), 1.2, W * 0.96, a)
            mb.prism(cab, 0.35, 1.9, 'white')
    elif kind == 'car':
        mb.prism(rect(c, 4.5, 1.85, a), 0.3, 1.0, random.choice(['car', 'car2']))
        mb.prism(rect(c, 2.4, 1.7, a), 1.0, 1.5, 'glass')
    elif kind == 'tent':
        L, W, H = 3.2, 2.6, 1.6
        a_r = -math.radians(a); ca, sa = math.cos(a_r), math.sin(a_r)
        def rot(dx, dy): return (c[0] + dx * ca - dy * sa, c[1] + dx * sa + dy * ca)
        pA, pB, pC, pD = rot(-L / 2, -W / 2), rot(L / 2, -W / 2), rot(L / 2, W / 2), rot(-L / 2, W / 2)
        r1, r2 = rot(-L / 2, 0), rot(L / 2, 0)
        m = random.choice(['tent', 'tent2'])
        bm = mb.bm
        v = lambda p, z: bm.verts.new((p[0], p[1], z))
        mb.face([v(pA, .1), v(pB, .1), v(r2, H), v(r1, H)], m)
        mb.face([v(pD, .1), v(r1, H), v(r2, H), v(pC, .1)], m)
        mb.face([v(pA, .1), v(r1, H), v(pD, .1)], m)
        mb.face([v(pB, .1), v(pC, .1), v(r2, H)], m)
    return mb
for k, pr in enumerate(D.get('props', [])):
    prop(pr['kind'], P(pr['c']), pr.get('ang', 0)).obj('%s %d' % (pr['kind'], k), C_PROPS)

# ---------------------------------------------------------------- world, light, cameras
world = bpy.data.worlds.new('svet'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = srgb('#dfeaf2'); bg.inputs['Strength'].default_value = 0.9
sun_d = bpy.data.lights.new('slnko', 'SUN'); sun_d.energy = 3.6; sun_d.angle = math.radians(4)
sun = bpy.data.objects.new('slnko', sun_d); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), 0, math.radians(-35))

W_, H_ = [int(v) for v in OPT['res'].split('x')]
sc.render.resolution_x, sc.render.resolution_y = W_, H_
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'; sc.cycles.samples = OPT['samples']; sc.cycles.use_denoising = True
try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
sc.render.film_transparent = False
try: sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass

# camp extent (parcels + boundary) for framing
pts = bnd + [P(p['c']) for p in D['parcels']]
bx0 = min(p[0] for p in pts); bx1 = max(p[0] for p in pts); by0 = min(p[1] for p in pts); by1 = max(p[1] for p in pts)
mx_, my_ = (bx0 + bx1) / 2, (by0 + by1) / 2; span = max(bx1 - bx0, (by1 - by0) * W_ / H_)

cam_top_d = bpy.data.cameras.new('kamera hore'); cam_top_d.type = 'ORTHO'; cam_top_d.ortho_scale = span * 1.08
cam_top = bpy.data.objects.new('kamera hore', cam_top_d); sc.collection.objects.link(cam_top)
cam_top.location = (mx_, my_, 120); cam_top.rotation_euler = (0, 0, 0)

cam_d = bpy.data.cameras.new('kamera 3D'); cam_d.lens = 38; cam_d.clip_end = 2000
cam = bpy.data.objects.new('kamera 3D', cam_d); sc.collection.objects.link(cam)
CAM = D.get('camera', {})
dist = span * CAM.get('dist', 1.05)
tilt = math.radians(52)
cam.location = (mx_ + dist * CAM.get('offsetX', 0.28), my_ - dist * math.cos(tilt) * 1.02, dist * math.sin(tilt) * 0.82)
direction = Vector((mx_, my_ + (by1 - by0) * CAM.get('aimY', 0.02), 0)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CAMP, 'camp.blend'))
try:
    bpy.ops.export_scene.gltf(filepath=os.path.join(CAMP, 'camp.glb'), export_format='GLB', export_apply=True, export_cameras=False, export_lights=False)
except Exception as e:
    print('GLB export failed:', e)

if OPT['render']:
    for name, camobj in (('render_3d.png', cam), ('render_top.png', cam_top)):
        sc.camera = camobj
        sc.render.filepath = os.path.join(CAMP, name)
        bpy.ops.render.render(write_still=True)
        print('rendered', name)
print('DONE', CAMP)
