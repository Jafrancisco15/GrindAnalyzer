export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function percentile(arr, p){
  if(!arr.length) return 0;
  const a=[...arr].sort((x,y)=>x-y);
  const i=(p/100)*(a.length-1);
  const lo=Math.floor(i), hi=Math.ceil(i);
  if(lo===hi) return a[lo];
  const w=i-lo; return a[lo]*(1-w)+a[hi]*w;
}
export function iqrFilter(values){
  if(values.length<4) return values;
  const q1=percentile(values,25), q3=percentile(values,75);
  const iqr=q3-q1, lo=q1-1.5*iqr, hi=q3+1.5*iqr;
  return values.filter(v=>v>=lo && v<=hi);
}
