import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
// jsPDF via UMD (CDN)
function getJsPDF() {
  return (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF)
    ? window.jspdf.jsPDF
    : null;
}

/**
 * Grind Analyzer – Portafiltro (con PDF + D10/D50/D90 en histograma)
 * - ROI y Exclusiones
 * - Overlays opcionales
 * - CLAHE con fallback
 * - Listeners con {passive:false}
 * - Índice de precisión (0–100)
 * - Exportar a PDF (canvas + histograma + métricas)
 */

export default function App() {
  // Canvas & view
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const view = useRef({ ox: 0, oy: 0, zoom: 1 });

  // Base image
  const [img, setImg] = useState(null);
  const imgRef = useRef(null);

  // Analysis state
  const [sizes, setSizes] = useState([]);               // µm (filtradas)
  const [particles, setParticles] = useState([]);       // [{cx,cy,r_px,r_um}]
  const [contoursPoly, setContoursPoly] = useState([]); // [{pts, accepted, ...}]

  // Overlays (canvases)
  const [maskOverlay, setMaskOverlay] = useState(null);        // {canvas,x,y,w,h}
  const [edgesOverlay, setEdgesOverlay] = useState(null);      // {canvas,x,y,w,h}
  const [boundaryOverlay, setBoundaryOverlay] = useState(null);// {canvas,x,y,w,h}

  // Overlays selector
  const [overlayPreset, setOverlayPreset] = useState("auditar");
  const [overlayAlpha, setOverlayAlpha] = useState(0.6);
  const [showMask, setShowMask] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showEdges, setShowEdges] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [showCircles, setShowCircles] = useState(false);

  // Tools / modes
  const [mode, setMode] = useState("pan"); // 'pan' | 'roi' | 'exclude' | 'rim'
  const drag = useRef({ active: false, lastX: 0, lastY: 0 });
  const drawBox = useRef(null); // rect en curso para ROI o exclude

  // Lens (opcional)
  const [lensEnabled, setLensEnabled] = useState(false);
  const lens = useRef({ visible: false, sx: 0, sy: 0, imgx: 0, imgy: 0 });
  const lensRadius = 80, lensFactor = 2.0;

  // ROI / exclusiones
  const [roi, setRoi] = useState(null);     // {x,y,w,h}
  const [excls, setExcls] = useState([]);   // [{x,y,w,h}]

  // Rim/scale
  const [rim, setRim] = useState(null);     // {cx,cy,r}
  const [basketMM, setBasketMM] = useState(58);
  const [customMM, setCustomMM] = useState("");
  const [umPerPx, setUmPerPx] = useState(0);

  // Viz gate
  const [viz, setViz] = useState("mask");

  // Results + precisión
  const [results, setResults] = useState({
    N: 0, d10: 0, d50: 0, d90: 0, span: 0,
    gsd: 0, cv: 0, iqrMd: 0, precision: 0
  });

  // Histograma refs (para D10/50/90)
  const histRef = useRef(null);

  // Status
  const [status, setStatus] = useState("Sube una imagen y detecta el aro para calibrar la escala.");

  // ---------- Helpers ----------
  function normRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }
  function fitView() {
    const c = canvasRef.current;
    if (!c || !img) return;
    const pad = 16;
    const zx = (c.width - pad * 2) / img.width;
    const zy = (c.height - pad * 2) / img.height;
    const z = Math.max(0.05, Math.min(zx, zy));
    view.current.zoom = z;
    view.current.ox = (c.width - img.width * z) * 0.5;
    view.current.oy = (c.height - img.height * z) * 0.5;
  }
  function worldToImage(x, y) {
    const z = view.current.zoom;
    return { x: (x - view.current.ox) / z, y: (y - view.current.oy) / z };
  }
  function imageToWorld(ix, iy) {
    const z = view.current.zoom;
    return { x: ix * z + view.current.ox, y: iy * z + view.current.oy };
  }
  const fmt = (n, d=1) => (isFinite(n) ? Number(n).toFixed(d) : "—");

  // ---------- Dibujo principal ----------
  function draw() {
    const c = canvasRef.current; if (!c) return;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (!img) return;

    g.save();
    g.translate(view.current.ox, view.current.oy);
    g.scale(view.current.zoom, view.current.zoom);

    // base
    g.drawImage(img, 0, 0);

    // overlays
    if (viz !== "none") {
      if (showMask && maskOverlay?.canvas) {
        g.save(); g.globalAlpha = overlayAlpha;
        g.drawImage(maskOverlay.canvas, maskOverlay.x, maskOverlay.y, maskOverlay.w, maskOverlay.h);
        g.restore();
      }
      if (showBoundary && boundaryOverlay?.canvas) {
        g.save(); g.globalAlpha = Math.min(1, overlayAlpha + 0.15);
        g.drawImage(boundaryOverlay.canvas, boundaryOverlay.x, boundaryOverlay.y, boundaryOverlay.w, boundaryOverlay.h);
        g.restore();
      }
      if (showEdges && edgesOverlay?.canvas) {
        g.save(); g.globalAlpha = Math.min(1, overlayAlpha + 0.25);
        g.drawImage(edgesOverlay.canvas, edgesOverlay.x, edgesOverlay.y, edgesOverlay.w, edgesOverlay.h);
        g.restore();
      }
    }

    // ROI
    if (roi) {
      g.save(); g.strokeStyle = "#10b981"; g.lineWidth = 2 / view.current.zoom;
      g.strokeRect(roi.x, roi.y, roi.w, roi.h); g.restore();
    }

    // Exclusiones
    if (excls?.length) {
      g.save(); g.fillStyle = "rgba(239,68,68,0.25)"; g.strokeStyle = "#ef4444"; g.lineWidth = 2 / view.current.zoom;
      excls.forEach(r => { g.fillRect(r.x, r.y, r.w, r.h); g.strokeRect(r.x, r.y, r.w, r.h); });
      g.restore();
    }

    // Cuadro temporal
    if (drawBox.current) {
      const r = drawBox.current;
      g.save();
      g.setLineDash([6 / view.current.zoom, 4 / view.current.zoom]);
      g.strokeStyle = mode === "roi" ? "#10b981" : "#ef4444";
      g.lineWidth = 2 / view.current.zoom;
      g.strokeRect(r.x, r.y, r.w, r.h);
      g.restore();
    }

    // rim + escala
    if (rim) {
      g.save(); g.strokeStyle = "#111827"; g.lineWidth = 2 / view.current.zoom;
      g.beginPath(); g.arc(rim.cx, rim.cy, rim.r, 0, Math.PI * 2); g.stroke();
      const label = `${Number(customMM || basketMM)} mm · ${umPerPx ? umPerPx.toFixed(1) : "—"} µm/px`;
      g.fillStyle = "rgba(17,24,39,0.85)"; g.font = `${14 / view.current.zoom}px sans-serif`;
      g.fillText(label, rim.cx + 6 / view.current.zoom, rim.cy - 6 / view.current.zoom);
      if (mode === "rim") {
        const hh = 6 / view.current.zoom;
        g.beginPath(); g.arc(rim.cx, rim.cy, hh, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(rim.cx + rim.r, rim.cy, hh, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }

    // círculos equivalentes
    if (showCircles && particles?.length) {
      g.save(); g.strokeStyle = "#2563eb"; g.setLineDash([5 / view.current.zoom, 3 / view.current.zoom]); g.lineWidth = 1.5 / view.current.zoom;
      particles.forEach(p => { g.beginPath(); g.arc(p.cx, p.cy, p.r_px, 0, Math.PI * 2); g.stroke(); });
      g.setLineDash([]); g.restore();
    }

    // contornos reales
    if (showContours && contoursPoly?.length) {
      g.save(); g.lineWidth = 1.5 / view.current.zoom;
      contoursPoly.forEach(cn => {
        const pts = cn.pts; if (!pts || pts.length < 2) return;
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        if (cn.accepted) { g.strokeStyle = "#10b981"; g.fillStyle = "rgba(16,185,129,0.12)"; g.fill(); g.stroke(); }
        else { g.strokeStyle = "rgba(16,185,129,0.35)"; g.setLineDash([4 / view.current.zoom, 3 / view.current.zoom]); g.stroke(); g.setLineDash([]); }
      });
      g.restore();
    }

    g.restore();

    // lens
    if (img && lensEnabled && lens.current?.visible) {
      const { sx, sy, imgx, imgy } = lens.current;
      const r = lensRadius, z = view.current.zoom * lensFactor;
      const ox = sx - imgx * z, oy = sy - imgy * z;
      g.save(); g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.clip();
      g.save(); g.translate(ox, oy); g.scale(z, z); g.drawImage(img, 0, 0); g.restore();
      g.strokeStyle = "#111827"; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.stroke(); g.restore();
    }
  }

  useEffect(draw, [img, rim, roi, excls, maskOverlay, edgesOverlay, boundaryOverlay, particles, contoursPoly, showMask, showBoundary, showEdges, showContours, showCircles, overlayAlpha, viz, lensEnabled, mode]);

  // ---------- Wheel / pan / lens ----------
  function onWheel(e) {
    if (e && e.cancelable) e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const before = worldToImage(x, y);
    const dz = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.current.zoom = Math.min(8, Math.max(0.05, view.current.zoom * dz));
    const after = imageToWorld(before.x, before.y);
    view.current.ox += x - after.x; view.current.oy += y - after.y;
    draw();
  }
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const im = worldToImage(x, y);

    if (mode === "roi" || mode === "exclude") {
      drawBox.current = { x: im.x, y: im.y, w: 0, h: 0 };
      draw();
      return;
    }

    if (mode === "rim" && rim) {
      const dc = Math.hypot(im.x - rim.cx, im.y - rim.cy);
      const edge = Math.abs(dc - rim.r) < 12 ? "edge" : "center";
      drag.current = { active: true, lastX: im.x, lastY: im.y, rimMode: edge };
      return;
    }

    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    if (lensEnabled) {
      lens.current.visible = true;
      lens.current.sx = x; lens.current.sy = y;
      lens.current.imgx = im.x; lens.current.imgy = im.y;
      draw();
    }
  }
  function onPointerMove(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const im = worldToImage(x, y);

    if (drawBox.current && (mode === "roi" || mode === "exclude")) {
      const r = normRect(drawBox.current.x, drawBox.current.y, im.x, im.y);
      drawBox.current = r; draw(); return;
    }

    if (drag.current.active && mode === "rim" && rim) {
      if (drag.current.rimMode === "center") {
        setRim(r => ({ ...r, cx: im.x, cy: im.y }));
      } else {
        const newR = Math.max(5, Math.hypot(im.x - rim.cx, im.y - rim.cy));
        setRim(r => ({ ...r, r: newR }));
      }
      draw(); return;
    }

    if (drag.current.active && mode === "pan") {
      const dx = e.clientX - drag.current.lastX, dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX; drag.current.lastY = e.clientY;
      view.current.ox += dx; view.current.oy += dy; draw();
    }

    if (lensEnabled && lens.current.visible) {
      lens.current.sx = x; lens.current.sy = y; draw();
    }
  }
  function onPointerUp(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (drawBox.current && (mode === "roi" || mode === "exclude")) {
      const r = drawBox.current; drawBox.current = null;
      if (r.w > 4 && r.h > 4) {
        if (mode === "roi") setRoi(r);
        else setExcls(prev => [...prev, r]);
      }
      draw(); return;
    }

    drag.current.active = false;
    if (lensEnabled) { lens.current.visible = false; draw(); }
  }

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const holder = holderRef.current;
      const W = holder ? holder.clientWidth : window.innerWidth;
      const H = Math.max(300, window.innerHeight - 240);
      c.width = Math.floor(W); c.height = Math.floor(H);
      if (img) fitView(); draw();
    };
    resize();
    window.addEventListener("resize", resize);

    // wheel/touch con passive:false
    const wheelHandler = (ev) => onWheel(ev);
    const touchMoveHandler = (ev) => { if (ev && ev.cancelable) ev.preventDefault(); };
    c.addEventListener("wheel", wheelHandler, { passive: false });
    c.addEventListener("touchmove", touchMoveHandler, { passive: false });

    return () => {
      window.removeEventListener("resize", resize);
      c.removeEventListener("wheel", wheelHandler);
      c.removeEventListener("touchmove", touchMoveHandler);
    };
  }, [img]);

  // ---------- File load ----------
  async function handleFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    // im.crossOrigin = "anonymous"; // no necesario para File API
    im.onload = () => {
      imgRef.current = im; setImg(im);
      setRim(null); setRoi(null); setExcls([]);
      setMaskOverlay(null); setEdgesOverlay(null); setBoundaryOverlay(null);
      setParticles([]); setContoursPoly([]); setSizes([]);
      setResults({ N: 0, d10: 0, d50: 0, d90: 0, span: 0, gsd: 0, cv: 0, iqrMd: 0, precision: 0 });
      setStatus("Imagen cargada. Detecta el aro para calibrar la escala.");
      fitView(); draw(); URL.revokeObjectURL(url);
    };
    im.src = url;
  }

  // ---------- Rim detection (Hough) ----------
  function detectRim() {
    try {
      if (!window.cv || !img) { setStatus("OpenCV no disponible o imagen no cargada."); return; }
      const maxSide = 900;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.floor(img.width * scale));
      const h = Math.max(1, Math.floor(img.height * scale));
      const src = new window.cv.Mat(h, w, window.cv.CV_8UC4);
      const tmpCanvas = document.createElement("canvas"); tmpCanvas.width = w; tmpCanvas.height = h;
      const g = tmpCanvas.getContext("2d"); g.drawImage(img, 0, 0, w, h);
      const imgData = g.getImageData(0, 0, w, h); src.data.set(imgData.data);
      const gray = new window.cv.Mat(); window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
      const blur = new window.cv.Mat(); window.cv.GaussianBlur(gray, blur, new window.cv.Size(9, 9), 2, 2, window.cv.BORDER_DEFAULT);
      const circles = new window.cv.Mat();
      window.cv.HoughCircles(blur, circles, window.cv.HOUGH_GRADIENT, 1, 50, 100, 30, Math.floor(Math.min(w, h) * 0.25), Math.floor(Math.min(w, h) * 0.49));
      if (circles.rows > 0) {
        const cx = circles.data32F[0], cy = circles.data32F[1], r = circles.data32F[2];
        const inv = 1 / scale; const rimNew = { cx: cx * inv, cy: cy * inv, r: r * inv };
        setRim(rimNew);
        const mm = Number(customMM || basketMM);
        const micronsPerPx = (mm * 1000) / (2 * rimNew.r);
        setUmPerPx(micronsPerPx);
        setStatus(`Aro detectado. Escala: ${micronsPerPx.toFixed(1)} µm/px`);
      } else setStatus("No se detectó aro. Ajusta la imagen o intenta manualmente (modo Rim).");
      src.delete(); gray.delete(); blur.delete(); circles.delete();
    } catch (err) { console.error(err); setStatus("Error detectando aro (Hough)."); }
  }

  // ---------- Analyze ----------
  function analyze() {
    try {
      if (!window.cv || !img) { setStatus("OpenCV no disponible o imagen no cargada."); return; }
      const mm = Number(customMM || basketMM);
      if (!rim?.r || !mm || mm <= 0) { setStatus("Falta calibrar el aro/diámetro para obtener micras."); return; }
      const um_per_px = (mm * 1000) / (2 * rim.r); setUmPerPx(um_per_px);

      // ROI to Mat
      const rx = roi ? Math.max(0, Math.floor(roi.x)) : 0;
      const ry = roi ? Math.max(0, Math.floor(roi.y)) : 0;
      const rw = roi ? Math.min(img.width - rx, Math.floor(roi.w)) : img.width;
      const rh = roi ? Math.min(img.height - ry, Math.floor(roi.h)) : img.height;

      const srcFull = new window.cv.Mat(img.height, img.width, window.cv.CV_8UC4);
      const tmpCanvas = document.createElement("canvas"); tmpCanvas.width = img.width; tmpCanvas.height = img.height;
      const gg = tmpCanvas.getContext("2d"); gg.drawImage(img, 0, 0);
      const imgData = gg.getImageData(0, 0, img.width, img.height); srcFull.data.set(imgData.data);
      const src = srcFull.roi(new window.cv.Rect(rx, ry, rw, rh));

      // Gray → (CLAHE || equalizeHist) → Blur
      const gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
      const tile = new window.cv.Size(8, 8);
      let didCLAHE = false;
      try {
        if (typeof window.cv.createCLAHE === "function") {
          const clahe = window.cv.createCLAHE(2.0, tile);
          clahe.apply(gray, gray); clahe.delete(); didCLAHE = true;
        } else if (typeof window.cv.CLAHE !== "undefined") {
          const clahe = new window.cv.CLAHE(2.0, tile);
          clahe.apply(gray, gray); clahe.delete(); didCLAHE = true;
        }
      } catch(_) {}
      if (!didCLAHE) window.cv.equalizeHist(gray, gray);

      const blur = new window.cv.Mat();
      window.cv.GaussianBlur(gray, blur, new window.cv.Size(3, 3), 0, 0, window.cv.BORDER_DEFAULT);

      // Adaptive threshold (inv)
      const bin = new window.cv.Mat();
      window.cv.adaptiveThreshold(blur, bin, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5);

      // Exclusiones dentro de ROI
      if (excls?.length) {
        excls.forEach(r => {
          const xx = Math.max(0, Math.floor(r.x - rx));
          const yy = Math.max(0, Math.floor(r.y - ry));
          const ww = Math.max(0, Math.min(rw - xx, Math.floor(r.w)));
          const hh = Math.max(0, Math.min(rh - yy, Math.floor(r.h)));
          if (ww > 0 && hh > 0) {
            const sub = bin.roi(new window.cv.Rect(xx, yy, ww, hh));
            sub.setTo(new window.cv.Scalar(0)); sub.delete();
          }
        });
      }

      // Morph open
      const kernel = window.cv.getStructuringElement(window.cv.MORPH_ELLIPSE, new window.cv.Size(3, 3));
      const opened = new window.cv.Mat(); window.cv.morphologyEx(bin, opened, window.cv.MORPH_OPEN, kernel);

      // Canny (diagnóstico)
      const edges = new window.cv.Mat(); window.cv.Canny(blur, edges, 50, 150);

      // Boundary of mask
      const eroded = new window.cv.Mat(); window.cv.erode(opened, eroded, kernel);
      const boundary = new window.cv.Mat(); window.cv.subtract(opened, eroded, boundary);

      // Overlays RGBA
      const maskVis = new window.cv.Mat(); opened.copyTo(maskVis);
      const maskRGBA = new window.cv.Mat(); window.cv.cvtColor(maskVis, maskRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < maskRGBA.rows; y++) for (let x = 0; x < maskRGBA.cols; x++) {
        const a = maskRGBA.ucharPtr(y, x); if (a[0] > 0) { a[0] = 59; a[1] = 130; a[2] = 246; a[3] = 180; } else { a[3] = 0; }
      }
      const edgesRGBA = new window.cv.Mat(); window.cv.cvtColor(edges, edgesRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < edgesRGBA.rows; y++) for (let x = 0; x < edgesRGBA.cols; x++) {
        const a = edgesRGBA.ucharPtr(y, x); if (a[0] > 0) { a[0] = 255; a[1] = 255; a[2] = 255; a[3] = 255; } else { a[3] = 0; }
      }
      const boundaryRGBA = new window.cv.Mat(); window.cv.cvtColor(boundary, boundaryRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < boundaryRGBA.rows; y++) for (let x = 0; x < boundaryRGBA.cols; x++) {
        const a = boundaryRGBA.ucharPtr(y, x); if (a[0] > 0) { a[0] = 16; a[1] = 185; a[2] = 129; a[3] = 255; } else { a[3] = 0; }
      }

      // Overlay canvases
      const cm = document.createElement("canvas"); cm.width = maskRGBA.cols; cm.height = maskRGBA.rows; window.cv.imshow(cm, maskRGBA);
      setMaskOverlay({ canvas: cm, x: rx, y: ry, w: maskRGBA.cols, h: maskRGBA.rows });
      const ce = document.createElement("canvas"); ce.width = edgesRGBA.cols; ce.height = edgesRGBA.rows; window.cv.imshow(ce, edgesRGBA);
      setEdgesOverlay({ canvas: ce, x: rx, y: ry, w: edgesRGBA.cols, h: edgesRGBA.rows });
      const cb = document.createElement("canvas"); cb.width = boundaryRGBA.cols; cb.height = boundaryRGBA.rows; window.cv.imshow(cb, boundaryRGBA);
      setBoundaryOverlay({ canvas: cb, x: rx, y: ry, w: boundaryRGBA.cols, h: boundaryRGBA.rows });

      // Contours
      const contours = new window.cv.MatVector(); const hier = new window.cv.Mat();
      window.cv.findContours(opened, contours, hier, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

      const sizesArr = []; const pts = []; const polysAll = [];
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = window.cv.contourArea(cnt); if (area < 3) continue;
        const m = window.cv.moments(cnt); const cx = m.m10 / (m.m00 || 1); const cy = m.m01 / (m.m00 || 1);

        // excluir por excls en coordenadas de ROI
        let bad = false;
        for (const r of excls) {
          if (cx >= r.x - rx && cx <= r.x - rx + r.w && cy >= r.y - ry && cy <= r.y - ry + r.h) { bad = true; break; }
        }
        if (bad) continue;

        const per = window.cv.arcLength(cnt, true);
        const approx = new window.cv.Mat(); window.cv.approxPolyDP(cnt, approx, 0.8, true);
        const ptsPoly = []; for (let j = 0; j < approx.rows; j++) {
          const px = approx.intPtr(j, 0)[0]; const py = approx.intPtr(j, 0)[1];
          ptsPoly.push({ x: px + rx, y: py + ry });
        }
        approx.delete();

        const dpx = 2 * Math.sqrt(area / Math.PI);
        const dum = dpx * um_per_px;
        if (dum < 10 || dum > 3000) continue;
        sizesArr.push(dum);
        pts.push({ cx: cx + rx, cy: cy + ry, r_px: dpx / 2, r_um: dum / 2 });

        const hull = new window.cv.Mat(); window.cv.convexHull(cnt, hull, false, true);
        const hullArea = window.cv.contourArea(hull);
        const solidity = hullArea > 0 ? area / hullArea : 0; hull.delete();

        polysAll.push({ pts: ptsPoly, cx: cx + rx, cy: cy + ry, area_px: area, per_px: per, d_um: dum, solidity, circularity: per > 0 ? (4 * Math.PI * area) / (per * per) : 0 });
      }

      // IQR filter
      const filtered = iqrFilter(sizesArr);
      const finalPts = pts.filter(p => filtered.includes(p.r_um * 2));
      setSizes(filtered); setParticles(finalPts);

      let polys = [];
      if (filtered.length) {
        const lo = Math.min(...filtered), hi = Math.max(...filtered);
        polys = polysAll.map(poly => ({ ...poly, accepted: poly.d_um >= lo && poly.d_um <= hi }));
      } else polys = polysAll.map(poly => ({ ...poly, accepted: false }));
      setContoursPoly(polys);

      // D10/50/90 + span
      let d50 = 0, d10 = 0, d90 = 0, span = 0, N = filtered.length;
      if (N) {
        const sorted = [...filtered].sort((a, b) => a - b);
        d50 = quantile(sorted, 0.5); d10 = quantile(sorted, 0.1); d90 = quantile(sorted, 0.9);
        span = d10 > 0 ? d90 / d10 : 0;
      }

      // Precisión
      const prec = computePrecisionMetrics(filtered, { d10, d50, d90, span });
      setResults({ N, d10, d50, d90, span, gsd: prec.gsd, cv: prec.cv, iqrMd: prec.iqrMd, precision: prec.score });

      setViz("mask");
      setStatus(N
        ? `Listo. N=${N} | D50=${d50.toFixed(1)} µm | Índice de precisión=${prec.score.toFixed(0)}/100`
        : "No se detectaron partículas claras. Ajusta ROI/Exclusiones, enfoque/contraste.");

      // cleanup
      src.delete(); srcFull.delete(); gray.delete(); blur.delete(); bin.delete();
      opened.delete(); edges.delete(); eroded.delete(); boundary.delete();
      maskVis.delete(); maskRGBA.delete(); edgesRGBA.delete(); boundaryRGBA.delete();
      contours.delete(); hier.delete(); kernel.delete();
    } catch (err) { console.error(err); setStatus("Error en el análisis."); }
  }

  // ---------- Utils ----------
  function iqrFilter(arr) {
    if (!arr?.length) return [];
    const a = [...arr].sort((x, y) => x - y);
    const q1 = quantile(a, 0.25), q3 = quantile(a, 0.75), iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    return a.filter(v => v >= lo && v <= hi);
  }
  function quantile(sortedAsc, q) {
    const n = sortedAsc.length; if (!n) return 0;
    const pos = (n - 1) * q, base = Math.floor(pos), rest = pos - base;
    return sortedAsc[base + 1] !== undefined
      ? sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base])
      : sortedAsc[base];
  }
  function stdDev(a) {
    if (!a?.length) return 0;
    const n = a.length;
    const mean = a.reduce((s,v)=>s+v,0) / n;
    const varsum = a.reduce((s,v)=>s + (v-mean)*(v-mean), 0) / n;
    return Math.sqrt(varsum);
  }
  function computePrecisionMetrics(data, qs) {
    const arr = (data || []).filter(v => v > 0);
    if (!arr.length) return { score: 0, gsd: 0, cv: 0, iqrMd: 0 };

    const sorted = [...arr].sort((a,b)=>a-b);
    const d10 = qs?.d10 ?? quantile(sorted, 0.1);
    const d50 = qs?.d50 ?? quantile(sorted, 0.5);
    const d90 = qs?.d90 ?? quantile(sorted, 0.9);
    const span = qs?.span ?? (d10>0 ? d90/d10 : 0);

    const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
    const sd = stdDev(arr);
    const cv = mean>0 ? sd/mean : 0;

    const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
    const iqrMd = d50>0 ? (q3 - q1)/d50 : 0;

    const logs = arr.map(v=>Math.log(v));
    const sdLog = stdDev(logs);
    const gsd = Math.exp(sdLog);

    const s1 = clamp01((2.0 - Math.min(gsd, 2.0)) / (2.0 - 1.0)); // 1→1, 2→0
    const s2 = clamp01(1 - (iqrMd / 0.8));                         // 0.8→0
    const s3 = clamp01(1 - ((Math.max(span,1) - 1) / 3));          // 4→0
    const score = Math.round(100 * (0.5*s1 + 0.3*s2 + 0.2*s3));
    return { score, gsd, cv, iqrMd };
  }
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }

  // ---------- Histograma (con D10/D50/D90) ----------
  useEffect(() => {
    const c = histRef.current; if (!c) return;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    const data = sizes;
    if (!data?.length) return;

    const W = c.width, H = c.height, pad = 28;
    const bins = Math.max(10, Math.min(48, Math.ceil(Math.sqrt(data.length))));
    const min = Math.min(...data), max = Math.max(...data);
    const bw = (max - min) / bins || 1;
    const counts = Array(bins).fill(0);
    data.forEach(v => {
      let k = Math.floor((v - min) / bw);
      if (k < 0) k = 0; if (k >= bins) k = bins - 1;
      counts[k]++;
    });
    const maxC = Math.max(...counts);

    // ejes
    g.strokeStyle = "#9ca3af"; g.lineWidth = 1; g.beginPath();
    g.moveTo(pad, H - pad); g.lineTo(W - pad, H - pad);
    g.moveTo(pad, H - pad); g.lineTo(pad, pad); g.stroke();

    // barras
    const plotW = W - pad * 2, plotH = H - pad * 2;
    const pxPerBin = plotW / bins;
    g.fillStyle = "rgba(37,99,235,0.35)";
    counts.forEach((cV, i) => {
      const h = maxC ? (cV / maxC) * plotH : 0;
      const x = pad + i * pxPerBin;
      g.fillRect(x, H - pad - h, Math.max(1, pxPerBin - 2), h);
    });

    // líneas D10/D50/D90
    const d10 = results.d10, d50 = results.d50, d90 = results.d90;
    function xFor(v){ return pad + ((v - min) / (max - min || 1)) * plotW; }
    const drawVLine = (x, color, label) => {
      g.save();
      g.strokeStyle = color; g.lineWidth = 2;
      g.setLineDash([6, 4]); g.beginPath();
      g.moveTo(x, pad - 4); g.lineTo(x, H - pad + 4); g.stroke();
      g.setLineDash([]);
      g.fillStyle = color; g.font = "12px sans-serif";
      const txt = `${label} ${isFinite(x)?fmt(label==='D50'?d50:label==='D10'?d10:d90,0):'—'}µm`;
      const wtxt = g.measureText(txt).width;
      g.fillText(txt, Math.min(Math.max(pad, x - wtxt/2), W - pad - wtxt), pad - 8);
      g.restore();
    };
    if (data.length>=3) {
      drawVLine(xFor(d10), "#f59e0b", "D10");
      drawVLine(xFor(d50), "#111827", "D50");
      drawVLine(xFor(d90), "#10b981", "D90");
    }

    // etiquetas min/max
    g.fillStyle = "#374151"; g.font = "12px sans-serif";
    g.fillText(`${min.toFixed(0)}µm`, pad, H - 6);
    const tmax = `${max.toFixed(0)}µm`;
    g.fillText(tmax, W - pad - g.measureText(tmax).width, H - 6);
  }, [sizes, results.d10, results.d50, results.d90]);

  // ---------- Exportar PDF ----------
  function exportPDF() {
    if (!results.N) { setStatus("No hay resultados para exportar. Ejecuta Analizar primero."); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const margin = 12;
    let y = margin;

    // Header
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Grind Analyzer – Reporte de Molienda (Portafiltro)", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const now = new Date();
    doc.text(`Fecha: ${now.toLocaleString()}`, margin, y);
    y += 6;

    // Tabla de métricas
    const mm = Number(customMM || basketMM);
    const scaleStr = umPerPx ? `${umPerPx.toFixed(1)} µm/px` : "—";
    const roiStr = roi ? `${fmt(roi.w * umPerPx / 1000,2)}×${fmt(roi.h * umPerPx / 1000,2)} mm` : "imagen completa";
    const rows = [
      [`N partículas`, String(results.N)],
      [`D10 (µm)`, fmt(results.d10,1)],
      [`D50 (µm)`, fmt(results.d50,1)],
      [`D90 (µm)`, fmt(results.d90,1)],
      [`Span (D90/D10)`, results.d10?fmt(results.span,2):"—"],
      [`GSD (σg)`, fmt(results.gsd,3)],
      [`CV (%)`, fmt(results.cv*100,1)],
      [`IQR/Md`, fmt(results.iqrMd,3)],
      [`Índice de precisión (0–100)`, String(Math.round(results.precision))],
      [`Diámetro canasto (mm)`, String(mm)],
      [`Escala`, scaleStr],
      [`ROI`, roiStr]
    ];
    const col1 = margin, col2 = 85;
    rows.forEach(r => {
      doc.setFont("helvetica", "bold"); doc.text(r[0], col1, y);
      doc.setFont("helvetica", "normal"); doc.text(r[1], col2, y);
      y += 6;
    });
    y += 2;

    // Imagen: canvas principal
    const canvas = canvasRef.current;
    if (canvas) {
      const imgData = canvas.toDataURL("image/png", 1.0);
      const maxW = 180, w = maxW, h = (canvas.height / canvas.width) * w;
      if (y + h > 297 - margin) { doc.addPage(); y = margin; }
      doc.text("Vista análisis (overlays/ROI)", margin, y); y += 4;
      doc.addImage(imgData, "PNG", margin, y, w, h, undefined, "FAST");
      y += h + 6;
    }

    // Imagen: histograma
    const hc = histRef.current;
    if (hc) {
      const imgData = hc.toDataURL("image/png", 1.0);
      const maxW = 180, w = maxW, h = (hc.height / hc.width) * w;
      if (y + h > 297 - margin) { doc.addPage(); y = margin; }
      doc.text("Histograma con D10/D50/D90", margin, y); y += 4;
      doc.addImage(imgData, "PNG", margin, y, w, h, undefined, "FAST");
      y += h + 6;
    }

    // Footer
    doc.setFontSize(8);
    doc.text("Generado con Grind Analyzer (Portafiltro)", margin, 297 - 6);

    doc.save(`grind-report-${now.toISOString().slice(0,19).replace(/[:T]/g,'-')}.pdf`);
  }

  // ---------- Presets ----------
  useEffect(() => {
    if (overlayPreset === "todos") {
      setShowMask(true); setShowBoundary(true); setShowEdges(true); setShowContours(true); setShowCircles(true);
    } else if (overlayPreset === "auditar") {
      setShowMask(true); setShowBoundary(true); setShowEdges(true); setShowContours(true); setShowCircles(false);
    } else if (overlayPreset === "solo-mascara") {
      setShowMask(true); setShowBoundary(false); setShowEdges(false); setShowContours(false); setShowCircles(false);
    } else if (overlayPreset === "poligonos") {
      setShowMask(false); setShowBoundary(false); setShowEdges(false); setShowContours(true); setShowCircles(false);
    } else if (overlayPreset === "ninguno") {
      setShowMask(false); setShowBoundary(false); setShowEdges(false); setShowContours(false); setShowCircles(false);
    }
  }, [overlayPreset]);

  // ---------- UI ----------
  const precChip = colorForPrecision(results.precision);

  return (
    <div className="max-w-7xl mx-auto p-4 bg-white text-gray-900 min-h-screen">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Grind Analyzer – Portafiltro</h1>

        <label className="ml-4 text-sm">
          Imagen
          <input type="file" accept="image/*" onChange={handleFile} className="ml-2" />
        </label>

        <label className="text-sm ml-2">
          Diámetro canasto (mm)
          <input
            type="number" step="0.1"
            className="ml-2 w-24 border rounded bg-white text-gray-900 px-2 py-1"
            value={customMM} placeholder={String(basketMM)}
            onChange={(e) => setCustomMM(e.target.value)}
          />
        </label>

        <button onClick={detectRim} className="px-3 py-1 rounded bg-blue-600 text-white">
          Detectar aro
        </button>
        <button onClick={analyze} className="px-3 py-1 rounded bg-emerald-600 text-white">
          Analizar
        </button>
        <button
          onClick={exportPDF}
          className="px-3 py-1 rounded bg-gray-800 text-white"
          disabled={!results.N}
          title={results.N ? "Exportar reporte en PDF" : "Analiza primero para habilitar"}
        >
          Exportar PDF
        </button>

        {/* Herramientas */}
        <div className="ml-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600 mr-1">Herramienta:</span>
          <ToolBtn label="Pan" active={mode==='pan'} onClick={()=>setMode('pan')} />
          <ToolBtn label="ROI" active={mode==='roi'} onClick={()=>setMode('roi')} />
          <ToolBtn label="Excluir" active={mode==='exclude'} onClick={()=>setMode('exclude')} />
          <ToolBtn label="Rim" active={mode==='rim'} onClick={()=>setMode('rim')} />
          <button onClick={()=> setExcls([])} className="px-2 py-1 rounded border text-sm" title="Limpiar exclusiones">Limpiar excl.</button>
          <button onClick={()=> setExcls(prev => prev.slice(0,-1))} className="px-2 py-1 rounded border text-sm" title="Borrar última exclusión">Undo excl.</button>
        </div>

        {/* Lupa */}
        <label className="inline-flex items-center gap-2 text-sm ml-2">
          <input type="checkbox" checked={lensEnabled} onChange={(e) => setLensEnabled(e.target.checked)} />
          <span>Lupa</span>
        </label>

        {/* Overlay selector */}
        <div className="ml-auto flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-sm">
              Preset
              <select
                value={overlayPreset} onChange={(e) => setOverlayPreset(e.target.value)}
                className="ml-1 border rounded px-1 py-0.5 text-sm bg-white text-gray-900"
              >
                <option value="auditar">Auditar (Máscara+Borde+Canny+Contornos)</option>
                <option value="todos">Todos</option>
                <option value="solo-mascara">Solo Máscara</option>
                <option value="poligonos">Polígonos</option>
                <option value="ninguno">Ninguno</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} />
              <span>Máscara</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showBoundary} onChange={(e) => setShowBoundary(e.target.checked)} />
              <span>Borde máscara</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />
              <span>Canny</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} />
              <span>Contornos</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showCircles} onChange={(e) => setShowCircles(e.target.checked)} />
              <span>Círculos</span>
            </label>
            <label className="text-sm">
              Intensidad
              <input type="range" min="0.15" max="1" step="0.05" value={overlayAlpha}
                     onChange={(e) => setOverlayAlpha(parseFloat(e.target.value))}
                     className="ml-1 align-middle" />
            </label>
          </div>
        </div>
      </header>

      <p className="mt-2 text-sm text-gray-600">{status}</p>

      {/* Main area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3">
        <div className="lg:col-span-2">
          <div ref={holderRef} className="relative w-full">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="rounded bg-gray-100 w-full border border-gray-300"
              style={{ display: "block" }}
            />
          </div>
        </div>

        {/* Panel de resultados */}
        <div className="border rounded p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Resultados</h2>
            <span
              className="text-xs px-2 py-1 rounded"
              style={{ background: precChip.bg, color: precChip.fg }}
              title={`Índice de precisión: ${Math.round(results.precision)}/100 (${precChip.label})`}
            >
              Precisión {results.N ? Math.round(results.precision) : "—"}/100
            </span>
          </div>
          <ul className="text-sm space-y-1 mt-2">
            <li><span className="text-gray-600">N partículas:</span> {results.N}</li>
            <li><span className="text-gray-600">D10:</span> {results.N ? fmt(results.d10,1) : "—"} µm</li>
            <li><span className="text-gray-600">D50 (mediana):</span> {results.N ? fmt(results.d50,1) : "—"} µm</li>
            <li><span className="text-gray-600">D90:</span> {results.N ? fmt(results.d90,1) : "—"} µm</li>
            <li><span className="text-gray-600">Span D90/D10:</span> {results.N && results.d10>0 ? fmt(results.span,2) : "—"}</li>
            <li className="mt-2"><span className="text-gray-600">GSD (σ<sub>g</sub>):</span> {results.N ? fmt(results.gsd,3) : "—"}</li>
            <li><span className="text-gray-600">CV (std/mean):</span> {results.N ? fmt(results.cv*100,1) : "—"}%</li>
            <li><span className="text-gray-600">IQR/Md:</span> {results.N ? fmt(results.iqrMd,3) : "—"}</li>
            <li><span className="text-gray-600">Escala:</span> {umPerPx ? `${fmt(umPerPx,1)} µm/px` : "—"}</li>
            <li><span className="text-gray-600">ROI:</span> {roi ? `${fmt(roi.w * umPerPx / 1000,2)}×${fmt(roi.h * umPerPx / 1000,2)} mm` : "imagen completa"}</li>
          </ul>

          <h3 className="font-semibold mt-3 mb-1">Histograma</h3>
          <canvas ref={histRef} width={320} height={160} className="border rounded bg-white" />
          <p className="text-xs text-gray-500 mt-2">
            Líneas (D10 naranja, D50 negro, D90 verde). Índice combina GSD, IQR/Md y Span (más alto = más uniforme).
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Botón de herramienta ---- */
function ToolBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded border text-sm ${active ? "bg-indigo-600 text-white" : "bg-white"}`}
    >
      {label}
    </button>
  );
}

/* ---- Chip de precisión (color) ---- */
function colorForPrecision(score) {
  const s = Number(score) || 0;
  if (s >= 80) return { bg: "#ecfdf5", fg: "#065f46", label: "Alta" };
  if (s >= 60) return { bg: "#fffbeb", fg: "#92400e", label: "Media" };
  return { bg: "#fef2f2", fg: "#991b1b", label: "Baja" };
}
