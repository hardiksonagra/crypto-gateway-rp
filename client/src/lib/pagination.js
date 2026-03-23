export function getVisiblePages(current, total) {
  if (total < 1) return [];
  if (total === 1) return [1];
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);

  const add = (set, n) => {
    if (n >= 1 && n <= total) set.add(n);
  };
  const s = new Set();
  add(s, 1);
  add(s, total);
  for (let d = -2; d <= 2; d++) add(s, current + d);

  const arr = [...s].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) out.push("ellipsis");
    out.push(arr[i]);
  }
  return out;
}
