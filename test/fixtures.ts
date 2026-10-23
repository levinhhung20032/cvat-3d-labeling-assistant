import type { CvatAnnotations, CvatShape, CvatTrack } from '../src/shared/types';

export const shape = (frame: number, outside = false): CvatShape => ({
  type: 'cuboid',
  frame,
  outside,
  occluded: false,
  z_order: 0,
  rotation: 0,
  points: Array(16).fill(0), // độ dài giả định, chưa xác minh
  attributes: [],
});

export const track = (id: number | undefined, shapes: CvatShape[]): CvatTrack => ({
  id,
  label_id: 1,
  frame: shapes[0]?.frame ?? 0,
  shapes,
  attributes: [],
});

export const ann = (...tracks: CvatTrack[]): CvatAnnotations => ({
  version: 7,
  tags: [],
  shapes: [],
  tracks,
});
