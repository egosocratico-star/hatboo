CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    -- Último mensaje del hilo activo. Con variantes ya no vale «el último que
    -- se escribió»: este es el que dice por qué rama se lee la conversación.
    leaf_id TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    provider TEXT,
    created_at INTEGER NOT NULL,
    -- El mensaje al que responde este. NULL solo en el primero. Editar o
    -- regenerar crea una fila nueva con el MISMO padre en vez de borrar la
    -- vieja, y así las dos versiones siguen navegables.
    parent_id TEXT,
    -- Cuál de los hijos se toma al bajar por el árbol: la variante activa.
    preferido TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);

-- Lo que el modelo escribió y el usuario abrió en el panel: código, SVG,
-- documentos. Una fila por versión, agrupadas por (conversación, título,
-- lenguaje), para que «hazle un cambio» no borre la versión anterior.
CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    titulo TEXT NOT NULL,
    lenguaje TEXT NOT NULL,
    contenido TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    creado_en INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts (conversation_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Fase 2: apartado de trabajo

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,          -- 'pending' | 'in_progress' | 'done' | 'failed'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks (conversation_id);

CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,           -- JSON
    output TEXT,                   -- JSON, null hasta completar
    status TEXT NOT NULL,          -- 'pending_approval' | 'approved' | 'rejected' | 'completed' | 'failed'
    created_at INTEGER NOT NULL,
    -- Lo que tardó y el resumen de una línea. Sin esto la traza del agente no
    -- puede reconstruirse al reabrir la sesión: el frontend la pintaba solo en
    -- memoria y al salir se quedaba en nada.
    duration_ms INTEGER NOT NULL DEFAULT 0,
    brief TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation ON tool_calls (conversation_id);

-- Plantillas de comportamiento (Agent Skills)

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- Texto sin enviar del compositor, uno por conversación. Sin esto, escribir
-- medio mensaje largo y cambiar de hilo (o cerrar la app) lo borraba. La clave
-- es libre a propósito —«nueva» guarda el borrador de cuando todavía no existe
-- conversación—, así que no hay clave ajena: `delete_thread` limpia los suyos.

CREATE TABLE IF NOT EXISTS drafts (
    conversation_id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Notas de memoria escritas a mano por el usuario. Viajan en el system prompt
-- de chat y de agente; no se deducen de los chats, así que no hay nada que
-- generar ni que apagar.

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
