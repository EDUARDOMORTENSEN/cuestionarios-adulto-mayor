

const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config(); // Al inicio del archivo

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// CONEXIÓN (Modificada para Producción)
// ============================================================
// Si existe la variable en la nube, la usa; si no, usa tu local de Docker
const urlConexion = process.env.DATABASE_URL || 'postgres://admin_user:super_password123@localhost:5432/cuestionarios_db';

const sequelize = new Sequelize(urlConexion, {
    dialect: 'postgres',
    logging: false,
    // Render requiere SSL para conexiones seguras a la base de datos
    dialectOptions: process.env.DATABASE_URL ? {
        ssl: {
            require: true,
            rejectUnauthorized: false // Evita problemas de certificados en Render
        }
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
    password_hash: { type: DataTypes.STRING(64), allowNull: false }  // SHA-256 hex
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
const sha256 = (txt) => crypto.createHash('sha256').update(txt).digest('hex');
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
// SYNC + SEED
// ============================================================
sequelize.sync({ alter: true })
    .then(async () => {
        console.log('✅ Tablas sincronizadas.');
        const existe = await Admin.findOne({ where: { email: 'admin@sistema.com' } });
        if (!existe) {
            await Admin.create({
                nombre: 'Administrador',
                email: 'admin@sistema.com',
                password_hash: sha256('admin123')
            });
            console.log('👤 Admin creado → admin@sistema.com / admin123');
        }
    })
    .catch(err => console.error('❌ Error DB:', err));

// ============================================================
// RUTAS: AUTH ADMIN
// ============================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email y contraseña requeridos.' });

        const admin = await Admin.findOne({ where: { email: email.toLowerCase().trim() } });
        if (!admin || admin.password_hash !== sha256(password))
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
    if (req.admin.password_hash !== sha256(passwordActual))
        return res.status(401).json({ error: 'Contraseña actual incorrecta.' });
    await req.admin.update({ password_hash: sha256(passwordNuevo) });
    res.json({ message: 'Contraseña actualizada.' });
});

// ============================================================
// RUTAS: CUESTIONARIOS (protegidas — solo admin)
// ============================================================

// POST /api/cuestionarios — crear cuestionario y obtener link
app.post('/api/cuestionarios', requireAdmin, async (req, res) => {
    try {
        const nuevo = await Cuestionario.create(req.body);
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
app.post('/api/c/:token/responder', async (req, res) => {
    try {
        const c = await Cuestionario.findOne({
            where: { link_token: req.params.token, activo: true }
        });
        if (!c) return res.status(404).json({ error: 'Cuestionario no disponible.' });

        const resultado = await Resultado.create({
            nombreUsuario: req.body.nombreUsuario || 'Participante',
            edad: req.body.edad,
            sexo: req.body.sexo,
            respuestas: req.body.respuestas,
            cuestionario_id: c.id,
            meta: req.body.meta || null   // Guarda tiempos y consentimiento (v4)
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
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));

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

        const BOM     = '\uFEFF';
        const csvBody = [encabezados.join(','), ...filas].join('\r\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="resultados_completos.csv"');
        res.send(BOM + csvBody);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
