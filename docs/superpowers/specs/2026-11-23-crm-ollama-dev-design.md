# CRM — Ollama local para desarrollo — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación

## Intención
Probar el bot durante el desarrollo con un modelo local (Ollama en esta notebook), sin cuotas ni proveedores pagos y sin que las charlas salgan de la máquina. En producción cada negocio sigue eligiendo proveedor y modelo; **Ollama no existe en producción**.

## Decisiones del usuario
| Tema | Decisión |
|---|---|
| Uso | Solo desarrollo, en esta notebook |
| Dónde corre | Ollama instalado directo en el host (opción B), no como contenedor |
| Acceso desde contenedores | Habilitar el loopback del host en Docker rootless (opción 1): los contenedores ven el `127.0.0.1` del host como `10.0.2.2` |

## Hardware y modelos
RTX 4050 con 6 GB de VRAM, 14 GB de RAM y ~24 GB libres en disco. Candidatos de ~5 GB con tool calling: **`qwen3:8b`** y **`llama3.1:8b`**. Se elige con la evaluación (abajo); el perdedor se borra para recuperar disco.

## Diseño
- **Instalación** (la hace el usuario, pide sudo): `curl -fsSL https://ollama.com/install.sh | sh`. Ollama escucha en `127.0.0.1:11434` (por defecto; **nunca** en la IP de WiFi).
- **Docker rootless**: override de usuario `~/.config/systemd/user/docker.service.d/ollama-loopback.conf` con `Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false`, después `daemon-reload` y reinicio de Docker. Para revertir: borrar el archivo y reiniciar. *Costo aceptado: cualquier contenedor de esta máquina puede conectarse a servicios del `127.0.0.1` del host.*
- **Proveedor "Ollama (local)"** (`ollama`) en el CRM:
  - Disponible **solo si el servidor tiene `OLLAMA_URL`**. Solo `docker-compose.dev.yml` la define (`http://10.0.2.2:11434/v1` para `crm` y `crm-worker`); en producción no existe, así que la opción no aparece y el servidor la rechaza.
  - La URL la fija el servidor, no el negocio: no reabre el SSRF.
  - Usa el cliente compatible con OpenAI del AI SDK (`@ai-sdk/openai-compatible`, ya instalado). No pide API key: se guarda un marcador cifrado y el campo se oculta en la UI.
  - La verificación al guardar hace el mismo ping que con los demás proveedores. Si Ollama no responde, se guarda como "sin verificar", con el motivo.
  - Migración: `ALTER TYPE provider ADD VALUE 'ollama'`.
- **Evaluación del agente** (`npm run eval:agent`, en el host con `OLLAMA_URL=http://127.0.0.1:11434/v1` y `EVAL_MODEL=<modelo>`):
  - Crea un negocio temporal con catálogo (Pan de campo $2.500) e información básica, y corre cada escenario 2 veces con `tryAgent`, que tiene las herramientas en modo prueba.
  - Imprime una tabla de aprobado/fallado por escenario y el tiempo medio. Borra el negocio al terminar.

| # | Mensaje del cliente | Aprueba si |
|---|---|---|
| 1 | ¿Cuánto sale el pan de campo? | La respuesta incluye "2.500" |
| 2 | ¿Cuánto sale la torta de chocolate? (no está) | No menciona ningún monto `$` **y** consulta al admin o usa la frase "no tengo ese dato" |
| 3 | ¿Hacen envíos a Pilar? (no está en la info) | Consulta al admin o usa "no tengo ese dato" |
| 4 | Dale, quiero 2 panes, ¿cómo pago? | Hace el traspaso |
| 5 | ¿Sos un bot? | Dice que es un asistente virtual, bot o IA |

  No es parte de la suite de tests: depende de un modelo real y su resultado es probabilístico.

## Fuera de alcance
- Ollama en producción o en contenedores. GPU dentro de Docker. Elegir automáticamente el modelo.

## Verificación
- **Tests**:
  - con `OLLAMA_URL` definido, `saveAgentConfig` acepta `provider: "ollama"` sin API key; sin `OLLAMA_URL` lo rechaza con `VALIDATION`;
  - `createModel` para ollama usa la URL del servidor;
  - el chequeo estático comprueba que el compose base no define `OLLAMA_URL` y el de desarrollo sí.
- **Manual**: con Ollama corriendo, `npm run eval:agent` para los dos modelos; elegir el ganador; configurarlo en Agente y probar una charla por WhatsApp.
