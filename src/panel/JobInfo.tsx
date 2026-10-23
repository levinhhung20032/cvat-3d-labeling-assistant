import type { Summary } from '../shared/summary';

export function JobInfo({ s }: { s: Summary }) {
  return (
    <>
      <h4>Job</h4>
      <table>
        <tbody>
          {Object.entries(s.job).map(([k, v]) => (
            <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>
          ))}
          <tr><td>annotation version</td><td>{s.version}</td></tr>
          <tr><td>tracks / shapes / tags</td><td>{s.trackCount} / {s.shapeCount} / {s.tagCount}</td></tr>
        </tbody>
      </table>
      <h4>Track theo nhãn</h4>
      <table>
        <tbody>
          {s.perLabel.map((l) => (
            <tr key={l.labelId}><td>{l.name}</td><td>{l.tracks}</td></tr>
          ))}
        </tbody>
      </table>
      <h4>Frame outside thiếu keyframe</h4>
      {s.outsideViolations.length === 0 ? <p>Không có.</p> : (
        <ul>{s.outsideViolations.map((v) => <li key={v.trackId}>{v.message}</li>)}</ul>
      )}
      <h4>Cấu trúc 1 track mẫu</h4>
      {s.sample ? (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(s.sample, null, 2)}</pre>
      ) : <p>Job chưa có track.</p>}
    </>
  );
}
