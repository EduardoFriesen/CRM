# CRM - Bot de WhatsApp con IA

Stack Docker Compose: Evolution API v2.3.7 (WhatsApp) + Postgres 17 + Redis 8 + nginx como proxy. El bot con IA se reconstruye dentro de la app del CRM (entrega 2); por ahora **no responde mensajes**.

## Requisitos

- Docker con Compose v2, `openssl`, `curl`.
- Una clave de API de un proveedor de modelos (Anthropic, OpenAI, etc.) para el chatflow.
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
  - Evolution: http://evolution.localhost:8080
  - En un VPS con Docker como root podes poner `HTTP_PORT=80`.

## Tests

```bash
bash tests/static.sh        # validaciones estaticas, no levanta nada
bash tests/smoke.sh         # levanta el stack y prueba el proxy (lo deja corriendo)
bash tests/db-isolation.sh  # requiere postgres healthy; verifica aislamiento entre bases
```

## 1. Crear la instancia de WhatsApp y escanear el QR

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

- [ ] Escanear el QR con el numero dedicado.
- [ ] Escribir en un grupo donde este el numero: no debe responder.
- [ ] Reiniciar el stack (`docker compose restart`) y confirmar que la instancia sigue conectada.

## Notas importantes

- **Riesgo de baneo:** Baileys es un cliente no oficial de WhatsApp Web. Usa un numero dedicado, no el personal ni el de un negocio establecido.
- Evolution **no guarda historial de mensajes** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`).
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
