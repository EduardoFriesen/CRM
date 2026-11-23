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
3. Cada mensaje que recibe o envia ese numero aparece en **Clientes**, en la columna Consulta. Tocar la tarjeta abre el chat en `wa.me` (con la cuenta de WhatsApp que tengas abierta en ese dispositivo); la etapa se cambia con el selector de la tarjeta.

4. En **Catálogo** cargá los productos y en **Agente** el modelo, la API key, el tono y la información del negocio. Probalo en el chat de prueba y encendé el bot.

## Bot

- **Cómo contesta:** el webhook guarda cada mensaje y, si el bot del negocio está encendido, encola una respuesta en Redis (base 2). Los mensajes que llegan dentro de 8 segundos se juntan. El servicio `crm-worker` toma la tarea, le pasa al modelo los últimos 20 mensajes, el catálogo (herramienta de búsqueda) y la información del negocio, y responde por WhatsApp. También mueve la tarjeta entre Consulta, Venta y Postventa.
- **Veracidad:** el bot solo afirma lo que está en el catálogo activo o en la información del negocio. Si le falta un dato responde "no tengo ese dato, te lo confirma alguien del equipo". Nunca dice cantidades de stock ni afirma ser una persona. Si el negocio lo elige, se presenta como asistente virtual al empezar cada charla.
- **No contesta** mensajes que llegaron con el bot apagado, ni si el último mensaje de la charla es del negocio (por ejemplo, si respondiste vos desde el teléfono). Tope de **20 respuestas por cliente por hora** contra bucles y costos.
- **API keys:** se guardan cifradas (AES-256-GCM) con `CRM_ENCRYPTION_KEY` (64 hex, `openssl rand -hex 32`), que solo tienen `crm` y `crm-worker`. **Si cambiás esa clave, todas las keys guardadas dejan de servir** y cada negocio tiene que volver a cargarla. Si el proveedor rechaza la key (401/403), el bot se apaga solo y la pantalla Agente lo muestra.
- **Proveedores:** Anthropic, Google, OpenAI y compatibles con OpenAI (OpenRouter, Groq…). La URL de un proveedor compatible tiene que ser `https://` y apuntar a una IP pública: no se aceptan direcciones de la red local ni de Docker (por eso Ollama en la LAN no funciona por ahora).
- **Datos personales (Ley 25.326):** el texto de las conversaciones se envía al proveedor de IA que elige cada negocio; tiene que figurar en su política de privacidad.
- **Diagnóstico:** `docker compose logs crm-worker` muestra por respuesta solo ids, resultado (`sent`, `skipped:...`) y duración; nunca textos ni teléfonos. El último error del bot también aparece en la pantalla Agente.

Base de datos: la app usa la base `crm` con dos roles. `crm` es el dueno y solo lo usa el servicio `crm-migrate` (aplica migraciones y termina); `crm_app` es el que usa la app y esta sujeto a Row Level Security por negocio. En un volumen de Postgres que ya existia, crea la base y los roles una vez:

```bash
docker compose up -d postgres   # recrea postgres con CRM_DB_PASSWORD/CRM_APP_DB_PASSWORD (los datos quedan en el volumen)
docker compose exec -T postgres bash /docker-entrypoint-initdb.d/02-create-crm-db.sh   # idempotente
docker compose up -d --build
```

Antes, agrega `CRM_DB_PASSWORD` y `CRM_APP_DB_PASSWORD` al `.env` (`openssl rand -hex 32`). Si `crm-migrate` falla, `crm` no arranca pero Evolution sigue accesible.

El webhook (`/api/webhooks/evolution/<instancia>`) solo es accesible por la red interna de Docker; nginx devuelve 404. Si cambias `nginx/nginx.conf`, reinicia nginx (`docker compose restart nginx`).

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
npx playwright install chromium && npx playwright test   # E2E contra next dev en localhost:3100
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
