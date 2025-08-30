import React, { useEffect, useRef, useState } from "react";
import phones from "./data/phones.json";
import { percentile, iqrFilter } from "./utils";
import { circleFrom3 } from "./circleFit";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const DEFAULT_BASKETS = [58.5, 58.0, 54.0, 53.0, 51.0, 49.0];

export default function App(){
  const [imgURL, setImgURL] = useState(null);
  const [image, setImage] = useState(null);
  const [phoneQuery, setPhoneQuery] = useState("");
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [basketMM, setBasketMM] = useState(58.5);
  const [customBasket, setCustomBasket] = useState("");
  const [status, setStatus] = useState("Cargue una foto superior del portafiltro con la molienda.");
  const [cvReady, setCvReady] = useState(false);
  const [roi, setRoi] = useState(null);
  const [mode, setMode] = useState("pan"); // 'pan' | 'roi' | 'calib'
  const [calibPoints, setCalibPoints] = useState([]); // 3 points for manual circle
  const [scaleUmPerPx, setScaleUmPerPx] = useState(null); // microns/pixel
  const [sizesUm, setSizesUm] = useState([]);
  const [overlay, setOverlay] = useState(true);
  const canvasRef = useRef();
  const view = useRef({zoom:1, offsetX:0, offsetY:0});
  const imgDim = useRef({w:0,h:0});
  const down = useRef(null);

  // Load extended phone DB if present
  useEffect(()=>{
    fetch('/phones-extended.json').then(r=>{
      if (r.ok) return r.json();
      return null;
    }).then(j=>{
      if (j && Array.isArray(j)) {
        // merge unique
        const key = (p)=> (p.brand+' '+p.model).toLowerCase();
        const baseMap = new Map(phones.map(p=>[key(p), p]));
        j.forEach(p=>{ baseMap.set(key(p), p); });
        const merged = Array.from(baseMap.values());
        // @ts-ignore
        window.__PHONES__ = merged;
      } else {
        // @ts-ignore
        window.__PHONES__ = phones;
      }
    }).catch(()=>{
      // @ts-ignore
      window.__PHONES__ = phones;
    })
  },[]);

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
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    const {zoom, offsetX, offsetY} = view.current;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);
    ctx.drawImage(image, 0, 0);
    ctx.restore();

    if (roi){
      ctx.save();
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
      ctx.restore();
    }
    if (mode === "calib"){
      ctx.save();
      ctx.fillStyle = "#ef4444";
      calibPoints.forEach(p=>{
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
        ctx.fill();
      });
      if (calibPoints.length === 3){
        const c = circleFrom3(calibPoints[0], calibPoints[1], calibPoints[2]);
        if (c){
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.cx, c.cy, c.r, 0, Math.PI*2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  useEffect(()=>{ draw(); }, [image, roi, mode, calibPoints]);

  function onWheel(e){
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const {zoom, offsetX, offsetY} = view.current;
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.1, Math.min(10, zoom*scale));
    // Zoom to cursor
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
    setImgURL(URL.createObjectURL(f));
    const img = await toImage(f);
    setImage(img);
    imgDim.current = {w: img.width, h: img.height};
    // Fit to canvas
    const canvas = canvasRef.current;
    if (canvas){
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const x = (canvas.width - img.width*scale)/2;
      const y = (canvas.height - img.height*scale)/2;
      view.current.zoom = scale;
      view.current.offsetX = x;
      view.current.offsetY = y;
    }
    setStatus("Imagen cargada. Calibre el diámetro del canasto o use detección automática.");
    // Read EXIF
    if (window.EXIF){
      window.EXIF.getData(f, function(){
        const make = window.EXIF.getTag(this, "Make");
        const model = window.EXIF.getTag(this, "Model");
        const fl = window.EXIF.getTag(this, "FocalLength");
        const fl35 = window.EXIF.getTag(this, "FocalLengthIn35mmFilm");
        const subDist = window.EXIF.getTag(this, "SubjectDistance");
        console.log("EXIF:", {make, model, fl, fl35, subDist});
      });
    }
  }

  function onMouseDown(e){
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - view.current.offsetX) / view.current.zoom;
    const y = (e.clientY - rect.top - view.current.offsetY) / view.current.zoom;
    down.current = {x, y};
    if (mode === "roi"){
      setRoi({x, y, w:0, h:0});
    }
  }
  function onMouseMove(e){
    if (!down.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - view.current.offsetX) / view.current.zoom;
    const y = (e.clientY - rect.top - view.current.offsetY) / view.current.zoom;
    if (mode === "pan"){
      view.current.offsetX += e.movementX;
      view.current.offsetY += e.movementY;
      draw();
    } else if (mode === "roi"){
      const x0 = down.current.x, y0 = down.current.y;
      setRoi({x: Math.min(x0,x), y: Math.min(y0,y), w: Math.abs(x-x0), h: Math.abs(y-y0)});
    } else if (mode === "calib"){
      // do nothing during drag
    }
  }
  function onMouseUp(){
    down.current = null;
  }
  function addCalibPoint(){
    setMode("calib");
    setStatus("Haz clic en 3 puntos del borde interno del canasto para ajustar un círculo.");
    // next clicks recorded in handler below
  }
  function onClickCanvas(e){
    if (mode !== "calib") return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - view.current.offsetX) / view.current.zoom;
    const y = (e.clientY - rect.top - view.current.offsetY) / view.current.zoom;
    setCalibPoints(prev => {
      const next = [...prev, {x,y}].slice(-3);
      if (next.length === 3){
        const c = circleFrom3(next[0], next[1], next[2]);
        if (c){
          // compute um/px from basket diameter
          const d_px = c.r*2;
          const mm = Number(customBasket || basketMM);
          const umPerPx = (mm * 1000) / d_px;
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
    // dp=1.2, minDist = image.height/4
    window.cv.HoughCircles(blur, circles, window.cv.HOUGH_GRADIENT, 1.2, image.height/4, 100, 50, Math.floor(image.height*0.2), Math.floor(image.height*0.6));
    let best = null;
    for (let i=0; i<circles.cols; i++){
      const x = circles.data32F[i*3];
      const y = circles.data32F[i*3+1];
      const r = circles.data32F[i*3+2];
      // prefer circles near center and large radius
      const dc = Math.hypot(x - image.width/2, y - image.height/2);
      const score = -dc + r*0.5;
      if (!best || score > best.score) best = {x,y,r,score};
    }
    src.delete(); gray.delete(); blur.delete(); circles.delete();
    if (!best){
      setStatus("No se detectó el aro interno automáticamente. Use calibración manual.");
      return;
    }
    const d_px = best.r*2;
    const mm = Number(customBasket || basketMM);
    const umPerPx = (mm*1000) / d_px;
    setScaleUmPerPx(umPerPx);
    setCalibPoints([{x:best.x, y:best.y- best.r},{x:best.x + best.r, y:best.y},{x:best.x, y:best.y + best.r}]);
    setStatus(`Detección automática OK. Escala: ${umPerPx.toFixed(2)} µm/px`);
    draw();
  }

  function analyze(){
    if (!cvReady || !image) { setStatus("Falta imagen o OpenCV."); return; }
    if (!scaleUmPerPx){ setStatus("Primero calibre la escala (um/px) con el diámetro del canasto."); return; }
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    let src = window.cv.imread(canvas);
    // Crop to ROI (if provided)
    if (roi && roi.w>10 && roi.h>10){
      const rect = new window.cv.Rect(Math.max(0, roi.x|0), Math.max(0, roi.y|0), Math.min(roi.w|0, src.cols - (roi.x|0)), Math.min(roi.h|0, src.rows - (roi.y|0)));
      src = src.roi(rect);
    }
    const gray = new window.cv.Mat();
    window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY, 0);

    // CLAHE for contrast
    const clahe = new window.cv.CLAHE(2.0, new window.cv.Size(8,8));
    const cl = new window.cv.Mat();
    clahe.apply(gray, cl);

    // Blur + adaptive threshold
    const blur = new window.cv.Mat();
    window.cv.GaussianBlur(cl, blur, new window.cv.Size(3,3), 0, 0);
    const bin = new window.cv.Mat();
    window.cv.adaptiveThreshold(blur, bin, 255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5);

    // Morph open to remove specks
    const kernel = window.cv.getStructuringElement(window.cv.MORPH_ELLIPSE, new window.cv.Size(3,3));
    const opened = new window.cv.Mat();
    window.cv.morphologyEx(bin, opened, window.cv.MORPH_OPEN, kernel);

    // Find contours
    const contours = new window.cv.MatVector();
    const hierarchy = new window.cv.Mat();
    window.cv.findContours(opened, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);

    const sizes = [];
    for (let i=0; i<contours.size(); i++){
      const cnt = contours.get(i);
      const areaPx = window.cv.contourArea(cnt);
      if (areaPx < 3) continue; // tiny noise
      // Equivalent circular diameter in pixels
      const d_px = 2 * Math.sqrt(areaPx / Math.PI);
      const d_um = d_px * scaleUmPerPx;
      if (d_um < 10 || d_um > 3000) continue; // reject extreme outliers
      sizes.push(d_um);
    }

    // Outlier filtering
    const filtered = iqrFilter(sizes);
    setSizesUm(filtered);

    src.delete(); gray.delete(); cl.delete(); blur.delete(); bin.delete(); opened.delete(); kernel.delete(); contours.delete(); hierarchy.delete();

    if (!filtered.length){
      setStatus("No se detectaron partículas claras en el área seleccionada. Ajuste la ROI o el enfoque.");
      return;
    }
    const med = percentile(filtered, 50);
    const p10 = percentile(filtered, 10);
    const p90 = percentile(filtered, 90);
    setStatus(`Partículas: ${filtered.length} | D50: ${med.toFixed(1)} µm | D10: ${p10.toFixed(1)} µm | D90: ${p90.toFixed(1)} µm`);
  }

  function exportCSV(){
    if (!sizesUm.length) return;
    const rows = ["size_um"];
    sizesUm.forEach(v=>rows.push(v.toFixed(2)));
    const blob = new Blob([rows.join("\\n")], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grind_sizes_um.csv";
    a.click();
  }

  const phoneList = (window.__PHONES__ || phones).filter(p=>{
    const q = phoneQuery.toLowerCase();
    return (p.brand+" "+p.model).toLowerCase().includes(q);
  }).slice(0, 100);

  const med = sizesUm.length ? percentile(sizesUm,50) : null;
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
              <button onClick={addCalibPoint} className={`px-3 py-1 rounded ${mode==="calib"?"bg-blue-600 text-white":"bg-gray-100"}`}>Calibrar (3 puntos)</button>
              <button onClick={autoDetectRim} className="px-3 py-1 rounded bg-emerald-600 text-white">Detectar Aro</button>
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
            <h3 className="font-medium mb-2">1) Teléfono (opcional)</h3>
            <input value={phoneQuery} onChange={e=>setPhoneQuery(e.target.value)} placeholder="Buscar modelo..." className="w-full border rounded px-2 py-1 mb-2"/>
            <div className="max-h-40 overflow-auto border rounded">
              {phoneList.map((p,i)=>(
                <button key={i} onClick={()=>setSelectedPhone(p)} className={`w-full text-left px-2 py-1 text-sm hover:bg-gray-100 ${selectedPhone===p?'bg-gray-100':''}`}>
                  {p.brand} {p.model} — {p.sensor_pixel_pitch_um} µm
                </button>
              ))}
            </div>
            {selectedPhone && (
              <p className="text-xs text-gray-600 mt-1">
                Seleccionado: {selectedPhone.brand} {selectedPhone.model} ({selectedPhone.sensor_pixel_pitch_um} µm px). *Se usa solo como metadato; la escala precisa viene del diámetro del canasto.
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">2) Diámetro interno del canasto</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {DEFAULT_BASKETS.map(mm=>(
                <button key={mm} onClick={()=>{setBasketMM(mm); setCustomBasket("");}} className={`px-2 py-1 rounded border ${basketMM===mm && !customBasket ? 'bg-gray-900 text-white' : 'bg-white'}`}>{mm} mm</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={customBasket} onChange={e=>setCustomBasket(e.target.value)} placeholder="Otro (mm)" className="w-28 border rounded px-2 py-1"/>
              <button onClick={()=>setBasketMM(Number(customBasket)||basketMM)} className="px-2 py-1 rounded bg-gray-100">Usar</button>
            </div>
            <p className="text-xs text-gray-600 mt-2">La escala µm/px se calcula detectando el aro interno y usando este diámetro.</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">3) Resultados</h3>
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
        Inspirado por ideas de análisis de tamaño de partícula (p.ej., proyecto coffeegrindsize). Este enfoque usa el diámetro del canasto como referencia física para lograr precisión real sin regla.
      </footer>
    </div>
  );
}
