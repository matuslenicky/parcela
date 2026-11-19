# Spoločná stavebnica 3D modelov vozidiel pre Blender (importuje ju car.py a ďalšie generátory).
#
# Princíp:
#   1. Shell = hladká karoséria ako rad priečnych rezov (polovičný rez = lomená čiara so zaoblenými rohmi) pozdĺž vozidla.
#      Tvar je daný funkciami (bočný profil, pôdorys, rezy), takže rozmery sedia presne a povrch sa dá kedykoľvek „odčítať“.
#   2. Detail = ostré prvky (okná, svetlá, maska, škáry dverí, lišty) nakreslené ako 2D tvary v bočnom, hornom, prednom
#      alebo zadnom pohľade a premietnuté na povrch karosérie s malým odstupom. Tvar prvku nezávisí od siete karosérie.
#   3. Kolesá, zrkadlá a lišty sú samostatná geometria.
# Súradnice: d = vzdialenosť od predku (0 … L), y = od osi doľava/doprava, z = výška. Vo svete je predok v smere +X.
import bpy, bmesh, math
from bisect import bisect_right
from mathutils import Vector, Matrix
from mathutils.geometry import delaunay_2d_cdt


SET = {'q': 1.0}      # podrobnosť siete: 1 = samostatný model, okolo 0.5 = vozidlo v scéne kempu

def clamp(v, a=0.0, b=1.0): return a if v < a else b if v > b else v
def lerp(a, b, t): return a + (b - a) * t
def smooth(t): t = clamp(t); return t * t * (3 - 2 * t)
def sstep(a, b, x): return smooth((x - a) / (b - a)) if b != a else (1.0 if x >= a else 0.0)
def sup(t, n=2.4):
    """Štvrtina superelipsy: 0 → 0, 1 → 1, pri malom t rýchly nábeh (tupé čelo so zaobleným rohom)."""
    t = clamp(t); return (1 - (1 - t) ** n) ** (1 / n)


# ---------------------------------------------------------------- materiály
def srgb(h):
    h = h.lstrip('#'); c = [int(h[k:k + 2], 16) / 255 for k in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]

MATDEF = {  # názov: (farba, drsnosť, kov, lak, žiara)
    'sklo': ('#0b1013', .04, 0.0, 1.0, 0), 'sklo svetle': ('#3a4a52', .05, 0.0, 1.0, 0), 'lesk cierny': ('#08090a', .12, 0.0, 1.0, 0),
    'plast': ('#1b1d1f', .72, 0.0, 0, 0), 'plast svetly': ('#3a3d40', .7, 0.0, 0, 0), 'skara': ('#060607', .7, 0.0, 0, 0),
    'podbeh': ('#0b0c0d', .95, 0.0, 0, 0), 'chrom': ('#e3e6e8', .12, 1.0, 0, 0), 'hlinik': ('#b9bdc1', .34, 1.0, 0, 0),
    'svetlo puzdro': ('#23272b', .2, .8, 1.0, 0), 'svetlo sklo': ('#dfe6ea', .05, .3, 1.0, 0), 'led biela': ('#ffffff', .2, 0.0, 0, 2.2),
    'led oranzova': ('#ff9a1f', .3, 0.0, 0, .8), 'svetlo zadne': ('#8f0a12', .12, .2, 1.0, .25), 'led cervena': ('#ff1e22', .25, 0.0, 0, 1.6),
    'odrazka': ('#b0121a', .25, 0.0, 1.0, 0), 'spz': ('#f2f3f1', .5, 0.0, 0, 0), 'spz text': ('#17191b', .5, 0.0, 0, 0), 'spz modra': ('#1d4fa3', .5, 0.0, 0, 0),
    'guma': ('#141414', .9, 0.0, 0, 0), 'disk': ('#c7cace', .26, 1.0, 0, 0), 'disk tmavy': ('#25272a', .45, .7, 0, 0), 'brzda': ('#4d5053', .5, .9, 0, 0),
    'zrkadlo': ('#9fb0ba', .03, 1.0, 0, 0),
    'sokel': ('#b9bdc0', .55, 0.0, 0, 0), 'grafika': ('#56606a', .5, 0.0, 0, 0), 'grafika 2': ('#9aa3ab', .5, 0.0, 0, 0), 'ram': ('#27292b', .5, .6, 0, 0),
    'okno ram': ('#1a1c1e', .45, 0.0, 0, 0), 'plast biely': ('#e2e3e1', .55, 0.0, 0, 0),
}

def M(name, hexc=None, rough=.5, metal=0.0, coat=0.0, emit=0.0):
    m = bpy.data.materials.get(name)
    if m: return m
    if hexc is None: hexc, rough, metal, coat, emit = MATDEF[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(hexc); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = 0.05
    if emit:
        b.inputs['Emission Color'].default_value = srgb(hexc); b.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = srgb(hexc)
    return m

def paint(hexc):
    return M('lak ' + hexc, hexc, rough=.38, metal=.45, coat=1.0)


# ---------------------------------------------------------------- 2D krivky
def _corner(p, a, b, cut):
    la = math.hypot(a[0] - p[0], a[1] - p[1]); lb = math.hypot(b[0] - p[0], b[1] - p[1])
    ca = min(cut, la * .5); cb = min(cut, lb * .5)
    s = (p[0] + (a[0] - p[0]) * ca / la, p[1] + (a[1] - p[1]) * ca / la) if la > 1e-9 else (p[0], p[1])
    e = (p[0] + (b[0] - p[0]) * cb / lb, p[1] + (b[1] - p[1]) * cb / lb) if lb > 1e-9 else (p[0], p[1])
    return s, e

def _bez(s, c, e, nc):
    return [((1 - k / nc) ** 2 * s[0] + 2 * (1 - k / nc) * (k / nc) * c[0] + (k / nc) ** 2 * e[0],
             (1 - k / nc) ** 2 * s[1] + 2 * (1 - k / nc) * (k / nc) * c[1] + (k / nc) ** 2 * e[1]) for k in range(nc + 1)]

def fillet(ctrl, nc=3, ns=None):
    """Otvorená lomená čiara [(a, b, zaoblenie)] → body. Počet bodov závisí len od nc a ns, nie od tvaru (rezy sa dajú spájať)."""
    n = len(ctrl); ends = []
    for i, c in enumerate(ctrl):
        cut = c[2] if len(c) > 2 else 0
        if i == 0 or i == n - 1 or cut <= 0: ends.append(((c[0], c[1]), (c[0], c[1]), None)); continue
        s, e = _corner(c, ctrl[i - 1], ctrl[i + 1], cut); ends.append((s, e, (c[0], c[1])))
    out = []
    for i in range(n):
        s, e, c = ends[i]
        out += [s] if c is None else _bez(s, c, e, nc)
        if i < n - 1 and ns:
            p1 = ends[i + 1][0]
            out += [(lerp(e[0], p1[0], k / ns[i]), lerp(e[1], p1[1], k / ns[i])) for k in range(1, ns[i])]
    return out

def fillet_rows(cuts, nc, ns):
    """Index prvého bodu každého riadiaceho bodu vo výstupe fillet()."""
    idx = []; k = 0
    for i, c in enumerate(cuts):
        idx.append(k); k += 1 if (i == 0 or i == len(cuts) - 1 or not c) else nc + 1
        if i < len(cuts) - 1: k += ns[i] - 1
    return idx

def round_poly(pts, r=0.0, nc=4):
    """Uzavretý mnohouholník so zaoblenými rohmi; bod môže mať vlastné zaoblenie (a, b, r)."""
    n = len(pts); out = []
    for i, p in enumerate(pts):
        cut = p[2] if len(p) > 2 else r
        if cut <= 0: out.append((p[0], p[1])); continue
        s, e = _corner(p, pts[i - 1], pts[(i + 1) % n], cut); out += _bez(s, p, e, nc)
    return out

def resample(pts, step, closed=True):
    out = []; n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = pts[i], pts[(i + 1) % n]; k = max(1, int(math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step)))
        out += [(lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)) for j in range(k)]
    if not closed: out.append((pts[-1][0], pts[-1][1]))
    return out

def inside(p, poly):
    x, y = p; c = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i][0], poly[i][1]; xj, yj = poly[j][0], poly[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c

def hspan(poly, b):
    """Rozsah a, v ktorom vodorovná čiara vo výške b pretína mnohouholník."""
    xs = [p[0] + (q[0] - p[0]) * (b - p[1]) / (q[1] - p[1]) for p, q in zip(poly, poly[1:] + poly[:1]) if (p[1] > b) != (q[1] > b)]
    return (min(xs), max(xs)) if xs else None

def vspan(poly, a):
    ys = [p[1] + (q[1] - p[1]) * (a - p[0]) / (q[0] - p[0]) for p, q in zip(poly, poly[1:] + poly[:1]) if (p[0] > a) != (q[0] > a)]
    return (min(ys), max(ys)) if ys else None

def rect(a0, b0, a1, b1, r=0.0):
    return round_poly([(a0, b0), (a1, b0), (a1, b1), (a0, b1)], min(r, abs(a1 - a0) / 2, abs(b1 - b0) / 2))

def circle(a, b, r, n=20, sa=1.0, sb=1.0):
    return [(a + r * sa * math.cos(2 * math.pi * k / n), b + r * sb * math.sin(2 * math.pi * k / n)) for k in range(n)]

def band(x0, x1, lo, hi, step=0.04, inset=0.0, r=0.0):
    """Tvar medzi krivkami lo(x) a hi(x) na úseku x0 … x1 (okno medzi pásom a hranou strechy), voliteľne zmenšený a zaoblený."""
    n = max(2, int(math.ceil((x1 - x0) / step))); xs = [lerp(x0 + inset, x1 - inset, k / n) for k in range(n + 1)]
    xs = [x for x in xs if hi(x) - lo(x) > 2 * inset + 0.012]
    if len(xs) < 2: return []
    bot = [(x, lo(x) + inset) for x in xs]; top = [(x, hi(x) - inset) for x in reversed(xs)]
    poly = bot + top
    if r > 0:   # zaobliť len skutočné rohy (konce dolnej a hornej hrany)
        k = len(bot); poly = [(p[0], p[1], r if i in (0, k - 1, k, len(poly) - 1) else 0) for i, p in enumerate(poly)]
        poly = round_poly(poly, 0, 5)
    return poly

class Curve:
    """z = f(x) z bodov s rastúcim x."""
    def __init__(self, pts): self.x = [p[0] for p in pts]; self.y = [p[1] for p in pts]
    def __call__(self, x):
        X = self.x
        if x <= X[0]: return self.y[0]
        if x >= X[-1]: return self.y[-1]
        i = bisect_right(X, x) - 1; x0, x1 = X[i], X[i + 1]
        return self.y[i] if x1 <= x0 else lerp(self.y[i], self.y[i + 1], (x - x0) / (x1 - x0))

def profile(ctrl, nc=12): return Curve(fillet(ctrl, nc))


# ---------------------------------------------------------------- karoséria
class Shell:
    def __init__(self, L, ctrl, nc, ns):
        self.L = L; self.ctrl = ctrl; self.nc = nc; self.ns = ns; self._sec = {}; self._pos = {}

    def sec(self, d):
        k = round(clamp(d, 0, self.L), 4); s = self._sec.get(k)
        if s is None: s = self._sec[k] = fillet(self.ctrl(k), self.nc, self.ns)
        return s

    def side_y(self, d, z):                     # polovičná šírka vo výške z (0 = mimo karosérie)
        p = self.sec(d)
        for i in range(len(p) - 1):
            z0, z1 = p[i][1], p[i + 1][1]
            if z1 > z0 and z0 <= z <= z1: return lerp(p[i][0], p[i + 1][0], (z - z0) / (z1 - z0))
        return 0.0

    def top_z(self, d, y):                      # výška horného povrchu vo vzdialenosti y od osi
        p = self.sec(d); y = abs(y)
        for i in range(len(p) - 1, 0, -1):
            y0, y1 = p[i][0], p[i - 1][0]
            if y1 < y0 - 1e-7: return p[i][1]   # za najširším miestom
            if y1 > y0 and y0 <= y <= y1: return lerp(p[i][1], p[i - 1][1], (y - y0) / (y1 - y0))
        return p[0][1]

    def _end_d(self, y, z, front, reach=1.6):
        lo, hi = (0.0, min(reach, self.L / 2)) if front else (self.L, max(self.L - reach, self.L / 2))
        y = max(y, 1e-5)                         # v osi auta by „mimo karosérie“ (šírka 0) vyzeralo ako vnútri
        if self.side_y(hi, z) < y: return hi
        for _ in range(17):
            m = (lo + hi) / 2
            if self.side_y(m, z) >= y: hi = m
            else: lo = m
        return hi
    def front_d(self, y, z): return self._end_d(abs(y), z, True)
    def rear_d(self, y, z): return self._end_d(abs(y), z, False)

    def build(self, name, xs, mats, face_mat):
        bm = bmesh.new(); rings = []
        for d in xs:
            p = self.sec(d); X = self.L / 2 - d
            rings.append([bm.verts.new((X, y, z)) for y, z in p] + [bm.verts.new((X, -y, z)) for y, z in reversed(p[1:-1])])
        NP = len(self.sec(xs[0])); N = len(rings[0])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for j in range(N):
                f = bm.faces.new((a[j], b[j], b[(j + 1) % N], a[(j + 1) % N]))
                f.material_index = face_mat(j if j < NP - 1 else N - 1 - j, (xs[i] + xs[i + 1]) / 2); f.smooth = True
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for m in mats: me.materials.append(m)
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        return ob


def cut_cylinders(ob, cuts, mat):
    """Vyreže do karosérie valce pozdĺž osi y: [(X, y stred, z, polomer, hĺbka)] (podbehy)."""
    bpy.context.view_layer.objects.active = ob
    for X, y, z, r, depth in cuts:
        cm = bpy.data.meshes.new('rez'); cb = bmesh.new()
        bmesh.ops.create_cone(cb, cap_ends=True, segments=56, radius1=r, radius2=r, depth=depth,
                              matrix=Matrix.Translation((X, y, z)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
        cb.to_mesh(cm); cb.free(); cm.materials.append(mat)
        co = bpy.data.objects.new('rez', cm); bpy.context.scene.collection.objects.link(co)
        md = ob.modifiers.new('podbeh', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = co; md.solver = 'EXACT'; md.material_mode = 'TRANSFER'
        bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.data.objects.remove(co); bpy.data.meshes.remove(cm)


def shade(me, angle=40):
    for p in me.polygons: p.use_smooth = True
    try: me.set_sharp_from_angle(angle=math.radians(angle))
    except Exception: pass


# ---------------------------------------------------------------- detaily premietnuté na karosériu
REF = {'top': Vector((0, 0, 1)), 'front': Vector((1, 0, 0)), 'rear': Vector((-1, 0, 0))}

class Detail:
    def __init__(self, shell):
        self.sh = shell; self.bm = bmesh.new(); self.mats = []; self._c = {}

    def mi(self, name):
        if name not in self.mats: self.mats.append(name)
        return self.mats.index(name)

    def raw(self, kind, a, b, s=1):
        sh = self.sh
        if kind == 'side': return Vector((sh.L / 2 - a, s * sh.side_y(a, b), b))
        if kind == 'top': return Vector((sh.L / 2 - a, b, sh.top_z(a, b)))
        if kind == 'front': return Vector((sh.L / 2 - sh.front_d(a, b), a, b))
        return Vector((sh.L / 2 - sh.rear_d(a, b), a, b))

    def surf(self, kind, a, b, s=1):
        """Bod na povrchu a normála smerom von."""
        k = (kind, round(a, 4), round(b, 4), s); r = self._c.get(k)
        if r: return r
        ref = Vector((0, s, 0)) if kind == 'side' else REF[kind]; e = 0.012
        p = self.raw(kind, a, b, s)
        n = (self.raw(kind, a + e, b, s) - self.raw(kind, a - e, b, s)).cross(self.raw(kind, a, b + e, s) - self.raw(kind, a, b - e, s))
        if n.length < 1e-9: n = ref.copy()
        else:
            n.normalize()
            if n.dot(ref) < 0: n = -n
            if n.dot(ref) < 0.12: n = (n + ref * 0.35).normalized()
        r = self._c[k] = (p, n); return r

    def at(self, kind, a, b, off=0.0, s=1):
        p, n = self.surf(kind, a, b, s); return p + n * off

    def _variants(self, kind, mirror):
        if kind == 'side': return [(1, 1, 1), (1, 1, -1)] if mirror else [(1, 1, 1)]
        if not mirror: return [(1, 1, 1)]
        return [(1, 1, 1), (1, -1, 1)] if kind == 'top' else [(1, 1, 1), (-1, 1, 1)]

    def patch(self, kind, outline, off, mat, holes=(), step=0.07, mirror=False, s=None, skirt=0.0, skirt_mat=None):
        """Vyplnený tvar na povrchu. skirt = výška bočnej steny smerom ku karosérii (zdvihnuté prvky: svetlá, kľučky)."""
        if len(outline) < 3: return
        step = step / SET['q']
        loops = [resample(outline, step)] + [resample(h, step) for h in holes]
        pts = []; edges = []
        for lp in loops:
            b0 = len(pts); pts += lp; edges += [(b0 + i, b0 + (i + 1) % len(lp)) for i in range(len(lp))]
        a0 = min(p[0] for p in loops[0]); a1 = max(p[0] for p in loops[0]); b0_ = min(p[1] for p in loops[0]); b1 = max(p[1] for p in loops[0])
        na = int((a1 - a0) / step); nb = int((b1 - b0_) / step); nbound = len(pts)
        for i in range(1, na + 1):
            for j in range(1, nb + 1):
                q = (a0 + (a1 - a0) * i / (na + 1), b0_ + (b1 - b0_) * j / (nb + 1))
                if not inside(q, loops[0]) or any(inside(q, h) for h in loops[1:]): continue
                if min(math.hypot(q[0] - p[0], q[1] - p[1]) for p in pts[:nbound]) < step * 0.45: continue
                pts.append(q)
        res = delaunay_2d_cdt([Vector(p) for p in pts], edges, [], 0, 1e-7)
        vs = [(v.x, v.y) for v in res[0]]; tris = []
        for f in res[2]:
            c = (sum(vs[i][0] for i in f) / len(f), sum(vs[i][1] for i in f) / len(f))
            if inside(c, loops[0]) and not any(inside(c, h) for h in loops[1:]): tris.append(f)
        m = self.mi(mat); ms = self.mi(skirt_mat or mat)
        variants = self._variants(kind, mirror) if s is None else [(1, 1, s)]
        for fa, fb, sg in variants:
            sn = [self.surf(kind, v[0] * fa, v[1] * fb, sg) for v in vs]
            bv = [self.bm.verts.new(p + n * off) for p, n in sn]
            for f in tris:
                if any((sn[f[i]][0] - sn[f[i - 1]][0]).length > 3.5 * math.hypot(vs[f[i]][0] - vs[f[i - 1]][0], vs[f[i]][1] - vs[f[i - 1]][1]) + .01 for i in range(len(f))): continue   # mimo povrchu
                n = sum((sn[i][1] for i in f), Vector()); a, b, c = [bv[i].co for i in f[:3]]
                idx = list(f) if (b - a).cross(c - a).dot(n) >= 0 else list(reversed(f))
                try: fc = self.bm.faces.new([bv[i] for i in idx]); fc.material_index = m; fc.smooth = True
                except ValueError: pass
            if skirt > 0:
                for lp_i, lp in enumerate(loops):
                    base = sum(len(l) for l in loops[:lp_i]); n_ = len(lp)
                    low = [self.bm.verts.new(sn[base + i][0] + sn[base + i][1] * (off - skirt)) for i in range(n_)]
                    for i in range(n_):
                        j = (i + 1) % n_
                        try: fc = self.bm.faces.new((bv[base + i], bv[base + j], low[j], low[i])); fc.material_index = ms; fc.smooth = False
                        except ValueError: pass

    def strip(self, kind, line, width, off, mat, mirror=False, s=None, step=0.035, closed=False):
        """Pás danej šírky pozdĺž čiary (škáry, lišty, stierače)."""
        pts = resample(line, step / SET['q'], closed); n = len(pts)
        if n < 2: return
        L, R = [], []
        for i, p in enumerate(pts):
            a = pts[i - 1] if (i > 0 or closed) else p; b = pts[(i + 1) % n] if (i < n - 1 or closed) else p
            tx, ty = b[0] - a[0], b[1] - a[1]; l = math.hypot(tx, ty) or 1.0; nx, ny = -ty / l * width / 2, tx / l * width / 2
            L.append((p[0] + nx, p[1] + ny)); R.append((p[0] - nx, p[1] - ny))
        m = self.mi(mat)
        variants = self._variants(kind, mirror) if s is None else [(1, 1, s)]
        for fa, fb, sg in variants:
            vl = [self.bm.verts.new(self.at(kind, p[0] * fa, p[1] * fb, off, sg)) for p in L]
            vr = [self.bm.verts.new(self.at(kind, p[0] * fa, p[1] * fb, off, sg)) for p in R]
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                try: fc = self.bm.faces.new((vl[i], vl[j], vr[j], vr[i])); fc.material_index = m; fc.smooth = True
                except ValueError: pass

    # ---- voľná geometria (vo svetových súradniciach)
    def box(self, c, size, mat, rot=None, bevel=0.0):
        g = bmesh.ops.create_cube(self.bm, size=1.0, matrix=Matrix.Translation(c) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((size[0], size[1], size[2], 1)))
        m = self.mi(mat); fs = set()
        for v in g['verts']:
            for f in v.link_faces: fs.add(f)
        for f in fs: f.material_index = m
        if bevel > 0:
            es = list({e for f in fs for e in f.edges})
            r = bmesh.ops.bevel(self.bm, geom=es, offset=bevel, segments=2, affect='EDGES', profile=0.5)
            for f in r['faces']: f.material_index = m; f.smooth = True

    def blob(self, c, r, mat, e=2.5, seg=14, rings=8, rot=None, zmin=None):
        """Superelipsoid (zaoblený kváder): puzdrá zrkadiel, anténa."""
        m = self.mi(mat); f = lambda t: math.copysign(abs(t) ** (2 / e), t); rows = []
        for i in range(rings + 1):
            ph = -math.pi / 2 + math.pi * i / rings; row = []
            for j in range(seg):
                th = 2 * math.pi * j / seg
                v = Vector((r[0] * f(math.cos(ph)) * f(math.cos(th)), r[1] * f(math.cos(ph)) * f(math.sin(th)), r[2] * f(math.sin(ph))))
                if zmin is not None: v.z = max(v.z, zmin)
                if rot: v = rot @ v
                row.append(self.bm.verts.new(Vector(c) + v))
            rows.append(row)
        for i in range(rings):
            for j in range(seg):
                try: fc = self.bm.faces.new((rows[i][j], rows[i][(j + 1) % seg], rows[i + 1][(j + 1) % seg], rows[i + 1][j])); fc.material_index = m; fc.smooth = True
                except ValueError: pass

    def sweep(self, path, prof, mat, cap=True):
        """Profil [(do boku, hore)] ťahaný po dráhe (strešné lišty)."""
        m = self.mi(mat); rings = []; n = len(path)
        for i, p in enumerate(path):
            t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized(); side = t.cross(Vector((0, 0, 1))).normalized(); up = side.cross(t)
            rings.append([self.bm.verts.new(p + side * u + up * v) for u, v in prof])
        k = len(prof)
        for i in range(n - 1):
            for j in range(k):
                fc = self.bm.faces.new((rings[i][j], rings[i][(j + 1) % k], rings[i + 1][(j + 1) % k], rings[i + 1][j])); fc.material_index = m; fc.smooth = True
        if cap:
            for r in (rings[0], rings[-1]):
                try: fc = self.bm.faces.new(r); fc.material_index = m
                except ValueError: pass

    def finish(self, name):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        me = bpy.data.meshes.new(name); self.bm.normal_update(); self.bm.to_mesh(me); self.bm.free()
        for n in self.mats: me.materials.append(M(n) if n in MATDEF or bpy.data.materials.get(n) else M(n, '#ff00ff'))
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- koleso
def wheel_mesh(name, R, rim_r, tw, spokes=5, twin=True):
    """Koleso s osou y, vonkajšia strana v smere +y, stred v počiatku."""
    old = bpy.data.meshes.get(name)
    if old: return old
    bm = bmesh.new(); st = max(24, int(48 * SET['q'])); h = tw / 2; sw = R - rim_r; k = min(1.0, sw / 0.12)
    mats = ['guma', 'disk', 'disk tmavy', 'brzda']
    def P(r, th, a): return (r * math.cos(th), a, r * math.sin(th))
    def revolve(prof, mi, smooth_=True):
        rr = [[bm.verts.new(P(r, 2 * math.pi * q / st, a)) for r, a in prof] for q in range(st)]
        for q in range(st):
            A, B = rr[q], rr[(q + 1) % st]
            for j in range(len(prof) - 1):
                f = bm.faces.new((A[j], B[j], B[j + 1], A[j + 1])); f.material_index = mi; f.smooth = smooth_
    rl = rim_r + 0.006
    tyre = [(rl, -h + .014), (rl + .028 * k, -h), (lerp(rim_r, R, .52), -h - .007), (R - .04 * k, -h + .004), (R - .014 * k, -h + .022), (R, -h + .05),
            (R, h - .05), (R - .014 * k, h - .022), (R - .04 * k, h - .004), (lerp(rim_r, R, .52), h + .007), (rl + .028 * k, h), (rl, h - .014)]
    revolve(tyre, 0)
    revolve([(rl, h - .014), (rim_r - .008, h - .01), (rim_r - .02, h - .03)], 1)                    # lem ráfika
    revolve([(rim_r - .02, h - .03), (rim_r - .03, -h + .03), (0.0001, -h + .03)], 2)                 # vnútro ráfika a zadná stena
    ab = h - .095
    revolve([(rim_r * .66, ab - .02), (rim_r * .66, ab), (rim_r * .30, ab)], 3, False)                # brzdový kotúč
    revolve([(.075, ab), (.075, h - .046), (.058, h - .036), (0.0001, h - .036)], 1)                  # náboj
    ang = []
    for q in range(spokes):
        base = 2 * math.pi * q / spokes + math.pi / 2
        ang += [base - .2, base + .2] if twin else [base]
    for a0 in ang:                                                                                    # lúče
        r0, r1 = .06, rim_r - .014; w0, w1 = (.027, .021) if twin else (.04, .03); af0, af1 = h - .05, h - .024; th = .03
        def Q(r, wdt, a): c, s = math.cos(a0), math.sin(a0); return (r * c - wdt * s, a, r * s + wdt * c)
        v = [bm.verts.new(Q(*t)) for t in [(r0, -w0, af0), (r0, w0, af0), (r1, w1, af1), (r1, -w1, af1), (r0, -w0, af0 - th), (r0, w0, af0 - th), (r1, w1, af1 - th), (r1, -w1, af1 - th)]]
        for idx in [(0, 1, 2, 3), (1, 5, 6, 2), (4, 0, 3, 7), (5, 4, 7, 6)]:
            f = bm.faces.new([v[i] for i in idx]); f.material_index = 1
    bm.normal_update(); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for n in mats: me.materials.append(M(n))
    shade(me, 50)
    return me

def tyre_dims(spec):
    """'215/65 R17' → (polomer kolesa, polomer ráfika, šírka pneumatiky) v metroch."""
    w, ar, rim = [float(x) for x in spec.upper().replace('R', ' ').replace('/', ' ').split()[:3]]
    return (rim * 25.4 + 2 * w * ar / 100) / 2000, rim * 25.4 / 2000, w / 1000
