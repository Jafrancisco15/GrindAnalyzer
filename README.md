
# Grind Sizer Mobile v3

Rediseño móvil con:
- **Tema negro + amarillo**
- **Logo** con alto contraste (pill amarilla + texto negro)
- **Pinch-to-zoom** y **pan** fluidos en el visor de imagen
- **Overlays útiles** para la inspección de partículas:
  - `mask` (umbral binario)
  - `edges` (bordes tipo Sobel)
  - `contours` (bbox de componentes conectados)
  - `centroids` (centroides de partículas)
  - `sizeMap` (puntos coloreados por tamaño relativo)

> Nota: los cálculos están implementados en JS puro (rápidos pero simples). Para producción, conviene llevarlos a Web Worker y/o optimizarlos con estrategias más robustas.

## Ejecutar

```bash
npm i
npm run dev
```

## Integración con tus cálculos
Si ya tienes un pipeline de detección propio, puedes:
- reemplazar `connectedComponents(...)` por tus resultados, o
- exponer tus partículas (con `cx, cy, area, bbox`) y conectarlas al `ImageViewport` mediante `onParticles(...)`.

## Mejoras posibles
- CLAHE / umbrales adaptativos
- Supresión de grumos vs. partículas dispersas (morfología + distancia)
- Web Worker para no bloquear la UI
- Guardar/recuperar parámetros por imagen
