import type { UploadReq } from '../content/uploader';
import type { CvatAnnotations, CvatJob, CvatLabel } from './types';

export const PANEL_SOURCE = 'cvla-panel';
export const CONTENT_SOURCE = 'cvla-content';

type Envelope<S extends string> = { source: S; session: string };

export type PanelMessage = Envelope<typeof PANEL_SOURCE> &
  (
    | { type: 'ready' | 'load' | 'close' }
    | { type: 'resize'; wide: boolean }
    | { type: 'binary'; kind: 'frame' | 'context'; n: number; reqId: number }
    // chuyển focus trong giao diện CVAT sang object (đổi frame nếu cần); zoom = camera 3D của CVAT lại gần object; minimize = thu nhỏ tool
    | { type: 'toggleWindow' } // thu nhỏ / mở lại cửa sổ tool
    | { type: 'hotkeys'; toggle: string[] } // phím bật tắt cửa sổ để content script nghe ngay trên trang CVAT
    | { type: 'cvatFocus'; num: number; frame: number | null; zoom?: boolean; minimize?: boolean }
    | { type: 'upload'; reqId: number; req: UploadReq }
    | { type: 'revert'; reqId: number; real: boolean }
    | { type: 'revertInfo'; reqId: number }
  );

export type ContentMessage = Envelope<typeof CONTENT_SOURCE> &
  (
    | { type: 'loading' }
    | { type: 'cvatDbl'; num: number; frame: number | null } // bấm đúp vào object trong CVAT: mở rộng tool với object đó
    | { type: 'cvat'; num: number | null; frame: number | null } // object/frame đang chọn trong giao diện CVAT
    | { type: 'error'; message: string }
    | {
        type: 'data';
        job: CvatJob;
        labels: CvatLabel[];
        annotations: CvatAnnotations;
        removedIds: number[];
      }
    | { type: 'binary'; reqId: number; buf: ArrayBuffer | null; error?: string }
    | { type: 'rpc'; reqId: number; result: unknown }
  );
