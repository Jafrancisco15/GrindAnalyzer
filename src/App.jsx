import React, { useEffect, useRef, useState } from "react";
import { percentile, iqrFilter } from "./utils";
import { circleFrom3 } from "./circleFit";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const DEFAULT_BASKETS = [58.5, 58.0, 54.0, 53.0, 51.0, 49.0];

export default function App(){
  const [image, setImage] = useState(null);
  const [status, setStatus] = useState("Cargue una foto superior del portafiltro con la molienda.");
  const [cvReady, setCvReady] = useState(false);

  const canvasRef = useRef();
  const view = useRef({zoom:1, offsetX:0, offsetY:0});
  const [mode, setMode] = useState("pan"); // pan | roi | calib | exclude
  const [roi, setRoi] = useState(null);
  const [excludes, setExcludes] = useState([]);
  const [showOverlays, setShowOverlays] = useState(true);
  const down = useRef(null);

  const [basketMM, setBasketMM] = useState(58.5);
  const [customBasket, setCustomBasket] = useState("");
  const [calibPoints, setCalibPoints] = useState([]);
  const [rimCircle, setRimCircle] = useState(null); // {cx,cy,r} in image px
  const [scaleUmPerPx, setScaleUmPerPx] = useState(null);

  const [sizesUm, setSizesUm] = useState([]);
  const [particleCircles, setParticleCircles] = useState([]); // [{cx,cy,r_px,r_um}]

  // OpenCV readiness
  useEffect(()=>{
    const i = setInterval(()=>{
      if (window.cv && window.cv.Mat && window.cv.imread){
        setCvReady(true);
        clearInterval(i);
      }
    }, 200);
    return ()=>clearInterval(i);
  },[]);

  function draw(){
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!image) return;

    const {zoom, offsetX, offsetY} = view.current;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);

    // Image
    ctx.drawImage(image, 0, 0);

    if (showOverlays){
      // ROI
      if (roi){
        ctx.save();
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 2/zoom;
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.restore();
      }
      // Exclude rects
      if (excludes.length){
        ctx.save();
        ctx.fillStyle = "rgba(239,68,68,0.25)";
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2/zoom;
        excludes.forEach(r=>{
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        });
        ctx.restore();
      }
      // Rim circle
      if (rimCircle){
        ctx.save();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2/zoom;
        ctx.beginPath();
        ctx.arc(rimCircle.cx, rimCircle.cy, rimCircle.r, 0, Math.PI*2);
        ctx.stroke();
        ctx.fillStyle = "rgba(37,99,235,0.85)";
        ctx.font = `${14/zoom}px sans-serif`;
        const mm = Number(customBasket || basketMM);
        const label = `${mm} mm · ${scaleUmPerPx ? scaleUmPerPx.toFixed(1) : "—"} µm/px`;
        ctx.fillText(label, rimCircle.cx + 6/zoom, rimCircle.cy - 6/zoom);
        ctx.restore();
      }
      // Particles
      if (particleCircles.length){
        ctx.save();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5/zoom;
        particleCircles.forEach(p=>{
          ctx.beginPath();
          ctx.arc(p.cx, p.cy, p.r_px, 0, Math.PI*2);
          ctx.stroke();
        });
        ctx.restore();
      }
    }

    ctx.restore();
  }

  useEffect(()=>{ draw(); }, [image, roi, excludes, rimCircle, particleCircles, showOverlays]);

  function onWheel(e){
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const {zoom, offsetX, offsetY} = view.current;
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.1, Math.min(10, zoom*scale));
    view.current.offsetX = mx - (mx - offsetX)* (newZoom/zoom);
    view.current.offsetY = my - (my - offsetY)* (newZoom/zoom);
    view.current.zoom = newZoom;
    draw();
  }

  function toImage(file){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function onFile(e){
    const f = e.target.files?.[0];
    if (!f) return;
    const img = await toImage(f);
    setImage(img);

    // Fit to canvas
    const canvas = canvasRef.current;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width - img.width*scale)/2;
    const y = (canvas.height - img.height*scale)/2;
    view.current.zoom = scale;
    view.current.offsetX = x;
    view.current.offsetY = y;

    setStatus("Imagen cargada. Calibre el diámetro del canasto o use detección automática.");
    setRimCircle(null); setScaleUmPerPx(null);
    setParticleCircles([]); setSizesUm([]);
    setRoi(null); setExcludes([]); setCalibPoints([]);
  }

  function imgCoordsFromEvent(e){
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - view.current.offsetX) / view.current.zoom;
    const y = (e.clientY - rect.top - view.current.offsetY) / view.current.zoom;
    return {x,y};
  }

  function onMouseDown(e){
    if (!image) return;
    const p = imgCoordsFromEvent(e);
    down.current = p;
    if (mode === "roi"){
      setRoi({x:p.x, y:p.y, w:0, h:0});
    } else if (mode === "exclude"){
      setExcludes(prev=> [...prev, {x:p.x, y:p.y, w:0, h:0, _draft:true}]);
    }
  }
  function onMouseMove(e){
    if (!down.current || !image) return;
    const p = imgCoordsFromEvent(e);
    if (mode === "pan"){
      view.current.offsetX += e.movementX;
      view.current.offsetY += e.movementY;
      draw();
    } else if (mode === "roi"){
      const x0 = down.current.x, y0 = down.current.y;
      setRoi({x: Math.min(x0,p.x), y: Math.min(y0,p.y), w: Math.abs(p.x-x0), h: Math.abs(p.y-y0)});
    } else if (mode === "exclude"){
      setExcludes(prev=>{
        const arr = [...prev];
        const idx = arr.findIndex(r=>r._draft);
        if (idx>=0){
          const x0 = arr[idx].x, y0 = arr[idx].y;
          arr[idx] = {x: Math.min(x0,p.x), y: Math.min(y0,p.y), w: Math.abs(p.x-x0), h: Math.abs(p.y-y0), _draft:true};
        }
        return arr;
      });
    }
  }
  function onMouseUp(){
    if (mode === "exclude"){
      setExcludes(prev=> prev.map(r=> ({...r, _draft:false})));
    }
    down.current = null;
  }

  function addCalibPoint(){
    setMode("calib");
    setStatus("Haz clic en 3 puntos del borde interno del canasto para ajustar un círculo.");
  }
  function onClickCanvas(e){
    if (mode !== "calib" || !image) return;
    const p = imgCoordsFromEvent(e);
    setCalibPoints(prev => {
      const next = [...prev, {x:p.x,y:p.y}].slice(-3);
      if (next.length === 3){
        const c = circleFrom3(next[0], next[1], next[2]);
        if (c){
          setRimCircle(c);
          const mm = Number(customBasket || basketMM);
          const umPerPx = (mm * 1000) / (c.r*2);
          setScaleUmPerPx(umPerPx);
          setStatus(`Calibrado manual: ${umPerPx.toFixed(2)} µm/px`);
        } else {
          setStatus("No se pudo ajustar el círculo. Intente nuevos puntos.");
        }
      }
      return next;
    });
  }

  function autoDetectRim(){
    if (!cvReady || !image) { setStatus("OpenCV no está listo o no hay imagen."); return; }
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const src = window.cv.imread(canvas);
    const gray = new window.cv.Mat();
    window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
    const blur = new window.cv.Mat();
    window.cv.GaussianBlur(gray, blur, new window.cv.Size(9,9), 2, 2);
    const circles = new window.cv.Mat();
    window.cv.HoughCircles(blur, circles, window.cv.HOUGH_GRADIENT, 1.2, image.height/4, 100, 50, Math.floor(image.height*0.2), Math.floor(image.height*0.6));
    let best = null;
    for (let i=0; i<circles.cols; i++){
      const x = circles.data32F[i*3];
      const y = circles.data32F[i*3+1];
      const r = circles.data32F[i*3+2];
      const dc = Math.hypot(x - image.width/2, y - image.height/2);
      const score = -dc + r*0.5;
      if (!best || score > best.score) best = {x,y,r,score};
    }
    src.delete(); gray.delete(); blur.delete(); circles.delete();
    if (!best){
      setStatus("No se detectó el aro interno automáticamente. Use calibración manual.");
      return;
    }
    const mm = Number(customBasket || basketMM);
    const umPerPx = (mm*1000) / (best.r*2);
    setRimCircle({cx:best.x, cy:best.y, r:best.r});
    setScaleUmPerPx(umPerPx);
    setStatus(`Detección automática OK. Escala: ${umPerPx.toFixed(2)} µm/px`);
    draw();
  }

  function rectsToLocal(rect, rects){
    if (!rects || !rects.length) return [];
    if (!rect) return rects;
    return rects.map(r=>({x:r.x-rect.x, y:r.y-rect.y, w:r.w, h:r.h}))
                .filter(r=> r.x<rect.w && r.y<rect.h && r.x + r.w > 0 && r.y + r.h > 0);
  }

  function analyze(){
    if (!cvReady || !image) { setStatus("Falta imagen o OpenCV."); return; }
    if (!scaleUmPerPx || !rimCircle){ setStatus("Primero calibre la escala (um/px) con el diámetro del canasto."); return; }

    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    let src = window.cv.imread(canvas);

    let localOffset = {x:0, y:0};
    if (roi && roi.w>10 && roi.h>10){
      const rect = new window.cv.Rect(Math.max(0, roi.x|0), Math.max(0, roi.y|0), Math.min(roi.w|0, src.cols - (roi.x|0)), Math.min(roi.h|0, src.rows - (roi.y|0)));
      src = src.roi(rect);
      localOffset = {x:rect.x, y:rect.y};
    }

    const exLoc = rectsToLocal(roi, excludes);
    let mask = new window.cv.Mat(src.rows, src.cols, window.cv.CV_8UC1, new window.cv.Scalar(255));
    exLoc.forEach(r=>{
      const x = Math.max(0, r.x|0), y = Math.max(0, r.y|0);
      const w = Math.min(r.w|0, mask.cols - x), h = Math.min(r.h|0, mask.rows - y);
      if (w>0 && h>0){
        const roiM = mask.roi(new window.cv.Rect(x,y,w,h));
        roiM.setTo(new window.cv.Scalar(0));
        roiM.delete();
      }
    });

    const gray = new window.cv.Mat();
    window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);
    let masked = new window.cv.Mat();
    window.cv.bitwise_and(gray, gray, masked, mask);

    const clahe = new window.cv.CLAHE(2.0, new window.cv.Size(8,8));
    const cl = new window.cv.Mat();
    clahe.apply(masked, cl);
    const blur = new window.cv.Mat();
    window.cv.GaussianBlur(cl, blur, new window.cv.Size(3,3), 0, 0);
    const bin = new window.cv.Mat();
    window.cv.adaptiveThreshold(blur, bin, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5);

    const kernel = window.cv.getStructuringElement(window.cv.MORPH_ELLIPSE, new window.cv.Size(3,3));
    const opened = new window.cv.Mat();
    window.cv.morphologyEx(bin, opened, window.cv.MORPH_OPEN, kernel);

    const contours = new window.cv.MatVector();
    const hierarchy = new window.cv.Mat();
    window.cv.findContours(opened, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

    const sizes = [];
    const particles = [];
    for (let i=0; i<i<contours.size(); i++){
      const cnt = contours.get(i);
      const areaPx = window.cv.contourArea(cnt);
      if (areaPx < 3) continue;
      const m = window.cv.moments(cnt);
      const cx = m.m10 / (m.m00||1);
      const cy = m.m01 / (m.m00||1);
      let excluded = false;
      for (const r of exLoc){
        if (cx>=r.x && cx<=r.x+r.w && cy>=r.y && cy<=r.y+r.h){ excluded = true; break; }
      }
      if (excluded) continue;
      const d_px = 2 * Math.sqrt(areaPx / Math.PI);
      const d_um = d_px * scaleUmPerPx;
      if (d_um < 10 || d_um > 3000) continue;
      sizes.push(d_um);
      particles.push({cx: cx + localOffset.x, cy: cy + localOffset.y, r_px: d_px/2, r_um: d_um/2});
    }

    const filtered = iqrFilter(sizes);
    let finalParticles = particles;
    if (filtered.length && sizes.length){
      const q1 = percentile(sizes, 25);
      const q3 = percentile(sizes, 75);
      const iqr = q3 - q1;
      const lower = q1 - 1.5*iqr;
      const upper = q3 + 1.5*iqr;
      finalParticles = particles.filter(p=> (p.r_um*2) >= lower && (p.r_um*2) <= upper);
    }

    setSizesUm(filtered);
    setParticleCircles(finalParticles);

    src.delete(); gray.delete(); masked.delete(); cl.delete(); blur.delete(); bin.delete(); opened.delete(); kernel.delete(); contours.delete(); hierarchy.delete(); mask.delete();

    if (!filtered.length){
      setStatus("No se detectaron partículas claras en el área seleccionada. Ajuste la ROI o las exclusiones.");
      return;
    }
    const med = percentile(filtered, 50);
    const p10 = percentile(filtered, 10);
    const p90 = percentile(filtered, 90);
    setStatus(`Partículas: ${filtered.length} | D50: ${med.toFixed(1)} µm | D10: ${p10.toFixed(1)} µm | D90: ${p90.toFixed(1)} µm`);
  }

  function clearExcludes(){ setExcludes([]); draw(); }

  function exportCSV(){
    if (!sizesUm.length) return;
    const rows = ["size_um"];
    sizesUm.forEach(v=>rows.push(v.toFixed(2)));
    const blob = new Blob([rows.join("\n")], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grind_sizes_um.csv";
    a.click();
  }

  const dataHist = React.useMemo(()=>{
    if (!sizesUm.length) return null;
    const min = Math.min(...sizesUm);
    const max = Math.max(...sizesUm);
    const bins = 40;
    const step = (max-min)/bins || 1;
    const counts = new Array(bins).fill(0);
    sizesUm.forEach(v=>{
      let idx = Math.floor((v - min)/step);
      if (idx >= bins) idx = bins-1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    });
    const labels = counts.map((_,i)=> (min + i*step).toFixed(0));
    return {labels, counts};
  }, [sizesUm]);

  return (
    <div className="max-w-7xl mx-auto p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">GrindSizer — Análisis desde el Portafiltro</h1>
        <p className="text-gray-600">{status}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <div className="bg-white rounded-2xl shadow p-3">
            <div className="flex items-center gap-3 mb-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="font-medium">Imagen</span>
                <input type="file" accept="image/*" onChange={onFile} className="text-sm"/>
              </label>
              <button onClick={()=>setMode("pan")} className={`px-3 py-1 rounded ${mode==="pan"?"bg-blue-600 text-white":"bg-gray-100"}`}>Mover</button>
              <button onClick={()=>setMode("roi")} className={`px-3 py-1 rounded ${mode==="roi"?"bg-blue-600 text-white":"bg-gray-100"}`}>ROI</button>
              <button onClick={()=>setMode("exclude")} className={`px-3 py-1 rounded ${mode==="exclude"?"bg-pink-600 text-white":"bg-gray-100"}`}>Excluir</button>
              <button onClick={clearExcludes} className="px-3 py-1 rounded bg-pink-100">Limpiar exclusiones</button>
              <button onClick={addCalibPoint} className={`px-3 py-1 rounded ${mode==="calib"?"bg-blue-600 text-white":"bg-gray-100"}`}>Calibrar (3 puntos)</button>
              <button onClick={autoDetectRim} className="px-3 py-1 rounded bg-emerald-600 text-white">Detectar Aro</button>
              <label className="ml-auto inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showOverlays} onChange={(e)=>setShowOverlays(e.target.checked)} />
                <span>Overlays</span>
              </label>
            </div>
            <div className="relative w-full" style={{height: 520}}>
              <canvas
                ref={canvasRef}
                width={960}
                height={520}
                className="w-full h-full bg-gray-200 rounded"
                onWheel={onWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onClick={onClickCanvas}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-600">Escala (µm/px):</span>
              <span className="text-sm font-semibold">{scaleUmPerPx ? scaleUmPerPx.toFixed(2) : "—"}</span>
              <button onClick={analyze} className="ml-auto px-3 py-1 rounded bg-indigo-600 text-white">Analizar</button>
              <button onClick={exportCSV} className="px-3 py-1 rounded bg-gray-800 text-white disabled:opacity-50" disabled={!sizesUm.length}>CSV</button>
            </div>
          </div>
        </div>

        <aside className="md:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">Diámetro interno del canasto</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {DEFAULT_BASKETS.map(mm=>(
                <button key={mm} onClick={()=>{setBasketMM(mm); setCustomBasket(""); if (rimCircle){ const um = (mm*1000)/(rimCircle.r*2); setScaleUmPerPx(um);} }} className={`px-2 py-1 rounded border ${basketMM===mm && !customBasket ? 'bg-gray-900 text-white' : 'bg-white'}`}>{mm} mm</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={customBasket} onChange={e=>setCustomBasket(e.target.value)} placeholder="Otro (mm)" className="w-28 border rounded px-2 py-1"/>
              <button onClick={()=>{const mm = Number(customBasket)||basketMM; setBasketMM(mm); if (rimCircle){ const um = (mm*1000)/(rimCircle.r*2); setScaleUmPerPx(um);} }} className="px-2 py-1 rounded bg-gray-100">Usar</button>
            </div>
            <p className="text-xs text-gray-600 mt-2">La escala µm/px se calcula con el aro interno detectado/dibujado.</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">Resultados</h3>
            {sizesUm.length ? (
              <ul className="text-sm space-y-1">
                <li>N = <b>{sizesUm.length}</b></li>
                <li>D50 (mediana) = <b>{percentile(sizesUm,50).toFixed(1)} µm</b></li>
                <li>D10 = <b>{percentile(sizesUm,10).toFixed(1)} µm</b></li>
                <li>D90 = <b>{percentile(sizesUm,90).toFixed(1)} µm</b></li>
                <li>Promedio = <b>{(sizesUm.reduce((a,b)=>a+b,0)/sizesUm.length).toFixed(1)} µm</b></li>
              </ul>
            ) : <p className="text-sm text-gray-600">Sin datos aún.</p>}
          </div>
        </aside>
      </div>

      <section className="mt-6 bg-white rounded-2xl shadow p-3">
        <h3 className="font-medium mb-3">Histograma de distribución</h3>
        {dataHist ? (
          <Bar data={{
            labels: dataHist.labels,
            datasets: [{
              label: 'Frecuencia',
              data: dataHist.counts,
            }]
          }} options={{
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: 'Tamaño (µm, inicio de bin)' } },
              y: { title: { display: true, text: 'Conteo' } }
            }
          }} />
        ) : <p className="text-sm text-gray-600">Analiza para ver el histograma.</p>}
      </section>

      <footer className="mt-6 text-xs text-gray-500">
        El círculo azul muestra el aro medido; las zonas rojas son exclusiones; las partículas se dibujan en ámbar. Usa ROI + exclusiones para obviar áreas poco claras.
      </footer>
    </div>
  );
}
