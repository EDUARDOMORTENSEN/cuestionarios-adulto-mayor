-- ============================================================
-- NUEVAS TABLAS AGREGADAS AL SISTEMA
-- (Sequelize las crea automáticamente con sync({alter:true}))
-- ============================================================

-- TABLA: usuarios
-- Almacena las cuentas del panel de administración
CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(100)  NOT NULL,
    email         VARCHAR(150)  NOT NULL UNIQUE,
    password_hash VARCHAR(64)   NOT NULL,          -- SHA-256 hex
    rol           VARCHAR(20)   NOT NULL DEFAULT 'cuidador'
                                CHECK (rol IN ('admin','cuidador','familiar')),
    activo        BOOLEAN       NOT NULL DEFAULT TRUE,
    "createdAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- TABLA: sesiones
-- Token de sesión activo por usuario (expira en 8 horas)
CREATE TABLE IF NOT EXISTS sesiones (
    id           SERIAL PRIMARY KEY,
    token        VARCHAR(64)   NOT NULL UNIQUE,
    usuario_id   INTEGER       NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_en    TIMESTAMPTZ   NOT NULL,
    "createdAt"  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- TABLA: cuestionarios  (modificada: agrega columna creado_por)
ALTER TABLE cuestionarios
    ADD COLUMN IF NOT EXISTS creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

-- TABLA: resultados  (modificada: agrega columna cuestionario_id)
ALTER TABLE resultados
    ADD COLUMN IF NOT EXISTS cuestionario_id INTEGER REFERENCES cuestionarios(id) ON DELETE SET NULL;

-- ── ÍNDICES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sesiones_token       ON sesiones(token);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_id  ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email       ON usuarios(email);

-- ── USUARIO ADMIN POR DEFECTO ────────────────────────────────
-- Password: admin123  →  SHA-256 hash
INSERT INTO usuarios (nombre, email, password_hash, rol)
VALUES ('Administrador', 'admin@sistema.com',
        '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
        'admin')
ON CONFLICT (email) DO NOTHING;
