# CRM - Bot de WhatsApp con IA

Stack Docker Compose: app CRM (Next.js) + worker del bot (BullMQ) + Evolution API v2.3.7 (WhatsApp) + Postgres 17 + Redis 8 + nginx como proxy. Cada negocio configura su propio agente de IA con su API key.

## Requisitos

- Docker con Compose v2, `openssl`, `curl`.
- Un numero de WhatsApp **dedicado** (ver advertencias).

## Puesta en marcha

```bash
cp .env.example .env
# Reemplazar cada change-me por un valor propio, uno por variable:
openssl rand -hex 32
docker compose up -d
```

- Usa siempre `openssl rand -hex 32` (solo hex): la clave de Postgres se interpola sin codificar en una URI de conexion y caracteres como `@ / :` la rompen. Nunca dejes `change-me`: compose solo falla si una variable esta sin definir o vacia, **no detecta** el valor `change-me`.
- Las claves de base de datos solo se aplican cuando el volumen de Postgres esta vacio. Si las cambias despues, hay que ejecutar `docker compose down -v` (**borra TODOS los datos**, incluidas las instancias de WhatsApp) o hacer `ALTER ROLE` a mano.
- URLs locales (nginx escucha en `127.0.0.1:${HTTP_PORT}`, default 8080, porque Docker rootless no puede usar el puerto 80):
  - CRM: http://crm.localhost:8080
  - Evolution: http://evolution.localhost:8080
  - En un VPS con Docker como root podes poner `HTTP_PORT=80`.

## App CRM

> **La app no tiene login todavia (llega con Keycloak).** Cualquiera que llegue a `crm.localhost` ve y modifica todos los negocios. Por eso nginx la publica solo en `127.0.0.1`: **no la expongas a una red ni a internet hasta que exista el login.**

Flujo:

1. En http://crm.localhost:8080 crea el negocio (nombre, identificador para la URL y WhatsApp del administrador).
2. Entra al negocio > **WhatsApp** y escanea el QR desde el telefono del negocio (Dispositivos vinculados). La app crea la instancia en Evolution con un webhook propio y un secreto por instancia.
3. Cada mensaje que recibe o envia ese numero aparece en el **Tablero**, en la columna Consulta. Tocar la tarjeta abre el chat en `wa.me` (con la cuenta de WhatsApp que tengas abierta en ese dispositivo); la etapa se cambia con el selector de la tarjeta.

4. En **Catálogo** cargá los productos y en **Agente** el modelo, la API key, el tono y la información del negocio. Probalo en el chat de prueba y encendé el bot.

## Bot

- **Cómo contesta:** el webhook guarda cada mensaje y, si el bot del negocio está encendido, encola una respuesta en Redis (base 2). Los mensajes que llegan dentro de 8 segundos se juntan. El servicio `crm-worker` toma la tarea, le pasa al modelo los últimos 20 mensajes, el catálogo (herramienta de búsqueda) y la información del negocio, y responde por WhatsApp. También mueve la tarjeta entre Consulta, Venta y Postventa.
- **Veracidad:** el bot solo afirma lo que está en el catálogo activo o en la información del negocio. Si le falta un dato responde "no tengo ese dato, te lo confirma alguien del equipo". Nunca dice cantidades de stock ni afirma ser una persona. Si el negocio lo elige, se presenta como asistente virtual al empezar cada charla.
- **No contesta** mensajes que llegaron con el bot apagado, ni si el último mensaje de la charla es del negocio (por ejemplo, si respondiste vos desde el teléfono). Tope de **20 respuestas por cliente por hora** contra bucles y costos.
- **API keys:** se guardan cifradas (AES-256-GCM) con `CRM_ENCRYPTION_KEY` (64 hex, `openssl rand -hex 32`), que solo tienen `crm` y `crm-worker`. **Si cambiás esa clave, todas las keys guardadas dejan de servir** y cada negocio tiene que volver a cargarla. Si el proveedor rechaza la key (401/403), el bot se apaga solo y la pantalla Agente lo muestra.
- **Proveedores:** Anthropic, Google, OpenAI y compatibles con OpenAI (OpenRouter, Groq…). La URL de un proveedor compatible tiene que ser `https://` y apuntar a una IP pública: no se aceptan direcciones de la red local ni de Docker (por eso Ollama en la LAN no funciona por ahora).
- **Datos personales (Ley 25.326):** el texto de las conversaciones se envía al proveedor de IA que elige cada negocio; tiene que figurar en su política de privacidad.
- **Consultas al admin:** si al bot le falta un dato, se lo pregunta al **WhatsApp del administrador** (se configura en Agente) y al cliente le dice "lo consulto y te aviso". **Respondé citando el mensaje de la consulta**: el bot le transmite la respuesta al cliente con sus palabras y la guarda en **Aprendido** para la próxima vez. **Los precios nunca se aprenden**: si la consulta es de precios o tu respuesta menciona plata, se transmite pero no se guarda (los precios van en el Catálogo). Si no respondés en 2 h, te llega un recordatorio una sola vez. Las consultas pendientes se ven en Aprendido.
- **Traspaso:** cuando el cliente quiere cerrar la compra, el bot le avisa que lo atiende alguien del equipo, mueve la tarjeta a Venta, te avisa por WhatsApp y se **pausa en esa charla** (12 h por defecto, configurable en Agente). Atendé desde el WhatsApp del negocio. Si escribís vos desde el número del negocio en cualquier charla, también se pausa. La tarjeta muestra "Bot pausado hasta …" y el botón **Reactivar bot**. Los mensajes que llegan durante la pausa no se contestan después.
- **El número del administrador** nunca aparece como cliente ni recibe respuestas del bot.
- **El tablero muestra lo que hay que atender ahora.** En Postventa, **Cerrar venta** saca al cliente del tablero; en Consulta, la **×** de la esquina hace lo mismo. Las Consultas sin mensajes durante más de N días (1 por defecto, se cambia en **Configuración**) dejan de mostrarse solas. Nada se borra: si ese cliente vuelve a escribir, reaparece en Consulta como una **conversación nueva** (el bot no ve la charla anterior y se vuelve a presentar). Tus mensajes desde el número del negocio no lo reabren. Las tarjetas en Venta no se sacan: siguen hasta que las movés o hay pedido.
- **Etapas:** **Consulta** es un contacto nuevo o un cliente en Postventa que vuelve a querer comprar (lo detecta el bot, que es lo único que mueve por su cuenta); **Venta** llega solo con el traspaso, cuando hace falta el admin para cerrar; **Postventa** solo con **Marcar entregado**, que además saca la pausa del traspaso y el bot vuelve a atender esa charla.
- **Diagnóstico:** `docker compose logs crm-worker` muestra por respuesta solo ids, resultado (`sent`, `skipped:...`) y duración; nunca textos ni teléfonos. El último error del bot también aparece en la pantalla Agente.

Base de datos: la app usa la base `crm` con dos roles. `crm` es el dueno y solo lo usa el servicio `crm-migrate` (aplica migraciones y termina); `crm_app` es el que usa la app y esta sujeto a Row Level Security por negocio. En un volumen de Postgres que ya existia, crea la base y los roles una vez:

```bash
docker compose up -d postgres   # recrea postgres con CRM_DB_PASSWORD/CRM_APP_DB_PASSWORD (los datos quedan en el volumen)
docker compose exec -T postgres bash /docker-entrypoint-initdb.d/02-create-crm-db.sh   # idempotente
docker compose up -d --build
```

Antes, agrega `CRM_DB_PASSWORD` y `CRM_APP_DB_PASSWORD` al `.env` (`openssl rand -hex 32`). Si `crm-migrate` falla, `crm` no arranca pero Evolution sigue accesible.

El webhook (`/api/webhooks/evolution/<instancia>`) solo es accesible por la red interna de Docker; nginx devuelve 404. Si cambias `nginx/nginx.conf`, reinicia nginx (`docker compose restart nginx`).

## Consumo de IA

Debajo de la navegación de cada negocio hay una barra con el consumo **del día (hora de Argentina)**: pedidos al modelo, tokens y respuestas enviadas, más el último error del bot. Cuenta todo lo que gasta cuota: respuestas y transmisiones del bot, chat de prueba y verificación de la key (también los pedidos que fallan, que el proveedor cuenta igual).

Los proveedores no informan cuánta cuota queda. Para ver "N de M", cargá en **Agente** el "Límite diario de pedidos" y/o "de tokens" de tu plan: la barra avisa **Cerca del límite** al 80% y **Límite alcanzado** al 100%. Es aproximado: cada proveedor reinicia la cuota en su horario (Google, a medianoche del Pacífico).

## Modelo local (solo desarrollo)

Para probar el bot sin cuotas ni proveedores pagos, el compose de desarrollo ofrece el proveedor **"Ollama (local, solo desarrollo)"** en Agente. No pide API key. **En producción no existe**: aparece solo si el servidor tiene `OLLAMA_URL`, que define únicamente `docker-compose.dev.yml`.

1. Instalá Ollama en la máquina (pide sudo): `curl -fsSL https://ollama.com/install.sh | sh`. Escucha en `127.0.0.1:11434`; no lo expongas en la red.
2. Docker sin root no deja a los contenedores llegar al `127.0.0.1` del host. Habilitalo una vez:
   ```
   mkdir -p ~/.config/systemd/user/docker.service.d
   printf '[Service]\nEnvironment=DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false\n' > ~/.config/systemd/user/docker.service.d/ollama-loopback.conf
   systemctl --user daemon-reload && systemctl --user restart docker
   ```
   Los contenedores ven el host como `10.0.2.2`. **Costo**: cualquier contenedor de la máquina puede conectarse a servicios del `127.0.0.1` del host. Para revertir, borrá ese archivo y reiniciá Docker.
3. Bajá el modelo recomendado, `ollama pull qwen3:8b` (con 6 GB de VRAM, ~8B es el techo), levantá el stack con `-f docker-compose.dev.yml` y elegí el proveedor en Agente con el modelo `qwen3:8b`. El CRM le apaga el modo "pensar" (`reasoning_effort: none`): con él tardaba 17–62 s por respuesta e inventaba más; sin él, 2–13 s.
   - Evaluación (2026-11-23, RTX 4050): `qwen3:8b` aprobó 8/10; `llama3.1:8b`, 5/10 (decía "lo consulto" sin consultar de verdad).
4. Para comparar modelos: `cd crm && EVAL_MODEL=qwen3:8b npm run eval:agent`. Corre 6 charlas (precio del catálogo, precio que no existe, dato que falta, compra → traspaso, "¿sos un bot?", pregunta por categoría como "¿qué panificados tienen?") dos veces e imprime cuántas aprobó y cuánto tardó. No es parte de la suite: depende de un modelo real.

Los modelos locales chicos siguen peor las reglas que los grandes: usalos para desarrollar, no como referencia de calidad.

## Bot: respuestas frecuentes y métricas

Antes de llamar al modelo principal, cada mensaje pasa por dos filtros baratos (`crm/src/bot/faq/`): un prefiltro por reglas (cero tokens: silencia "ok", "gracias", 👍 y mapea preguntas obvias como horarios o dirección) y, si no alcanza, un router con el "Modelo rápido" (Configuración › Agente) que elige una función. Si la función es una pregunta frecuente, la respuesta sale de una plantilla con los datos del negocio (Configuración › Negocio) sin pasar por el modelo principal. Lo que el router no resuelve ("complex") sigue el camino de siempre.

**Agregar una pregunta frecuente** (todo en `crm/src/bot/faq/`):
1. La función que arma los datos en `answers.ts`.
2. La plantilla de texto en `templates.ts`.
3. La herramienta (schema + descripción) en `router.ts`, y el nombre en `FaqName` de `types.ts`.
4. Opcional: una regla regex en `rules.ts` para resolverla sin gastar tokens.

**Medir el router**: `cd crm && EVAL_MODEL=qwen3:8b npm run eval:router` (necesita Ollama local). Corre 30 mensajes realistas (con typos y abreviaturas) por prefiltro + router e imprime la precisión total, por función y los errores; falla debajo de 80%. No es parte de la suite.

**Métricas**: `cd crm && npm run metrics -- [--tenant <slug>] [--days 7]` informa, por camino (silencio, regla, router, modelo principal), cuántos mensajes y tokens consumió y su costo. Los precios están en `crm/scripts/prices.json` (viene vacío, `{}`), con el formato `{ "<id del modelo>": { "input": <USD/1M>, "output": <USD/1M>, "cached": <USD/1M> } }`. Los modelos sin precio se listan aparte y quedan fuera del costo.

## Pedidos

- Se crean desde la tarjeta de un cliente en **Venta** (botón **Crear pedido**): productos del catálogo con cantidad, fecha de entrega y datos de envío. El total sale de los precios del catálogo, que quedan congelados en el pedido.
- **Descuentan stock** al guardarse; si algún producto no alcanza, el pedido no se guarda y dice cuántos quedan. Los productos sin control de stock no se descuentan. **Cancelar** devuelve el stock.
- **Marcar entregado** pasa al cliente a **Postventa**. Sin un pedido entregado nadie puede llevar a un cliente a Postventa: ni el selector de la tarjeta ni el bot.
- Los pedidos pendientes se ven abajo del **Tablero** (Atrasados · Hoy · Mañana · Próximos). Los pedidos no se borran: se cancelan.
- **Ventas** lista los pedidos entregados (y los cancelados si tildás "Incluir cancelados"), filtrables por producto, cliente, fecha de entrega y monto, con la cantidad de ventas, el monto total y el ticket promedio del filtro.
- **Clientes** lista a todos los que escribieron, también los que salieron del tablero, con su estado: **Compró** (tiene un pedido entregado), **Llegó a Venta sin comprar** o **Nunca pasó de Consulta**. Se filtra por nombre o teléfono, estado y si está en el tablero; tocar un cliente despliega su historial de compras y el total gastado. Los clientes anteriores a esta versión que pasaron por Venta sin pedido figuran como "Nunca pasó de Consulta".

## Tests

```bash
bash tests/static.sh        # validaciones estaticas, no levanta nada
bash tests/smoke.sh         # levanta el stack y prueba el proxy (lo deja corriendo)
bash tests/db-isolation.sh  # requiere postgres healthy; verifica aislamiento entre bases
```

App CRM (requiere Node 24 y Postgres publicado en `127.0.0.1:55432` solo para desarrollo):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
cd crm && npm ci
npx vitest run            # unitarios + integracion (aplica migraciones con el rol crm)
npx playwright install chromium && npx playwright test   # E2E contra next dev (webpack) en localhost:3100; trazas en ../.e2e-results
npm run lint && npm run typecheck
```

Los tests leen las claves de `../.env` y arman las URLs de la base; se pueden pisar con `CRM_TEST_OWNER_URL` y `CRM_TEST_APP_URL`. Crean negocios con slugs aleatorios y los borran al terminar.

## 1. (Sin la app) Crear una instancia de WhatsApp a mano

Lo normal es conectar el numero desde la app (ver arriba). Una instancia creada a mano no manda mensajes al CRM porque no tiene el webhook configurado.

Las rutas se verificaron contra el codigo de Evolution en el tag 2.3.7 (`instance.router.ts`, `instance.dto.ts`).

```bash
set -a; . ./.env; set +a
E=http://evolution.localhost:8080

curl -s -X POST $E/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' \
  -d '{"instanceName":"bot","integration":"WHATSAPP-BAILEYS","qrcode":true,"groupsIgnore":true}'

# Si hace falta pedir el QR de nuevo:
curl -s $E/instance/connect/bot -H "apikey: $EVOLUTION_API_KEY"
```

La respuesta trae el QR (`base64`, y `code`). Escanealo desde WhatsApp > Dispositivos vinculados. Estado: `GET /instance/connectionState/bot`.

## 2. Verificacion manual end to end (pendiente, requiere humano)

No se ejecuto automaticamente; completar y registrar el resultado en la descripcion del PR:

- [ ] Crear un negocio en http://crm.localhost:8080.
- [ ] Desde el negocio > WhatsApp, escanear el QR con el numero dedicado.
- [ ] Escribirle desde otro telefono: aparece la tarjeta en Consulta con el ultimo mensaje.
- [ ] Tocar la tarjeta abre `wa.me` con ese numero; moverla a Venta con el selector.
- [ ] Cargar un producto en Catálogo y configurar el Agente con una API key real; encender el bot.
- [ ] Escribirle desde otro telefono "¿tienen <producto>?": responde con el precio y "disponible" sin decir cantidades.
- [ ] Preguntar algo que no está en el catálogo ni en la información: responde "no tengo ese dato, te lo confirma alguien del equipo".
- [ ] Decirle que lo querés comprar: la tarjeta pasa a Venta.
- [ ] Preguntar algo que no está cargado: al WhatsApp del admin llega la consulta; responderla citando el mensaje; el cliente recibe la respuesta; volver a preguntar lo mismo y que conteste sin consultar.
- [ ] Preguntar un precio que no está en el catálogo: consulta siempre (no aprende).
- [ ] Crear un pedido desde un cliente en Venta: baja el stock en Catálogo; marcarlo entregado: el cliente pasa a Postventa; cancelar otro: el stock vuelve.
- [ ] "Lo quiero comprar, ¿cómo pago?": llega el aviso de traspaso, la tarjeta muestra "Bot pausado" y "Reactivar bot" la reactiva.
- [ ] Escribir en un grupo donde este el numero: no debe responder.
- [ ] Reiniciar el stack (`docker compose restart`) y confirmar que la instancia sigue conectada.

## Notas importantes

- **Riesgo de baneo:** Baileys es un cliente no oficial de WhatsApp Web. Usa un numero dedicado, no el personal ni el de un negocio establecido.
- Evolution **no guarda historial de mensajes** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`).
- **Datos personales (Ley 25.326):** el CRM guarda contactos (nombre, telefono) y el texto de los mensajes en la base `crm`. La retencion configurable, la exportacion y el borrado por contacto estan planificados (ver `docs/superpowers/specs/2026-11-23-crm-platform-design.md`) y **todavia no estan implementados**. El CRM no loguea mensajes ni telefonos.
- **Logs con datos personales:** Evolution hace un `console.log` incondicional de cada mensaje, asi que los logs del contenedor `evolution-api` **SI contienen mensajes y numeros de telefono**, sin importar `LOG_LEVEL`. Se rotan (3 archivos x 10 MB, tope ~30 MB). Para purgarlos: `docker compose rm -sf evolution-api && docker compose up -d evolution-api` (recrear el contenedor borra sus logs).
- Todo queda en `127.0.0.1`; para exponerlo hace falta HTTPS delante.

## Reset total

```bash
docker compose down -v   # ATENCION: borra bases y sesiones de WhatsApp
```

## Migracion: retirar Flowise de un volumen existente

Flowise ya no forma parte del stack. Si lo tenias levantado, despues de `docker compose up -d --remove-orphans` borra su base y su volumen (**borra los chatflows y la memoria de conversaciones de Flowise, no se puede deshacer**):

```bash
docker compose exec -T postgres psql -U postgres -c 'DROP DATABASE IF EXISTS flowise' -c 'DROP ROLE IF EXISTS flowise'
docker volume rm "$(basename "$PWD" | tr '[:upper:]' '[:lower:]')_flowise_data"
```

Las variables `FLOWISE_*` del `.env` ya no se usan y se pueden borrar.
