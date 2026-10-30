import { useRef, useState } from 'react';
import type { CvatAnnotations } from '../shared/types';
import { comparePw, type CompareReport } from './pwCompareCalc';

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const cell: React.CSSProperties = { padding: '1px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/**
 * Bảng so sánh nguồn mặt đường cho lỗi G (cách cũ ↔ Patchwork++) trên các frame ĐÃ TẢI point cloud, của object đang xem hoặc cả job.
 * Chỉ số tổng hợp; danh sách cặp (object, frame) hai cách kết luận khác nhau, bấm để mở đúng frame.
 */
export function PwCompare({ ann, start, stop, num, onJump, onClose }: {
  ann: CvatAnnotations; start: number; stop: number; num: number;
  onJump: (num: number, f: number) => void; onClose: () => void;
}) {
  const [scope, setScope] = useState<'one' | 'job'>('one');
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [rep, setRep] = useState<CompareReport | null>(null);
  const ctl = useRef({ cancelled: false });
  const running = prog !== null;

  const run = async () => {
    ctl.current = { cancelled: false };
    setRep(null);
    setProg([0, 1]);
    const items = scope === 'one'
      ? (ann.tracks[num - 1] ? [{ num, track: ann.tracks[num - 1]! }] : [])
      : ann.tracks.map((track, i) => ({ num: i + 1, track }));
    try { setRep(await comparePw(items, start, stop, (d, t) => setProg([d, t]), ctl.current)); } finally { setProg(null); }
  };

  const row = (label: string, a: string | number, b: string | number, tip?: string) => (
    <tr title={tip}><td style={{ padding: '1px 8px' }}>{label}</td><td style={cell}>{a}</td><td style={cell}>{b}</td></tr>
  );

  return (
    <div style={{ margin: '0 0 6px', padding: '4px 8px', border: '1px solid #cfe0f5', background: '#f8fbff' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>⚖ So sánh nguồn mặt đường cho lỗi G</b>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'one' | 'job')} disabled={running}>
          <option value="one">object #{num}</option>
          <option value="job">cả job ({ann.tracks.length} object)</option>
        </select>
        {running
          ? <button onClick={() => { ctl.current.cancelled = true; }}>Dừng ({prog![0]}/{prog![1]})</button>
          : <button onClick={run} title="Đo từng cặp (object, frame) bằng cả hai cách. Chỉ tính frame đã tải point cloud; Patchwork++ mất ~0,15 s mỗi frame.">▶ Chạy</button>}
        <button onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
      </div>
      {rep && (
        <div style={{ marginTop: 4 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th style={{ textAlign: 'left', padding: '1px 8px' }}>{rep.pairs} cặp · {rep.frames} frame</th><th style={cell}>Cũ</th><th style={cell}>Patchwork++ (mức {rep.mode})</th></tr></thead>
            <tbody>
              {row('Bị báo G', `${rep.a.warn} (${pct(rep.a.warn, rep.pairs)})`, `${rep.b.warn} (${pct(rep.b.warn, rep.pairs)})`)}
              {row('Mơ hồ hai tầng', rep.a.ambiguous, rep.b.ambiguous, 'Có hai tầng (vỉa?) mà không có bằng chứng tiếp xúc để chọn')}
              {row('Không đo được', rep.a.none, rep.b.none, 'Không có lớp mặt đường nào quanh / dưới object, hoặc lệch quá mức cho phép')}
              {row('Đủ căn cứ (snap được)', rep.a.confident, rep.b.confident)}
              {rep.buckets.map((bk) => row(`Báo G ${bk.label}`, `${bk.b.warnA}/${bk.b.measured} (${pct(bk.b.warnA, bk.b.measured)})`, `${bk.b.warnB}/${bk.b.measured} (${pct(bk.b.warnB, bk.b.measured)})`, 'Theo khoảng cách tới ego'))}
              {row('Phân tách Patchwork++', '—', `${rep.segMs.toFixed(0)} ms / frame`)}
            </tbody>
          </table>
          <div style={{ marginTop: 4, fontSize: 12 }}>
            <b>Mặt đất Patchwork++ so với mặt đường cách cũ đo chắc</b> (chênh = Patchwork++ − cũ; 0 là khớp; sai số = p90 của |chênh − trung vị|)
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ textAlign: 'left', padding: '1px 8px' }}>Tầm</th><th style={cell}>ca cũ chắc</th><th style={cell}>PW có mặt đất</th><th style={cell}>chênh trung vị</th><th style={cell}>sai số p90</th><th style={cell} title="Chỉ các ca fit từ ≥ G.pwMinPts điểm mặt đất và phần dư ≤ G.pwMaxRms">qua cổng chất lượng</th><th style={cell}>chênh trung vị</th><th style={cell}>sai số p90</th><th style={cell} title="Trong nhóm qua cổng: còn lại sau kiểm tra nhất quán theo thời gian (so với mặt đường các frame kề của object)">sau nhất quán</th><th style={cell}>chênh trung vị</th><th style={cell}>sai số p90</th></tr></thead>
              <tbody>
                {rep.agree.map((a) => (
                  <tr key={a.label}><td style={{ padding: '1px 8px' }}>{a.label}</td><td style={cell}>{a.n}</td><td style={cell}>{a.withPw}</td><td style={cell}>{a.withPw ? `${(a.med * 100).toFixed(1)} cm` : '—'}</td><td style={cell}>{a.withPw ? `${(a.p90 * 100).toFixed(1)} cm` : '—'}</td><td style={cell}>{a.gateN}</td><td style={cell}>{a.gateN ? `${(a.gateMed * 100).toFixed(1)} cm` : '—'}</td><td style={cell}>{a.gateN ? `${(a.gateP90 * 100).toFixed(1)} cm` : '—'}</td><td style={cell}>{a.consKept}</td><td style={cell}>{a.consKept ? `${(a.consMed * 100).toFixed(1)} cm` : '—'}</td><td style={cell}>{a.consKept ? `${(a.consP90 * 100).toFixed(1)} cm` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
            Khả năng bù: {rep.unconfident} ca cách cũ không đo chắc, trong đó Patchwork++ có mặt đất tại {rep.unconfidentPw} ca ({pct(rep.unconfidentPw, rep.unconfident)}); qua cổng chất lượng: {rep.unconfidentGate} ca ({pct(rep.unconfidentGate, rep.unconfident)}). Mức 4 dùng mặt đất Patchwork++ đủ tin ở {rep.ptsKept} ca; bị loại vì không nhất quán theo thời gian: {rep.ptsDropped} ca.
          </div>
          {rep.worst.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              <b>Ca Patchwork++ lệch nhiều nhất so với cách cũ đo chắc</b> (bấm để mở frame; kiểm bằng mắt xem bên nào đúng)
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {rep.worst.map((w) => (
                  <button key={`${w.num}:${w.f}`} onClick={() => onJump(w.num, w.f)} style={{ padding: '0 4px', fontSize: 11 }}
                    title={`cách ${w.range.toFixed(0)} m · ${w.n} điểm mặt đất, phần dư ${(w.rms * 100).toFixed(1)} cm`}
                  >#{w.num}·f{w.f} {w.d > 0 ? '+' : ''}{(w.d * 100).toFixed(0)} cm</button>
                ))}
              </div>
            </div>
          )}
          {rep.noCloud > 0 && <div style={{ color: '#7a4b00', fontSize: 11 }}>⏳ Bỏ {rep.noCloud} cặp vì frame chưa tải point cloud (đợi tải xong rồi chạy lại để đủ số liệu).</div>}
          <div style={{ marginTop: 4 }}>
            <b>Hai cách kết luận khác nhau: {rep.diffTotal}</b>{rep.diffTotal > rep.diffs.length ? ` (hiện ${rep.diffs.length} đầu)` : ''}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
              {rep.diffs.map((d) => (
                <button
                  key={`${d.num}:${d.f}`} onClick={() => onJump(d.num, d.f)} style={{ padding: '0 4px', fontSize: 11, color: d.warnB ? '#a0006e' : '#2d5a00' }}
                  title={`#${d.num} frame ${d.f}, cách ${d.range.toFixed(0)} m · cũ: ${d.warnA ? 'báo' : 'không báo'}${d.dzA !== null ? ` (dz ${(d.dzA * 100).toFixed(0)} cm)` : ''} · Patchwork++: ${d.warnB ? 'báo' : 'không báo'}${d.dzB !== null ? ` (dz ${(d.dzB * 100).toFixed(0)} cm)` : ''}, ${d.noteB}`}
                >#{d.num}·f{d.f} {d.warnB ? '＋báo' : '−bỏ báo'}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>＋báo = chỉ Patchwork++ báo · −bỏ báo = Patchwork++ không báo mà cách cũ báo. Rê chuột lên nút để xem chi tiết.</div>
          </div>
        </div>
      )}
    </div>
  );
}
