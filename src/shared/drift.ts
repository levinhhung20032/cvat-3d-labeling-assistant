import { stateAt } from './interp';
import type { CvatTrack } from './types';

/**
 * Cảnh báo "trôi box": box ĐỨNG YÊN THEO EGO trong khi xe đang chạy, tức là box đi theo xe thay vì ở lại chỗ vật đứng yên.
 * Toạ độ trong từng frame là theo ego nên vật đứng yên ngoài đường đổi toạ độ đúng bằng quãng xe đi; toạ độ của một box mà không đổi
 * (giữ nguyên giữa hai keyframe trùng nhau, hoặc "giữ" sau keyframe cuối) khi xe đang chạy nghĩa là box không bám vật.
 * Chỉ so toạ độ ego của hai frame liền nhau, không ước lượng chuyển động ego rồi quy về toạ độ thế giới (không RANSAC, không cộng dồn):
 * mỗi cặp frame chỉ tính trung vị bước nhích của các object khác để biết xe có đang chạy không.
 * Không bắt được box nhích chậm quanh vị trí đúng (cần biết chính xác chuyển động ego). Box "không đổi" phải trùng khớp hoàn toàn (x, y, z, yaw):
 * trôi thật là box bị giữ nguyên (sau keyframe cuối hoặc trước keyframe outside) nên các số y hệt nhau.
 * Vật chạy cùng vận tốc với xe (xe đi cùng chiều, giữ khoảng cách) thì box giữ nguyên vẫn bám vật: `dropSupported` bỏ các frame đầu của
 * chuỗi khi trong box còn đủ điểm (đếm điểm do bước kiểm tra "ít điểm" của tool làm sẵn cho mọi object × frame).
 */
export interface DriftConfig {
  holdTol: number; // m: bước (x, y) và độ cao z giữa hai frame liền nhau không quá mức này thì coi là toạ độ không đổi
  holdYaw: number; // rad: góc yaw đổi không quá mức này thì coi là không đổi
  egoMin: number; // m: xe coi là đang chạy ở một cặp frame khi bước trung vị của các object đang nhích ≥ mức này
  minMovers: number; // số object đang nhích (bước > holdTol) tối thiểu ở cặp frame đó để tin ước lượng xe đang chạy
  minHold: number; // số frame liên tiếp (kể cả frame đầu) toạ độ không đổi tối thiểu để báo
  supportMin: number; // số điểm trong box tối thiểu (và tối thiểu supportRatio × số điểm ở frame neo) để coi box còn bám vật
  supportRatio: number;
}
export const DEFAULT_DRIFT: DriftConfig = { holdTol: 0.005, holdYaw: 0.01, egoMin: 0.3, minMovers: 3, minHold: 3, supportMin: 6, supportRatio: 0.5 };

/** dist: quãng xe đã đi (m, tích lũy từ lúc box bắt đầu đứng yên theo ego) tới frame f; from: frame neo của chuỗi (frame cuối còn nhích). */
export interface DriftFrame { f: number; dist: number; from: number }
export interface DriftInfo { num: number; frames: DriftFrame[] }

const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };

/**
 * Với mỗi object trả các frame mà toạ độ ego của box không đổi (≤ holdTol) so với frame liền trước trong khi xe đang chạy, nếu chuỗi
 * như vậy dài ≥ minHold frame (frame đầu chuỗi là điểm box còn nhích, không bị báo). Chuỗi đứt khi box vắng mặt, khi frame không liền
 * nhau hoặc khi box nhích trở lại.
 */
export function findDrift(tracks: CvatTrack[], frames: number[], cfg: DriftConfig = DEFAULT_DRIFT): Map<number, DriftInfo> {
  const sorted = [...frames].sort((x, y) => x - y);
  const out = new Map<number, DriftInfo>();
  const open = new Map<number, { f: number; dist: number; from: number }[]>(); // object → chuỗi đang chạy (phần tử đầu = frame neo, dist 0)
  const warn = new Map<number, DriftFrame[]>();
  const flush = (i: number) => {
    const run = open.get(i);
    open.delete(i);
    if (run && run.length >= cfg.minHold) warn.set(i, [...(warn.get(i) ?? []), ...run.slice(1)]);
  };
  let prev: Map<number, [number, number, number, number]> | null = null;
  let prevF = -Infinity;
  for (const f of sorted) {
    const cur = new Map<number, [number, number, number, number]>();
    tracks.forEach((t, i) => { const c = stateAt(t, f).cuboid; if (c) cur.set(i, [c.x, c.y, c.z, c.yaw]); });
    if (!prev || f !== prevF + 1) {
      for (const i of [...open.keys()]) flush(i);
    } else {
      // bước nhích của từng object giữa hai frame liền nhau; xe đang chạy nếu các object đang nhích có bước trung vị đủ lớn
      const step = new Map<number, number>(), same = new Set<number>();
      for (const [i, p] of cur) {
        const q = prev.get(i);
        if (!q) continue;
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        step.set(i, d);
        const dyaw = Math.abs(Math.atan2(Math.sin(p[3] - q[3]), Math.cos(p[3] - q[3])));
        if (d <= cfg.holdTol && Math.abs(p[2] - q[2]) <= cfg.holdTol && dyaw <= cfg.holdYaw) same.add(i);
      }
      const movers = [...step.values()].filter((d) => d > cfg.holdTol);
      const egoStep = movers.length >= cfg.minMovers ? median(movers) : 0;
      const egoMoves = egoStep >= cfg.egoMin;
      for (const i of tracks.keys()) {
        const frozen = same.has(i) && egoMoves;
        const run = open.get(i);
        if (frozen) {
          if (run) run.push({ f, dist: run[run.length - 1]!.dist + egoStep, from: run[0]!.f });
          else open.set(i, [{ f: prevF, dist: 0, from: prevF }, { f, dist: egoStep, from: prevF }]);
        } else if (run) flush(i);
      }
    }
    prev = cur;
    prevF = f;
  }
  for (const i of [...open.keys()]) flush(i);
  for (const [i, fs] of warn) if (fs.length) out.set(i + 1, { num: i + 1, frames: fs.sort((x, y) => x.f - y.f) });
  return out;
}

/**
 * Bỏ các frame ĐẦU của mỗi chuỗi trôi mà box vẫn còn bám vật: ở frame neo box có ≥ supportMin điểm (vật nhìn thấy rõ) và ở các frame
 * bị giữ vẫn còn ≥ max(supportMin, supportRatio × điểm ở neo) điểm, tức vật chạy cùng vận tốc với xe nên toạ độ ego không đổi là đúng.
 * Dừng bỏ ở frame đầu tiên không đủ điểm (hoặc chưa có số điểm); từ đó trở đi vẫn báo. Frame neo ít điểm (vật xa / thưa) thì không đủ
 * cơ sở để bỏ, giữ nguyên. `insideAt(f)`: số điểm trong box của object ở frame f (undefined: chưa tính).
 */
export function dropSupported(frames: DriftFrame[], insideAt: (f: number) => number | undefined, cfg: DriftConfig = DEFAULT_DRIFT): DriftFrame[] {
  const byFrom = new Map<number, DriftFrame[]>();
  for (const x of frames) byFrom.set(x.from, [...(byFrom.get(x.from) ?? []), x]);
  const out: DriftFrame[] = [];
  for (const [from, list] of byFrom) {
    list.sort((a, b) => a.f - b.f);
    const na = insideAt(from);
    let k = 0;
    if (na !== undefined && na >= cfg.supportMin) {
      const need = Math.max(cfg.supportMin, cfg.supportRatio * na);
      while (k < list.length) { const n = insideAt(list[k]!.f); if (n === undefined || n < need) break; k++; }
    }
    out.push(...list.slice(k));
  }
  return out.sort((a, b) => a.f - b.f);
}
