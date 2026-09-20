# ADR-004 — Proveedores de IA: un puerto, un adaptador por proveedor

Estado: aceptado (2026-09-20) — **implementado y verificado contra el proveedor real**

## Contexto

El harness necesita IA para tres cosas del pipeline: juzgar la relevancia de una señal, generar
ideas y redactar borradores (a pedido). Además necesita **embeddings** para la similitud en pgvector.

Restricciones reales del ecosistema:
- `atiende` y `cv-harness` **ya usan DeepSeek** con la misma cuenta (`deepseek-v4-flash`), y atiende
  tiene además Groq como alternativa y una implementación de OpenAI.
- El usuario es sensible al costo: necesita saber cuánto gasta y poder apagar lo caro.
- Hay que poder correr el pipeline completo **sin llaves** (para E2E y para que un repo recién
  clonado funcione).
- Mañana puede tocar cambiar de proveedor (cuota, precio, calidad o región). Eso **no** puede ser un
  refactor del pipeline.

## Decisiones

1. **Un puerto por capacidad, nunca una clase concreta.**
   - `LlmProviderPort` (`chat`, `json`, `isHealthy`) → token `LLM_PROVIDER_TOKEN`.
   - `EmbeddingProviderPort` (`embed`, `dimensions`) → token `EMBEDDING_PROVIDER_TOKEN`.
   Los servicios del pipeline inyectan el **token**; el proveedor se resuelve en el módulo.

2. **Un adaptador por proveedor, con una base compartida.**
   DeepSeek y Groq (y mañana Kimi, Ollama, OpenRouter…) hablan el dialecto OpenAI, así que toda la
   mecánica vive en `OpenAiCompatibleProvider`: armado del body, timeout, reintentos con backoff
   exponencial en errores transitorios, modo JSON, parseo de `usage`/tokens cacheados y validación.
   Cada proveedor aporta un archivo chico con su preset (base URL, modelo, llave, precio).
   **Agregar un proveedor son ~15 líneas + su nombre en el enum del `.env`.**

3. **Factory + exhaustividad en tiempo de compilación.** `createLlmProvider(name)` es el único lugar
   que sabe qué adaptador corresponde a cada nombre; el `switch` cierra con `never`, así que sumar un
   proveedor y olvidarse de registrarlo **no compila**.

4. **Router con respaldo.** Principal → respaldo. Si fallan los dos, `LlmUnavailableError` con los
   **dos** motivos (no solo el último). El resultado siempre dice **qué proveedor contestó**, para
   que el gasto quede atribuido al correcto. `LLM_FALLBACK=auto` elige el otro proveedor que tenga
   llave; un respaldo explícito **sin llave hace fallar el boot** (mejor que arrancar sin respaldo
   sin que nadie se entere).

5. **`mock` no es "IA de mentira": es un contrato.**
   - `json()` devuelve **`null`**: el llamador entiende que no hay IA y usa su respaldo
     determinístico. Devolver datos inventados sería peor que no devolver nada, porque se guardarían
     como si fueran reales.
   - `chat()` devuelve un texto que **se anuncia como mock**, para que nadie lo confunda con una
     respuesta del modelo si llega a la pantalla.
   - Los embeddings mock son **determinísticos** (hash → PRNG → vector normalizado de 1536 dims): la
     misma entrada da siempre el mismo vector, así el E2E es reproducible.

6. **Validación en la frontera.** Todo `json()` se valida con Zod contra el contrato del llamador; si
   no cumple, es `LlmInvalidJsonError` (y el router intenta el respaldo, porque otro modelo puede
   cumplirlo). El contrato de datos es del llamador, no del modelo.

7. **Costo medido, no estimado a ojo.** `pricing.ts` calcula USD por tokens (descontando los cacheados)
   y `CoachRun` lo persiste. Si el modelo no está en la tabla, el costo queda en **0 con un aviso
   único** y se puede fijar por `.env` (`LLM_PRICE_*_PER_1M`) **sin tocar código** — no se inventa un
   precio.

8. **La dimensión de los embeddings es un contrato de base.** `EMBEDDING_DIMENSIONS` debe coincidir
   con la columna `vector(1536)` de `Signal.embedding`: si no, **el boot falla**. Y si el proveedor
   devuelve otra dimensión, el adaptador falla en vez de guardar vectores incompatibles (que
   romperían la búsqueda por similitud mucho después y en silencio).

### Cambiar de proveedor: el procedimiento completo

```bash
# 1. Registrar el adaptador si es nuevo (o reusar la base OpenAI-compatible)
#    apps/api/src/modules/llm/<proveedor>/<proveedor>.provider.ts
# 2. Sumarlo a la factory y a los enums del .env
# 3. Configurar
LLM_PROVIDER=<nuevo>        # + las llaves del proveedor
LLM_FALLBACK=auto
# 4. Verificar de verdad
npm run llm:check           # o: docker compose exec api npm run llm:check
```

## Evidencia medida (2026-09-20, contra las APIs reales)

- **DeepSeek responde y la llave compartida sirve**: `GET /models` OK y un `json()` real devolvió
  `{"ok":true,"ejemplo":"hola"}` en ~900-1000 ms (122 tokens de entrada, ~40 de salida).
- **⚠️ El modelo que devuelve la API se llama `deepseek-flash`** (alias de `deepseek-v4-flash`), así
  que **no coincide con ninguna entrada de la tabla de precios** → el costo se registra en 0 y sale
  el aviso. Para el medidor de gasto hay que poner el precio en `LLM_PRICE_*_PER_1M`.
- **⚠️ La cuenta de OpenAI responde `You have no credits remaining`** (HTTP 429). Con
  `EMBEDDING_PROVIDER=openai` los embeddings **fallan siempre**; el `.env` queda en `mock` para que
  el pipeline no se rompa. **Esto también afecta a `atiende`**, que usa esa misma cuenta y llave para
  su base de conocimiento y su caché semántica (para que lo revise por su lado).
- El router se verificó con tests para: principal sano, principal caído → respaldo, ambos caídos →
  error con los dos motivos, JSON que no cumple el contrato → respaldo, y `mock` → `null` sin ninguna
  llamada.

## Decisiones abiertas

1. **Proveedor de embeddings alternativo** mientras la cuenta de OpenAI no tenga créditos: Voyage,
   Gemini (tienen embeddings) o uno local. Es un adaptador más; el puerto ya está.
2. **¿Re-embebir al cambiar de proveedor?** Sí, es obligatorio: vectores de espacios distintos no son
   comparables. Cuando existan señales guardadas hay que prever un job de re-embedding (misma lección
   que en `atiende`/`cv-harness`).
3. **¿Presupuesto duro por ciclo?** `CoachRun` ya mide; falta el tope que aborte el lote si un perfil
   se pasa de un umbral (queda para cuando el pipeline tenga volumen real).

## Consecuencias

- Cambiar de proveedor es configuración; el pipeline ni se entera. Se ve en el log del boot
  (`llm`, `embeddings`) y en `GET /health` (nombres, nunca llaves).
- El pipeline es ejecutable sin llaves, y decir "estoy en mock" es explícito en logs y en health, así
  que un mock silencioso no puede pasar por funcionamiento.
- Dos trampas quedan documentadas y cubiertas: el **cambio de espacio vectorial** al cambiar de
  proveedor de embeddings, y el **costo en 0** cuando el modelo no está en la tabla.
