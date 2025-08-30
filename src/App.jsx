import React, {useEffect,useLayoutEffect,useRef,useState} from 'react'
import { clamp, percentile, iqrFilter } from './utils'
import { circleFrom3 } from './circleFit'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const DEFAULT_BASKETS=[58.5,58,54,53,51,49]

export default function App(){
  const canvasRef=useRef(null)
  const holderRef=useRef(null)
  const [img,setImg]=useState(null)
  const [status,setStatus]=useState('Sube una foto superior del portafiltro con la molienda.')
  const [cvReady,setCvReady]=useState(false)

  const view=useRef({zoom:1, ox:0, oy:0})
  const [mode,setMode]=useState('roi')
  const [roi,setRoi]=useState(null)
  const [excls,setExcls]=useState([])
  const drag=useRef(null)

  const [basketMM,setBasketMM]=useState(58.5)
  const [customMM,setCustomMM]=useState('')
  const [rim,setRim]=useState(null)
  const [umPerPx,setUmPerPx]=useState(null)

  const [sizes,setSizes]=useState([])
  const [particles,setParticles]=useState([])
  const [showOverlays,setShowOverlays]=useState(true)

  const [viz,setViz]=useState('circles') // 'circles' | 'mask' | 'edges' | 'contours' | 'none'
  const [maskOverlay,setMaskOverlay]=useState(null) // {image,x,y,w,h}
  const [edgesOverlay,setEdgesOverlay]=useState(null) // {image,x,y,w,h}
  const [contoursPoly,setContoursPoly]=useState([]) // [{pts:[{x,y},...], accepted:true, cx, cy}]
  const [particleRecords,setParticleRecords]=useState([]) // rows for CSV

  const [ium,setIum]=useState(null)
  const [iumParts,setIumParts]=useState(null)

  // Magnifier
  const [lensEnabled,setLensEnabled]=useState(true)
  const [lensFactor,setLensFactor]=useState(3)
  const [lensRadius,setLensRadius]=useState(90)
  const lens=useRef({sx:0,sy:0,imgx:0,imgy:0,visible:false})

  function resizeCanvas(){
    const c=canvasRef.current, holder=holderRef.current
    if(!c||!holder) return
    const ratio = img ? (img.height/img.width) : (520/780)
    const cssW = holder.clientWidth
    const cssH = Math.min(560, Math.round(cssW*ratio))
    const dpr = window.devicePixelRatio||1
    c.style.width = cssW+'px'
    c.style.height = cssH+'px'
    c.width = Math.round(cssW*dpr)
    c.height = Math.round(cssH*dpr)
    const g=c.getContext('2d')
    g.setTransform(dpr,0,0,dpr,0,0)
    draw()
  }
  useLayoutEffect(()=>{
    const ro=new ResizeObserver(resizeCanvas)
    if(holderRef.current) ro.observe(holderRef.current)
    window.addEventListener('orientationchange', resizeCanvas)
    return ()=>{ ro.disconnect(); window.removeEventListener('orientationchange', resizeCanvas) }
  },[img])

  useEffect(()=>{
    const c = canvasRef.current
    if(!c) return
    const wheelHandler = (ev)=> onWheel(ev)
    const touchMoveHandler = (ev)=> { if(ev && ev.cancelable) ev.preventDefault() }
    c.addEventListener('wheel', wheelHandler, { passive: false })
    c.addEventListener('touchmove', touchMoveHandler, { passive: false })
    return ()=>{
      c.removeEventListener('wheel', wheelHandler)
      c.removeEventListener('touchmove', touchMoveHandler)
    }
  }, [img])

  useEffect(()=>{
    const t=setInterval(()=>{ if(window.cv && window.cv.Mat){ setCvReady(true); clearInterval(t) } },200)
    return ()=>clearInterval(t)
  },[])

  function drawLens(g){
    if(!img || !lensEnabled || !lens.current.visible) return
    const {sx,sy,imgx,imgy}=lens.current
    const r=lensRadius
    const z=view.current.zoom * lensFactor
    const ox = sx - imgx*z
    const oy = sy - imgy*z
    g.save()
    g.beginPath(); g.arc(sx,sy,r,0,Math.PI*2); g.clip()
    g.save(); g.translate(ox,oy); g.scale(z,z); g.drawImage(img,0,0); g.restore()
    g.strokeStyle='#111827'; g.lineWidth=2; g.beginPath(); g.arc(sx,sy,r,0,Math.PI*2); g.stroke()
    g.restore()
  }

  function draw(){
    const c=canvasRef.current; if(!c) return
    const g=c.getContext('2d')
    g.clearRect(0,0,c.width,c.height)
    if(!img) return
    g.save()
    g.translate(view.current.ox, view.current.oy)
    g.scale(view.current.zoom, view.current.zoom)
    g.drawImage(img,0,0)

    if(showOverlays && viz!=='none'){
      if(viz==='mask' && maskOverlay){
        const im=new Image(); im.src=maskOverlay.url
        g.save(); g.globalAlpha=0.45; g.drawImage(im, maskOverlay.x, maskOverlay.y, maskOverlay.w, maskOverlay.h); g.restore()
      } else if(viz==='edges' && edgesOverlay){
        const im=new Image(); im.src=edgesOverlay.url
        g.save(); g.globalAlpha=0.7; g.drawImage(im, edgesOverlay.x, edgesOverlay.y, edgesOverlay.w, edgesOverlay.h); g.restore()
      }
    }

    if(showOverlays){
      if(roi){ g.save(); g.strokeStyle='#10b981'; g.lineWidth=2/view.current.zoom; g.strokeRect(roi.x,roi.y,roi.w,roi.h); g.restore() }
      if(excls.length){ g.save(); g.fillStyle='rgba(239,68,68,0.25)'; g.strokeStyle='#ef4444'; g.lineWidth=2/view.current.zoom;
        excls.forEach(r=>{ g.fillRect(r.x,r.y,r.w,r.h); g.strokeRect(r.x,r.y,r.w,r.h) }); g.restore() }
      if(rim){ g.save(); g.strokeStyle='#2563eb'; g.lineWidth=2/view.current.zoom; g.beginPath(); g.arc(rim.cx,rim.cy,rim.r,0,Math.PI*2); g.stroke();
        const mmVal = Number(customMM || basketMM)
        const label=`${mmVal} mm · ${umPerPx? umPerPx.toFixed(1):'—'} µm/px`
        g.fillStyle='rgba(37,99,235,0.85)'; g.font=`${14/view.current.zoom}px sans-serif`; g.fillText(label,rim.cx+6/view.current.zoom,rim.cy-6/view.current.zoom)
        const hr=8/view.current.zoom
        g.fillStyle='#2563eb'; g.beginPath(); g.arc(rim.cx,rim.cy,hr,0,Math.PI*2); g.fill()
        g.beginPath(); g.arc(rim.cx+rim.r,rim.cy,hr,0,Math.PI*2); g.fill()
        g.restore() }
      if(viz==='circles' && particles.length){
        g.save(); g.strokeStyle='#f59e0b'; g.lineWidth=1.5/view.current.zoom;
        particles.forEach(p=>{ g.beginPath(); g.arc(p.cx,p.cy,p.r_px,0,Math.PI*2); g.stroke() })
        g.restore()
      } else if(viz==='contours' && contoursPoly.length){
        g.save(); g.strokeStyle='#f59e0b'; g.lineWidth=1.5/view.current.zoom; g.fillStyle='rgba(245,158,11,0.15)';
        contoursPoly.forEach(cn=>{
          if(!cn.accepted) return; // dibujar aceptados por IQR
          const pts=cn.pts
          if(!pts||pts.length<2) return
          g.beginPath(); g.moveTo(pts[0].x, pts[0].y)
          for(let i=1;i<pts.length;i++){ g.lineTo(pts[i].x, pts[i].y) }
          g.closePath(); g.fill(); g.stroke()
        })
        g.restore()
      }
    }
    g.restore()
    drawLens(g)
  }
  useEffect(draw,[img,roi,excls,rim,particles,showOverlays,lensEnabled,lensFactor,lensRadius,viz,maskOverlay,edgesOverlay])

  function screenToImage(sx,sy){
    const {zoom,ox,oy}=view.current
    return {x:(sx-ox)/zoom, y:(sy-oy)/zoom}
  }
  function fitView(){
    if(!img||!canvasRef.current) return
    const c=canvasRef.current
    const iw=img.width, ih=img.height
    const cssW=parseFloat(getComputedStyle(c).width), cssH=parseFloat(getComputedStyle(c).height)
    const scale=Math.min(cssW/iw, cssH/ih)
    view.current.zoom = scale
    view.current.ox = (cssW - iw*scale)/2
    view.current.oy = (cssH - ih*scale)/2
    draw()
  }

  async function onFile(e){
    const f=e.target.files?.[0]; if(!f) return
    const image=new Image(); image.onload=()=>{ setImg(image); setTimeout(()=>{ resizeCanvas(); fitView(); }, 0) }
    image.onerror=()=>alert('No se pudo cargar la imagen.')
    image.src=URL.createObjectURL(f)
    setRoi(null); setExcls([]); setRim(null); setUmPerPx(null); setSizes([]); setParticles([]); setIum(null); setIumParts(null)
    setMaskOverlay(null); setEdgesOverlay(null); setContoursPoly([]); setParticleRecords([])
    setStatus('Imagen cargada. Detecta el aro (auto) o calibra con 3 puntos; ajusta con el cursor.')
  }

  function onWheel(e){
    if(!img) return
    if(e && e.cancelable) e.preventDefault()
    const rect=canvasRef.current.getBoundingClientRect()
    const mx=e.clientX-rect.left, my=e.clientY-rect.top
    const before=screenToImage(mx,my)
    const factor = e.deltaY<0 ? 1.1 : 0.9
    const newZoom = clamp(view.current.zoom*factor, 0.05, 20)
    const cssW=parseFloat(getComputedStyle(canvasRef.current).width), cssH=parseFloat(getComputedStyle(canvasRef.current).height)
    const minZoom = Math.min(cssW/img.width, cssH/img.height) * 0.3
    view.current.zoom = Math.max(newZoom, minZoom)
    const after=screenToImage(mx,my)
    view.current.ox += (mx - (after.x*view.current.zoom + view.current.ox))
    view.current.oy += (my - (after.y*view.current.zoom + view.current.oy))
    draw()
  }

  const clicks=useRef([])
  function setCalibPoint(p){
    clicks.current=[...clicks.current, p].slice(-3)
    if(clicks.current.length===3){
      const c=circleFrom3(clicks.current[0], clicks.current[1], clicks.current[2])
      if(c){ setRim(c); recomputeScale(c); setStatus('Calibrado manual listo.') }
      else setStatus('Fallo el ajuste; repite los 3 puntos.')
      clicks.current=[]
    }
  }

  function onPointerDown(e){
    if(!img) return
    const rect=canvasRef.current.getBoundingClientRect()
    const x=e.clientX-rect.left, y=e.clientY-rect.top
    const p=screenToImage(x,y)
    drag.current={start:{x,y}, last:{x,y}, p0:p}
    canvasRef.current.setPointerCapture(e.pointerId)

    if(mode==='roi'){
      setRoi({x:p.x,y:p.y,w:0,h:0}); drag.current.kind='roi'
    } else if(mode==='exclude'){
      setExcls(prev=>[...prev,{x:p.x,y:p.y,w:0,h:0,_draft:true}]); drag.current.kind='exclude'
    } else if(mode==='calib'){
      setCalibPoint(p); drag.current.kind='none'
    } else if(mode==='pan'){
      drag.current.kind='pan'
    } else {
      if(rim){
        const d=Math.hypot(p.x-rim.cx,p.y-rim.cy)
        const tol = 12/view.current.zoom
        if(d<tol){ drag.current.kind='rim-center' }
        else if(Math.abs(d-rim.r)<tol){ drag.current.kind='rim-radius' }
        else { drag.current.kind='none' }
      } else { drag.current.kind='none' }
    }
  }
  function onPointerMove(e){
    if(!img) return
    const rect=canvasRef.current.getBoundingClientRect()
    const x=e.clientX-rect.left, y=e.clientY-rect.top
    const p=screenToImage(x,y)
    lens.current={sx:x, sy:y, imgx:p.x, imgy:p.y, visible:true}

    if(!drag.current){ draw(); return }
    const kind=drag.current.kind||mode
    if(kind==='pan'){
      const dx=x-drag.current.last.x, dy=y-drag.current.last.y
      view.current.ox += dx; view.current.oy += dy; draw()
    } else if(kind==='roi'){
      setRoi(prev=> prev ? ({...prev, x:Math.min(drag.current.p0.x,p.x), y:Math.min(drag.current.p0.y,p.y), w:Math.abs(p.x-drag.current.p0.x), h:Math.abs(p.y-drag.current.p0.y)}) : prev)
    } else if(kind==='exclude'){
      setExcls(prev=>{ const arr=[...prev]; const i=arr.findIndex(r=>r._draft); if(i>=0){ const r=arr[i]; arr[i]={...r, x:Math.min(drag.current.p0.x,p.x), y:Math.min(drag.current.p0.y,p.y), w:Math.abs(p.x-drag.current.p0.x), h:Math.abs(p.y-drag.current.p0.y)} } return arr })
    } else if(kind==='rim-center' && rim){
      setRim(prev=> ({...prev, cx:p.x, cy:p.y}))
    } else if(kind==='rim-radius' && rim){
      const r=Math.hypot(p.x-rim.cx,p.y-rim.cy)
      setRim(prev=> ({...prev, r})); recomputeScale({cx:rim.cx, cy:rim.cy, r})
    }
    drag.current.last={x,y}
  }
  function onPointerUp(e){
    if(!img) return
    if(mode==='exclude'){ setExcls(prev=> prev.map(r=>({...r, _draft:false}))) }
    drag.current=null
    canvasRef.current.releasePointerCapture(e.pointerId)
  }
  function onPointerLeave(){ lens.current.visible=false; draw() }

  function recomputeScale(circ=rim){
    if(!circ) return
    const mm = Number(customMM || basketMM) || basketMM
    const um = (mm*1000)/(circ.r*2)
    setUmPerPx(um)
  }

  function matToURL(mat){
    const c=document.createElement('canvas')
    c.width=mat.cols; c.height=mat.rows
    window.cv.imshow(c, mat)
    const url=c.toDataURL('image/png')
    c.width=1; c.height=1
    return url
  }

  function autoDetect(){
    if(!cvReady || !img){ setStatus('OpenCV no listo o no hay imagen'); return }
    setStatus('Detectando aro…')
    try{
      const maxSide = 900
      const scale = Math.max(img.width, img.height) > maxSide ? (Math.max(img.width, img.height)/maxSide) : 1
      const dw = Math.round(img.width/scale), dh = Math.round(img.height/scale)
      const off=document.createElement('canvas'); off.width=dw; off.height=dh
      off.getContext('2d').drawImage(img,0,0,dw,dh)
      const src=window.cv.imread(off)
      const gray=new window.cv.Mat(); window.cv.cvtColor(src,gray,window.cv.COLOR_RGBA2GRAY,0)
      const blur=new window.cv.Mat(); window.cv.GaussianBlur(gray,blur,new window.cv.Size(9,9),2,2)
      const edges=new window.cv.Mat(); window.cv.Canny(blur,edges,50,150)
      const circles=new window.cv.Mat()
      window.cv.HoughCircles(blur,circles,window.cv.HOUGH_GRADIENT,1.2, dh/4, 100, 50, Math.floor(dh*0.15), Math.floor(dh*0.7))
      let best=null
      function circleScore(cx,cy,r){
        const N=96; let sum=0
        for(let i=0;i<N;i++){
          const t=(i/N)*2*Math.PI
          const x=Math.round(cx + r*Math.cos(t)), y=Math.round(cy + r*Math.sin(t))
          if(x>=0 && y>=0 && x<edges.cols && y<edges.rows){ sum += edges.ucharPtr(y,x)[0] }
        }
        return sum/N
      }
      for(let i=0;i<circles.cols;i++){
        const cx=circles.data32F[i*3], cy=circles.data32F[i*3+1], r=circles.data32F[i*3+2]
        const dc = Math.hypot(cx - dw/2, cy - dh/2)
        const score = circleScore(cx,cy,r) - 0.002*dc + 0.001*r
        if(!best || score>best.score) best={cx,cy,r,score}
      }
      src.delete(); gray.delete(); blur.delete(); edges.delete(); circles.delete()
      if(!best){ setStatus('No se detectó el aro. Usa 3 puntos o ajusta manualmente.'); return }
      const cx = best.cx*scale, cy = best.cy*scale, r = best.r*scale
      setRim({cx, cy, r}); recomputeScale({cx,cy,r})
      setStatus('Aro detectado. Ajusta con el cursor (centro o radio).')
      draw()
    }catch(err){
      console.error(err); setStatus('Error al detectar el aro.')
    }
  }

  function localExclusions(rect, rects){
    if(!rects.length) return []
    if(!rect) return rects
    return rects.map(r=>({x:r.x-rect.x,y:r.y-rect.y,w:r.w,h:r.h})).filter(r=> r.x<rect.w && r.y<rect.h && r.x+r.w>0 && r.y+r.h>0)
  }

  function analyze(){
    if(!cvReady||!img){ setStatus('Falta imagen u OpenCV'); return }
    if(!rim||!umPerPx){ setStatus('Calibra primero (aro + mm)'); return }
    setStatus('Analizando…')
    try{
      const off=document.createElement('canvas'); off.width=img.width; off.height=img.height
      off.getContext('2d').drawImage(img,0,0)
      let src=window.cv.imread(off)
      let localOff={x:0,y:0}
      if(roi && roi.w>10 && roi.h>10){
        const rect=new window.cv.Rect(Math.max(0,roi.x|0), Math.max(0,roi.y|0), Math.min(roi.w|0, src.cols-(roi.x|0)), Math.min(roi.h|0, src.rows-(roi.y|0)))
        src=src.roi(rect); localOff={x:rect.x,y:rect.y}
      }
      const ex=localExclusions(roi, excls)
      const mask=new window.cv.Mat(src.rows, src.cols, window.cv.CV_8UC1, new window.cv.Scalar(255))
      ex.forEach(r=>{
        const x=Math.max(0,r.x|0), y=Math.max(0,r.y|0)
        const w=Math.min(r.w|0, mask.cols-x), h=Math.min(r.h|0, mask.rows-y)
        if(w>0&&h>0){ const m=mask.roi(new window.cv.Rect(x,y,w,h)); m.setTo(new window.cv.Scalar(0)); m.delete() }
      })
      const gray=new window.cv.Mat(); window.cv.cvtColor(src,gray,window.cv.COLOR_RGBA2GRAY,0)
      const masked=new window.cv.Mat(); window.cv.bitwise_and(gray,gray,masked,mask)

      // Focus (Laplacian stddev)
      const lap=new window.cv.Mat(); window.cv.Laplacian(masked, lap, window.cv.CV_16S, 3, 1, 0, window.cv.BORDER_DEFAULT)
      const lapAbs=new window.cv.Mat(); window.cv.convertScaleAbs(lap, lapAbs)
      const mean = new window.cv.Mat(); const stddev = new window.cv.Mat()
      window.cv.meanStdDev(lapAbs, mean, stddev)
      const focusStd = stddev.doubleAt(0,0) || 0
      mean.delete(); stddev.delete(); lap.delete(); lapAbs.delete()

      const clahe=new window.cv.CLAHE(2.0, new window.cv.Size(8,8)); const cl=new window.cv.Mat(); clahe.apply(masked,cl)
      const blur=new window.cv.Mat(); window.cv.GaussianBlur(cl,blur,new window.cv.Size(3,3),0,0)
      const bin=new window.cv.Mat(); window.cv.adaptiveThreshold(blur,bin,255, window.cv.ADAPTIVE_THRESH_GAUSSIAN_C, window.cv.THRESH_BINARY_INV, 35, 5)

      const maskVis=new window.cv.Mat(); bin.copyTo(maskVis)
      const kernel=window.cv.getStructuringElement(window.cv.MORPH_ELLIPSE, new window.cv.Size(3,3))
      const opened=new window.cv.Mat(); window.cv.morphologyEx(bin,opened,window.cv.MORPH_OPEN, kernel)

      const edges=new window.cv.Mat(); window.cv.Canny(cl,edges,50,150)

      const contours=new window.cv.MatVector(); const hier=new window.cv.Mat()
      window.cv.findContours(opened,contours,hier, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE)

      const eroded=new window.cv.Mat(); window.cv.erode(opened, eroded, kernel)
      const boundary=new window.cv.Mat(); window.cv.subtract(opened, eroded, boundary)
      let totalB=0, onEdge=0
      for(let y=0;y<boundary.rows;y++){
        for(let x=0;x<boundary.cols;x++){
          if(boundary.ucharPtr(y,x)[0]>0){
            totalB+=1
            if(edges.ucharPtr(y,x)[0]>0) onEdge+=1
          }
        }
      }
      const edgeAlign = totalB? onEdge/totalB : 0

      const sizesArr=[], pts=[], polysAll=[]
      let soliditySum=0, solidityCount=0
      for(let i=0;i<contours.size();i++){
        const cnt=contours.get(i)
        const area=window.cv.contourArea(cnt)
        if(area<3) continue
        const m=window.cv.moments(cnt); const cx=m.m10/(m.m00||1); const cy=m.m01/(m.m00||1)
        let bad=false; for(const r of ex){ if(cx>=r.x && cx<=r.x+r.w && cy>=r.y && cy<=r.y+r.h){ bad=true; break } } if(bad) continue
        const dpx=2*Math.sqrt(area/Math.PI)
        const dum=dpx*umPerPx
        if(dum<10 || dum>3000) continue
        sizesArr.push(dum)
        pts.push({cx:cx+localOff.x, cy:cy+localOff.y, r_px:dpx/2, r_um:dum/2})
        const hull=new window.cv.Mat()
        window.cv.convexHull(cnt, hull, false, true)
        const hullArea=window.cv.contourArea(hull)
        if(hullArea>0){ soliditySum += (area/hullArea); solidityCount+=1 }
        hull.delete()
      }
      const filtered=iqrFilter(sizesArr)
      let finalPts=pts
      if(filtered.length && sizesArr.length){
        const q1=percentile(sizesArr,25), q3=percentile(sizesArr,75), iqr=q3-q1, lo=q1-1.5*iqr, hi=q3+1.5*iqr
        finalPts=pts.filter(p=> (p.r_um*2)>=lo && (p.r_um*2)<=hi)
      }
      setSizes(filtered); setParticles(finalPts);
      // map acceptance by diameter filter
      const records=[];
      let polys=[];
      if(filtered.length){
        const lo=Math.min(...filtered), hi=Math.max(...filtered)
        polys = polysAll.map(poly=>{ const ok = (poly.d_um>=lo && poly.d_um<=hi); if(ok) records.push({cx_px:poly.cx, cy_px:poly.cy, d_um:poly.d_um, area_um2: poly.area_px*(umPerPx*umPerPx), per_um: poly.per_px*umPerPx, solidity: poly.solidity, circularity: poly.circularity}); return {...poly, accepted: ok} })
      } else { polys = polysAll.map(poly=> ({...poly, accepted:false})) }
      setContoursPoly(polys); setParticleRecords(records)

      // overlays
      const maskRGBA=new window.cv.Mat(); window.cv.cvtColor(maskVis, maskRGBA, window.cv.COLOR_GRAY2RGBA, 0)
      for(let y=0;y<maskRGBA.rows;y++){
        for(let x=0;x<maskRGBA.cols;x++){
          const a=maskRGBA.ucharPtr(y,x)
          if(a[0]>0){ a[0]=255; a[1]=160; a[2]=0; a[3]=200; } else { a[3]=0; }
        }
      }
      const edgesRGBA=new window.cv.Mat(); window.cv.cvtColor(edges, edgesRGBA, window.cv.COLOR_GRAY2RGBA, 0)
      for(let y=0;y<edgesRGBA.rows;y++){
        for(let x=0;x<edgesRGBA.cols;x++){
          const a=edgesRGBA.ucharPtr(y,x)
          if(a[0]>0){ a[2]=255; a[1]=255; a[0]=0; a[3]=220; } else { a[3]=0; }
        }
      }
      const maskURL=(function(){ const c=document.createElement('canvas'); c.width=maskRGBA.cols; c.height=maskRGBA.rows; window.cv.imshow(c, maskRGBA); const u=c.toDataURL('image/png'); c.width=1; c.height=1; return u; })()
      const edgesURL=(function(){ const c=document.createElement('canvas'); c.width=edgesRGBA.cols; c.height=edgesRGBA.rows; window.cv.imshow(c, edgesRGBA); const u=c.toDataURL('image/png'); c.width=1; c.height=1; return u; })()
      const imgMask=new Image(); imgMask.onload=()=>{ setMaskOverlay({image:imgMask, x:localOff.x, y:localOff.y, w:maskRGBA.cols, h:maskRGBA.rows}); draw() }; imgMask.src=maskURL
      const imgEdges=new Image(); imgEdges.onload=()=>{ setEdgesOverlay({image:imgEdges, x:localOff.x, y:localOff.y, w:edgesRGBA.cols, h:edgesRGBA.rows}); draw() }; imgEdges.src=edgesURL

      const N=filtered.length
      const med=percentile(filtered,50), p10=percentile(filtered,10), p90=percentile(filtered,90)
      const span = (p10>0) ? (p90/p10) : 999
      const U = clamp(1 - ((span-1)/(7-1)), 0, 1)
      const S = clamp((focusStd - 10)/(60-10), 0, 1)
      const C = edgeAlign
      const H = solidityCount? clamp((soliditySum/solidityCount - 0.6)/(0.95-0.6), 0, 1) : 0.5
      const Ns = clamp(N/1200, 0, 1)
      const iumScore = 100*(0.25*U + 0.25*S + 0.25*C + 0.15*Ns + 0.10*H)
      setIum(Math.round(iumScore))
      setIumParts({U,S,C,Ns,H,span,focusStd,edgeAlign,solidity: solidityCount? (soliditySum/solidityCount) : 0 })

      src.delete(); gray.delete(); masked.delete(); cl.delete(); blur.delete(); bin.delete(); opened.delete(); kernel.delete(); contours.delete(); hier.delete(); mask.delete(); maskVis.delete(); edges.delete(); eroded.delete(); boundary.delete(); maskRGBA.delete(); edgesRGBA.delete()

      if(!filtered.length){ setStatus('No se detectaron partículas claras. Ajusta ROI/Exclusiones, aumenta contraste o mejora el enfoque. Sin partículas aceptadas, no se mostrará IUM ni overlays.'); return }
      if(viz==='circles'){ setViz('mask') }
      setStatus(`Listo. N=${filtered.length} | D50=${med.toFixed(1)} µm | D10=${p10.toFixed(1)} µm | D90=${p90.toFixed(1)} µm · Cambia "Visualización" para ver máscara/bordes/contornos`)
    }catch(err){
      console.error(err); setStatus('Error durante el análisis.')
    }
  }

  useEffect(()=>{ if(rim) recomputeScale(rim) },[basketMM,customMM])

  const dataHist = React.useMemo(()=>{
    if(!sizes.length) return null
    const min=Math.min(...sizes), max=Math.max(...sizes)
    const bins=40, step=(max-min)/bins || 1
    const counts=new Array(bins).fill(0)
    sizes.forEach(v=>{ let i=Math.floor((v-min)/step); if(i>=bins) i=bins-1; if(i<0) i=0; counts[i]++ })
    const labels=counts.map((_,i)=> (min + i*step).toFixed(0))
    return {labels, counts}
  },[sizes])

  useEffect(()=>{ draw() }, [lensEnabled,lensFactor,lensRadius])

  function exportCSV(){
    if(!particleRecords.length){ alert('No hay datos para exportar.'); return }
    const header = ['id','cx_px','cy_px','d_eq_um','area_um2','perimetro_um','solidez','circularidad']
    const rows = particleRecords.map((r,i)=>[i+1,r.cx_px.toFixed(2),r.cy_px.toFixed(2),r.d_um.toFixed(2),r.area_um2.toFixed(2),r.per_um.toFixed(2),r.solidity.toFixed(4),r.circularity.toFixed(4)])
    const csv = [header.join(','), ...rows.map(r=>r.join(','))].join('\n')
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='grind_particles.csv'; a.click()
    URL.revokeObjectURL(url)
  }
  function recenter(){ fitView() }

  return (
    <div className="max-w-7xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-2">GrindSizer — Portafiltro (v2.4)</h1>
      <p className="text-gray-600 mb-4">{status}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow p-3">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <span className="font-medium">Imagen</span>
              <input type="file" accept="image/*" onChange={onFile}/>
            </label>
            <button onClick={()=>setMode('pan')} className={`px-3 py-1 rounded ${mode==='pan'?'bg-blue-600 text-white':'bg-gray-100'}`}>Mover</button>
            <button onClick={()=>setMode('roi')} className={`px-3 py-1 rounded ${mode==='roi'?'bg-blue-600 text-white':'bg-gray-100'}`}>ROI</button>
            <button onClick={()=>setMode('exclude')} className={`px-3 py-1 rounded ${mode==='exclude'?'bg-pink-600 text-white':'bg-gray-100'}`}>Excluir</button>
            <button onClick={()=>setExcls([])} className="px-3 py-1 rounded bg-pink-100">Limpiar exclusiones</button>
            <button onClick={()=>setMode('calib')} className={`px-3 py-1 rounded ${mode==='calib'?'bg-blue-600 text-white':'bg-gray-100'}`}>Calibrar (3 puntos)</button>
            <button onClick={autoDetect} className="px-3 py-1 rounded bg-emerald-600 text-white">Detectar Aro</button>
            <button onClick={recenter} className="px-3 py-1 rounded bg-gray-200">Recentrar</button>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-sm">Visualización
                <select value={viz} onChange={e=>setViz(e.target.value)} className="ml-1 border rounded px-1 py-0.5 text-sm">
                  <option value="circles">Partículas (círculos)</option>
                  <option value="mask">Máscara (BW/ámbar)</option>
                  <option value="edges">Bordes (Canny)</option>
                  <option value="contours">Contornos reales</option>
                  <option value="none">Ninguno</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showOverlays} onChange={e=>setShowOverlays(e.target.checked)}/><span>Overlays</span>
              </label>
            </div>
          </div>

          <div ref={holderRef} className="relative w-full">
            <canvas
              ref={canvasRef}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
              className="rounded bg-gray-200 w-full"
              style={{display:'block'}}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">Escala (µm/px):</span>
            <span className="text-sm font-semibold">{umPerPx? umPerPx.toFixed(2): '—'}</span>
            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={lensEnabled} onChange={e=>setLensEnabled(e.target.checked)} />
                <span>Lupa</span>
              </label>
              <label className="text-sm">Factor
                <select value={lensFactor} onChange={e=>setLensFactor(Number(e.target.value))} className="ml-1 border rounded px-1 py-0.5 text-sm">
                  <option value={2}>2×</option>
                  <option value={3}>3×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <label className="text-sm">Radio
                <input type="range" min="60" max="140" value={lensRadius} onChange={e=>setLensRadius(Number(e.target.value))} className="ml-1" />
              </label>
            </div>
            <button onClick={analyze} className="px-3 py-1 rounded bg-indigo-600 text-white">Analizar</button>
            <button onClick={exportCSV} disabled={!particleRecords.length} className={`px-3 py-1 rounded ${particleRecords.length? "bg-green-600 text-white":"bg-gray-200 text-gray-500"}`}>Exportar CSV</button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">Diámetro interno del canasto</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {DEFAULT_BASKETS.map(mm=>(
                <button key={mm} onClick={()=>{ setBasketMM(mm); setCustomMM(''); if(rim) { const um=(mm*1000)/(rim.r*2); setUmPerPx(um) } }} className={`px-2 py-1 rounded border ${basketMM===mm && !customMM ? 'bg-gray-900 text-white':'bg-white'}`}>{mm} mm</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={customMM} onChange={e=>setCustomMM(e.target.value)} placeholder="Otro (mm)" className="w-28 border rounded px-2 py-1"/>
              <button onClick={()=>{ const mm=Number(customMM)||basketMM; setBasketMM(mm); if(rim){ const um=(mm*1000)/(rim.r*2); setUmPerPx(um) } }} className="px-2 py-1 rounded bg-gray-100">Usar</button>
            </div>
            <p className="text-xs text-gray-600 mt-2">Ajusta el aro con el cursor: arrastra el centro o el radio. Usa “Mover” solo cuando quieras panear.</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">Resultados</h3>
            {sizes.length? (
              <ul className="text-sm space-y-1">
                <li>N = <b>{sizes.length}</b></li>
                <li>D50 (mediana) = <b>{percentile(sizes,50).toFixed(1)} µm</b></li>
                <li>D10 = <b>{percentile(sizes,10).toFixed(1)} µm</b></li>
                <li>D90 = <b>{percentile(sizes,90).toFixed(1)} µm</b></li>
                <li>Promedio = <b>{(sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(1)} µm</b></li>
              </ul>
            ) : <p className="text-sm text-gray-600">Sin datos aún.</p>}
          </div>

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-medium mb-2">Índice de Uniformidad de Molienda (IUM)</h3>
            {ium!==null ? (
              <div>
                <p className="text-xl font-semibold">{ium} / 100</p>
                <ul className="text-xs text-gray-700 mt-2 space-y-1">
                  <li>Uniformidad (D90/D10): <b>{(iumParts?.span||0).toFixed(2)}</b></li>
                  <li>Enfoque (σ Laplaciano): <b>{(iumParts?.focusStd||0).toFixed(1)}</b></li>
                  <li>Alineación borde/máscara: <b>{Math.round((iumParts?.edgeAlign||0)*100)}%</b></li>
                  <li>Solidez media: <b>{(iumParts?.solidity||0).toFixed(2)}</b></li>
                  <li>Tamaño de muestra (N): <b>{sizes.length}</b></li>
                </ul>
              </div>
            ) : <p className="text-sm text-gray-600">Ejecuta “Analizar” para calcularlo.</p>}
          </div>
        </aside>
      </div>

      <section className="mt-6 bg-white rounded-2xl shadow p-3">
        <h3 className="font-medium mb-3">Histograma</h3>
        {dataHist? (
          <Bar data={{labels:dataHist.labels, datasets:[{label:'Frecuencia', data:dataHist.counts}]}} options={{responsive:true, plugins:{legend:{display:false}}, scales:{x:{title:{display:true,text:'Tamaño (µm, inicio de bin)'}}, y:{title:{display:true,text:'Conteo'}}}}} />
        ) : <p className="text-sm text-gray-600">Analiza para ver el histograma.</p>}
      </section>
    </div>
  )
}
