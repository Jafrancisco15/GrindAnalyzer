# GrindSizer — Portafiltro (v2.3)

- Canvas sin deformación; zoom al cursor; pan controlado.
- **Overlays reales** del procesamiento: **Máscara (BW/ámbar)** y **Bordes (Canny)**.
- Opción de ver **círculos equivalentes** solo a modo ilustrativo.
- **Índice de Uniformidad de Molienda (IUM, 0–100)** basado en:
  - Uniformidad de distribución (span D90/D10)
  - Enfoque (σ del Laplaciano)
  - Alineación borde/máscara
  - Solidez media de partículas
  - Tamaño de muestra
- D10/D50/D90 + histograma; ROI y exclusiones.

## Uso
```bash
npm i
npm run dev
```
