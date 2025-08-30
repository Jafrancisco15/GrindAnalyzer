# GrindSizer — Portafilter Grind Analyzer

App web (Vite + React + OpenCV.js + Tailwind + Chart.js) para analizar el tamaño de molienda **desde una foto superior del portafiltro**. Usa el **diámetro interno del canasto** como referencia física para convertir píxeles a micrones con alta precisión, evitando reglas físicas.

## Características
- Carga una foto tomada con el móvil (idealmente sin flash, enfoque nítido).
- Detección automática del aro interno (HoughCircles) o calibración manual con **3 clics** sobre el borde.
- Selección de **ROI** con zoom/pan para analizar sólo áreas útiles (evita grumos).
- Segmentación por contraste + **contornos** (OpenCV.js): tamaño equivalente circular de cada partícula.
- Filtro de outliers (IQR), **D10 / D50 (mediana) / D90**, histograma y exportación **CSV**.
- Selector de modelo de teléfono (DB semilla) y carga opcional de `phones-extended.json` con miles de modelos.

## Cómo usar
```bash
npm i
npm run dev
# despliega en Vercel sin cambios
```

Para una base de teléfonos más grande, crea un archivo en `public/phones-extended.json` con:
```json
[
  {"brand":"Apple","model":"iPhone 15 Pro","sensor_pixel_pitch_um":1.12},
  {"brand":"Samsung","model":"Galaxy S21","sensor_pixel_pitch_um":1.8}
]
```
La app lo detecta y fusiona automáticamente.

## Consejos de captura
- Foto perpendicular al canasto, buena luz difusa, ISO bajo.
- Extiende levemente la molienda para **evitar aglomerados** si quieres medir sólo partículas sueltas.
- Selecciona una ROI uniforme y ejecuta **Analizar**.

> Nota: el campo “Teléfono” es meta‑dato; la **escala real** proviene del diámetro interno del canasto (p. ej., 58.5 mm). Si usas canastos 54/53/51/49 mm, selecciónalos o ingresa un valor personalizado.
