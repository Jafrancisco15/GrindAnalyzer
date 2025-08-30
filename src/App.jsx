import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Grind Analyzer – Portafiltro (overlays con selector)
 * - Overlays opcionales: Máscara (opened), Borde de máscara (boundary), Canny, Contornos reales, Círculos equivalentes
 * - Lupa opcional
 * - Paneo por cursor
 * - Aro para escala (Hough o manual)
 * - Pipeline con OpenCV.js (se requiere <script src="https://docs.opencv.org/4.x/opencv.js"> en index.html)
 */

export default function App() {
  // Refs de canvas y vista
  const canvasRef = useRef(null);
  const holderRef = useRef(null);
  const view = useRef({ ox: 0, oy: 0, zoom: 1 });

  // Imagen base
  const [img, setImg] = useState(null);
  const imgRef = useRef(null);

  // Estados de análisis
  const [sizes, setSizes] = useState([]); // tamaños (µm)
  const [particles, setParticles] = useState([]); // [{cx,cy,r_px,r_um}]
  const [contoursPoly, setContoursPoly] = useState([]); // [{pts:[{x,y}..], accepted, cx, cy, d_um, ...}]

  // Overlays (canvases construidos desde Mats)
  const [maskOverlay, setMaskOverlay] = useState(null);     // {canvas,x,y,w,h}
  const [edgesOverlay, setEdgesOverlay] = useState(null);   // {canvas,x,y,w,h}
  const [boundaryOverlay, setBoundaryOverlay] = useState(null); // {canvas,x,y,w,h}

  // Selector de overlays (opcionales)
  const [showOverlays, setShowOverlays] = useState(true);
  const [overlayPreset, setOverlayPreset] = useState("auditar");
  const [overlayAlpha, setOverlayAlpha] = useState(0.6);
  const [showMask, setShowMask] = useState(true);
  const [showBoundary, setShowBoundary] = useState(true);
  const [showEdges, setShowEdges] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [showCircles, setShowCircles] = useState(false);

  // Lupa
  const [lensEnabled, setLensEnabled] = useState(false);
  const lens = useRef({ visible: false, sx: 0, sy: 0, imgx: 0, imgy: 0 });
  const lensRadius = 80;
  const lensFactor = 2.0;

  // ROI / Exclusiones (opcional)
  const [roi, setRoi] = useState(null);            // {x,y,w,h} en coordenadas de imagen
  const [excls, setExcls] = useState([]);          // [{x,y,w,h}]

  // Aro / escala
  const [rim, setRim] = useState(null);            // {cx,cy,r}
  const [basketMM, setBasketMM] = useState(58);    // diámetro interno típico (mm)
  const [customMM, setCustomMM] = useState("");
  const [umPerPx, setUmPerPx] = useState(0);       // micras por píxel
  const [viz, setViz] = useState("mask");          // 'mask' | 'edges' | 'none' (solo para gating básico)

  // UI
  const [status, setStatus] = useState("Sube una imagen y detecta el aro para calibrar la escala.");

  // ============== Utilidades de dibujo ==============

  function fitView() {
    const c = canvasRef.current;
    if (!c || !img) return;
    // centra la imagen en el canvas con un zoom que la ajuste
    const pad = 16;
    const zx = (c.width - pad * 2) / img.width;
    const zy = (c.height - pad * 2) / img.height;
    const z = Math.max(0.05, Math.min(zx, zy));
    view.current.zoom = z;
    view.current.ox = (c.width - img.width * z) * 0.5;
    view.current.oy = (c.height - img.height * z) * 0.5;
  }

  function worldToImage(x, y) {
    // de coords canvas (pantalla) a coords imagen (mundo)
    const z = view.current.zoom;
    const ix = (x - view.current.ox) / z;
    const iy = (y - view.current.oy) / z;
    return { x: ix, y: iy };
  }

  function imageToWorld(ix, iy) {
    const z = view.current.zoom;
    const x = ix * z + view.current.ox;
    const y = iy * z + view.current.oy;
    return { x, y };
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

    // overlays independientes (opcionales)
    if (viz !== "none") {
      if ((showOverlays || showMask) && maskOverlay && maskOverlay.canvas) {
        g.save();
        g.globalAlpha = overlayAlpha;
        g.drawImage(
          maskOverlay.canvas,
          maskOverlay.x,
          maskOverlay.y,
          maskOverlay.w,
          maskOverlay.h
        );
        g.restore();
      }
      if (
        (showOverlays || (typeof showBoundary !== "undefined" && showBoundary)) &&
        boundaryOverlay &&
        boundaryOverlay.canvas
      ) {
        g.save();
        g.globalAlpha = Math.min(1, overlayAlpha + 0.15);
        g.drawImage(
          boundaryOverlay.canvas,
          boundaryOverlay.x,
          boundaryOverlay.y,
          boundaryOverlay.w,
          boundaryOverlay.h
        );
        g.restore();
      }
      if ((showOverlays || showEdges) && edgesOverlay && edgesOverlay.canvas) {
        g.save();
        g.globalAlpha = Math.min(1, overlayAlpha + 0.25);
        g.drawImage(
          edgesOverlay.canvas,
          edgesOverlay.x,
          edgesOverlay.y,
          edgesOverlay.w,
          edgesOverlay.h
        );
        g.restore();
      }
    }

    // ROI y Exclusiones
    if (roi) {
      g.save();
      g.strokeStyle = "#10b981";
      g.lineWidth = 2 / view.current.zoom;
      g.strokeRect(roi.x, roi.y, roi.w, roi.h);
      g.restore();
    }
    if (excls && excls.length) {
      g.save();
      g.fillStyle = "rgba(239,68,68,0.25)";
      g.strokeStyle = "#ef4444";
      g.lineWidth = 2 / view.current.zoom;
      excls.forEach((r) => {
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeRect(r.x, r.y, r.w, r.h);
      });
      g.restore();
    }

    // aro + escala
    if (rim) {
      g.save();
      g.strokeStyle = "#fcd34d";
      g.lineWidth = 2 / view.current.zoom;
      g.beginPath();
      g.arc(rim.cx, rim.cy, rim.r, 0, Math.PI * 2);
      g.stroke();
      const label = `${Number(customMM || basketMM)} mm · ${
        umPerPx ? umPerPx.toFixed(1) : "—"
      } µm/px`;
      g.fillStyle = "rgba(250,204,21,0.85)";
      g.font = `${14 / view.current.zoom}px sans-serif`;
      g.fillText(label, rim.cx + 6 / view.current.zoom, rim.cy - 6 / view.current.zoom);
      g.restore();
    }

    // círculos equivalentes (d_eq) – opcional
    if (showCircles && particles && particles.length) {
      g.save();
      g.strokeStyle = "#fde68a";
      g.setLineDash([5 / view.current.zoom, 3 / view.current.zoom]);
      g.lineWidth = 1.5 / view.current.zoom;
      particles.forEach((p) => {
        g.beginPath();
        g.arc(p.cx, p.cy, p.r_px, 0, Math.PI * 2);
        g.stroke();
      });
      g.setLineDash([]);
      g.restore();
    }

    // contornos reales – opcional
    if (showContours && contoursPoly && contoursPoly.length) {
      g.save();
      g.lineWidth = 1.5 / view.current.zoom;
      contoursPoly.forEach((cn) => {
        const pts = cn.pts;
        if (!pts || pts.length < 2) return;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          g.lineTo(pts[i].x, pts[i].y);
        }
        g.closePath();
        if (cn.accepted) {
          g.strokeStyle = "#f59e0b";
          g.fillStyle = "rgba(245,158,11,0.12)";
          g.fill();
          g.stroke();
        } else {
          g.strokeStyle = "rgba(245,158,11,0.35)";
          g.setLineDash([4 / view.current.zoom, 3 / view.current.zoom]);
          g.stroke();
          g.setLineDash([]);
        }
      });
      g.restore();
    }

    g.restore();

    // Lupa (opcional)
    if (img && lensEnabled && lens.current && lens.current.visible) {
      const { sx, sy, imgx, imgy } = lens.current;
      const r = lensRadius;
      const z = view.current.zoom * lensFactor;
      const ox = sx - imgx * z;
      const oy = sy - imgy * z;
      g.save();
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.clip();
      g.save();
      g.translate(ox, oy);
      g.scale(z, z);
      g.drawImage(img, 0, 0);
      g.restore();
      g.strokeStyle = "#fcd34d";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  useEffect(draw, [img, rim, roi, excls, maskOverlay, edgesOverlay, boundaryOverlay, particles, contoursPoly, showOverlays, showMask, showBoundary, showEdges, showContours, showCircles, overlayAlpha, viz, lensEnabled]);

  // ============== Eventos de interacción (pan/zoom/lupa) ==============

  function onWheel(e) {
    if (e && e.cancelable) e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const before = worldToImage(x, y);
    const dz = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const z2 = Math.min(8, Math.max(0.05, view.current.zoom * dz));
    view.current.zoom = z2;
    const after = imageToWorld(before.x, before.y);
    view.current.ox += x - after.x;
    view.current.oy += y - after.y;
    draw();
  }

  const drag = useRef({ active: false, lastX: 0, lastY: 0 });
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    if (lensEnabled) {
      const rect = canvasRef.current.getBoundingClientRect();
      lens.current.visible = true;
      lens.current.sx = e.clientX - rect.left;
      lens.current.sy = e.clientY - rect.top;
      const im = worldToImage(lens.current.sx, lens.current.sy);
      lens.current.imgx = im.x;
      lens.current.imgy = im.y;
      draw();
    }
  }
  function onPointerMove(e) {
    if (drag.current.active) {
      const dx = e.clientX - drag.current.lastX;
      const dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX;
      drag.current.lastY = e.clientY;
      view.current.ox += dx;
      view.current.oy += dy;
      draw();
    }
    if (lensEnabled && lens.current.visible) {
      const rect = canvasRef.current.getBoundingClientRect();
      lens.current.sx = e.clientX - rect.left;
      lens.current.sy = e.clientY - rect.top;
      draw();
    }
  }
  function onPointerUp(e) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current.active = false;
    if (lensEnabled) {
      lens.current.visible = false;
      draw();
    }
  }

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const holder = holderRef.current;
      const W = holder ? holder.clientWidth : window.innerWidth;
      const H = Math.max(300, window.innerHeight - 160);
      c.width = Math.floor(W);
      c.height = Math.floor(H);
      if (img) fitView();
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    // listeners no pasivos para wheel/touch
    const wheelHandler = (ev) => onWheel(ev);
    c.addEventListener("wheel", wheelHandler, { passive: false });
    return () => {
      window.removeEventListener("resize", resize);
      c.removeEventListener("wheel", wheelHandler);
    };
  }, [img]);

  // ============== Carga de imagen ==============

  async function handleFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      imgRef.current = im;
      setImg(im);
      setRim(null);
      setRoi(null);
      setExcls([]);
      setMaskOverlay(null);
      setEdgesOverlay(null);
      setBoundaryOverlay(null);
      setParticles([]);
      setContoursPoly([]);
      setSizes([]);
      setStatus("Imagen cargada. Detecta el aro para calibrar la escala.");
      fitView();
      draw();
      URL.revokeObjectURL(url);
    };
    im.src = url;
  }

  // ============== Detección de aro (Hough) ==============

  function detectRim() {
    try {
      if (!window.cv || !img) {
        setStatus("OpenCV no disponible o imagen no cargada.");
        return;
      }
      // Escala reducida para Hough
      const maxSide = 900;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.floor(img.width * scale));
      const h = Math.max(1, Math.floor(img.height * scale));
      const src = new window.cv.Mat(h, w, window.cv.CV_8UC4);
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = w;
      tmpCanvas.height = h;
      const g = tmpCanvas.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      const imgData = g.getImageData(0, 0, w, h);
      src.data.set(imgData.data);
      const gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
      const blur = new window.cv.Mat();
      window.cv.GaussianBlur(gray, blur, new window.cv.Size(9, 9), 2, 2, window.cv.BORDER_DEFAULT);
      const circles = new window.cv.Mat();
      window.cv.HoughCircles(
        blur,
        circles,
        window.cv.HOUGH_GRADIENT,
        1,
        50,
        100,
        30,
        Math.floor(Math.min(w, h) * 0.25),
        Math.floor(Math.min(w, h) * 0.49)
      );
      if (circles.rows > 0) {
        // tomar el primero
        const cx = circles.data32F[0];
        const cy = circles.data32F[1];
        const r = circles.data32F[2];
        // reescala a coords de la imagen original
        const inv = 1 / scale;
        const rimNew = { cx: cx * inv, cy: cy * inv, r: r * inv };
        setRim(rimNew);
        const mm = Number(customMM || basketMM);
        const micronsPerPx = (mm * 1000) / (2 * rimNew.r);
        setUmPerPx(micronsPerPx);
        setStatus(`Aro detectado. Escala: ${micronsPerPx.toFixed(1)} µm/px`);
      } else {
        setStatus("No se detectó aro. Ajusta la imagen o intenta manualmente.");
      }
      src.delete(); gray.delete(); blur.delete(); circles.delete();
    } catch (err) {
      console.error(err);
      setStatus("Error detectando aro (Hough).");
    }
  }

  // ============== Análisis de molienda (pipeline) ==============

  function analyze() {
    try {
      if (!window.cv || !img) {
        setStatus("OpenCV no disponible o imagen no cargada.");
        return;
      }
      const mm = Number(customMM || basketMM);
      if (!rim || !rim.r || !mm || mm <= 0) {
        setStatus("Falta calibrar el aro/diámetro para obtener micras.");
        return;
      }
      const um_per_px = (mm * 1000) / (2 * rim.r);
      setUmPerPx(um_per_px);

      // ROI local
      const rx = roi ? Math.max(0, Math.floor(roi.x)) : 0;
      const ry = roi ? Math.max(0, Math.floor(roi.y)) : 0;
      const rw = roi ? Math.min(img.width - rx, Math.floor(roi.w)) : img.width;
      const rh = roi ? Math.min(img.height - ry, Math.floor(roi.h)) : img.height;
      const localOff = { x: rx, y: ry };

      // Crear Mat desde ROI
      const srcFull = new window.cv.Mat(img.height, img.width, window.cv.CV_8UC4);
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = img.width;
      tmpCanvas.height = img.height;
      const gg = tmpCanvas.getContext("2d");
      gg.drawImage(img, 0, 0);
      const imgData = gg.getImageData(0, 0, img.width, img.height);
      srcFull.data.set(imgData.data);
      const roiRect = new window.cv.Rect(rx, ry, rw, rh);
      const src = srcFull.roi(roiRect);

      // Preprocesado: gris → CLAHE → blur
      const gray = new window.cv.Mat();
      window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
      const clahe = new window.cv.createCLAHE(2.0, new window.cv.Size(8, 8));
      clahe.apply(gray, gray);
      const blur = new window.cv.Mat();
      window.cv.GaussianBlur(gray, blur, new window.cv.Size(3, 3), 0, 0, window.cv.BORDER_DEFAULT);

      // Umbral adaptativo (Gauss, invertido)
      const bin = new window.cv.Mat();
      window.cv.adaptiveThreshold(blur, bin, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5);

      // Exclusiones (píxeles a 0)
      if (excls && excls.length) {
        excls.forEach((r) => {
          const xx = Math.max(0, Math.floor(r.x - rx));
          const yy = Math.max(0, Math.floor(r.y - ry));
          const ww = Math.max(0, Math.min(rw - xx, Math.floor(r.w)));
          const hh = Math.max(0, Math.min(rh - yy, Math.floor(r.h)));
          if (ww > 0 && hh > 0) {
            const sub = bin.roi(new window.cv.Rect(xx, yy, ww, hh));
            sub.setTo(new window.cv.Scalar(0));
            sub.delete();
          }
        });
      }

      // Apertura morfológica (kernel elíptico 3x3)
      const kernel = window.cv.getStructuringElement(window.cv.MORPH_ELLIPSE, new window.cv.Size(3, 3));
      const opened = new window.cv.Mat();
      window.cv.morphologyEx(bin, opened, window.cv.MORPH_OPEN, kernel);

      // Canny (sobre gris mejorado)
      const edges = new window.cv.Mat();
      window.cv.Canny(blur, edges, 50, 150);

      // Borde de máscara (opened - eroded(opened))
      const eroded = new window.cv.Mat();
      window.cv.erode(opened, eroded, kernel);
      const boundary = new window.cv.Mat();
      window.cv.subtract(opened, eroded, boundary);

      // Overlays (RGBA) coloreados
      const maskVis = new window.cv.Mat();
      opened.copyTo(maskVis);
      const maskRGBA = new window.cv.Mat();
      window.cv.cvtColor(maskVis, maskRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < maskRGBA.rows; y++) {
        for (let x = 0; x < maskRGBA.cols; x++) {
          const a = maskRGBA.ucharPtr(y, x);
          if (a[0] > 0) {
            a[0] = 255; a[1] = 160; a[2] = 0; a[3] = 200; // ámbar translúcido
          } else {
            a[3] = 0;
          }
        }
      }

      const edgesRGBA = new window.cv.Mat();
      window.cv.cvtColor(edges, edgesRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < edgesRGBA.rows; y++) {
        for (let x = 0; x < edgesRGBA.cols; x++) {
          const a = edgesRGBA.ucharPtr(y, x);
          if (a[0] > 0) {
            a[0] = 255; a[1] = 255; a[2] = 255; a[3] = 255; // blanco
          } else {
            a[3] = 0;
          }
        }
      }

      const boundaryRGBA = new window.cv.Mat();
      window.cv.cvtColor(boundary, boundaryRGBA, window.cv.COLOR_GRAY2RGBA, 0);
      for (let y = 0; y < boundaryRGBA.rows; y++) {
        for (let x = 0; x < boundaryRGBA.cols; x++) {
          const a = boundaryRGBA.ucharPtr(y, x);
          if (a[0] > 0) {
            a[0] = 255; a[1] = 215; a[2] = 0; a[3] = 255; // dorado
          } else {
            a[3] = 0;
          }
        }
      }

      // Canvases para overlays (sin async)
      const cm = document.createElement("canvas");
      cm.width = maskRGBA.cols; cm.height = maskRGBA.rows;
      window.cv.imshow(cm, maskRGBA);
      setMaskOverlay({ canvas: cm, x: localOff.x, y: localOff.y, w: maskRGBA.cols, h: maskRGBA.rows });

      const ce = document.createElement("canvas");
      ce.width = edgesRGBA.cols; ce.height = edgesRGBA.rows;
      window.cv.imshow(ce, edgesRGBA);
      setEdgesOverlay({ canvas: ce, x: localOff.x, y: localOff.y, w: edgesRGBA.cols, h: edgesRGBA.rows });

      const cb = document.createElement("canvas");
      cb.width = boundaryRGBA.cols; cb.height = boundaryRGBA.rows;
      window.cv.imshow(cb, boundaryRGBA);
      setBoundaryOverlay({ canvas: cb, x: localOff.x, y: localOff.y, w: boundaryRGBA.cols, h: boundaryRGBA.rows });

      // Contornos sobre "opened"
      const contours = new window.cv.MatVector();
      const hier = new window.cv.Mat();
      window.cv.findContours(opened, contours, hier, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

      const sizesArr = [];
      const pts = [];
      const polysAll = [];
      let soliditySum = 0, solidityCount = 0;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = window.cv.contourArea(cnt);
        if (area < 3) continue;

        const m = window.cv.moments(cnt);
        const cx = m.m10 / (m.m00 || 1);
        const cy = m.m01 / (m.m00 || 1);

        // excluir por zonas
        let bad = false;
        for (const r of excls) {
          if (cx >= r.x - rx && cx <= r.x - rx + r.w && cy >= r.y - ry && cy <= r.y - ry + r.h) {
            bad = true; break;
          }
        }
        if (bad) continue;

        // perimetro + polígono aproximado (overlay contornos)
        const per = window.cv.arcLength(cnt, true);
        const approx = new window.cv.Mat();
        window.cv.approxPolyDP(cnt, approx, 0.8, true);
        const ptsPoly = [];
        for (let j = 0; j < approx.rows; j++) {
          const px = approx.intPtr(j, 0)[0];
          const py = approx.intPtr(j, 0)[1];
          ptsPoly.push({ x: px + localOff.x, y: py + localOff.y });
        }
        approx.delete();

        // tamaño
        const dpx = 2 * Math.sqrt(area / Math.PI);
        const dum = dpx * um_per_px;
        if (dum < 10 || dum > 3000) continue; // filtros duros
        sizesArr.push(dum);
        pts.push({ cx: cx + localOff.x, cy: cy + localOff.y, r_px: dpx / 2, r_um: dum / 2 });

        // solidez
        const hull = new window.cv.Mat();
        window.cv.convexHull(cnt, hull, false, true);
        const hullArea = window.cv.contourArea(hull);
        let solidity = 0;
        if (hullArea > 0) {
          solidity = area / hullArea;
          soliditySum += solidity; solidityCount += 1;
        }
        hull.delete();

        polysAll.push({
          pts: ptsPoly,
          cx: cx + localOff.x,
          cy: cy + localOff.y,
          area_px: area,
          per_px: per,
          d_um: dum,
          solidity,
          circularity: per > 0 ? (4 * Math.PI * area) / (per * per) : 0
        });
      }

      // Filtro IQR
      const filtered = iqrFilter(sizesArr);
      const finalPts = pts.filter(p => {
        const d = p.r_um * 2;
        return filtered.includes(d);
      });

      setSizes(filtered);
      setParticles(finalPts);

      const records = [];
      let polys = [];
      if (filtered.length) {
        const lo = Math.min(...filtered), hi = Math.max(...filtered);
        polys = polysAll.map(poly => {
          const ok = poly.d_um >= lo && poly.d_um <= hi;
          if (ok) {
            records.push({
              cx_px: poly.cx,
              cy_px: poly.cy,
              d_um: poly.d_um,
              area_um2: poly.area_px * (um_per_px * um_per_px),
              per_um: poly.per_px * um_per_px,
              solidity: poly.solidity,
              circularity: poly.circularity
            });
          }
          return { ...poly, accepted: ok };
        });
      } else {
        polys = polysAll.map(poly => ({ ...poly, accepted: false }));
      }
      setContoursPoly(polys);

      // Métricas D10/D50/D90
      let med = 0, p10 = 0, p90 = 0;
      if (filtered.length) {
        const sorted = [...filtered].sort((a, b) => a - b);
        med = quantile(sorted, 0.5);
        p10 = quantile(sorted, 0.1);
        p90 = quantile(sorted, 0.9);
      }
      setViz("mask");
      setShowOverlays(true);
      setShowMask(true); setShowBoundary(true); setShowEdges(true); setShowContours(true); setShowCircles(false);

      if (!filtered.length) {
        setStatus("No se detectaron partículas claras. Ajusta ROI/Exclusiones, mejora enfoque/contraste.");
      } else {
        setStatus(`Listo. N=${filtered.length} | D50=${med.toFixed(1)} µm | D10=${p10.toFixed(1)} µm | D90=${p90.toFixed(1)} µm · Usa el selector de overlays`);
      }

      // limpieza
      src.delete(); srcFull.delete(); gray.delete(); blur.delete(); bin.delete();
      opened.delete(); edges.delete(); eroded.delete(); boundary.delete();
      maskVis.delete(); maskRGBA.delete(); edgesRGBA.delete(); boundaryRGBA.delete();
      contours.delete(); hier.delete();
      kernel.delete();
    } catch (err) {
      console.error(err);
      setStatus("Error en el análisis.");
    }
  }

  // ============== Utilidades: IQR / Cuantiles ==============

  function iqrFilter(arr) {
    if (!arr || !arr.length) return [];
    const a = [...arr].sort((x, y) => x - y);
    const q1 = quantile(a, 0.25);
    const q3 = quantile(a, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    return a.filter((v) => v >= lo && v <= hi);
  }
  function quantile(sortedAsc, q) {
    const n = sortedAsc.length;
    if (!n) return 0;
    const pos = (n - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sortedAsc[base + 1] !== undefined) {
      return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
    } else {
      return sortedAsc[base];
    }
  }

  // ============== UI ==============

  useEffect(() => {
    // Si cambia el preset, aplicar toggles comunes
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

  return (
    <div className="max-w-7xl mx-auto p-4 bg-black text-yellow-300 min-h-screen">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Grind Analyzer – Portafiltro</h1>

        <label className="ml-4 text-sm">
          Imagen
          <input type="file" accept="image/*" onChange={handleFile} className="ml-2" />
        </label>

        <label className="text-sm ml-2">
          Diámetro canasto (mm)
          <input
            type="number"
            step="0.1"
            className="ml-2 w-24 border border-yellow-700 rounded bg-neutral-900 text-yellow-100 px-2 py-1"
            value={customMM}
            placeholder={String(basketMM)}
            onChange={(e) => setCustomMM(e.target.value)}
          />
        </label>

        <button
          onClick={detectRim}
          className="px-3 py-1 rounded bg-yellow-500 text-black border border-yellow-700"
        >
          Detectar aro
        </button>

        <button
          onClick={analyze}
          className="px-3 py-1 rounded bg-yellow-600 text-black border border-yellow-700"
        >
          Analizar
        </button>

        <label className="inline-flex items-center gap-2 text-sm ml-2">
          <input
            type="checkbox"
            checked={lensEnabled}
            onChange={(e) => setLensEnabled(e.target.checked)}
          />
          <span>Lupa</span>
        </label>

        {/* Selector de overlays */}
        <div className="ml-auto flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-sm">
              Preset
              <select
                value={overlayPreset}
                onChange={(e) => setOverlayPreset(e.target.value)}
                className="ml-1 border border-yellow-700 rounded px-1 py-0.5 text-sm bg-black text-yellow-300"
              >
                <option value="auditar">Auditar (Máscara+Borde+Canny+Contornos)</option>
                <option value="todos">Todos</option>
                <option value="solo-mascara">Solo Máscara</option>
                <option value="poligonos">Polígonos</option>
                <option value="ninguno">Ninguno</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showMask}
                onChange={(e) => setShowMask(e.target.checked)}
              />
              <span>Máscara</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showBoundary}
                onChange={(e) => setShowBoundary(e.target.checked)}
              />
              <span>Borde máscara</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showEdges}
                onChange={(e) => setShowEdges(e.target.checked)}
              />
              <span>Canny</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showContours}
                onChange={(e) => setShowContours(e.target.checked)}
              />
              <span>Contornos</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showCircles}
                onChange={(e) => setShowCircles(e.target.checked)}
              />
              <span>Círculos</span>
            </label>

            <label className="text-sm">
              Intensidad
              <input
                type="range"
                min="0.15"
                max="1"
                step="0.05"
                value={overlayAlpha}
                onChange={(e) => setOverlayAlpha(parseFloat(e.target.value))}
                className="ml-1 align-middle"
              />
            </label>
          </div>
        </div>
      </header>

      <p className="mt-2 text-sm text-yellow-500">{status}</p>

      <div ref={holderRef} className="relative w-full mt-3">
        <canvas
          ref={canvasRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="rounded bg-neutral-800 w-full border border-yellow-700"
          style={{ display: "block" }}
        />
      </div>
    </div>
  );
}
