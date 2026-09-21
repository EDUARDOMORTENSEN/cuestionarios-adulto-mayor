const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = express();

// Detrás de cloudflared/un reverse proxy: necesario para que express-rate-limit
// use la IP real del cliente (X-Forwarded-For) y no la del túnel.
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // El HTML existente usa atributos onclick="..." por todas partes;
            // quitarlos es un refactor aparte. El escape de datos (ver admin.js)
            // es la mitigación real, esto es defensa en profundidad.
            // CSP nivel 3 trata los atributos onclick="..." (script-src-attr)
            // como una directiva separada de los <script> inline (script-src);
            // Helmet la pone en 'none' por defecto si no se especifica.
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com'],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
            connectSrc: ["'self'", 'https://cloudflareinsights.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ============================================================
// CONEXIÓN
// ============================================================
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ Falta la variable de entorno DATABASE_URL.');
    process.exit(1);
}

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: process.env.DB_SSL === 'true' ? {
        ssl: { require: true, rejectUnauthorized: false }
    } : {}
});

// ============================================================
// MODELOS
// ============================================================

// TABLA: admins  — solo para el inicio de sesión del administrador
const Admin = sequelize.define('Admin', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nombre:        { type: DataTypes.STRING(100), allowNull: false },
    email:         { type: DataTypes.STRING(150), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false }  // bcrypt
}, { tableName: 'admins' });

// TABLA: sesiones_admin  — tokens activos del administrador
const SesionAdmin = sequelize.define('SesionAdmin', {
    id:         { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token:      { type: DataTypes.STRING(64), allowNull: false, unique: true },
    admin_id:   { type: DataTypes.INTEGER, allowNull: false },
    expira_en:  { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'sesiones_admin' });

// TABLA: cuestionarios
const Cuestionario = sequelize.define('Cuestionario', {
    id:        { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    titulo:    { type: DataTypes.STRING },
    videoUrl:  { type: DataTypes.STRING },
    preguntas: { type: DataTypes.JSON },
    // token único que va en el link público
    link_token: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
        defaultValue: () => crypto.randomBytes(16).toString('hex')
    },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'cuestionarios' });

// TABLA: resultados
const Resultado = sequelize.define('Resultado', {
    id:              { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nombreUsuario:   { type: DataTypes.STRING },
    edad:            { type: DataTypes.INTEGER, allowNull: true },
    sexo:            { type: DataTypes.STRING, allowNull: true },
    respuestas:      { type: DataTypes.JSON },
    cuestionario_id: { type: DataTypes.INTEGER, allowNull: true },
    // Metadatos de sesión: tiempos y consentimiento (v4)
    meta:            { type: DataTypes.JSON, allowNull: true }
}, { tableName: 'resultados' });

// Relaciones
Admin.hasMany(SesionAdmin, { foreignKey: 'admin_id' });
SesionAdmin.belongsTo(Admin, { foreignKey: 'admin_id' });
Cuestionario.hasMany(Resultado, { foreignKey: 'cuestionario_id' });
Resultado.belongsTo(Cuestionario, { foreignKey: 'cuestionario_id' });

// ============================================================
// HELPERS
// ============================================================
const hashPassword = (pw) => bcrypt.hash(pw, 12);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
// Hash "señuelo" para comparar contra él cuando el email no existe:
// evita que el tiempo de respuesta delate si una cuenta existe o no.
const HASH_SENUELO = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOFRV6l8Xw9lE0lqYs4Y5G8lJ5t3XoW9G';

const genToken = () => crypto.randomBytes(32).toString('hex');

async function verificarSesion(req) {
    const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!auth) return null;
    const sesion = await SesionAdmin.findOne({ where: { token: auth }, include: [Admin] });
    if (!sesion) return null;
    if (new Date() > sesion.expira_en) { await sesion.destroy(); return null; }
    return sesion.Admin;
}

async function requireAdmin(req, res, next) {
    const admin = await verificarSesion(req);
    if (!admin) return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    req.admin = admin;
    next();
}

// ============================================================
// VALIDACIÓN — endpoint público /api/c/:token/responder
// ============================================================
const SEXOS_VALIDOS = ['Masculino', 'Femenino', 'Otro'];

function sanitizarMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    return {
        fecha:          str(meta.fecha, 20),
        hora_inicio:    str(meta.hora_inicio, 20),
        hora_fin:       str(meta.hora_fin, 20),
        duracion:       str(meta.duracion, 30),
        consentimiento: meta.consentimiento === true
    };
}

function limpiarRespuestas(lista) {
    if (!Array.isArray(lista) || lista.length === 0 || lista.length > 200) return null;
    const limpio = [];
    for (const r of lista) {
        if (!r || typeof r !== 'object') return null;
        if (typeof r.pregunta !== 'string' || !r.pregunta.trim() || r.pregunta.length > 500) return null;
        if (typeof r.respuesta !== 'string' || r.respuesta.length > 2000) return null;
        if (typeof r.fase !== 'string' || !r.fase || r.fase.length > 30) return null;

        const item = { pregunta: r.pregunta.trim(), respuesta: r.respuesta, fase: r.fase };
        if (Number.isFinite(r.tiempo_respuesta)) {
            item.tiempo_respuesta = Math.max(0, Math.min(100000, Math.round(r.tiempo_respuesta)));
        }
        limpio.push(item);
    }
    return limpio;
}

function validarRespuestaPublica(body) {
    const nombreUsuario = (typeof body.nombreUsuario === 'string' ? body.nombreUsuario.trim() : '')
        .slice(0, 120) || 'Participante';

    const edad = parseInt(body.edad, 10);
    if (!Number.isInteger(edad) || edad < 18 || edad > 120) {
        return { ok: false, error: 'Edad inválida.' };
    }

    if (!SEXOS_VALIDOS.includes(body.sexo)) {
        return { ok: false, error: 'Sexo inválido.' };
    }

    const respuestas = limpiarRespuestas(body.respuestas);
    if (!respuestas) {
        return { ok: false, error: 'Formato de respuestas inválido.' };
    }

    return {
        ok: true,
        data: { nombreUsuario, edad, sexo: body.sexo, respuestas, meta: sanitizarMeta(body.meta) }
    };
}

function esUrlVideoValida(url) {
    if (typeof url !== 'string') return false;
    try {
        return new URL(url).protocol === 'https:';
    } catch {
        return false;
    }
}

// ============================================================
// RATE LIMITING
// ============================================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intente de nuevo en unos minutos.' }
});

const responderLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intente de nuevo más tarde.' }
});

// ============================================================
// RAÍZ Y ARCHIVOS ESTÁTICOS
// ============================================================
app.get('/', (req, res) => res.redirect('/login.html'));
app.use(express.static('public', { index: false }));

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ============================================================
// RUTAS: AUTH ADMIN
// ============================================================

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email y contraseña requeridos.' });

        const admin = await Admin.findOne({ where: { email: String(email).toLowerCase().trim() } });
        const coincide = await verifyPassword(password, admin ? admin.password_hash : HASH_SENUELO);
        if (!admin || !coincide)
            return res.status(401).json({ error: 'Credenciales incorrectas.' });

        // Una sola sesión activa por admin
        await SesionAdmin.destroy({ where: { admin_id: admin.id } });

        const token = genToken();
        const expira = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas
        await SesionAdmin.create({ token, admin_id: admin.id, expira_en: expira });

        res.json({ token, nombre: admin.nombre, email: admin.email });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', requireAdmin, async (req, res) => {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    await SesionAdmin.destroy({ where: { token } });
    res.json({ message: 'Sesión cerrada.' });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAdmin, (req, res) => {
    res.json({ nombre: req.admin.nombre, email: req.admin.email });
});

// PUT /api/auth/password  — cambiar contraseña del admin
app.put('/api/auth/password', requireAdmin, async (req, res) => {
    const { passwordActual, passwordNuevo } = req.body;
    if (typeof passwordNuevo !== 'string' || passwordNuevo.length < 8)
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });

    const ok = await verifyPassword(passwordActual || '', req.admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta.' });

    await req.admin.update({ password_hash: await hashPassword(passwordNuevo) });

    // Invalida las demás sesiones (deja viva la que acaba de usarse para cambiarla)
    const tokenActual = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    await SesionAdmin.destroy({ where: { admin_id: req.admin.id, token: { [Op.ne]: tokenActual } } });

    res.json({ message: 'Contraseña actualizada.' });
});

// ============================================================
// RUTAS: CUESTIONARIOS (protegidas — solo admin)
// ============================================================

// POST /api/cuestionarios — crear cuestionario y obtener link
app.post('/api/cuestionarios', requireAdmin, async (req, res) => {
    try {
        const { titulo, videoUrl, preguntas } = req.body;
        if (!titulo || !String(titulo).trim())
            return res.status(400).json({ error: 'El título es obligatorio.' });
        if (!esUrlVideoValida(videoUrl))
            return res.status(400).json({ error: 'La URL del video debe ser una dirección https válida.' });

        const nuevo = await Cuestionario.create({ titulo: String(titulo).trim(), videoUrl, preguntas });
        res.json(nuevo);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/cuestionarios — listar todos
app.get('/api/cuestionarios', requireAdmin, async (req, res) => {
    const lista = await Cuestionario.findAll({
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'titulo', 'link_token', 'activo', 'createdAt']
    });
    res.json(lista);
});

// DELETE /api/cuestionarios/:id
app.delete('/api/cuestionarios/:id', requireAdmin, async (req, res) => {
    const borrado = await Cuestionario.destroy({ where: { id: req.params.id } });
    borrado ? res.json({ message: 'Eliminado.' }) : res.status(404).json({ error: 'No encontrado.' });
});

// PATCH /api/cuestionarios/:id/activo — activar/desactivar
app.patch('/api/cuestionarios/:id/activo', requireAdmin, async (req, res) => {
    const c = await Cuestionario.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'No encontrado.' });
    await c.update({ activo: req.body.activo });
    res.json({ activo: c.activo });
});

// PATCH /api/cuestionarios/:id/titulo — editar título del cuestionario
app.patch('/api/cuestionarios/:id/titulo', requireAdmin, async (req, res) => {
    try {
        const c = await Cuestionario.findByPk(req.params.id);
        if (!c) return res.status(404).json({ error: 'No encontrado.' });
        if (!req.body.titulo || !req.body.titulo.trim()) {
            return res.status(400).json({ error: 'El título no puede estar vacío.' });
        }
        await c.update({ titulo: req.body.titulo.trim() });
        res.json({ titulo: c.titulo });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// RUTAS: CUESTIONARIO PÚBLICO (sin auth — acceso por link_token)
// ============================================================

// GET /api/c/:token — el participante carga su cuestionario por el link
app.get('/api/c/:token', async (req, res) => {
    const c = await Cuestionario.findOne({
        where: { link_token: req.params.token, activo: true }
    });
    if (!c) return res.status(404).json({ error: 'El cuestionario no está disponible.' });
    res.json(c);
});

// POST /api/c/:token/responder — el participante envía sus respuestas
app.post('/api/c/:token/responder', responderLimiter, async (req, res) => {
    try {
        const c = await Cuestionario.findOne({
            where: { link_token: req.params.token, activo: true }
        });
        if (!c) return res.status(404).json({ error: 'Cuestionario no disponible.' });

        const validacion = validarRespuestaPublica(req.body || {});
        if (!validacion.ok) return res.status(400).json({ error: validacion.error });

        const resultado = await Resultado.create({
            ...validacion.data,
            cuestionario_id: c.id
        });
        res.json(resultado);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// RUTAS: RESULTADOS (protegidas)
// ============================================================

app.get('/api/resultados-admin', requireAdmin, async (req, res) => {
    const resultados = await Resultado.findAll({
        order: [['createdAt', 'DESC']],
        include: [{ model: Cuestionario, attributes: ['titulo'] }]
    });
    res.json(resultados);
});

app.delete('/api/resultados/:id', requireAdmin, async (req, res) => {
    try {
        const borrado = await Resultado.destroy({ where: { id: req.params.id } });
        borrado
            ? res.json({ message: 'Registro eliminado.' })
            : res.status(404).json({ error: 'No encontrado.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// RUTA: EXPORTAR CSV COMPLETO — ADMIN (v4)
// GET /api/resultados-admin/csv
// ============================================================
app.get('/api/resultados-admin/csv', requireAdmin, async (req, res) => {
    try {
        const resultados = await Resultado.findAll({
            order: [['createdAt', 'DESC']],
            include: [{ model: Cuestionario, attributes: ['titulo'] }]
        });

        const esc = (v) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n'))
                return `"${s.replace(/"/g, '""')}"`;
            return s;
        };

        const encabezados = [
            'id', 'cuestionario', 'usuario', 'edad', 'sexo',
            'fecha', 'hora_inicio', 'hora_fin', 'duracion',
            'consentimiento', 'num_pregunta', 'pregunta',
            'respuesta', 'fase', 'tiempo_respuesta_seg', 'registrado_en'
        ];

        const filas = [];
        for (const r of resultados) {
            const respuestas = r.respuestas || [];
            const meta       = r.meta       || {};
            const titulo     = r.Cuestionario ? r.Cuestionario.titulo : '';
            const fecha      = r.createdAt ? r.createdAt.toISOString().slice(0, 10) : '';

            if (respuestas.length === 0) {
                filas.push([
                    r.id, titulo, r.nombreUsuario, r.edad, r.sexo,
                    meta.fecha || fecha, meta.hora_inicio || '', meta.hora_fin || '',
                    meta.duracion || '', meta.consentimiento ? 'si' : 'no',
                    '', '', '', '', '', fecha
                ].map(esc).join(','));
            } else {
                respuestas.forEach((resp, idx) => {
                    filas.push([
                        r.id, titulo, r.nombreUsuario, r.edad, r.sexo,
                        meta.fecha || fecha, meta.hora_inicio || '', meta.hora_fin || '',
                        meta.duracion || '', meta.consentimiento ? 'si' : 'no',
                        idx + 1,
                        resp.pregunta  || '',
                        resp.respuesta || '',
                        resp.fase      || '',
                        resp.tiempo_respuesta !== undefined ? resp.tiempo_respuesta + 's' : '',
                        fecha
                    ].map(esc).join(','));
                });
            }
        }

        const BOM     = '﻿';
        const csvBody = [encabezados.join(','), ...filas].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="resultados_completos.csv"');
        res.send(BOM + csvBody);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// SYNC + SEED + ARRANQUE
// ============================================================
async function iniciar() {
    try {
        await sequelize.authenticate();
        await sequelize.sync(isProd ? {} : { alter: true });
        console.log('✅ Tablas sincronizadas.');

        const existeAdmin = await Admin.findOne();
        if (!existeAdmin) {
            const email = process.env.ADMIN_EMAIL;
            const password = process.env.ADMIN_PASSWORD;
            if (!email || !password) {
                console.error('❌ No hay ningún admin en la base y faltan ADMIN_EMAIL / ADMIN_PASSWORD en el entorno.');
                process.exit(1);
            }
            await Admin.create({
                nombre: 'Administrador',
                email: email.toLowerCase().trim(),
                password_hash: await hashPassword(password)
            });
            console.log(`👤 Admin creado → ${email}`);
        }

        app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
    } catch (err) {
        console.error('❌ Error al iniciar:', err);
        process.exit(1);
    }
}

iniciar();
