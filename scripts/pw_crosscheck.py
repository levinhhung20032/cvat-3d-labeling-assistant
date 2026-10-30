"""Sinh cảnh tổng hợp và nhãn mặt đất của Patchwork++ GỐC (pypatchworkpp) để test/patchwork.test.ts đối chiếu bản TypeScript.
Chạy: pip install pypatchworkpp numpy && python scripts/pw_crosscheck.py   (chỉ dữ liệu tự tạo, không dùng dữ liệu thật)."""
import json, os
import numpy as np
import pypatchworkpp

H = 1.7  # gốc toạ độ nằm trên mặt đường, lidar cao H: bản gốc cần gốc ở lidar nên dời z xuống H
rng = np.random.default_rng(7)


def scene(slope=0.0, car=None, wall=False):
    n = 30000
    rad = 3 + 67 * rng.random(n)
    th = 2 * np.pi * rng.random(n)
    x, y = rad * np.cos(th), rad * np.sin(th)
    z = slope * x + (rng.random(n) - 0.5) * 0.02
    if car:
        keep = ~((np.abs(x - car[0]) < 2.4) & (np.abs(y - car[1]) < 1.1))
        x, y, z = x[keep], y[keep], z[keep]
    parts = [np.c_[x, y, z]]
    if car:
        m = 900
        parts.append(np.c_[car[0] + (rng.random(m) - 0.5) * 4.5, car[1] + (rng.random(m) - 0.5) * 1.8, 0.3 + rng.random(m) * 1.3])
    if wall:
        m = 1500
        parts.append(np.c_[6 + (rng.random(m) - 0.5) * 0.05, -10 + rng.random(m) * 20, rng.random(m) * 2.5])
    return np.round(np.vstack(parts), 3).astype(np.float32)


out = {}
for name, kw in {'flat': {}, 'slope5': {'slope': float(np.tan(np.radians(5)))}, 'car': {'car': (10, 0)}, 'wall': {'wall': True}}.items():
    pts = scene(**kw)
    p = pypatchworkpp.Parameters()
    p.sensor_height = H
    p.enable_RNR = False
    pp = pypatchworkpp.patchworkpp(p)
    cloud = np.c_[pts[:, 0], pts[:, 1], pts[:, 2] - H, np.ones(len(pts), dtype=np.float32)].astype(np.float32)
    for _ in range(3):  # bản gốc học ngưỡng qua các frame: cho cùng một cảnh chạy 3 lần như bản TS trong test
        pp.estimateGround(cloud)
    g = {tuple(np.round(r[:3], 3)) for r in pp.getGround()}
    label = [1 if tuple(np.round([a, b, c - H], 3)) in g else 0 for a, b, c in pts]
    out[name] = {'xyz': pts.reshape(-1).tolist(), 'ground': label}
    print(name, len(pts), 'ground', sum(label))
os.makedirs('test/fixtures', exist_ok=True)
json.dump(out, open('test/fixtures/pw_scenes.json', 'w'), separators=(',', ':'))
