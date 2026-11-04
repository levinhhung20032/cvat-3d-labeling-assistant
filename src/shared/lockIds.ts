/** Tập ID được phép xóa: sổ do tool tạo + (khi đã khóa) ID trên server không nằm trong danh sách khóa. ID đã khóa không bao giờ có mặt. */
export function deletableIds(made: readonly number[], locked: readonly number[] | null, serverIds: readonly number[]): { all: Set<number>; external: Set<number> } {
  const lock = new Set(locked ?? []);
  const external = new Set(locked ? serverIds.filter((id) => !lock.has(id) && !made.includes(id)) : []);
  const all = new Set([...made, ...external].filter((id) => !lock.has(id)));
  return { all, external };
}
