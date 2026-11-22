# CRM - Bot de WhatsApp con IA

Stack Docker Compose: Evolution API v2.3.7 (WhatsApp) + Flowise 3.1.4 (cerebro IA) + Postgres 17 + Redis 8 + nginx como proxy. El bot recibe mensajes por WhatsApp, Evolution los manda a un chatflow de Flowise y devuelve la respuesta.

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

- Usa siempre `openssl rand -hex 32` (solo hex): la clave de Postgres se interpola sin codificar en una URI de conexion y caracteres como `@ / :` la rompen. Nunca dejes `change-me`; compose se niega a levantar si falta alguna variable.
- Las claves de base de datos solo se aplican cuando el volumen de Postgres esta vacio. Si las cambias despues, hay que ejecutar `docker compose down -v` (**borra TODOS los datos**: instancias de WhatsApp, chatflows, usuarios de Flowise) o hacer `ALTER ROLE` a mano.
- URLs locales (nginx escucha en `127.0.0.1:${HTTP_PORT}`, default 8080, porque Docker rootless no puede usar el puerto 80):
  - Evolution: http://evolution.localhost:8080
  - Flowise: http://flowise.localhost:8080
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
  -d '{"instanceName":"bot","integration":"WHATSAPP-BAILEYS","qrcode":true}'

# Si hace falta pedir el QR de nuevo:
curl -s $E/instance/connect/bot -H "apikey: $EVOLUTION_API_KEY"
```

La respuesta trae el QR (`base64`, y `code`). Escanealo desde WhatsApp > Dispositivos vinculados. Estado: `GET /instance/connectionState/bot`.

## 2. Crear el chatflow en Flowise

1. Abri http://flowise.localhost:8080. La primera visita crea la cuenta de administrador.
2. Credenciales: carga la API key del proveedor del modelo (se guarda cifrada en Flowise).
3. Crea un chatflow con: un chat model (ej. ChatAnthropic o ChatOpenAI), **Buffer Memory** (o similar) y un system prompt con la personalidad del bot. Conectalos en una Conversation Chain y guarda.
4. Anota el ID del chatflow (esta en la URL) y crea una **API key** en Flowise (menu API Keys).

Evolution manda `sessionId = remoteJid` en `overrideConfig`, asi que cada chat tiene su propia memoria (verificado en `flowise.service.ts`; para que Flowise lo respete, la memoria del chatflow debe aceptar override de Session ID: habilitalo en Security del chatflow, **no verificado en runtime**).

## 3. Registrar el bot en Evolution

Ruta `POST /flowise/create/{instance}`; campos verificados en `flowise.router.ts`, `flowise.dto.ts` y `flowise.schema.ts` (requeridos: `enabled`, `apiUrl`, `triggerType`).

```bash
curl -s -X POST $E/flowise/create/bot \
  -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "enabled": true,
    "description": "Bot principal",
    "apiUrl": "http://flowise:3000/api/v1/prediction/<chatflowId>",
    "apiKey": "<flowise-api-key>",
    "triggerType": "all",
    "ignoreJids": ["@g.us"]
  }'
```

- `apiUrl` usa la red interna de Docker (`flowise:3000`), no el hostname publico.
- `triggerType`: `all | keyword | none | advanced`. `ignoreJids: ["@g.us"]` evita responder en grupos.
- Campos opcionales existentes: `expire` (minutos), `keepOpen`, `keywordFinish`, `delayMessage`, `unknownMessage`, `debounceTime`, `splitMessages`, `timePerChar`, `listeningFromMe`, `stopBotFromMe`.
- Otras rutas: `GET /flowise/find/{instance}`, `PUT /flowise/update/{flowiseId}/{instance}`, `DELETE /flowise/delete/{flowiseId}/{instance}` (derivadas de `routerPath` en el codigo; no probadas en runtime).

## 4. Verificacion manual end to end (pendiente, requiere humano)

No se ejecuto automaticamente; completar y registrar el resultado en la descripcion del PR:

- [ ] Escanear el QR con el numero dedicado.
- [ ] Escribirle desde otro telefono y recibir la respuesta de la IA.
- [ ] Escribir en un grupo donde este el numero: no debe responder.
- [ ] Reiniciar el stack (`docker compose restart`) y confirmar que la instancia sigue conectada.

## Notas importantes

- **Riesgo de baneo:** Baileys es un cliente no oficial de WhatsApp Web. Usa un numero dedicado, no el personal ni el de un negocio establecido.
- Evolution **no guarda historial de mensajes** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`). La memoria de las conversaciones vive en Flowise.
- Datos personales (Ley 25.326): la memoria de Flowise contiene conversaciones de usuarios. La politica de retencion y los procesos de acceso/supresion estan **pendientes de definir**.
- Todo queda en `127.0.0.1`; para exponerlo hace falta HTTPS delante (y `SECURE_COOKIES=true` en Flowise).

## Reset total

```bash
docker compose down -v   # ATENCION: borra bases, sesiones de WhatsApp y chatflows
```
