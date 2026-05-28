-- ============================================================
-- NUEVAS TABLAS  (Sequelize las crea automáticamente)
-- ============================================================

-- TABLA: admins
-- Una sola cuenta para el administrador del sistema
CREATE TABLE IF NOT EXISTS admins (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(100)  NOT NULL,
    email         VARCHAR(150)  NOT NULL UNIQUE,
    password_hash VARCHAR(64)   NOT NULL,   -- SHA-256 hex
    "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- TABLA: sesiones_admin
-- Token activo del administrador (expira en 8 horas)
CREATE TABLE IF NOT EXISTS sesiones_admin (
    id          SERIAL PRIMARY KEY,
    token       VARCHAR(64)  NOT NULL UNIQUE,
    admin_id    INTEGER      NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expira_en   TIMESTAMPTZ  NOT NULL,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- TABLA: cuestionarios  (columnas nuevas respecto a la versión anterior)
--   link_token  → token único que forma el link público
--   activo      → permite pausar/reactivar el cuestionario
CREATE TABLE IF NOT EXISTS cuestionarios (
    id          SERIAL PRIMARY KEY,
    titulo      VARCHAR(255),
    "videoUrl"  VARCHAR(500),
    preguntas   JSON,
    link_token  VARCHAR(32)  NOT NULL UNIQUE,  -- /cuestionario.html?c=TOKEN
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- TABLA: resultados  (columna nueva: cuestionario_id)
CREATE TABLE IF NOT EXISTS resultados (
    id               SERIAL PRIMARY KEY,
    "nombreUsuario"  VARCHAR(200),
    respuestas       JSON,
    cuestionario_id  INTEGER REFERENCES cuestionarios(id) ON DELETE SET NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_sesiones_admin_token   ON sesiones_admin(token);
CREATE INDEX IF NOT EXISTS idx_cuestionarios_token     ON cuestionarios(link_token);

-- ADMIN POR DEFECTO
-- Contraseña: admin123  → SHA-256
INSERT INTO admins (nombre, email, password_hash)
VALUES ('Administrador', 'admin@sistema.com',
        '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9')
ON CONFLICT (email) DO NOTHING;
