# GrindSizer — Portafilter Grind Analyzer

Analiza el tamaño de molienda **desde una foto superior del portafiltro** y convierte píxeles a micrones usando el **diámetro interno del canasto** como referencia física.

## Características
- Carga una foto tomada con el móvil (idealmente sin flash, enfoque nítido).
- Detección automática del aro interno (HoughCircles) o calibración manual con **3 clics**.
- **Zoom, pan, ROI** y **múltiples exclusiones** (rectángulos rojos) para obviar áreas borrosas/reflejos o grumos.
- Segmentación con OpenCV.js y cálculo de **diámetro equivalente** por partícula → micrones.
- Filtro IQR de outliers, **D10 / D50 / D90**, histograma y exportación **CSV**.
- **Overlays**: círculo del aro (azul) y partículas detectadas (ámbar).

## Uso
```bash
npm i
npm run dev
```
Despliegue listo para Vercel.

## Consejos
- Foto perpendicular, luz difusa, enfoque nítido. Extiende la molienda para reducir grumos si quieres medir solo partículas sueltas.
- Selecciona una **ROI** y añade **exclusiones** para limpiar zonas confusas antes de analizar.
