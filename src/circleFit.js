export function circleFrom3(p1, p2, p3) {
  const {x:x1,y:y1}=p1, {x:x2,y:y2}=p2, {x:x3,y:y3}=p3;
  const a = x1*(y2 - y3) - y1*(x2 - x3) + x2*y3 - x3*y2;
  if (Math.abs(a) < 1e-6) return null;
  const b = ( (x1*x1 + y1*y1)*(y3 - y2) + (x2*x2 + y2*y2)*(y1 - y3) + (x3*x3 + y3*y3)*(y2 - y1) ) / (2*a);
  const c = ( (x1*x1 + y1*y1)*(x2 - x3) + (x2*x2 + y2*y2)*(x3 - x1) + (x3*x3 + y3*y3)*(x1 - x2) ) / (2*a);
  const cx = b, cy = c;
  const r = Math.hypot(cx - x1, cy - y1);
  return {cx, cy, r};
}
