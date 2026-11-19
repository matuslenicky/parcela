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
    elif a == '--q': OPT['q'] = float(argv[i + 1]); i += 1
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
    'logwall': ('#9a6b47', .85), 'roof2': ('#5a4a3f', .75), 'pitch': ('#78b860', .95), 'labeldark': ('#2b2118', .6),
    'paved': ('#cfcbc0', .85), 'shrub': ('#3f7f45', .95), 'stone': ('#9a9a94', .9), 'poolrim': ('#e6e8e7', .6), 'poolwater': ('#4fb4dc', .08),
    'pingpong': ('#2f5fb5', .5), 'tramp': ('#22262a', .7),
}
for k_, v_ in D.get('pal', {}).items(): PAL[k_] = (v_, PAL.get(k_, ('', .9))[1])     # kemp si môže farby povrchov upraviť
def M(n):
    if n.startswith('#'): return mat('c_' + n, n, .8)                               # farba zadaná priamo v camp.json
    c, r = PAL[n]; return mat('m_' + n, c, r)
def mix(h1, h2, t):
    a = [int(h1.lstrip('#')[k:k + 2], 16) for k in (0, 2, 4)]; b = [int(h2.lstrip('#')[k:k + 2], 16) for k in (0, 2, 4)]
    return '#%02x%02x%02x' % tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))
LAWN = D.get('parcelStyle') == 'lawn'      # parcely ako trávnik s jemným odtieňom a farebným obrysom namiesto farebných dosiek
for t, info in D['types'].items():
    mat('m_type_' + t, mix(PAL['inside'][0], info['color'], .3) if LAWN else info['color'], .9)
    mat('m_edge_' + t, info['color'], .8)

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
        for m in s.mats: me.materials.append(M(m) if not m.startswith(('type_', 'edge_')) else MATS['m_' + m])
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
G = max(90, max(x1 - x0, y1 - y0) * 1.1)  # extra meadow around the map so the oblique camera never sees the void
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

for li, lk in enumerate(D.get('lakes', [])):
    mb = MB(); mb.flat([P(p) for p in lk['pts']], 0.056 + li * 0.002, 'water'); mb.obj('jazero ' + lk.get('name', ''), C_GROUND)

# bazény: obruba a hladina; kruhový bazén má stred a polomer
for pl in D.get('pools', []):
    pts = [P(p) for p in pl['pts']] if 'pts' in pl else [(P(pl['c'])[0] + math.cos(2 * math.pi * k / 28) * pl['r'] / S, P(pl['c'])[1] + math.sin(2 * math.pi * k / 28) * pl['r'] / S) for k in range(28)]
    cx_ = sum(p[0] for p in pts) / len(pts); cy_ = sum(p[1] for p in pts) / len(pts); rim = pl.get('rim', 0.25)
    mb = MB(); mb.prism(pts, 0.0, rim, 'poolrim')
    mb.flat([(cx_ + (x - cx_) * (1 - 0.3 / max(1.0, math.hypot(x - cx_, y - cy_))), cy_ + (y - cy_) * (1 - 0.3 / max(1.0, math.hypot(x - cx_, y - cy_)))) for x, y in pts], rim + 0.006, 'poolwater')
    mb.obj('bazen ' + pl.get('name', ''), C_ROADS)

# ---------------------------------------------------------------- areas, roads
for ai, a in enumerate(D.get('areas', [])):
    mb = MB(); kind = a['kind']
    z = {'meadow': 0.03, 'asphalt': 0.05, 'play': 0.04, 'gravel': 0.04, 'pitch': 0.04, 'paved': 0.045, 'sand': 0.04}.get(kind, 0.03) + ai * 0.0007   # prekrývajúce sa plochy v jednej výške kreslí Cycles čierno
    mb.flat([P(p) for p in a['pts']], z, kind if kind in PAL else 'meadow')
    if kind == 'pitch':  # biele čiary: obrys, stredová čiara
        apts = [P(p) for p in a['pts']]
        for q in ribbon(apts, 0.14, True):
            mb.face([mb.bm.verts.new((v.x, v.y, z + 0.006)) for v in q], 'line')
        if len(apts) == 4:
            m1 = ((apts[0][0] + apts[3][0]) / 2, (apts[0][1] + apts[3][1]) / 2); m2 = ((apts[1][0] + apts[2][0]) / 2, (apts[1][1] + apts[2][1]) / 2)
            for q in ribbon([m1, m2], 0.14):
                mb.face([mb.bm.verts.new((v.x, v.y, z + 0.006)) for v in q], 'line')
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

# živé ploty a múriky z camp.json (lomená čiara, šírka v px, výška v m), kríky medzi parcelami, kamenné kruhy ohnísk
if D.get('hedges'):
    mb = MB()
    for hg in D['hedges']:
        for q in ribbon([P(p) for p in hg['pts']], hg['w'] / S):
            mb.prism([(v.x, v.y) for v in q], 0.0, hg.get('h', 1.2), hg.get('mat', 'hedge'))
    mb.obj('ziva ploty kempu', C_GREEN)
if D.get('shrubs'):
    mb = MB(); mi_s = mb.mi('shrub')
    for sx, sy, sr in D['shrubs']:
        mx, my = P((sx, sy)); r_ = sr / S; before = set(mb.bm.faces)
        bmesh.ops.create_icosphere(mb.bm, subdivisions=1, radius=r_, matrix=Matrix.Translation((mx, my, r_ * 0.95)) @ Matrix.Diagonal((1, 1, 1.25, 1)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_s
    mb.obj('kriky', C_GREEN)
for k, rg in enumerate(D.get('rings', [])):
    mb = MB(); c_ = P(rg[:2]); r_ = rg[2] / S
    mb.prism([(c_[0] + math.cos(2 * math.pi * q / 14) * r_, c_[1] + math.sin(2 * math.pi * q / 14) * r_) for q in range(14)], 0.0, 0.32, 'stone', 'trunk')
    mb.obj('ohnisko %d' % k, C_PROPS)

for k, bx in enumerate(D.get('boxes', [])):
    mb = MB(); mb.prism(rect(P(bx['c']), bx['w'] / S, bx['d'] / S, bx.get('ang', 0)), bx.get('z', 0.0), bx['height'], bx.get('mat', 'wood'))
    mb.obj('plosina %d' % k, C_PROPS)

# ---------------------------------------------------------------- buildings
def house(c, w, d, hgt, ang, wall='wall', roof='roof', windows=True, eave=None, flat=False):
    """Dom so sedlovou strechou nad dlhšou stranou; c, w, d v metroch. eave = výška odkvapu, flat = plochá strecha. Vráti MB."""
    wall_h = eave if eave else hgt * 0.62
    mb = MB()
    if flat:
        mb.prism(rect(c, w, d, ang), 0.0, hgt, wall, roof)
        if windows:
            a_ = -math.radians(ang); ca_, sa_ = math.cos(a_), math.sin(a_)
            p1 = (c[0] + (-0.5) * ca_ - (-d / 2 - 0.03) * sa_, c[1] + (-0.5) * sa_ + (-d / 2 - 0.03) * ca_); p2 = (c[0] + 0.5 * ca_ - (-d / 2 - 0.03) * sa_, c[1] + 0.5 * sa_ + (-d / 2 - 0.03) * ca_)
            mb.face([mb.bm.verts.new((p1[0], p1[1], 0.02)), mb.bm.verts.new((p2[0], p2[1], 0.02)), mb.bm.verts.new((p2[0], p2[1], min(2.05, hgt - 0.2))), mb.bm.verts.new((p1[0], p1[1], min(2.05, hgt - 0.2)))], 'door')
        return mb
    mb.prism(rect(c, w, d, ang), 0.0, wall_h, wall)
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
        mb.face(v, roof); mb.face(v[::-1], roof)
    # gable ends
    if w >= d:
        for sx in (-w / 2, w / 2):
            p1, p2, p3 = rot(sx, -d / 2), rot(sx, d / 2), rot(sx, 0)
            v = [mb.bm.verts.new((p1[0], p1[1], wall_h)), mb.bm.verts.new((p2[0], p2[1], wall_h)), mb.bm.verts.new((p3[0], p3[1], zr - 0.1))]
            mb.face(v, wall); mb.face(v[::-1], wall)
    else:
        for sy in (-d / 2, d / 2):
            p1, p2, p3 = rot(-w / 2, sy), rot(w / 2, sy), rot(0, sy)
            v = [mb.bm.verts.new((p1[0], p1[1], wall_h)), mb.bm.verts.new((p2[0], p2[1], wall_h)), mb.bm.verts.new((p3[0], p3[1], zr - 0.1))]
            mb.face(v, wall); mb.face(v[::-1], wall)
    if windows:  # door and two windows on the south face
        for dx, wdt, z0, z1, m in ((-w * 0.22, 1.0, 0.0, 2.05, 'door'), (w * 0.12, 1.1, 1.0, 1.9, 'window'), (w * 0.32, 1.1, 1.0, 1.9, 'window')):
            p1, p2 = rot(dx - wdt / 2, -d / 2 - 0.03), rot(dx + wdt / 2, -d / 2 - 0.03)
            mb.face([mb.bm.verts.new((p1[0], p1[1], z0 + 0.02)), mb.bm.verts.new((p2[0], p2[1], z0 + 0.02)),
                     mb.bm.verts.new((p2[0], p2[1], z1)), mb.bm.verts.new((p1[0], p1[1], z1))], m)
    return mb

for b in D.get('buildings', []):
    rtype = b.get('roof') if b.get('roof') in ('flat', 'gable') else None        # staršie kempy majú v "roof" názov materiálu
    if b.get('poly'):                                                            # presný obrys (okolité budovy z OSM): hranol s plochou strechou
        mb = MB(); mb.prism([P(p) for p in b['pts']], 0.0, b['height'], b.get('wallc') or 'wall', b.get('roofc') or 'roof'); mb.obj('budova ' + b['name'], C_BUILD); continue
    house(P(b['c']), b['w'] / S, b['d'] / S, b['height'], b.get('ang', 0), b.get('wallc') or b.get('wall', 'wall'), b.get('roofc') or (b.get('roof', 'roof') if not rtype else 'roof'),
          b.get('windows', True), b.get('eave'), rtype == 'flat').obj('budova ' + b['name'], C_BUILD)

# ---------------------------------------------------------------- parcels + labels
font_mat = M('label')
for pi, p in enumerate(D['parcels']):
    c = P(p['c']); w = p['w'] / S; h = p['h'] / S; t = p['t']
    mb = MB()
    corners = rect(c, w, h, p['ang'])
    # susedné parcely sa na odčítanom pláne často o pár px prekrývajú: rovnako vysoké koplanárne plochy kreslí Cycles
    # čierno, preto má každá parcela vlastnú výšku (o 1 mm vyššie než predchádzajúca), štítok ide nad ňu
    top = (0.075 if p.get('flat') else 0.09) + pi * 0.001
    if p.get('flat'):
        mb.flat(corners, top, 'type_' + t)
        if LAWN:
            for q in ribbon(corners, 0.16, True): mb.face([mb.bm.verts.new((v.x, v.y, top + 0.004)) for v in q], 'edge_' + t)
    else:
        mb.prism(corners, 0.0, top, 'type_' + t)
    ob = mb.obj('parcela ' + p['id'], C_PARC)
    ob['parcel_id'] = p['id']; ob['parcel_type'] = t
    unit = D['types'].get(t, {}).get('unit', 'parcel')
    a_ = -math.radians(p['ang']); ca_, sa_ = math.cos(a_), math.sin(a_)
    def off(dx, dy): return (c[0] + dx * ca_ - dy * sa_, c[1] + dx * sa_ + dy * ca_)
    lc = c; lmat = font_mat
    if unit == 'cabin':  # zrubová chatka v zadnej časti pozemku, číslo vpredu (kamera sa pozerá od juhu)
        cw, cd, chh = D['types'][t].get('cabin', [4.4, 3.6, 3.4])
        house(off(0, h * 0.17), cw, cd, chh, p['ang'], 'logwall', 'roof2').obj('chatka ' + p['id'], C_BUILD)
        lc = off(0, -h * 0.29); lmat = M('labeldark')
    elif unit == 'zone':
        lc = off(-w * 0.3, 0)
    cu = bpy.data.curves.new('txt_' + p['id'], 'FONT'); cu.body = p['id']
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.02
    if unit == 'cabin': cu.size = min(w / (0.62 * len(p['id']) + 0.5), h * 0.34)
    elif unit == 'zone': cu.size = h * 0.38
    else: cu.size = min(w / (0.62 * len(p['id']) + 0.6), h * 0.32) if (LAWN or not p.get('flat')) else h * 0.55
    cu.font = bpy.data.fonts.load('C:/Windows/Fonts/arialbd.ttf', check_existing=True) if os.path.exists('C:/Windows/Fonts/arialbd.ttf') else cu.font
    to = bpy.data.objects.new('stitok ' + p['id'], cu); to.data.materials.append(lmat)
    to.location = (lc[0], lc[1], top + (0.03 if not p.get('flat') else 0.025))
    to.rotation_euler = (0, 0, -math.radians(p['ang']))
    link(to, C_PARC)

# ---------------------------------------------------------------- greenery
# one mesh object per tree kind keeps the scene light
buckets = {}
def bucket(kind):
    if kind not in buckets: buckets[kind] = MB()
    return buckets[kind]
def put_tree(x, y, r, kind, hh=None):
    mb = bucket(kind)
    if kind == 'pine':
        h = hh or r * 3.4
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
        zc = max(r * 0.95, hh - r * 0.85) if hh else r * 2.0     # stred koruny; pri známej výške stromu siaha koruna presne po ňu
        bmesh.ops.create_cone(mb.bm, cap_ends=True, segments=7, radius1=min(0.3, r * 0.2), radius2=min(0.22, r * 0.15), depth=zc, matrix=Matrix.Translation((x, y, zc / 2)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_t
        before = set(mb.bm.faces)
        bmesh.ops.create_icosphere(mb.bm, subdivisions=2, radius=r, matrix=Matrix.Translation((x, y, zc)) @ Matrix.Diagonal((1, 1, 0.85 if not hh else min(1.25, max(0.7, (hh - zc) / (r * 0.85) * 0.85)), 1)))
        for f in set(mb.bm.faces) - before: f.material_index = mi_l

for tr_ in D.get('trees', []):         # [x, y, polomer koruny px, výška m (nepovinná), druh (nepovinný: pine)]
    x, y, r = tr_[:3]; mx, my = P((x, y)); hh_ = tr_[3] if len(tr_) > 3 else None; kd = tr_[4] if len(tr_) > 4 else None
    if hh_: put_tree(mx, my, max(0.6, r / S), kd or random.choice(['leaf1', 'leaf2', 'leaf3']), hh_)
    else: put_tree(mx, my, max(1.6, r / S * 0.9), random.choice(['leaf1', 'leaf2', 'leaf3']))
for cf in D.get('conifers', []):
    mx, my = P((cf[0], cf[1])); put_tree(mx, my, cf[2] if len(cf) > 2 else random.uniform(1.5, 2.3), 'pine')
tr = D.get('treeRow')
if tr:
    a = Vector(tr['from']); b = Vector(tr['to']); n = int((b - a).length / tr['step'])
    for k in range(n + 1):
        p = a + (b - a) * (k / max(1, n)); jx = random.uniform(-1, 1) * tr['jitter']; jy = random.uniform(-1, 1) * tr['jitter']
        mx, my = P((p.x + jx, p.y + jy)); put_tree(mx, my, random.uniform(1.4, 2.1), 'pine' if k % 3 else random.choice(['leaf1', 'leaf3']))
def inside(pt, poly):
    x, y = pt; c = False; n = len(poly)
    for k in range(n):
        x1, y1 = poly[k]; x2, y2 = poly[(k + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
fo = D.get('forest')
if fo:  # dense forest around a camp that sits in a clearing
    exb = D['extent']; placed = 0; tries = 0
    while placed < fo['count'] and tries < fo['count'] * 20:
        tries += 1
        px_ = random.uniform(exb[0] - 60, exb[2] + 60); py_ = random.uniform(exb[1] - 60, exb[3] + 60)
        if inside((px_, py_), D['boundary']): continue
        mx, my = P((px_, py_)); placed += 1
        put_tree(mx, my, random.uniform(1.8, 3.0), 'pine' if random.random() < 0.55 else random.choice(['leaf1', 'leaf2', 'leaf3']))
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
# autá, karavany a obytné autá sú modely z kempy/models (presné rozmery výrobcu); prop môže mať "model" a "color", inak sa striedajú
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models'))
import shell as kit, car as carmod, camper, gear
kit.SET['q'] = OPT.get('q', 0.5)
MODELS = {c['id']: c for f in ('cars.json', 'campers.json') for c in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', f), encoding='utf-8'))}
GEAR = {c['id']: c for c in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'gear.json'), encoding='utf-8'))}
TENTS = ['darwin3', 'vail4', 'bizon3', 'arpenaz41', 'q2seconds', 'tent6']
DEFAULT = {'car': ['octaviacombi', 'kodiaq', 'golf', 'duster', 'passat', 'touran', 'fabia', 'x5'], 'caravan': ['hobby495', 'troll530', 'hobby720'],
           'motorhome': ['sunlightt58', 'caradoa464', 'summit600', 'california']}
CAR_COLORS = ['#2f4a3c', '#8d9399', '#27384f', '#7b1f24', '#e9e9e6', '#1d1f22', '#3f5f7a', '#b9b29f']
BUILT = {}; COUNT = {}
def vehicle(kind, pr, k):
    n = COUNT.get(kind, 0); COUNT[kind] = n + 1
    mid = pr.get('model') or DEFAULT[kind][n % len(DEFAULT[kind])]
    spec = dict(MODELS[mid])
    if pr.get('color'): spec['color'] = pr['color']
    elif spec.get('cat') not in ('caravan', 'motorhome', 'campervan', 'van', 'minibus'): spec['color'] = CAR_COLORS[n % len(CAR_COLORS)]
    key = (mid, spec.get('color'))
    if key not in BUILT:
        root, parts = (camper.build(spec) if 'body' not in spec else carmod.build_car(spec))
        for o in [root] + parts:
            for cl in list(o.users_collection): cl.objects.unlink(o)
            C_PROPS.objects.link(o)
        BUILT[key] = (root, parts)
    else:                                               # ďalší kus toho istého modelu zdieľa sieť
        r0, p0 = BUILT[key]; root = r0.copy(); C_PROPS.objects.link(root); parts = []
        for o in p0:
            o2 = o.copy(); o2.parent = root; C_PROPS.objects.link(o2); parts.append(o2)
    root.name = 'vozidlo %s %d %s' % (kind, k, mid)
    x, y = P(pr['c']); root.location = (x, y, 0); root.rotation_euler = (0, 0, -math.radians(pr.get('ang', 0)))
    pr['model'] = mid
    # život pri karavane a obytnom aute: každé druhé má vysunutú markízu a pod ňou stôl (prop môže určiť "awning": true/false)
    if kind in ('caravan', 'motorhome') and pr.get('awning', n % 2 == 0):
        Wv = spec['W'] / 1000; Hv = spec['H'] / 1000; aw = GEAR['f45s350' if (spec.get('Lbody') or spec.get('L')) > 5200 else 'f45s260']
        col = gear.FABRICS[(n * 2 + 3) % len(gear.FABRICS)]
        o = gear.build(aw, color=col, name='vozidlo markiza %d' % k, zwall=Hv - .28, y0=-Wv / 2, kit=kind == 'caravan'); place(o, pr)
        t = gear.build(GEAR['set4'], color=col, name='vozidlo stol %d' % k); place(t, pr, (0, -(Wv / 2 + aw['parts']['extension'] / 2000 + .1)))
def place(o, pr, off=(0, 0)):
    for cl in list(o.users_collection): cl.objects.unlink(o)
    C_PROPS.objects.link(o)
    a = -math.radians(pr.get('ang', 0)); x, y = P(pr['c'])
    o.location = (x + off[0] * math.cos(a) - off[1] * math.sin(a), y + off[0] * math.sin(a) + off[1] * math.cos(a), 0); o.rotation_euler = (0, 0, a)
NT = 0
for k, pr in enumerate(D.get('props', [])):
    if pr['kind'] in DEFAULT: vehicle(pr['kind'], pr, k)
    elif pr['kind'] == 'tent' and (pr.get('model') or TENTS[NT % len(TENTS)]) in GEAR:
        mid = pr.get('model') or TENTS[NT % len(TENTS)]; pr['model'] = mid
        place(gear.build(GEAR[mid], color=pr.get('color') or gear.FABRICS[NT % len(gear.FABRICS)], name='vozidlo stan %d %s' % (k, mid)), pr); NT += 1
    else: prop(pr['kind'], P(pr['c']), pr.get('ang', 0)).obj('%s %d' % (pr['kind'], k), C_PROPS)
json.dump([{'kind': p['kind'], 'model': p.get('model')} for p in D.get('props', [])], open(os.path.join(CAMP, 'props.models.json'), 'w'))

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
