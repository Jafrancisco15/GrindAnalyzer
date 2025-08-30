import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Grind Analyzer – Portafiltro (paleta clara + overlays opcionales)
 * - Fix CLAHE (uso correcto y fallback a equalizeHist)
 * - Fix passive listeners (wheel/touch con {passive:false}; sin onWheel en JSX)
 * - Paleta clara (fondo blanco, botones azul/verde)
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
  const [sizes, setSizes] = useState([]);                 // µm
  const [particles, setParticles] = useState([]);         // [{cx,cy,r_px,r_um}]
  const [contoursPoly, setContoursPoly] = useState([]);   // [{pts, accepted, cx, cy, d_um, ...}]

  // Overlays (canvases)
  const [maskOverlay, setMaskOverlay] = useState(null);       // {canvas,x,y,w,h}
  const [edgesOverlay, setEdgesOverlay] = useState(null);     // {canvas,x,y,w,h}
  const [boundaryOverlay, setBoundaryOverlay] = useState(null);// {canvas,x,y,w,h}

  // Overlays selector
  const [showOverlays, setShowOverlays] = useState(true);
  const [overlayPreset, setOverlayPreset] = useState("auditar");
  const [overlayAlpha, setOverlayAlpha] = useState(0.6);
  const [showMask, setShowMask] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showEdges, setShowEdges] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [showCircles, setShowCircles] = useState(false);

  // Lens (optional)
  const [lensEnabled, setLensEnabled] = useState(false);
  const lens = useRef({ visible: false, sx: 0, sy: 0, imgx: 0, imgy: 0 });
  const lensRadius = 80;
  const lensFactor = 2.0;

  // ROI / exclusions
  const [roi, setRoi] = useState(null); // {x,y,w,h}
  const [excls, setExcls] = useState([]);

  // Rim/scale
  const [rim, setRim] = useState(null);     // {cx,cy,r}
  const [basketMM, setBasketMM] = useState(58);
  const [customMM, setCustomMM] = useState("");
  const [umPerPx, setUmPerPx] = useState(0);
  const [viz, setViz] = useState("mask");   // basic gate

  // UI
  const [status, setStatus] = useState("Sube una imagen y detecta el aro para calibrar la escala.");

  // ---------- Drawing helpers ----------
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

  function draw() {
    const c = canvasRef.current;
    if (!c) return;
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
      if ((showOverlays || showMask) && maskOverlay?.canvas) {
        g.save(); g.globalAlpha = overlayAlpha;
        g.drawImage(maskOverlay.canvas, maskOverlay.x, maskOverlay.y, maskOverlay.w, maskOverlay.h);
        g.restore();
      }
      if ((showOverlays || showBoundary) && boundaryOverlay?.canvas) {
        g.save(); g.globalAlpha = Math.min(1, overlayAlpha + 0.15);
        g.drawImage(boundaryOverlay.canvas, boundaryOverlay.x, boundaryOverlay.y, boundaryOverlay.w, boundaryOverlay.h);
        g.restore();
      }
      if ((showOverlays || showEdges) && edgesOverlay?.canvas) {
        g.save(); g.globalAlpha = Math.min(1, overlayAlpha + 0.25);
        g.drawImage(edgesOverlay.canvas, edgesOverlay.x, edgesOverlay.y, edgesOverlay.w, edgesOverlay.h);
        g.restore();
      }
    }

    // ROI/exclusions
    if (roi) {
      g.save(); g.strokeStyle = "#10b981"; g.lineWidth = 2 / view.current.zoom;
      g.strokeRect(roi.x, roi.y, roi.w, roi.h); g.restore();
    }
    if (excls?.length) {
      g.save(); g.fillStyle = "rgba(239,68,68,0.25)"; g.strokeStyle = "#ef4444"; g.lineWidth = 2 / view.current.zoom;
      excls.forEach(r => { g.fillRect(r.x, r.y, r.w, r.h); g.strokeRect(r.x, r.y, r.w, r.h); });
      g.restore();
    }

    // rim + scale
    if (rim) {
      g.save(); g.strokeStyle = "#111827"; g.lineWidth = 2 / view.current.zoom;
      g.beginPath(); g.arc(rim.cx, rim.cy, rim.r, 0, Math.PI * 2); g.stroke();
      const label = `${Number(customMM || basketMM)} mm · ${umPerPx ? umPerPx.toFixed(1) : "—"} µm/px`;
      g.fillStyle = "rgba(17,24,39,0.85)"; g.font = `${14 / view.current.zoom}px sans-serif`;
      g.fillText(label, rim.cx + 6 / view.current.zoom, rim.cy - 6 / view.current.zoom);
      g.restore();
    }

    // circles
    if (showCircles && particles?.length) {
      g.save(); g.strokeStyle = "#2563eb"; g.setLineDash([5 / view.current.zoom, 3 / view.current.zoom]); g.lineWidth = 1.5 / view.current.zoom;
      particles.forEach(p => { g.beginPath(); g.arc(p.cx, p.cy, p.r_px, 0, Math.PI * 2); g.stroke(); });
      g.setLineDash([]); g.restore();
    }

    // contours
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

  useEffect(draw, [img, rim, roi, excls, maskOverlay, edgesOverlay, boundaryOverlay, particles, contoursPoly, showOverlays, showMask, showBoundary, showEdges, showContours, showCircles, overlayAlpha, viz, lensEnabled]);

  // ---------- Input: wheel / pan / lens ----------
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
  const drag = useRef({ active: false, lastX: 0, lastY: 0 });
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    if (lensEnabled) {
      const rect = canvasRef.current.getBoundingClientRect();
      lens.current.visible = true;
      lens.current.sx = e.clientX - rect.left; lens.current.sy = e.clientY - rect.top;
      const im = worldToImage(lens.current.sx, lens.current.sy); lens.current.imgx = im.x; lens.current.imgy = im.y;
      draw();
    }
  }
  function onPointerMove(e) {
    if (drag.current.active) {
      const dx = e.clientX - drag.current.lastX, dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX; drag.current.lastY = e.clientY;
      view.current.ox += dx; view.current.oy += dy; draw();
    }
    if (lensEnabled && lens.current.visible) {
      const rect = canvasRef.current.getBoundingClientRect();
      lens.current.sx = e.clientX - rect.left; lens.current.sy = e.clientY - rect.top; draw();
    }
  }
  function onPointerUp(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current.active = false;
    if (lensEnabled) { lens.current.visible = false; draw(); }
  }

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const holder = holderRef.current;
      const W = holder ? holder.clientWidth : window.innerWidth;
      const H = Math.max(300, window.innerHeight - 160);
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
      } else setStatus("No se detectó aro. Ajusta la imagen o intenta manualmente.");
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
      const localOff = { x: rx, y: ry };

      const srcFull = new window.cv.Mat(img.height, img.width, window.cv.CV_8UC4);
      const tmpCanvas = document.createElement("canvas"); tmpCanvas.width = img.width; tmpCanvas.height = img.height;
      const gg = tmpCanvas.getContext("2d"); gg.drawImage(img, 0, 0);
      const imgData = gg.getImageData(0, 0, img.width, img.height); srcFull.data.set(imgData.data);
      const src = srcFull.roi(new window.cv.Rect(rx, ry, rw, rh));

      // Gray → (CLAHE || equalizeHist) → Blur
      const gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

      // Robust CLAHE usage
      const tile = new window.cv.Size(8, 8);
      let didCLAHE = false;
      try {
        if (typeof window.cv.createCLAHE === "function") {
          const clahe = window.cv.createCLAHE(2.0, tile);
          clahe.apply(gray, gray);
          clahe.delete();
          didCLAHE = true;
        } else if (typeof window.cv.CLAHE !== "undefined") {
          const clahe = new window.cv.CLAHE(2.0, tile);
          clahe.apply(gray, gray);
          clahe.delete();
          didCLAHE = true;
        }
      } catch (_) { /* fall back below */ }
      if (!didCLAHE) {
        // Fallback global equalize if CLAHE unavailable
        window.cv.equalizeHist(gray, gray);
      }

      const blur = new window.cv.Mat();
      window.cv.GaussianBlur(gray, blur, new window.cv.Size(3, 3), 0, 0, window.cv.BORDER_DEFAULT);

      // Adaptive threshold (inv)
      const bin = new window.cv.Mat();
      window.cv.adaptiveThreshold(blur, bin, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5);

      // Exclusions
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
      } // azul translúcido

      const edgesRGBA = new window.cv.Mat(); window.cv.cvtColor(edges, edgesRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < edgesRGBA.rows; y++) for (let x = 0; x < edgesRGBA.cols; x++) {
        const a = edgesRGBA.ucharPtr(y, x); if (a[0] > 0) { a[0] = 255; a[1] = 255; a[2] = 255; a[3] = 255; } else { a[3] = 0; }
      }

      const boundaryRGBA = new window.cv.Mat(); window.cv.cvtColor(boundary, boundaryRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < boundaryRGBA.rows; y++) for (let x = 0; x < boundaryRGBA.cols; x++) {
        const a = boundaryRGBA.ucharPtr(y, x); if (a[0] > 0) { a[0] = 16; a[1] = 185; a[2] = 129; a[3] = 255; } else { a[3] = 0; }
      } // verde (combina con contornos aceptados)

      // Overlay canvases (sync)
      const cm = document.createElement("canvas"); cm.width = maskRGBA.cols; cm.height = maskRGBA.rows; window.cv.imshow(cm, maskRGBA);
      setMaskOverlay({ canvas: cm, x: rx, y: ry, w: maskRGBA.cols, h: maskRGBA.rows });
      const ce = document.createElement("canvas"); ce.width = edgesRGBA.cols; ce.height = edgesRGBA.rows; window.cv.imshow(ce, edgesRGBA);
      setEdgesOverlay({ canvas: ce, x: rx, y: ry, w: edgesRGBA.cols, h: edgesRGBA.rows });
      const cb = document.createElement("canvas"); cb.width = boundaryRGBA.cols; cb.height = boundaryRGBA.rows; window.cv.imshow(cb, boundaryRGBA);
      setBoundaryOverlay({ canvas: cb, x: rx, y: ry, w: boundaryRGBA.cols, h: boundaryRGBA.rows });

      // Contours from opened
      const contours = new window.cv.MatVector(); const hier = new window.cv.Mat();
      window.cv.findContours(opened, contours, hier, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

      const sizesArr = []; const pts = []; const polysAll = [];
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = window.cv.contourArea(cnt); if (area < 3) continue;
        const m = window.cv.moments(cnt); const cx = m.m10 / (m.m00 || 1); const cy = m.m01 / (m.m00 || 1);

        // exclude by excls
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

      // D10/50/90
      let med = 0, p10 = 0, p90 = 0;
      if (filtered.length) {
        const sorted = [...filtered].sort((a, b) => a - b);
        med = quantile(sorted, 0.5); p10 = quantile(sorted, 0.1); p90 = quantile(sorted, 0.9);
      }
      setViz("mask"); setShowOverlays(true);
      setShowMask(true); setShowBoundary(true); setShowEdges(true); setShowContours(true); setShowCircles(false);

      setStatus(filtered.length
        ? `Listo. N=${filtered.length} | D50=${med.toFixed(1)} µm | D10=${p10.toFixed(1)} µm | D90=${p90.toFixed(1)} µm`
        : "No se detectaron partículas claras. Ajusta ROI/Exclusiones, enfoque/contraste.");

      // cleanup
      src.delete(); srcFull.delete(); gray.delete(); blur.delete(); bin.delete();
      opened.delete(); edges.delete(); eroded.delete(); boundary.delete();
      maskVis.delete(); maskRGBA.delete(); edgesRGBA.delete(); boundaryRGBA.delete();
      contours.delete(); hier.delete(); kernel.delete();
    } catch (err) { console.error(err); setStatus("Error en el análisis."); }
  }

  // ---------- Utils: IQR / quantile ----------
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

      <div ref={holderRef} className="relative w-full mt-3">
        <canvas
          ref={canvasRef}
          // NOTA: sin onWheel aquí; lo enganchamos con addEventListener({passive:false})
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="rounded bg-gray-100 w-full border border-gray-300"
          style={{ display: "block" }}
        />
      </div>
    </div>
  );
}
