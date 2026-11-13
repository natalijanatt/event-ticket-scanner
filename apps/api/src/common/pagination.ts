export function pagination(query: Record<string, string | undefined>, defaultSize = 50): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const size = Math.floor(Number(query.pageSize)) || defaultSize;
  return { page, pageSize: Math.min(200, Math.max(1, size)) };
}
