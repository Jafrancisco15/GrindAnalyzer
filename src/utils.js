export function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = (p/100)*(sorted.length-1);
  const lower = Math.floor(idx), upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const w = idx - lower;
  return sorted[lower]*(1-w)+sorted[upper]*w;
}

export function iqrFilter(values) {
  if (values.length < 4) return values;
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5*iqr;
  const upper = q3 + 1.5*iqr;
  return values.filter(v => v >= lower && v <= upper);
}
