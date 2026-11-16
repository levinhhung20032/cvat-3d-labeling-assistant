import { useMemo, useState } from 'react';
import type { CvatLabel } from '../shared/types';
import { makeCameraPreset } from '../shared/cameras';
import { applyPersisted, toPersisted } from '../shared/thresholds';
import { BUNDLED, dynForJob, mergeDynSettings, parseSettings, pickParts, presentParts, SETTINGS_PARTS, type SettingsFile, type SettingsPart } from '../shared/settings';
import { defaultDyn, dynClassStore, dynRuleStore, useDynClasses, useDynRules } from './dynClassStore';
import { symbolStore } from './symbolStore';
import { thresholdStore } from './thresholdStore';
import { loadCameraBank, saveCameraBank } from './cameraStore';

const ALL = SETTINGS_PARTS.map((p) => p.id);
const box = { border: '1px solid #bbb', borderRadius: 6, padding: '6px 8px', margin: '6px 0', fontSize: 12 } as const;

/**
 * Xuất / nạp `setting.json` (dùng chung cho tab Threshold và Camera): chọn xuất / nạp toàn bộ hoặc từng phần
 * (Rule & tham số, Ký hiệu lỗi, Dynamic size, Camera). File là của riêng người dùng, không nằm trong repo, không chứa dữ liệu nhãn.
 */
export function SettingsIO({ jobId, labels }: { jobId: number; labels: CvatLabel[] }) {
  const labelNames = useMemo(() => labels.map((l) => l.name), [labels]);
  const dynMap = useDynClasses(jobId);
  const dynRules = useDynRules(jobId);
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<SettingsPart[]>(ALL);
  const [pending, setPending] = useState<{ name: string; file: SettingsFile; present: SettingsPart[]; pick: SettingsPart[] } | null>(null);
  const [msg, setMsg] = useState('');
  const toggle = (list: SettingsPart[], id: SettingsPart) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const exportSettings = () => {
    const classOn = Object.fromEntries(labelNames.map((n) => [n, dynMap[n] ?? defaultDyn(n)]));
    const full: SettingsFile = {
      version: 2,
      params: toPersisted().n,
      rules: [...thresholdStore.rules()],
      symbols: symbolStore.all(),
      dynamicSize: mergeDynSettings(BUNDLED.dynamicSize, labelNames, classOn, dynRules),
      camera: loadCameraBank(),
    };
    const file = pickParts(full, exp);
    if (file.camera) (file as Record<string, unknown>).camera = makeCameraPreset(file.camera);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'setting.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const names = SETTINGS_PARTS.filter((p) => exp.includes(p.id)).map((p) => p.label).join(', ');
    setMsg(`Đã xuất setting.json (${exp.length === ALL.length ? 'toàn bộ' : names}). File này của riêng bạn: không commit / đưa lên GitHub.`);
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const raw: unknown = JSON.parse(await f.text());
      const present = presentParts(raw);
      if (!present.length) { setMsg('File không có phần cài đặt nào nhận ra được.'); return; }
      setPending({ name: f.name, file: parseSettings(raw), present, pick: present });
      setMsg('');
    } catch { setMsg('File setting không đọc được.'); }
  };

  const applyImport = () => {
    if (!pending) return;
    const { file: s, pick } = pending;
    const done: string[] = [];
    if (pick.includes('rules')) {
      applyPersisted({ n: s.params });
      thresholdStore.setRules(s.rules);
      done.push(`${s.rules.length} rule, ${Object.keys(s.params).length} tham số`);
    }
    if (pick.includes('symbols')) { symbolStore.replace(s.symbols); done.push('ký hiệu lỗi'); }
    if (pick.includes('dynamic')) {
      const d = dynForJob(s.dynamicSize, labelNames);
      for (const [n, on] of Object.entries(d.classes)) dynClassStore.set(jobId, n, on);
      for (const [k, v] of Object.entries(d.attrRules)) dynRuleStore.set(jobId, k, v);
      done.push(`Dynamic size (${Object.keys(d.classes).length} class khớp job này)`);
    }
    if (pick.includes('camera') && s.camera) { saveCameraBank(s.camera); done.push('camera (bộ 6 và 8 cam)'); }
    thresholdStore.changed();
    setMsg(`Đã nạp từ ${pending.name}: ${done.join('; ') || 'không có phần nào được chọn'}.`);
    setPending(null);
  };

  const parts = (list: SettingsPart[], onToggle: (id: SettingsPart) => void, enabled?: SettingsPart[]) => (
    <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap' }}>
      {SETTINGS_PARTS.map((p) => (
        <label key={p.id} style={{ opacity: !enabled || enabled.includes(p.id) ? 1 : 0.4 }}>
          <input type="checkbox" checked={list.includes(p.id)} disabled={!!enabled && !enabled.includes(p.id)} onChange={() => onToggle(p.id)} /> {p.label}
        </label>
      ))}
    </span>
  );

  return (
    <div style={{ margin: '4px 0' }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>⇅ Xuất / Nạp setting.json</button>
      {msg && <span style={{ color: '#345', marginLeft: 8 }}>{msg}</span>}
      {open && (
        <>
          <div style={box}>
            <b>Xuất</b>: chọn phần cần xuất{' '}
            <button onClick={() => setExp(ALL)}>Tất cả</button> {parts(exp, (id) => setExp(toggle(exp, id)))}{' '}
            <button disabled={!exp.length} onClick={exportSettings}>Xuất setting.json</button>
          </div>
          <div style={box}>
            <b>Nạp</b>: chọn file (nhận cả file xuất toàn bộ lẫn một phần), rồi chọn phần cần nạp{' '}
            <label style={{ cursor: 'pointer' }}>
              <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} />
              <span style={{ border: '1px solid #888', borderRadius: 3, padding: '1px 6px' }}>Chọn file…</span>
            </label>
            {pending && (
              <div style={{ marginTop: 6 }}>
                {pending.name}: có {pending.present.length}/{ALL.length} phần.{' '}
                <button onClick={() => setPending({ ...pending, pick: pending.present })}>Tất cả</button>{' '}
                {parts(pending.pick, (id) => setPending({ ...pending, pick: toggle(pending.pick, id) }), pending.present)}{' '}
                <button disabled={!pending.pick.length} onClick={applyImport}>Nạp</button>{' '}
                <button onClick={() => setPending(null)}>Huỷ</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
