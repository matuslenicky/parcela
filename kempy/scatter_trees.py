# Rozmiestni stromy v areáli kempu mimo ciest, plôch, budov a parciel a zapíše ich do camp.json ("conifers").
#   python kempy/scatter_trees.py kempy/<slug> [--count 160] [--gap 15] [--seed 3]
# Rovnaké stromy potom kreslí 2D mapa ukážky (build-demo.js) aj Blender (build_camp.py), takže 2D a 3D sedia.
# Hustejší les v časti areálu: v camp.json "groves": [{"pts": [[x, y], ...], "count": 40, "gap": 9}].
import json, math, random, sys
from pathlib import Path

args = sys.argv[1:]
camp = Path(args[0]) / 'camp.json'
opt = {'count': 160, 'gap': 15.0, 'seed': 3}
for k in range(1, len(args) - 1):
    if args[k].startswith('--') and args[k][2:] in opt: opt[args[k][2:]] = type(opt[args[k][2:]])(args[k + 1])
D = json.loads(camp.read_text(encoding='utf-8'))
S = D['pxPerM']
random.seed(opt['seed'])

def inside(pt, poly):
    x, y = pt; c = False; n = len(poly)
    for k in range(n):
        x1, y1 = poly[k]; x2, y2 = poly[(k + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def rect_pts(c, w, h, ang):
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    return [(c[0] + dx * ca - dy * sa, c[1] + dx * sa + dy * ca) for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]

def grow(c, w, h, ang, m):  # obdĺžnik zväčšený o okraj m px
    return rect_pts(c, w + 2 * m, h + 2 * m, ang)

M = 2.0 * S  # odstup stromu od cesty, budovy a parcely: 2 m
blocked = []
for b in D.get('buildings', []): blocked.append(grow(b['c'], b['w'], b['d'], b.get('ang', 0), M))
for p in D.get('parcels', []): blocked.append(grow(p['c'], p['w'], p['h'], p.get('ang', 0), M * 0.8))
for bx in D.get('boxes', []): blocked.append(grow(bx['c'], bx['w'], bx['d'], bx.get('ang', 0), M))
areas = [a['pts'] for a in D.get('areas', []) if a['kind'] != 'meadow']
roads = [(r['pts'], r['w'] / 2 + M, r.get('closed', False)) for r in D.get('roads', [])]
water = [(w['pts'], w['w'] / 2 + M) for w in D.get('water', [])]

def free(pt, trees, gap):
    if not inside(pt, D['boundary']): return False
    if any(inside(pt, poly) for poly in blocked + areas): return False
    for pts, r, closed in roads:
        segs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if closed else [])
        if any(seg_dist(pt, a, b) < r for a, b in segs): return False
    for pts, r in water:
        if any(seg_dist(pt, a, b) < r for a, b in zip(pts, pts[1:])): return False
    return all(math.hypot(pt[0] - t[0], pt[1] - t[1]) >= gap for t in trees)

trees = []
for g in D.get('groves', []):
    xs = [p[0] for p in g['pts']]; ys = [p[1] for p in g['pts']]; n = 0; tries = 0
    while n < g['count'] and tries < g['count'] * 60:
        tries += 1
        pt = (random.uniform(min(xs), max(xs)), random.uniform(min(ys), max(ys)))
        if inside(pt, g['pts']) and free(pt, trees, g.get('gap', 9)): trees.append(pt); n += 1
ex = D['extent']; n = 0; tries = 0
while n < opt['count'] and tries < opt['count'] * 80:
    tries += 1
    pt = (random.uniform(ex[0], ex[2]), random.uniform(ex[1], ex[3]))
    if free(pt, trees, opt['gap']): trees.append(pt); n += 1
D['conifers'] = [[round(x, 1), round(y, 1)] for x, y in trees]
camp.write_text(json.dumps(D, ensure_ascii=False, indent=1), encoding='utf-8')
print('stromy:', len(trees), '(háje', len(trees) - n, ')')
