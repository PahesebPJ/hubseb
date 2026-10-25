# hubseb

Centro de conexión (*hub*), grafo de topología y motor polimórfico de drivers multi-agente para herramientas `*seb` (como **crewseb**).

## Instalación

```sh
npm install -g hubseb
hubseb agents
```

## Arquitectura de `hubseb`

1. **Drivers Polimórficos por Agente (`DriverHub`):**
   Cada agente de código tiene su propio Driver independiente que traduce capacidades abstractas (`fs:read`, `fs:write`, `shell:run`, `web:fetch`, `web:search`) y niveles de razonamiento (`fast`, `balanced`, `deep`):
   - `AntigravityHostDriver` (`agy`)
   - `ClaudeHostDriver` (`claude`)
   - `CodexHostDriver` (`codex`)
   - `OpenCodeHostDriver` (`opencode`)
2. **Directivas Firmadas con SHA-256 + Lockfiles:**
   Los bloques inyectados en la memoria global llevan un hash SHA-256 en el encabezado (`<!-- [hubseb:bundle=crewseb sha256=...] -->`) y cada despliegue escribe un lockfile en `~/.local/share/hubseb/locks/` para desinstalar con precisión quirúrgica.
3. **Grafo de Topología (`TopologyStore`):**
   Registra herramientas `*seb` como nodos en `~/.config/hubseb/topology.json`, resuelve automáticamente los puentes entre herramientas que proveen (`provides`) y consumen (`consumes`) capacidades, y transmite señales entre ellas con el protocolo `hubseb/v1`.

## Comandos CLI

```sh
hubseb agents         # Detecta los 4 agentes de código instalados en tu sistema
hubseb ls             # Lista los nodos *seb registrados en topology.json
hubseb graph          # Muestra el grafo de conexiones entre tus herramientas *seb
hubseb doctor         # Verifica la salud de todos los nodos registrados
hubseb capabilities   # Imprime el paquete wire hubseb/v1
```
