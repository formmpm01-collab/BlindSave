# BlindSave

Primera versión funcional del comparador eléctrico descrito en la propuesta «Zero-PII». React + TypeScript + Vite, con Auth, Postgres/RLS y una Edge Function en Supabase. Interfaz en español, adaptable a móvil, sin analítica ni fuentes externas.

## Ejecutar

Requiere Node >=20.19 y npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Sin variables de Supabase: demostración **local**, con tres tarifas ficticias claramente identificadas. «Probar con un ejemplo» rellena los datos; «Calcular mi ahorro» ejecuta el motor. No hay ofertas reales incluidas ni ahorros comerciales verificados.

Con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`: sesión anónima, cálculo en Edge Function y catálogo real. La clave puede ser la publicable del proyecto o la antigua `anon`; **nunca** `service_role` ni una secret key. Si falla el backend o no hay ofertas, se muestra un error: no se sustituye el catálogo por datos de demostración.

## Alcance implementado

- Electricidad 2.0TD para Península y Baleares, hasta 15 kW. Entrada anual por P1/P2/P3 o CSV horario estricto, entre 28 y 366 días completos.
- Validación **local** de archivo, tamaño, esquema, fechas, huecos, duplicados y cambios de hora. Solo tres totales anuales, dos potencias y seis precios salen del navegador. Ningún PDF, nombre de archivo, CUPS o serie horaria se transmite.
- Motor compartido entre navegador y backend: energía + potencia + cuotas, ranking, diferencia anual/mensual, condiciones y filtro de permanencia.
- Gráfica de periodos y, para CSV, media por hora con tabla accesible.
- Auth anónimo en memoria; políticas RLS de solo lectura sobre ofertas publicadas, revisadas en los últimos 30 días y vigentes; sin escrituras del usuario al catálogo.
- Edge Function con verificación del JWT, lista de orígenes, cuerpo máximo de 8 KiB, esquema estricto y cuota de 30 intentos/hora por sesión.
- Esquema de documentos públicos y embeddings pgvector como base para una futura recuperación de fuentes. **No hay chatbot ni ingesta automática implementados**.

## Límites del cálculo

Todos los costes se muestran **antes de impuestos y alquiler del contador**. La tarifa de referencia se reconstruye a partir de precios introducidos, no de un total de factura. Se incluyen cuotas obligatorias, pero no penalizaciones de salida. Solo precios fijos garantizados durante al menos 12 meses, sin promociones escalonadas, autoconsumo, bono social, PVPC ni tarifas indexadas.

Se normaliza a 365 días. Un periodo corto se extrapola por `365 / días` y se advierte de que no corrige la estacionalidad; un año bisiesto también se normaliza. Nunca se infiere una potencia máxima ni se aconseja reducirla usando una media horaria.

La plantilla `public/plantilla-consumo.csv` contiene **31 días sintéticos**, no datos reales. Es un formato canónico: no se garantiza compatibilidad directa con exportaciones de Datadis/distribuidoras. Adapta localmente a estas tres columnas:

```csv
fecha;hora;kwh
2025-01-01;0;0,250
2025-01-01;1;0,180
```

Fecha ISO y hora local al **inicio** del intervalo (0–23); no confundir con exportaciones 1–24 de fin de intervalo. En primavera falta 02:00 el último domingo de marzo; en otoño debe aparecer dos veces el último domingo de octubre. Sin compensación de excedentes: consumo no negativo. Archivo hasta 2 MiB. No se envían valores inválidos en mensajes de error.

Los periodos siguen el [calendario 2.0TD de la CNMC](https://www.cnmc.es/file/304517/download): festivos de fecha fija no sustituibles y 6 de enero; no se incorporan festivos locales, autonómicos o móviles. El calendario y las reglas de cambio de hora deben revisarse si cambia la normativa.

## Verificación

```sh
npm run check             # Motor, CSV, SQL/pgTAP en PGlite y compilación
npx playwright install chromium
npm run test:e2e          # Flujos en escritorio y móvil
deno check --config supabase/functions/deno.json supabase/functions/analyze/index.ts
deno test --allow-env --config supabase/functions/deno.json supabase/functions/analyze/handler_test.ts
supabase start           # CLI + Docker
supabase test db          # RLS, visibilidad, cuotas y retención con pgTAP
```

CI ejecuta compilación, pruebas de lógica/interfaz, comprobación Deno y pruebas SQL. No requiere un proyecto remoto ni credenciales para esas pruebas. Las pruebas E2E fuerzan el modo demostración en un servidor aislado en el puerto 5174. La suite local SQL ejecuta la migración real y pgTAP con pgvector en PGlite y un contrato mínimo simulado de Auth; CI también la ejecuta contra Supabase local. La verificación remota de Auth, CAPTCHA y despliegue requiere tu proyecto.

## Despliegue

Ver [guía de Supabase](docs/DEPLOYMENT.md), [arquitectura y privacidad](docs/ARCHITECTURE.md) y [plan de siguientes fases](docs/ROADMAP.md). Supabase aloja el backend; la SPA compilada necesita alojamiento estático separado (por ejemplo Cloudflare Pages, Netlify o Vercel). El repositorio no contiene un despliegue remoto ni credenciales.
