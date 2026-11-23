# CRM Entrega 2b — Consulta al admin y traspaso — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación
Parte de: `docs/superpowers/specs/2026-11-23-crm-platform-design.md`. Se construye sobre la 2a (`docs/superpowers/specs/2026-11-23-crm-entrega-2a-design.md`).

## Intención
En la 2a, cuando al bot le falta un dato dice "no tengo ese dato, te lo confirma alguien del equipo" y ahí queda. En la 2b:

1. **Consulta al admin**: el bot le pregunta al admin por WhatsApp. El admin contesta citando ese mensaje y el bot le transmite la respuesta al cliente. Lo que el admin contesta **queda aprendido** para la próxima vez, **salvo que tenga que ver con precios**: en ese caso el bot pregunta siempre.
2. **Traspaso**: cuando la venta está por cerrarse, el bot le pasa el control al admin y se pausa en esa conversación. Vuelve con un botón en la tarjeta o solo después de X horas.

## Objetivos
- Herramienta del bot `ask_admin`: crea la consulta, se la manda al WhatsApp personal del admin y el bot le dice al cliente que lo consulta y le avisa.
- Respuesta citada del admin → el bot se la transmite al cliente y la guarda como dato aprendido, si no es de precios.
- Datos aprendidos disponibles para el bot en las siguientes charlas, sin aprobación previa.
- Herramienta del bot `handoff_to_admin`:
  - le avisa al cliente y al admin;
  - mueve la tarjeta a Venta;
  - pausa el bot en esa conversación.
- El admin escribiendo desde el número del negocio en una charla también la pausa.
- Reactivación con el botón "Reactivar bot" en la tarjeta, o automática tras `pause_hours` sin mensajes del admin.
- Recordatorio único al admin si una consulta sigue sin respuesta a las 2 h.
- El número personal del admin nunca aparece como cliente ni recibe respuestas del bot.

## No objetivos
- Chat dentro del CRM: el admin atiende desde el WhatsApp del negocio, en el teléfono o en WhatsApp Web.
- Varios admins por negocio: un solo `admin_phone`.
- Aprobación previa de datos aprendidos (*decisión del usuario: se aprenden solos*).

## Anti-objetivos
- Que el bot aprenda o repita un **precio** que no esté en el catálogo o en la información del negocio.
- Que el bot le hable encima al admin durante un traspaso.
- Que el eco del mensaje del propio bot se tome como "el admin escribió" y pause la charla por error.
- Que el admin quede como tarjeta de cliente o que el bot le conteste.

## Decisiones del usuario
| Tema | Decisión |
|---|---|
| Datos aprendidos | Se guardan y usan directo, sin aprobación |
| Precios | Nunca se aprenden: si el precio no está en el catálogo ni en la información del negocio, el bot pregunta siempre |
| Respuesta del admin | Citando el mensaje de la consulta (ya decidido) |
| Reactivación | Botón en la tarjeta + timeout configurable (ya decidido) |
| Propuestas aceptadas | Pausa de 12 h por defecto; pantalla de datos aprendidos; recordatorio único a las 2 h; aviso de traspaso sin link `wa.me` |

## Enfoques considerados
| Tema | Opción | Resultado |
|---|---|---|
| Cómo usa el bot lo aprendido | Herramienta `search_facts` (como el catálogo) | Descartado: una llamada más por respuesta para pocos datos |
| | **Inyectar los datos aprendidos en el prompt, dentro de `<negocio>`** | **Elegido (mío)**: simple, el modelo ve todo. *ponytail: tope de 8000 caracteres, los más recientes; con más datos pasar a herramienta de búsqueda* |
| Cómo transmite la respuesta del admin | Reenviar el texto del admin tal cual | Descartado: las respuestas del admin suelen ser escuetas ("sí, hasta las 20") |
| | **El bot redacta la respuesta con sus palabras, usando solo lo que dijo el admin** | **Elegido (mío)**: mantiene el tono del agente; la regla fija prohíbe agregar datos |
| Distinguir eco del bot vs. admin | Decidirlo al llegar el eco | Descartado: el eco puede llegar antes de que el worker reclame su mensaje |
| | **Tarea demorada de 10 s que verifica si el mensaje sigue siendo `admin`** | **Elegido (mío)**: se apoya en el reclamo por `wa_message_id` que ya existe |

## Detección de "precio"
Doble barrera, porque un error acá es justo lo que el usuario no quiere:
1. `ask_admin(question, is_price)`: el modelo marca si la consulta es de precio (instrucción fija: precio, costo, cuánto sale o vale, descuento, recargo, envío con costo).
2. **Regla del servidor** sobre la pregunta y la respuesta del admin. Si alguna menciona dinero, no se aprende, aunque `is_price` sea falso. Cuenta como dinero:
   - `$` seguido de número;
   - "precio", "cuesta", "cuestan", "sale", "salen", "vale", "valen", "costo", "cobr", "descuento", "recargo", "pesos", "ars", "usd";
   - números con separador de miles junto a esas palabras.

   *Mi decisión: el falso positivo (no aprender algo inocente) es barato; el falso negativo no.*

Los precios del **catálogo** y los de la **información del negocio** los carga el dueño y el bot los puede decir. Lo que nunca hace es aprender un precio de una respuesta del admin.

## Modelo de datos (migraciones nuevas)
- `agent_configs.pause_hours` int, default 12, entre 1 y 168.
- `tenants.admin_phone` editable desde la pantalla Agente: requiere `GRANT UPDATE (admin_phone) ON tenants` para `crm_app`. Se valida igual que al crear el negocio.
- `contacts.bot_paused_until` timestamptz null.
- `escalations`, con RLS:
  - `id`, `tenant_id`, `contact_id`, `question` (≤ 500), `is_price` bool;
  - `admin_message_id` (id de WhatsApp del mensaje enviado al admin, único por negocio);
  - `status` (`pending|answered`), `answer` null, `reminded_at` null, `created_at`, `answered_at` null.
- `business_facts`, con RLS: `id`, `tenant_id`, `question`, `answer`, `escalation_id` null, `created_at`, `updated_at`.
- Grants para `crm_app`: SELECT/INSERT/UPDATE en `escalations`; SELECT/INSERT/UPDATE/DELETE en `business_facts`.

## Flujos

### Mensajes del número del admin
- El webhook compara el remitente (dígitos del JID, o de `remoteJidAlt` si es `@lid`) con `tenants.admin_phone`. Si coincide, el mensaje **no crea contacto, no se guarda en `messages` y no despierta al bot**.
- Si cita (`contextInfo.stanzaId`) el `admin_message_id` de una consulta `pending` → flujo "respuesta del admin".
- Si no cita nada y hay consultas pendientes, se le contesta al admin una sola vez cada 10 minutos: "Para responder una consulta, citá el mensaje de la consulta."
- Si no cita nada y no hay pendientes, se ignora.

### Consulta al admin (`ask_admin`)
1. El modelo llama `ask_admin({ question, is_price })`.
2. Se crea la consulta `pending` y se le envía al admin:
   `Consulta de <nombre o "un cliente"> (+<teléfono>): <question>. Respondé citando este mensaje.`
3. La herramienta devuelve "consulta enviada". El prompt fijo indica decirle al cliente "lo consulto y te aviso".
4. Si falla el envío al admin, la herramienta devuelve "no se pudo consultar" y el bot usa la frase de la 2a ("no tengo ese dato, te lo confirma alguien del equipo").
5. Límite: 3 consultas pendientes por contacto. Al pasarlo, la herramienta pide usar la frase de la 2a.
6. Se programa un recordatorio (tarea demorada 2 h). Si sigue `pending`, se envía una sola vez: `Recordatorio: <mismo texto>`, y se marca `reminded_at`.

### Respuesta del admin
1. La consulta pasa a `answered` y guarda la respuesta (≤ 2000 caracteres).
2. **Aprendizaje**: si `!is_price` y la regla del servidor no detecta dinero, se crea un `business_fact(question, answer)`.
3. **Transmisión al cliente**: tarea `relay` en la cola.
   - Si la conversación está en traspaso (pausada), no se envía nada: el admin ya está atendiendo.
   - Si no, el bot redacta un mensaje con la instrucción fija "comunicá la respuesta del equipo con tus palabras, sin agregar datos", lo envía y lo guarda como `bot`.
   - El relay ignora el freno de "el último mensaje debe ser del cliente", pero respeta el tope de 20 por hora y que el bot esté encendido con key válida.
4. Al admin se le confirma: `Listo, le respondí a <nombre>.` Si la respuesta es de precio, se agrega: `(no la guardé porque es de precios)`.

### Traspaso (`handoff_to_admin`)
1. El modelo lo llama cuando el cliente quiere cerrar la compra (confirma, pregunta cómo pagar o pide reservar).
2. Efectos:
   - `bot_paused_until = now + pause_hours`;
   - etapa → Venta;
   - aviso al admin: `Traspaso: <nombre> (+<teléfono>) quiere cerrar una compra. <reason>. Atendelo desde el WhatsApp del negocio.`
3. El bot le dice al cliente que lo atiende alguien del equipo; el prompt fijo lo indica.

### Pausa
- `runConversation` devuelve `skipped:paused` si `bot_paused_until > now`. El webhook tampoco encola en ese caso.
- Los mensajes del cliente durante la pausa **no se contestan después** (mismo criterio que con el bot apagado).
- **Admin escribiendo desde el número del negocio**: por cada `fromMe` que el webhook guarda como `admin`, se encola `check-admin` con 10 s de demora. Si a los 10 s el mensaje sigue con `author='admin'` (el bot no lo reclamó), se renueva `bot_paused_until = now + pause_hours`.
- **Reactivación**: el botón "Reactivar bot" en la tarjeta pone `bot_paused_until = null`. Si no, la pausa vence sola.

## Prompt (cambios)
- **Reglas fijas nuevas**:
  - si falta un dato, usar `ask_admin` y decirle al cliente "lo consulto y te aviso";
  - marcar `is_price` en toda consulta de precios;
  - nunca usar los datos aprendidos para precios;
  - cuando el cliente quiere cerrar la compra, usar `handoff_to_admin` y decirle que lo atiende alguien del equipo.
- **Datos aprendidos** dentro de `<negocio>`, como "Preguntas ya respondidas por el equipo", hasta 8000 caracteres, los más recientes primero.

## UI
- **Datos aprendidos** (pantalla nueva en la navegación): lista de pregunta, respuesta y fecha, con editar y borrar. Arriba, las consultas pendientes (pregunta, cliente y hace cuánto). Contempla los 4 estados.
- **Agente**:
  - campo "Horas de pausa tras un traspaso" (default 12);
  - campo "WhatsApp del administrador";
  - texto: "Las consultas y avisos de traspaso llegan a este número. Para responder una consulta, citá el mensaje."
- **Clientes**: la tarjeta pausada muestra "Bot pausado hasta 18:30" y un botón "Reactivar bot", fuera del link `wa.me`, como el selector de etapa.

## Seguridad y datos personales
- Los avisos al admin incluyen nombre y teléfono del cliente, como el CRM. No se loguean.
- El número del admin no se guarda en `messages`: sus mensajes son operativos, no de clientes.
- `business_facts` no guarda datos de clientes: el prompt de `ask_admin` pide formular la pregunta sin datos personales.

## Verificación
- **Unitarios**:
  - detector de dinero (casos positivos y negativos, incluidos "$2.500", "cuesta", "sale 3000", "abrimos a las 8");
  - armado del prompt con datos aprendidos y tope de 8000 caracteres;
  - formato de los mensajes al admin.
- **Integración**:
  - el número del admin no crea contacto ni encola;
  - una respuesta citada responde la consulta correcta, aprende si no es de precio y no aprende si lo es (por `is_price` y por la regla);
  - el relay se envía y respeta la pausa;
  - `handoff_to_admin` pausa, mueve a Venta y avisa;
  - `skipped:paused`;
  - el eco del bot no pausa;
  - un mensaje real del admin desde el negocio sí pausa;
  - reactivar pone la pausa en null;
  - el recordatorio se envía una sola vez;
  - RLS de `escalations` y `business_facts`.
- **E2E**: datos aprendidos (editar y borrar); tarjeta pausada con "Reactivar bot"; campos nuevos en Agente.
- **Manual**:
  - preguntar algo fuera del catálogo → el admin recibe la consulta; contestar citando → el cliente recibe la respuesta; volver a preguntar lo mismo → responde sin consultar;
  - preguntar un precio no cargado → consulta siempre;
  - "lo quiero comprar" → traspaso: aviso al admin, bot pausado y botón Reactivar.

## Queda a criterio del implementador
- Texto exacto de los mensajes al admin, respetando los contenidos de arriba.
- Cómo programar el recordatorio y `check-admin`: tareas demoradas en la misma cola u otra cola.
- Diseño visual de la pantalla de datos aprendidos, dentro de la dirección existente.
