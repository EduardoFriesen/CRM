# Stack de contestador de WhatsApp con IA — Diseño

Fecha: 2026-11-22 · Estado: borrador para aprobación

## Intención
Un stack en Docker que recibe mensajes de WhatsApp y los contesta con un modelo de IA.
Hoy corre local; después se mudará a un home server o VPS (sin definir), así que tiene que ser portable.
La app propia del CRM llega más adelante y no es parte de esto.

## Objetivos
- `docker compose up -d` levanta todo; vincular WhatsApp escaneando un QR.
- Mensaje entrante → Flowise genera la respuesta → Evolution la envía.
- Cambiar de modelo (Claude, OpenAI, Ollama) desde Flowise, sin tocar el stack.

## No objetivos
- Node-RED (descartado), app del CRM, TLS/exposición pública, Ollama local, backups automáticos.

## Anti-objetivos
- Puertos de base de datos o servicios internos expuestos al host.
- Secretos en Git.
- Que el bot conteste en grupos o a sí mismo (loops).

## Enfoques considerados
| Enfoque | Resultado |
|---|---|
| Node-RED orquestando y llamando a la API del modelo | Descartado por el usuario |
| Integración nativa OpenAI de Evolution | Descartado: ata a OpenAI |
| Dify | Descartado: ~6 contenedores extra, pesado para home server |
| **Integración nativa Flowise de Evolution** | **Elegido por el usuario**: cualquier modelo, base de conocimiento, 1 contenedor extra |

## Diseño
Servicios (imágenes con versión exacta fijada, nunca `latest`):

| Servicio | Rol | Puertos al host |
|---|---|---|
| `nginx` | Reverse proxy, único punto de entrada | `127.0.0.1:80` |
| `evolution-api` | Conexión WhatsApp (Baileys) + integración Flowise | ninguno |
| `flowise` | Chatflow con el modelo de IA y memoria de conversación | ninguno |
| `postgres` | Una instancia, dos bases: `evolution` y `flowise`, cada una con su usuario | ninguno |
| `redis` | Caché de Evolution | ninguno |

- **Ruteo por subdominio** (no por subpath: Flowise y el manager de Evolution se rompen bajo subpath):
  `evolution.localhost` → evolution-api, `flowise.localhost` → flowise. `*.localhost` resuelve a 127.0.0.1 sin tocar `/etc/hosts`.
- **Evolution → Flowise** por la red interna de Docker (`http://flowise:3000`), sin pasar por nginx.
- **Una red interna** `backend`; solo nginx publica puerto, y ligado a `127.0.0.1` mientras sea local.
- **Volúmenes persistentes**: datos de Postgres, Redis, instancias de Evolution y Flowise.
- **Postgres**: script de init que crea las dos bases y usuarios con permisos solo sobre la suya.
- **Healthchecks** en postgres y redis; evolution y flowise dependen de ellos (`condition: service_healthy`).

## Seguridad
- Secretos en `.env` (en `.gitignore`); `.env.example` versionado sin valores reales.
- Evolution: `AUTHENTICATION_API_KEY` obligatoria. Flowise: login propio activado.
- La API key del modelo se carga como credencial dentro de Flowise (cifrada con `FLOWISE_SECRETKEY_OVERWRITE`), no en el compose.
- nginx: cabeceras de seguridad, `server_tokens off`, rate limiting, límite de tamaño de body.
- Bot configurado para ignorar grupos y mensajes propios.
- Número de WhatsApp dedicado (riesgo de ban por uso de WhatsApp Web no oficial).

## Datos personales (Ley 25.326)
- Evolution guarda solo lo necesario para operar (instancia, contactos, chats); **no guarda el historial de mensajes** (`DATABASE_SAVE_DATA_NEW_MESSAGE=false`). *Decisión propia; revisable si la app del CRM necesita el historial.*
- La memoria de conversación vive en Flowise; la política de retención y borrado se define cuando exista la app del CRM.
- Logs de contenedores sin contenido de mensajes (nivel de log de Evolution en `ERROR,WARN,INFO`).

## Verificación
- `docker compose config` válido.
- Todos los contenedores `healthy`/`running`.
- `curl` a `evolution.localhost` con y sin API key (200 / 401); `flowise.localhost` muestra el login.
- Prueba manual: crear instancia, escanear QR, configurar el bot de Flowise, mandar un mensaje desde otro número y recibir respuesta.

## Queda a criterio del implementador
- Versiones exactas de las imágenes (las más recientes estables, verificadas al implementar).
- Valores concretos de rate limiting.
- Un `README` con los pasos de puesta en marcha y la configuración del bot en Flowise.
