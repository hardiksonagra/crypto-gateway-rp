export function parsePageQuery(q) {
  const page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(q.pageSize ?? "20"), 10) || 20),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
