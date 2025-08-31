import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// jsPDF via UMD (CDN): NO import de 'jspdf'
function getJsPDF() {
  return (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF)
    ? window.jspdf.jsPDF
    : null;
}

/**
 * Grind Analyzer – Portafiltro
 * - ROI y exclusiones
 * - Overlays opcionales (máscara, borde, Canny, contornos, círculos)
 * - D10/D50/D90 + histograma (con ventana sombreada)
 * - Índice de precisión RBP (Range-Based Precision) centrado en D50 ±15% o ±40µm
 * - Exportar PDF (canvas + histograma + métricas)
 * - CLAHE con fallback, listeners {passive:false}, lupa opcional
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
  const [basketMM] = useState(58);
  const [customMM, setCustomMM] = useState("");
  const [umPerPx, setUmPerPx] = useState(0);

  // Viz gate
  const [viz, setViz] = useState("mask");

  // Results + precisión
  const [results, setResults] = useState({
    N: 0, d10: 0, d50: 0, d90: 0, span: 0,
    gsd: 0, cv: 0, iqrMd: 0, precision: 0,
    bandLo: 0, bandHi: 0, shareMain: 0, finesFrac: 0, boulderFrac: 0
  });

  // Histograma refs
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
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

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
    im.onload = () => {
      imgRef.current = im; setImg(im);
      setRim(null); setRoi(null); setExcls([]);
      setMaskOverlay(null); setEdgesOverlay(null); setBoundaryOverlay(null);
      setParticles([]); setContoursPoly([]); setSizes([]);
      setResults({
        N: 0, d10: 0, d50: 0, d90: 0, span: 0,
        gsd: 0, cv: 0, iqrMd: 0, precision: 0,
        bandLo: 0, bandHi: 0, shareMain: 0, finesFrac: 0, boulderFrac: 0
      });
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
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA_
