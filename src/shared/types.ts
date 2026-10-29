// Kiểu dữ liệu theo REST API CVAT 2.x. Bố cục `points` của cuboid 3D CHƯA xác minh.

/** Giá trị attribute trong REST: id đặc tả + giá trị (luôn là chuỗi; checkbox là 'true' / 'false'). */
export interface AttrValue { spec_id: number; value: string }

export interface CvatShape {
  type?: string;
  frame: number;
  outside: boolean;
  occluded?: boolean;
  z_order?: number;
  rotation?: number;
  points: number[];
  attributes?: AttrValue[];
  id?: number;
  source?: string;
  [extra: string]: unknown;
}

export interface CvatTrack {
  id?: number;
  label_id: number;
  frame: number;
  group?: number;
  source?: string;
  attributes?: AttrValue[];
  elements?: unknown[];
  shapes: CvatShape[];
  [extra: string]: unknown;
}

export interface CvatAnnotations {
  version: number;
  tags: unknown[];
  shapes: unknown[];
  tracks: CvatTrack[];
}

export interface CvatJob {
  id: number;
  task_id: number;
  start_frame: number;
  stop_frame: number;
  dimension?: string;
  state?: string;
  stage?: string;
  [extra: string]: unknown;
}

export interface CvatLabel {
  id: number;
  name: string;
  type?: string;
  attributes?: { id: number; name: string; input_type?: string; mutable?: boolean; default_value?: string; values?: string[] }[];
  [extra: string]: unknown;
}

export interface Violation {
  rule: 'id-removed' | 'outside-missing-keyframe' | 'forbidden-action' | 'id-missing' | 'tilt-too-large';
  trackId?: number;
  frames?: number[];
  message: string;
}
