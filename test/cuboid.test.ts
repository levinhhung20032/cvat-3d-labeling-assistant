import { describe, expect, it } from 'vitest';
import { azimuthDeg, hasTilt, parseCuboid, serializeCuboid } from '../src/shared/cuboid';
import { parsePcd } from '../src/shared/pcd';

const pts = [-27.4, 20.7, 0.73, 0, 0, -1.22, 4.82, 1.97, 1.56, 0, 0, 0, 0, 0, 0, 0];

describe('cuboid points', () => {
  it('đọc rồi ghi lại không đổi', () => {
    expect(serializeCuboid(parseCuboid(pts), pts)).toEqual(pts);
  });
  it('ép rx, ry về 0 khi ghi', () => {
    const tilted = [...pts]; tilted[3] = 0.01; tilted[4] = -0.02;
    expect(hasTilt(tilted)).toBe(true);
    expect(serializeCuboid(parseCuboid(tilted), tilted).slice(3, 5)).toEqual([0, 0]);
  });
  it('từ chối độ dài sai', () => {
    expect(() => parseCuboid([1, 2, 3])).toThrow();
  });
  it('azimuth: trước 0°, trái +90°', () => {
    expect(azimuthDeg({ x: 5, y: 0 })).toBeCloseTo(0);
    expect(azimuthDeg({ x: 0, y: 5 })).toBeCloseTo(90);
  });
});

describe('parsePcd', () => {
  it('đọc PCD binary x y z rgb tổng hợp', () => {
    const header = 'VERSION 0.7\nFIELDS x y z rgb\nSIZE 4 4 4 4\nTYPE F F F U\nCOUNT 1 1 1 1\nWIDTH 2\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 2\nDATA binary\n';
    const h = new TextEncoder().encode(header);
    const buf = new ArrayBuffer(h.length + 32);
    new Uint8Array(buf).set(h);
    const dv = new DataView(buf, h.length);
    [[1, 2, 3, 7], [4, 5, 6, 9]].forEach((p, i) => {
      dv.setFloat32(i * 16, p[0]!, true); dv.setFloat32(i * 16 + 4, p[1]!, true);
      dv.setFloat32(i * 16 + 8, p[2]!, true); dv.setUint32(i * 16 + 12, p[3]!, true);
    });
    const pc = parsePcd(buf);
    expect(pc.count).toBe(2);
    expect(Array.from(pc.xyz)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(pc.rgb!)).toEqual([7, 9]);
  });
});
