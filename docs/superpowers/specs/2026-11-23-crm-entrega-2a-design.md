# CRM Entrega 2a — Catálogo, agente configurable y bot nuevo — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación
Parte de: `docs/superpowers/specs/2026-11-23-crm-platform-design.md` (la entrega 2 se dividió en 2a y 2b).

## Intención
Hoy el CRM recibe y muestra las conversaciones, pero nadie contesta: Flowise se retiró en la entrega 1.
La 2a devuelve el bot, ahora dentro del CRM y por negocio. Cada negocio:
- carga su **catálogo**;
- configura **su agente** (tono, actitud, información del negocio);
- usa **su propia API key** del proveedor de IA que elija.

El bot contesta solo con datos verídicos y mueve las tarjetas entre etapas según la charla.

## Objetivos
- Catálogo por negocio: nombre, descripción, precio (ARS), stock y activo/pausado. Sin fotos.
- Agente por negocio:
  - nombre del agente;
  - tono y actitud (texto libre);
  - información del negocio (texto libre: horarios, envíos, medios de pago);
  - proveedor, modelo y API key;
  - interruptor para encender o apagar el bot.
- Chat de prueba en la plataforma, con la configuración real y sin enviar nada por WhatsApp.
- El bot contesta a todo cliente que escriba, si el bot está encendido y la key es válida.
- Los mensajes seguidos del cliente se juntan y se contestan en una sola respuesta (debounce).
- El bot clasifica la etapa (consulta / venta / postventa); el admin la sigue pudiendo corregir.

## No objetivos (2a)
- Consulta al admin por WhatsApp, traspaso, pausa por conversación y reactivación: son la **2b**.
- Fotos de productos (*más adelante, quizás*). Variantes de producto (talles, sabores).
- Proveedores en red local (Ollama en la LAN): ver "Proveedores".
- Autenticación (Keycloak, más adelante). La advertencia de "no exponer" sigue vigente y ahora pesa más, porque la plataforma guarda API keys.

## Anti-objetivos
- Que el bot invente precios, stock, plazos o políticas que no estén en el catálogo o en la información del negocio.
- Que el bot diga cantidades exactas de stock.
- Que una API key vuelva al navegador, aparezca en logs o se guarde sin cifrar.
- Que un negocio vea datos o use la key de otro.
- Que el bot entre en un bucle (contestándose a sí mismo o a otro bot) o dispare costos sin techo.

## Decisiones del usuario
| Tema | Decisión |
|---|---|
| Partición | Entrega 2 en dos partes: 2a (esto) y 2b (consulta al admin + traspaso) |
| Fotos | Sin fotos por ahora; quizás más adelante |
| Procesamiento en segundo plano | **BullMQ sobre el Redis existente** (elegido sobre cola en Postgres y temporizador en memoria) |
| Alcance funcional | Aprobado tal cual se propuso (ver Objetivos y "Comportamiento del bot") |
| Multi-proveedor | Vercel AI SDK (decidido en el diseño general) |
| Presentarse como asistente virtual | **Lo decide cada negocio** con un interruptor en Agente (arranca encendido) |

## Enfoques considerados (segundo plano)
| Enfoque | Resultado |
|---|---|
| Cola en Postgres procesada dentro de la app | Recomendado por mí; el usuario eligió B |
| **BullMQ sobre Redis** | **Elegido por el usuario**: reintentos, demoras y debounce resueltos; suma un worker |
| `setTimeout` en memoria | Descartado: se pierden respuestas al reiniciar |

## Arquitectura

```
WhatsApp → Evolution → webhook (crm) → guarda mensaje (author=customer)
                                     → encola "reply:<tenant>:<contact>" con debounce
crm-worker (BullMQ) → toma la tarea → arma contexto (últimos 20 mensajes)
                    → modelo del negocio + herramientas → Evolution sendText
                    → guarda la respuesta (author=bot) → actualiza la etapa si corresponde
```

- **Redis**: el mismo servicio `redis` del compose, con la base lógica **2** (Evolution usa la 1). Sigue sin puerto publicado.
- **Servicio nuevo `crm-worker`**:
  - misma imagen base que `crm`, otro target y comando;
  - el código del worker se empaqueta con esbuild en el build (`dist/worker.mjs`);
  - usa `DATABASE_URL` (crm_app, sujeto a RLS), `REDIS_URL`, `EVOLUTION_URL`, `EVOLUTION_API_KEY` y `CRM_ENCRYPTION_KEY`;
  - no publica puertos;
  - nginx no lo conoce.
- **El webhook solo encola**:
  - nunca llama al modelo;
  - encola solo mensajes entrantes (`fromMe=false`) de contactos no ignorados;
  - si Redis no responde, el mensaje igual se guarda; el webhook loguea el código del error y contesta 200, para que Evolution no reintente sin fin.
- **Debounce**:
  - una tarea por contacto (`jobId`/deduplicación `reply:<tenantId>:<contactId>`), con demora de **8 s**;
  - cada mensaje nuevo dentro de la ventana reinicia la demora;
  - la respuesta contempla todos los mensajes pendientes.
- **Reintentos**: 3 intentos con backoff exponencial ante errores transitorios (5xx del proveedor, timeouts, Evolution caído). Un 401/403 del proveedor **no** se reintenta (ver "Estado de la key").
- **Aislamiento**: el worker siempre trabaja con `withTenant(tenantId)`. El `tenantId` sale de la tarea, que solo crea el webhook ya autenticado.

## Modelo de datos (migraciones nuevas)
- `products`:
  - id, tenant_id, nombre (1–120), descripción (0–1000), `price` numeric(12,2) ≥ 0, `stock` int nullable ≥ 0 (null = no se controla stock), `active` bool default true, timestamps;
  - RLS como el resto;
  - `crm_app` con SELECT/INSERT/UPDATE/DELETE: el catálogo sí se borra.
- `agent_configs`, uno por negocio:
  - `agent_name`;
  - `tone` (≤ 2000);
  - `business_info` (≤ 8000);
  - `provider` (`anthropic|google|openai|openai-compatible`), `model`, `base_url` (solo openai-compatible);
  - `api_key_enc` (bytea/base64: IV + tag + ciphertext), `api_key_last4`;
  - `key_status` (`unverified|valid|invalid`), `enabled` bool default false, `disclose_ai` bool default true;
  - `last_error_code` y `last_error_at` (para mostrar en la pantalla);
  - RLS.
- `messages.author`: enum `customer|bot|admin`.
  - Migración con backfill: `in` → customer, `out` → admin (histórico desconocido; con Flowise ya retirado, todo `out` previo fue Flowise o el admin).
  - Desde ahora:
    - entrante = `customer`;
    - `fromMe` del webhook = `admin`;
    - lo que envía el worker = `bot`.
  - **Carrera**: el eco `fromMe` del mensaje del bot puede llegar al webhook antes de que el worker guarde su fila. Por eso el worker hace upsert por `wa_message_id` forzando `author='bot'`. Requiere `GRANT UPDATE (author)` sobre `messages` para `crm_app`.
- `bot_usage` (o un contador en Redis, a criterio del implementador): respuestas del bot por contacto y por hora, para el freno anti-bucle.

## Proveedores y API key
- Proveedores: Anthropic, Google (Gemini), OpenAI y "compatible con OpenAI" (OpenRouter, Groq, DeepSeek, etc.), con URL base.
- **URL base (anti-SSRF)**:
  - solo `https://`;
  - el host debe resolver a IPs públicas: se rechazan loopback, privadas (10/8, 172.16/12, 192.168/16), link-local, CGNAT y los nombres de servicios internos (`postgres`, `redis`, `evolution-api`, `crm`);
  - se valida al guardar **y** antes de cada uso.
  - *Decisión mía*: deja afuera a Ollama en la LAN; se habilita cuando exista una opción explícita y protegida.
- **Cifrado**:
  - AES-256-GCM con `node:crypto`, IV aleatorio de 12 bytes por cifrado;
  - clave maestra `CRM_ENCRYPTION_KEY` (32 bytes en hex) solo en `crm` y `crm-worker`;
  - la key nunca vuelve al cliente (solo `api_key_last4`) y nunca se loguea;
  - cambiar la clave maestra invalida las keys guardadas: se documenta.
- **Validación al guardar**:
  - llamada mínima al proveedor (1 token);
  - éxito → `valid`; 401/403 → `invalid`, el guardado se rechaza con un mensaje claro; error de red → se guarda como `unverified`, con aviso.
- **Estado de la key en uso**: si el proveedor responde 401/403 durante una respuesta, `key_status=invalid`, el bot deja de contestar para ese negocio y la pantalla Agente lo muestra en rojo.
- **Modelos**:
  - campo de texto con sugerencias por proveedor; las sugerencias se verifican al implementar;
  - al elegir uno fuera de las sugerencias se advierte que "modelos chicos inventan más".

## Comportamiento del bot
- Contesta si `enabled` y `key_status != invalid` y el contacto no está ignorado.
- **Contexto**: últimos **20** mensajes del contacto (customer/bot/admin, en orden), más la hora actual en `America/Argentina/Buenos_Aires`.
- **Prompt en dos partes**:
  - **Fija** (no editable):
    - contestar solo con lo que devuelven las herramientas o lo que dice la información del negocio;
    - nunca inventar precios, stock, plazos ni políticas;
    - no decir cantidades de stock;
    - si falta un dato, decir "no tengo ese dato, te lo confirma alguien del equipo";
    - español rioplatense, mensajes breves de WhatsApp;
    - llamar `set_stage` cuando cambie la etapa;
    - **nunca afirmar ser una persona**: si le preguntan si es un bot, dice la verdad, aunque `disclose_ai` esté apagado (*decisión mía: el interruptor controla la presentación, no habilita mentir*).
  - **Presentación** (si `disclose_ai`): en la primera respuesta a un contacto sin mensajes del bot, o cuyo último mensaje del bot tiene más de 24 h, se presenta como "el asistente virtual de <negocio>". El worker lo decide y agrega la instrucción al prompt; no depende del modelo.
  - **Del negocio**: nombre, tono/actitud e información, delimitados como datos (no como instrucciones).
- **Herramientas**:
  - `search_catalog(query)`: productos **activos** del negocio que coinciden (nombre o descripción, sin distinguir mayúsculas ni acentos), hasta 10. Devuelve nombre, descripción, precio y disponibilidad (`disponible` | `sin stock`); nunca la cantidad.
  - `set_stage(stage)`: actualiza la etapa del contacto. No la mueve hacia atrás de postventa a consulta salvo que la charla sea claramente una consulta nueva; *criterio en el prompt*.
- **Freno anti-bucle y de costos**:
  - máximo **20 respuestas del bot por contacto por hora**; al pasarlo, deja de contestar ese contacto hasta la hora siguiente y lo registra;
  - el bot nunca reacciona a mensajes `fromMe`.
- **Envío**: un único mensaje de texto por respuesta (`sendText` de Evolution), de hasta 1500 caracteres; si la respuesta es más larga, se corta en el último punto antes del límite.
- **Si falla todo** (agotó reintentos): no se envía nada al cliente y se registra `last_error_code` en `agent_configs`, visible en la pantalla Agente.

## Chat de prueba
- En la pantalla Agente: conversación en memoria del navegador, no se guarda.
- Server action síncrona que usa la misma función que el worker, con las mismas herramientas y la configuración guardada.
- `set_stage` no tiene efecto y se muestra como "(el bot movería la tarjeta a Venta)".
- Funciona aunque el bot esté apagado, para poder probar antes de encenderlo.

## UI
- La navegación del negocio pasa a ser Clientes · **Catálogo** · **Agente** · WhatsApp.
- **Catálogo**: tabla con alta, edición inline o en formulario, pausar/activar y borrar con confirmación. Estados vacío, loading, error e ideal.
- **Agente**:
  - formulario de configuración;
  - key con `••••1234` y botón "Cambiar key";
  - estado de la key y último error;
  - interruptor del bot;
  - interruptor "Presentarse como asistente virtual" (encendido por defecto);
  - chat de prueba al costado (abajo en el celular).
- En **Clientes**, la cabecera muestra "Bot encendido / apagado / key inválida" con un link a Agente. El estado por conversación llega en la 2b.
- Misma dirección visual de la entrega 1 (tokens en `globals.css`).

## Ley 25.326
- El texto de las conversaciones se envía al proveedor de IA que elige el negocio. La pantalla Agente lo avisa, y el README indica que el negocio debe contemplarlo en su política de privacidad.
- Los logs del worker incluyen solo ids, códigos y duraciones; nunca texto de mensajes, teléfonos ni keys.

## Verificación
- Unitarios (Vitest):
  - cifrado: ida y vuelta, IV único, tag alterado → error;
  - validador de URL base (casos privados, http, nombres internos);
  - armado del prompt (el texto del negocio no reemplaza la parte fija);
  - corte a 1500 caracteres;
  - formateo de la disponibilidad.
- Integración (Postgres real):
  - CRUD de productos aislado por RLS;
  - `search_catalog` sin productos pausados, sin cantidades y sin productos de otro negocio;
  - backfill de `author`;
  - upsert del bot que gana la carrera del eco;
  - la API de Agente nunca devuelve la key.
- Loop del bot con el modelo falso del AI SDK (`MockLanguageModel`) y fetch de Evolution stubbeado:
  - contesta y guarda `author=bot`;
  - llama `set_stage`;
  - 401 → `invalid` y no contesta más;
  - freno de 20 por hora.
- Cola: con Redis real (el del compose, base de test separada), varios mensajes en la ventana de 8 s → una sola tarea.
- E2E (Playwright): CRUD de catálogo; configurar el agente (la key queda enmascarada); chat de prueba con un modelo falso inyectado en modo test.
- Manual: con una key real, escribir desde otro teléfono y recibir respuesta. Preguntar algo que no está en el catálogo → "no tengo ese dato". Ver la tarjeta moverse a Venta.

## Decisiones mías (builder check)
- `search_catalog` filtra en la app con texto normalizado (minúsculas y sin acentos) sobre los productos activos. *ponytail: hasta unos cientos de productos; si crece, pasar a `unaccent` + índice trigram.*
- Al encender el bot no se contestan mensajes recibidos mientras estaba apagado: solo los que llegan con el bot encendido.
- Los precios se muestran sin decimales cuando son redondos (`$2.500`) y con dos cuando no lo son (`$2.500,50`), con formato `es-AR`.

## Queda a criterio del implementador
- Versiones exactas (bullmq, ai, @ai-sdk/*, esbuild), verificadas al implementar.
- Mecanismo exacto del debounce en BullMQ (deduplicación con extensión o remove+add).
- Contador del freno: tabla `bot_usage` o Redis.
- Diseño visual de Catálogo y Agente, dentro de la dirección ya definida.
- Cómo se inyecta el modelo falso en E2E: variable de entorno solo en modo test, nunca en producción.
