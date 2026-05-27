export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
}

export function sourceId(hash: string): string {
  return `src_${hash.slice(0, 16)}`;
}

export function memoryId(sourceIdValue: string, index: number): string {
  return `mem_${sourceIdValue.replace(/^src_/, "")}_${String(index + 1).padStart(3, "0")}`;
}
