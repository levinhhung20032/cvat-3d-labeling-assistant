import { useEffect, useState, type ReactNode } from 'react';
import { askConfirm } from './confirmStore';
import type { CvatLabel, CvatTrack } from '../shared/types';
import {
  fieldsOf, isChanged, resetAll, resetSection, SECTIONS, sectionChanged, setValue, type Field, type SectionId,
} from '../shared/thresholds';
import { metricsOf, METRIC_BY_ID, type MetricDef, type Op, type Rule, type SectionCode, type Target } from '../shared/alertRules';
import { parseLabelSpecs } from '../shared/attributes';
import { ruleValues } from '../shared/dynrule';
import { DynClassTable } from './DynSizePanel';
import { NULLABLE_KINDS, SYMBOL_DEFAULTS, type SymbolKind } from '../shared/symbols';
import { symbolStore, sym, useSymbols } from './symbolStore';
import { thresholdStore, useRules, useThresholdVersion } from './thresholdStore';

/** Ô nhập số cho tham số kỹ thuật: gõ tự do; chỉ ghi khi hợp lệ (`onCommit` trả false thì ô đỏ), rời ô mà còn sai thì về giá trị đang dùng. */
function NumField({ value, onCommit, step, width = 78, title }: { value: number; onCommit: (v: number) => boolean; step: number; width?: number; title?: string }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(String(value)); setBad(false); }, [value]);
  return (
    <input
      type="number" value={text} step={step} title={title}
      style={{ width, borderColor: bad ? '#b00' : undefined, background: bad ? '#fee' : undefined }}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        const v = Number(s);
        if (s.trim() === '' || !Number.isFinite(v)) { setBad(true); return; }
        setBad(!onCommit(v));
      }}
      onBlur={() => { if (bad) { setText(String(value)); setBad(false); } }}
    />
  );
}

function FieldRow({ f }: { f: Field }) {
  const changed = isChanged(f);
  return (
    <tr style={{ background: changed ? '#fff8dc' : undefined }}>
      <td style={{ padding: '2px 10px 2px 0' }} title={f.help}>{f.label}{f.help ? ' ⓘ' : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <NumField value={f.get()} step={f.step} onCommit={(v) => { const ok = setValue(f.key, v); if (ok) thresholdStore.changed(); return ok; }} />
        {f.unit ? ` ${f.unit}` : ''}
      </td>
      <td style={{ padding: '2px 8px', color: '#777', fontSize: 11 }}>mặc định {f.def}{f.unit ? ` ${f.unit}` : ''}</td>
      <td>{changed && <button onClick={() => { f.set(f.def); thresholdStore.changed(); }} title="Về giá trị mặc định">↺</button>}</td>
    </tr>
  );
}

/** Ô sửa ký hiệu hiển thị của loại lỗi (1–3 ký tự, không trùng loại khác). */
function SymbolInput({ kind }: { kind: SymbolKind }) {
  const [text, setText] = useState(sym(kind));
  const [bad, setBad] = useState(false);
  const nullable = NULLABLE_KINDS.includes(kind);
  useEffect(() => { setText(sym(kind)); setBad(false); }, [sym(kind)]);
  return (
    <input
      value={text} maxLength={3} placeholder={nullable ? 'NULL' : undefined}
      title={nullable ? 'Lỗi này chưa có mã (NULL). Điền 1–3 ký tự nếu muốn đặt mã, không trùng loại khác; để trống = NULL' : `Ký hiệu hiển thị của lỗi này (mặc định ${SYMBOL_DEFAULTS[kind]}); 1–3 ký tự, không trùng loại khác`}
      style={{ width: nullable ? 48 : 34, textAlign: 'center', fontWeight: 700, marginRight: 6, borderColor: bad ? '#b00' : undefined, background: bad ? '#fee' : undefined }}
      onClick={(e) => e.preventDefault()} onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => { const v = e.target.value; setText(v); setBad((v.trim() !== '' || nullable) && !symbolStore.set(kind, v)); }}
      onBlur={() => { setText(sym(kind)); setBad(false); }}
    />
  );
}

// Ô đối tượng: rule theo attribute hiện là class của nó ở ô này, attribute = giá trị chọn ở ô thứ hai.
const targetKey = (t: Target) => (t.t === 'all' ? 'all' : t.t === 'class' || t.t === 'attr' ? `c:${t.name}` : `o:${t.num}`);
const SEP = String.fromCharCode(1); // ngăn cách tên attribute và giá trị trong value của ô chọn
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Một rule: đối tượng, thuộc tính, quy tắc (>, >=, <, <=, =, !=), ngưỡng, nút xoá. Chọn bằng dropbox. */
function RuleRow({ r, metrics, labels, tracks, jobId }: { r: Rule; metrics: MetricDef[]; labels: CvatLabel[]; tracks: CvatTrack[]; jobId: number }) {
  const m = METRIC_BY_ID.get(r.metric)!;
  const [text, setText] = useState(r.value === null ? '' : String(r.value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(r.value === null ? '' : String(r.value)); setBad(false); }, [r.value, r.metric]);
  const nameOf = (labelId: number) => labels.find((l) => l.id === labelId)?.name ?? '?';
  const classNames = labels.map((l) => l.name);
  const hasClass = (r.target.t !== 'class' && r.target.t !== 'attr') || classNames.some((n) => sameName(n, (r.target as { name: string }).name));
  // Attribute có giá trị rời rạc (select / radio / checkbox) của class đang chọn: chọn từ class rồi mới tới attribute = giá trị.
  const cls = r.target.t === 'class' || r.target.t === 'attr' ? r.target.name : null;
  const attrOpts = cls && m.targets.includes('attr')
    ? [...parseLabelSpecs(labels).values()].find((sp) => sameName(sp.name, cls))?.attrs.map((a) => ({ name: a.name, values: ruleValues(a) })).filter((a) => a.values.length) ?? []
    : [];
  const attrKey = r.target.t === 'attr' ? `${r.target.attr}${SEP}${r.target.value}` : '';
  const setAttr = (k: string) => {
    if (!cls) return;
    if (!k) { thresholdStore.updateRule(r.id, { target: { t: 'class', name: cls } }); return; }
    const [attr = '', value = ''] = k.split(SEP);
    thresholdStore.updateRule(r.id, { target: { t: 'attr', name: cls, attr, value } });
  };

  const setMetric = (id: string) => {
    const nm = METRIC_BY_ID.get(id as never);
    if (!nm) return;
    const keepValue = r.value !== null && r.value >= nm.min && r.value <= nm.max && (!nm.int || Number.isInteger(r.value));
    thresholdStore.updateRule(r.id, {
      metric: nm.id,
      op: nm.ops.includes(r.op) ? r.op : nm.ops[0]!,
      target: nm.targets.includes(r.target.t) ? r.target : { t: 'all' },
      value: keepValue ? r.value : null,
    });
  };
  const setTarget = (k: string) => {
    if (k === 'all') thresholdStore.updateRule(r.id, { target: { t: 'all' } });
    else if (k.startsWith('c:')) thresholdStore.updateRule(r.id, { target: { t: 'class', name: k.slice(2) } });
    else thresholdStore.updateRule(r.id, { target: { t: 'object', job: jobId, num: Number(k.slice(2)) } });
  };
  return (
    <tr style={{ background: r.value === null ? '#f3f3f3' : undefined }}>
      <td><select value={targetKey(r.target)} onChange={(e) => setTarget(e.target.value)} title="Đối tượng áp dụng rule">
        <option value="all">Tất cả object</option>
        {!hasClass && (r.target.t === 'class' || r.target.t === 'attr') && <option value={targetKey(r.target)}>Class: {r.target.name} (job này không có)</option>}
        {m.targets.includes('class') && <optgroup label="Class của job">{classNames.map((n) => <option key={n} value={`c:${n}`}>Class: {n}</option>)}</optgroup>}
        {m.targets.includes('object') && <optgroup label="Object">{tracks.map((t, i) => <option key={i} value={`o:${i + 1}`}>#{i + 1} · {nameOf(t.label_id)}</option>)}</optgroup>}
      </select>
      {(attrOpts.length > 0 || r.target.t === 'attr') && (
        <select value={attrKey} onChange={(e) => setAttr(e.target.value)} style={{ marginLeft: 4 }} title="Thu hẹp rule về các object của class có attribute = giá trị này (ở đúng frame đang xét). Rule theo attribute ưu tiên hơn rule của class và của tất cả object.">
          <option value="">cả class</option>
          {r.target.t === 'attr' && !attrOpts.some((a) => a.name === (r.target as { attr: string }).attr && a.values.includes((r.target as { value: string }).value)) && (
            <option value={attrKey}>{r.target.attr} = {r.target.value} (job này không có)</option>
          )}
          {attrOpts.map((a) => (
            <optgroup key={a.name} label={a.name}>
              {a.values.map((v) => <option key={v} value={`${a.name}${SEP}${v}`}>{a.name} = {v}</option>)}
            </optgroup>
          ))}
        </select>
      )}</td>
      <td><select value={r.metric} onChange={(e) => setMetric(e.target.value)} title={m.help ?? 'Thuộc tính đo'}>
        {metrics.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select></td>
      <td><select value={r.op} onChange={(e) => thresholdStore.updateRule(r.id, { op: e.target.value as Op })} title="Quy tắc xét: báo lỗi khi giá trị đo thoả quy tắc so với ngưỡng">
        {m.ops.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input
          type="number" step={m.step} value={text} placeholder="ngưỡng" style={{ width: 90, borderColor: bad ? '#b00' : undefined, background: bad ? '#fee' : undefined }}
          onChange={(e) => {
            const s = e.target.value;
            setText(s);
            if (s.trim() === '') { setBad(false); thresholdStore.updateRule(r.id, { value: null }); return; }
            const v = Number(s);
            setBad(!Number.isFinite(v) || !thresholdStore.updateRule(r.id, { value: v }));
          }}
          onBlur={() => { if (bad) { setText(r.value === null ? '' : String(r.value)); setBad(false); } }}
        />{m.unit ? ` ${m.unit}` : ''}
      </td>
      <td><button onClick={() => thresholdStore.removeRule(r.id)} title="Xoá rule này">✕</button></td>
      {r.value === null && <td style={{ color: '#777', fontSize: 11, paddingLeft: 6 }}>chưa nhập ngưỡng: chưa có hiệu lực</td>}
    </tr>
  );
}

function Section({ id, title, about, code, rules, labels, tracks, jobId, children }: {
  id: SectionId; title: string; about: string; code?: SymbolKind; rules: readonly Rule[]; labels: CvatLabel[]; tracks: CvatTrack[]; jobId: number; children?: ReactNode;
}) {
  const metrics = metricsOf(id as SectionCode);
  const mine = rules.filter((r) => METRIC_BY_ID.get(r.metric)?.section === id);
  const shown = mine.filter((r) => r.target.t !== 'object' || r.target.job === jobId);
  const hidden = mine.length - shown.length;
  const params = fieldsOf(id);
  const changed = sectionChanged(id);
  return (
    // mặc định thu gọn (chủ dự án 2026-10-29): số rule / "đã chỉnh" vẫn hiện trên tiêu đề
    <details style={{ border: '1px solid #ccd', borderRadius: 4, margin: '6px 0', padding: '2px 8px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '3px 0' }}>
        {code && <SymbolInput kind={code} />}{title}
        <span style={{ color: shown.length ? '#a60' : '#999', fontWeight: 600, marginLeft: 8 }}>{shown.length ? `● ${shown.length} rule` : 'chưa có rule (không báo)'}</span>
        {changed && <span style={{ color: '#345', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>● tham số đã chỉnh</span>}
      </summary>
      <p style={{ margin: '2px 0 4px', color: '#456', fontSize: 12 }}>{about}</p>
      {children}
      {shown.length > 0 && (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: 11, color: '#666' }}><th>Đối tượng</th><th>Thuộc tính</th><th>Quy tắc</th><th>Ngưỡng</th><th /></tr></thead>
          <tbody>{shown.map((r) => <RuleRow key={r.id} r={r} metrics={metrics} labels={labels} tracks={tracks} jobId={jobId} />)}</tbody>
        </table>
      )}
      {hidden > 0 && <p style={{ margin: '2px 0', color: '#777', fontSize: 11 }}>{hidden} rule theo object của job khác (ẩn, giữ nguyên).</p>}
      <div style={{ margin: '4px 0' }}>
        <button onClick={() => thresholdStore.addRule({ metric: metrics[0]!.id, target: { t: 'all' }, op: metrics[0]!.ops[0]! })}>＋ Thêm rule</button>
      </div>
      {params.length > 0 && (
        <details style={{ margin: '2px 0' }}>
          <summary style={{ cursor: 'pointer', color: '#345' }}>Tham số thuật toán{changed ? ' ● đã chỉnh' : ''}</summary>
          <table style={{ borderCollapse: 'collapse' }}><tbody>{params.map((f) => <FieldRow key={f.key} f={f} />)}</tbody></table>
          <button disabled={!changed} onClick={() => { resetSection(id); thresholdStore.changed(); }}>↺ Đặt lại tham số mục này</button>
        </details>
      )}
    </details>
  );
}

/**
 * Tab "Threshold": mỗi loại lỗi là một mục gồm các RULE (đối tượng · thuộc tính · quy tắc · ngưỡng), thêm / xoá bằng nút, chọn bằng dropbox.
 * Không có rule thì không báo lỗi đó. Có thể xuất toàn bộ cài đặt ra `setting.json` (file riêng của bạn, không đưa vào repo) và nạp lại.
 */
export function ThresholdPanel({ jobId, labels, tracks }: { jobId: number; labels: CvatLabel[]; tracks: CvatTrack[] }) {
  useThresholdVersion();
  useSymbols();
  const rules = useRules();

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        <b>Threshold</b>: mỗi lỗi là các <b>rule</b> do bạn đặt: chọn đối tượng, thuộc tính, quy tắc (&gt;, &gt;=, &lt;, &lt;=, =, !=) và ngưỡng.
        Extension không kèm con số nào: <b>chưa có rule thì không báo lỗi</b>. Có hiệu lực ngay; lưu cục bộ, không gửi đi đâu.
      </p>
      <p style={{ margin: '4px 0' }}>
        <button disabled={!rules.length} onClick={() => { void askConfirm({ title: 'Xoá tất cả rule', message: `Xoá TẤT CẢ ${rules.length} rule? (tham số, ký hiệu giữ nguyên)`, confirmLabel: 'Xoá tất cả', danger: true }).then((ok) => { if (ok) thresholdStore.setRules([]); }); }}>Xoá tất cả rule</button>{' '}
        <button onClick={() => { resetAll(); thresholdStore.changed(); }} disabled={!SECTIONS.some((s) => sectionChanged(s.id))}>↺ Tham số</button>{' '}
        <button onClick={() => symbolStore.reset()} title="Về ký hiệu mặc định (đi xa bất thường = Y)">↺ Ký hiệu lỗi</button>
      </p>
      <p style={{ margin: '2px 0', color: '#777', fontSize: 11 }}>Ô chữ đậm đầu mỗi mục = ký hiệu lỗi, sửa được; lỗi chưa có mã hiện NULL (điền 1–3 ký tự nếu sau này muốn đặt mã). Tên class và attribute trong dropbox lấy từ nhãn của job này.</p>
      <p style={{ margin: '2px 0', color: '#456', fontSize: 12 }}>
        <b>Ưu tiên</b>: nhiều rule cùng thuộc tính và cùng chiều (&gt; / &gt;= hoặc &lt; / &lt;=) cùng khớp một object thì chỉ rule cụ thể nhất có hiệu lực:
        một object &gt; class · attribute &gt; class &gt; tất cả object. Ví dụ có rule Vehicle "Dài &gt; 5.5" thì rule "Tất cả object: Dài &gt; 2" không áp cho Vehicle,
        nhưng rule "Tất cả object: Dài &lt; 0.3" vẫn áp. Object khớp rule của từ hai attribute khác nhau trở lên (vd. age = child và pose = sitting) thì xét từ rule của class.
      </p>
      {SECTIONS.map((s) => (
        <Section key={s.id} id={s.id} code={s.code} title={s.title} about={s.about} rules={rules} labels={labels} tracks={tracks} jobId={jobId}>
          {s.id === 'S' && (
            <>
              <p style={{ margin: '2px 0' }}>
                Chỉ xét object có <b>Dynamic size TẮT</b>: class bật thì không xét S, tắt thì xét. Sửa ngay tại đây (cùng cài đặt với tab Dynamic size);
                thứ tự ưu tiên: công tắc riêng của object (Batch Review) &gt; luật attribute &gt; công tắc class. Đổi công tắc class sẽ bỏ công tắc riêng của các object thuộc class đó.
              </p>
              <div style={{ marginBottom: 4 }}><DynClassTable jobId={jobId} labels={labels} tracks={tracks} /></div>
            </>
          )}
        </Section>
      ))}
    </>
  );
}
