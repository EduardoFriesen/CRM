# Plataforma CRM SaaS sobre el bot de WhatsApp — Diseño

Fecha: 2026-11-23 · Estado: aprobado

## Intención
El stack actual (Evolution 2.3.7 → Flowise → Postgres/Redis, detrás de nginx) ya contesta por WhatsApp, pero:
- no existe ninguna app propia;
- no se guarda el historial de mensajes;
- el bot no conoce productos ni datos reales del negocio, y no hay forma de que derive al humano.

Se busca una plataforma **multi-negocio (SaaS)** donde cada negocio:
1. Ve a sus **clientes** como tarjetas con la etapa de la conversación (consulta / venta / postventa). El bot interpreta la etapa y el admin puede corregirla. Tocar la tarjeta abre el chat de WhatsApp (`wa.me`).
2. Carga su **catálogo**, que el bot usa para contestar **solo con información verídica**.
3. Lleva una **agenda de pedidos**: cliente, productos y cantidades, fecha de entrega y datos de envío.
4. Configura **su propio agente**: forma de responder, actitud e información del negocio.
5. Carga **su propia API key** de cualquier proveedor de IA (Anthropic, Gemini, OpenAI, etc.) y elige el modelo.

Comportamiento del bot:
- Si no sabe algo, le escribe por WhatsApp al admin del negocio. El admin contesta citando ese mensaje y el bot le reenvía la respuesta al cliente.
- Cuando la venta está por cerrarse, se pausa y le pasa el control al admin. Vuelve a activarse con un botón en la tarjeta o, si nadie lo reactiva, sola después de X horas (configurable por negocio).

## Objetivos
- Entregas usables por separado, en este orden: **1)** base SaaS + tablero de clientes · **2)** catálogo + agente configurable + bot nuevo · **3)** agenda de pedidos.
- Datos de cada negocio aislados en la base (RLS), no solo en la app.

## No objetivos (por ahora)
- **Autenticación y usuarios**: se implementan más adelante con Keycloak (OIDC).
- Registro público de negocios, cobros y facturación.
- Chat completo dentro de la plataforma (la conversación se abre en WhatsApp).
- Envío de mails.

## Anti-objetivos
- Que el bot invente datos (precios, stock, plazos) que no estén en el catálogo o en la información del negocio.
- Que un negocio vea o afecte datos de otro.
- Que una API key de IA vuelva al navegador o aparezca en logs.
- Exponer la app fuera de `127.0.0.1` mientras no haya login.

## Enfoques considerados
| Enfoque | Resultado |
|---|---|
| **Lógica del bot en el backend del CRM** (webhook de Evolution → CRM → modelo con herramientas → Evolution) | **Elegido por el usuario**: aislamiento por negocio, lógica en git, testeable con TDD |
| Flowise con Custom Tools | Descartado: un chatflow por negocio, aislamiento entre negocios difícil de garantizar, sin TDD |
| Híbrido CRM + Flowise | Descartado: dos sistemas que mantener y coordinar |
| **Next.js + Postgres propio** | **Elegido por el usuario**: el stack sigue self-hosted y portable |
| Next.js + Supabase | Descartado: suma un servicio externo o unos 10 contenedores |

## Decisiones del usuario
| Tema | Decisión |
|---|---|
| Etapas | El bot las interpreta según la charla; el admin puede corregirlas |
| Tarjeta | Abre `https://wa.me/<número>` en otra pestaña |
| Consulta al admin | El admin responde citando el mensaje del bot y el bot se lo reenvía al cliente |
| Reactivar el bot | Botón en la tarjeta + timeout configurable por negocio |
| Alta de negocios | La hace el superadmin; por ahora, desde una pantalla interna sin login |
| Modelo de IA | Cada negocio usa su propia API key, de cualquier proveedor |
| Catálogo y bot | El bot usa el catálogo desde la entrega 2 |

## Arquitectura
- **Servicio `crm`** nuevo en `docker-compose.yml` (Next.js standalone, TypeScript estricto), con base `crm` y usuario propio. Se crean siguiendo el patrón de `postgres/init/01-create-databases.sh`. Ese script solo corre con el volumen vacío, así que para el volumen existente hay un script idempotente aparte (`postgres/create-crm-db.sh`).
- **nginx**: nuevo `server` para `crm.localhost`, con las mismas cabeceras y el mismo rate limiting que ya hay. La ruta del webhook **no se publica**: Evolution llama a `http://crm:3000` por la red interna.
- **Una instancia de Evolution por negocio**: el CRM la crea con la API key global (que solo está en el servidor) y configura el webhook de esa instancia hacia `/api/webhooks/evolution/<instancia>`, con un secreto propio de cada instancia en un header. Eventos: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`. *Al implementar hay que verificar en el código de Evolution 2.3.7 el soporte de `headers` en el webhook.*
- **Datos**: Drizzle ORM + migraciones, y Zod en cada entrada y salida (el contrato de API es el del CLAUDE.md global).
- **RLS**: la app se conecta con el rol `crm_app`, que no es dueño de las tablas. Cada transacción hace `set_config('app.tenant_id', …, true)` y las políticas filtran por `tenant_id = current_setting('app.tenant_id')::uuid`. El webhook resuelve el negocio a partir de la instancia.
- **Negocio activo sin auth**: sale de la ruta (`/t/<slug>/…`) y se resuelve en un único punto del servidor, `getCurrentTenant()`. Con Keycloak solo cambia esa función: leerá el negocio de los claims OIDC y comprobará que el usuario pertenece a él.
- **Advertencia**: sin login, cualquiera con acceso a la máquina ve todos los negocios y puede cambiar sus API keys. El README lo dice en negrita. Keycloak es obligatorio antes de exponer la app.

## Modelo de datos
Todas las tablas llevan `tenant_id`, salvo `tenants`.

- `tenants`: slug, nombre, teléfono del admin, horas de timeout del bot, meses de retención.
- `agent_configs`: nombre del agente, tono/actitud, información del negocio (texto libre), proveedor, modelo, URL base (para proveedores compatibles con OpenAI), API key cifrada, últimos 4 caracteres, `enabled`.
- `whatsapp_instances`: nombre, estado, hash del secreto del webhook.
- `contacts`: jid, teléfono (nullable), nombre, `stage` (`consulta|venta|postventa`), `bot_paused_until`, `last_message_at`.
- `messages`: contacto, dirección, autor (`customer|bot|admin`), texto, id de WhatsApp (único por negocio, para que un webhook repetido no duplique mensajes).
- `products`: nombre, descripción, precio, stock, activo.
- `business_facts`: pregunta, respuesta y estado `pending|approved`.
- `escalations`: contacto, pregunta, id del mensaje enviado al admin, estado, respuesta.
- `orders`: contacto, fecha de entrega, dirección, localidad, notas de envío, estado.
- `order_items`: producto, cantidad y precio unitario congelado.
- `audit_log`: acción, entidad, actor ("sistema" hasta que exista Keycloak) y fecha.

Usuarios y membresías llegan con Keycloak.

## Bot (entrega 2)
- **Multi-proveedor con Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`). Unifica el tool calling: la lógica se escribe una vez y cubre Groq, DeepSeek, OpenRouter, Ollama, etc. con la URL base. Las versiones se fijan y se corre `npm audit` al agregarlas.
- **BYOK**: la key se cifra con AES-256-GCM (`node:crypto`) usando la clave maestra `CRM_ENCRYPTION_KEY`. Nunca vuelve al cliente (solo se muestran los últimos 4 caracteres) y nunca se loguea. Se valida con una llamada mínima al guardarla. Sin key válida, el bot queda apagado y la plataforma lo avisa.
- **Prompt**: tiene una parte **fija** (veracidad, uso de herramientas, escalación y traspaso) que el negocio no puede pisar, y una parte **del negocio** (nombre, tono, actitud e información) delimitada como datos.
- **Herramientas**: `search_catalog`, `get_business_facts`, `set_stage`, `ask_admin(question)`, `handoff_to_admin(reason)`.
- **Veracidad**: solo responde con lo que devuelven las herramientas o la información del negocio. Si no tiene el dato, llama a `ask_admin` y le dice al cliente "lo consulto y te aviso". *Riesgo: los modelos chicos siguen peor las reglas. La plataforma recomienda modelos probados y advierte al elegir otro.*
- **Respuesta del admin**: un mensaje que llega desde el teléfono del admin y cita un mensaje de escalación se le reenvía al cliente, y la respuesta se guarda como `business_fact` **pendiente** hasta que el admin la aprueba. *Decisión de diseño: el bot no aprende datos sin revisión.*
- **Traspaso**: `handoff_to_admin` pausa el bot en esa conversación (`bot_paused_until` = ahora + timeout del negocio) y le avisa al admin. Si el admin escribe desde el número del negocio en ese chat (`fromMe`), la pausa se renueva. Se reactiva con el botón o cuando vence la pausa.
- **Debounce** de unos segundos para juntar los mensajes seguidos del cliente.
- **Probar agente**: un chat de prueba dentro de la plataforma, que usa la configuración real sin enviar nada por WhatsApp.
- **Etapas**: las marca el bot con `set_stage` y el admin puede corregirlas. Desde la entrega 3, crear un pedido → venta y pedido entregado → postventa.
- Flowise se retira en la entrega 1: la app está en desarrollo y nadie la usa, así que no hace falta que el bot conteste mientras tanto (decisión del usuario).

## Ley 25.326
- Retención de mensajes configurable por negocio (12 meses por defecto), con un job que purga lo vencido.
- Exportar y borrar los datos de un contacto; `audit_log` para borrados, exportaciones y cambios de API key.
- Los enlaces a la Política de Privacidad y a los Términos llegan con el login de Keycloak.
- El CRM nunca loguea el texto de los mensajes.

## Riesgo conocido: JIDs `@lid`
WhatsApp puede ocultar el número detrás de un JID `@lid`. Si Evolution no manda el número alternativo (`remoteJidAlt`/`senderPn`), el contacto se guarda sin teléfono y la tarjeta no puede armar el `wa.me`: queda deshabilitada y lo avisa.

## Entrega 1
1. Servicio `crm` + base y rol + `crm.localhost` en nginx, más chequeos en `tests/static.sh`.
2. Esquema y migraciones con RLS, y un test de aislamiento entre negocios (siguiendo el patrón de `tests/db-isolation.sh`).
3. Alta y listado de negocios (pantalla interna) y `getCurrentTenant()` a partir de `/t/<slug>`.
4. Conectar WhatsApp desde la app: crear la instancia, mostrar el QR y el estado, y configurar el webhook.
5. Webhook: valida el secreto, crea o actualiza el contacto, guarda el mensaje (idempotente) y actualiza `last_message_at`.
6. Tablero de clientes: tres columnas. La tarjeta muestra nombre, teléfono, último mensaje y estado del bot. El click abre `wa.me`; la etapa se cambia con un control aparte. Contempla los 4 estados (ideal, loading, error, vacío) y es accesible por teclado.
7. En esta entrega la etapa es manual (arranca en "consulta").
8. Se retira Flowise del stack: servicio, base y rol, nginx, variables y README. El bot no contesta hasta la entrega 2. La memoria de conversaciones de Flowise se descarta.

## Verificación
- Vitest con TDD para la lógica de negocio: `getCurrentTenant()`, parseo del webhook, armado del `wa.me`, cálculo de la pausa y la etapa.
- Aislamiento: con `app.tenant_id` de A no se leen datos de B, ni siquiera con SQL directo usando `crm_app`.
- Entrega 2: cifrado de la API key (ida y vuelta, nonce único, tag alterado → error), que la API nunca devuelva la clave, armado del prompt, y loop del bot con el modelo falso del AI SDK.
- E2E con Playwright: `/t/<slug>` → tablero → tarjeta con `href` a `wa.me` → cambiar la etapa.
- Manual: conectar un número por QR desde la app, escribir desde otro teléfono y ver aparecer la tarjeta.
- Antes de cerrar: lint, `tsc --noEmit`, `npm audit --audit-level=high`, `gitleaks detect`.

## Queda a criterio del implementador
- Versiones exactas (las estables más recientes, verificadas al implementar).
- Estructura de carpetas dentro de `crm/`, la UI del tablero (respetando los 4 estados y WCAG AA) y la duración del debounce.
- Qué modelos figuran como "recomendados" en la entrega 2.
