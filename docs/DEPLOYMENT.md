# Despliegue de BlindSave

## 1. Proyecto Supabase

Crea un proyecto en la región adecuada. Instala la CLI oficial de Supabase en tu máquina de despliegue y autentícate. No incluyas claves administrativas en el frontend ni en Git.

```sh
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

La migración crea tablas del mercado y sus políticas. No crea buckets Storage ni tablas para consumos. La tabla de documentos usa `vector(1536)`; deberá adaptarse al modelo de embeddings elegido cuando se implemente RAG.

En Auth activa **Anonymous Sign-ins**. Configura los límites de Auth, CAPTCHA con Turnstile y la URL pública del sitio. Usa la clave secreta del CAPTCHA en la configuración de Supabase; la clave de sitio es pública y va al frontend.

## 2. Función

```sh
supabase secrets set ALLOWED_ORIGINS=https://tu-dominio.example
supabase functions deploy analyze
```

Para varios dominios, lista separada por comas, sin barras finales. Añade localhost solo para desarrollo. `SUPABASE_URL` y `SUPABASE_ANON_KEY` son variables proporcionadas por Supabase a la función. `verify_jwt = false` desactiva la comprobación del gateway para permitir claves asimétricas; **la función exige y valida el JWT con `auth.getUser()` antes de aceptar datos**. No elimines esa validación. CORS no sustituye a la autenticación.

## 3. Catálogo revisado

No se precargan ofertas inventadas en la base de producción. Carga cada oferta desde SQL Editor o una herramienta administrativa confiable con `status = 'draft'`. Revisa la fuente, impuestos excluidos, servicios obligatorios, permanencia y garantía de precio. Campos:

| Campo | Unidad / propósito |
| --- | --- |
| `energy_p1`, `energy_p2`, `energy_p3` | €/kWh, antes de impuestos |
| `power_p1`, `power_p2` | €/kW/día, antes de impuestos |
| `monthly_fee` | €/mes; sumar todos los servicios obligatorios |
| `price_guarantee_months` | Al menos 12; excluir promociones con cambios de precio |
| `valid_from`, `valid_until` | Fechas durante las que se puede contratar la oferta |
| `source_url` | Documento o página pública HTTPS que respalda la oferta |
| `verified_at` | Momento real de la revisión; máximo 30 días de antigüedad |
| `conditions` | Descripción factual de condiciones y restricciones |
| `commitment_months` | Duración de permanencia |
| `renewable` | Solo verdadero con respaldo documental |
| `is_demo` | Debe ser falso para publicar |

Una vez revisada, cambia a `status = 'published'`. El cliente no tiene permisos de escritura. El motor compara como máximo 100 ofertas; ampliar o paginar antes de crecer por encima de ese límite. Si no hay ofertas vigentes y verificadas, la aplicación responde con un estado de catálogo no disponible.

## 4. Frontend estático

Configura las variables **durante la compilación** en tu proveedor de alojamiento:

```dotenv
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICABLE
VITE_TURNSTILE_SITE_KEY=TU_CLAVE_PUBLICA_TURNSTILE
```

Compilación: `npm ci && npm run build`. Directorio de salida: `dist`. Activa HTTPS. `public/_headers` y `_redirects` son archivos para proveedores compatibles como Pages/Netlify; en otros proveedores configura sus equivalentes. La CSP admite `https://*.supabase.co`; modifica `connect-src` si utilizas dominio propio de Supabase. El servidor de desarrollo de Vite **no** aplica esos headers.

El modo demo se activa únicamente si ambas variables de Supabase están ausentes. No despliegues con variables vacías si quieres el servicio real. Ninguna variable `VITE_` es secreta.

## 5. Operación y privacidad

- Configura una tarea diaria en Supabase Cron para `select public.prune_analysis_quotas();`. La función elimina contadores de más de 24 horas; hasta configurar la tarea, no hay borrado automático.
- Establece una retención breve de logs técnicos en los proveedores. No añadas logging de cuerpos, tokens, consumos o archivos.
- Las sesiones anónimas generan registros Auth. Programa su limpieza con la API administrativa de Auth según tu política de retención; no borres sesiones activas indiscriminadamente. El botón de la UI no elimina esos registros del servidor.
- El límite de 30 intentos/hora es por usuario anónimo, **no por persona**. Puede evadirse creando sesiones; CAPTCHA y los límites de creación de usuarios de Supabase son necesarios antes de abrir el servicio al público. Añade protección de red si crece el abuso.
- Asegura un presupuesto/límite de costes y monitoriza errores sin capturar los cuerpos de solicitudes.
- Publica identidad del responsable, proveedores, finalidades y plazos reales de retención antes de abrir el servicio al público. «Zero-PII» es un objetivo de minimización del flujo de consumo, no una certificación de anonimato o cumplimiento legal.

## 6. Verificación remota tras desplegar

1. Confirma que desaparece la etiqueta DEMO y que se crea sesión sin correo.
2. Comprueba que un catálogo vacío muestra un error y no ofertas ficticias.
3. Publica una oferta revisada y compara el resultado con la fórmula documentada.
4. Revisa Network: solo se envían totales numéricos, potencias y precios; ningún archivo o nombre de archivo.
5. Verifica que los intentos sin JWT devuelven 401, otro origen recibe 403 y la petición 31/hora devuelve 429.
6. Comprueba CAPTCHA, headers, cierre local de sesión y tareas de limpieza.

Fuentes: [Auth anónimo](https://supabase.com/docs/guides/auth/auth-anonymous), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth en Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt).
