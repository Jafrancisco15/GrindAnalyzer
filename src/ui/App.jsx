
import React, { useState } from 'react'
import BrandBar from './BrandBar.jsx'
import ImageViewport from './ImageViewport.jsx'
import OverlayControls from './OverlayControls.jsx'
import StatsPanel from './StatsPanel.jsx'

export default function App() {
  const [file, setFile] = useState(null)
  const [overlays, setOverlays] = useState({
    mask: false,
    edges: false,
    contours: true,
    centroids: true,
    sizeMap: false,
  })
  const [params, setParams] = useState({
    threshold: 160,
    invert: false,
    minArea: 12,
    maxArea: 1000000,
  })
  const [particles, setParticles] = useState([])

  return (
    <div className="min-h-screen bg-ink text-neutral-100">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-2 sm:py-4">
        <BrandBar/>

        <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-3 sm:p-4 mb-3">
          <h2 className="text-lg font-bold text-accent mb-2">Cargar imagen</h2>
          <p className="text-sm text-neutral-400 mb-3">
            Sube una foto de la molienda <span className="text-neutral-500">(idealmente con las partículas dispersas)</span>.
            Pellizca para hacer zoom y arrastra para mover la imagen.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-ink font-semibold cursor-pointer active:scale-[0.98]">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e)=> setFile(e.target.files?.[0] ?? null)}
            />
            Subir imagen
          </label>
          {file && (
            <div className="mt-3 text-xs text-neutral-400">
              {file.name} • {(file.size/1024).toFixed(1)} KB
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <ImageViewport
              file={file}
              overlays={overlays}
              params={params}
              onParticles={setParticles}
            />
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-3 sm:p-4">
              <OverlayControls
                overlays={overlays}
                setOverlays={setOverlays}
                params={params}
                setParams={setParams}
              />
            </div>
            <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-3 sm:p-4">
              <StatsPanel particles={particles} />
            </div>
            <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-accent mb-2">Tips</h3>
              <ul className="list-disc ml-5 text-sm text-neutral-300 space-y-1">
                <li>Usa luz uniforme, sin sombras fuertes.</li>
                <li>Dispersa bien el café para evitar grumos.</li>
                <li>Ajusta el umbral si ves partículas perdidas.</li>
                <li>Activa <b>centroids</b> y <b>contours</b> para revisar detecciones.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 text-[11px] text-neutral-500 text-center">
          Interfaz re-diseñada para móvil (negro + amarillo), zoom por pellizco, panning fluido,
          overlays útiles (máscara, bordes, contornos, centroides, mapa por tamaño). Logo con contraste mejorado.
        </div>
      </div>
    </div>
  )
}
