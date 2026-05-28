/* ============================================================
   admin.js — Lógica del panel de administración
   Sistema de Cuestionarios v3
   ============================================================ */

let resultadosCache = [];
let contadorPreguntas = 0;

/* ── Helpers de auth ────────────────────────────────────────── */
function headers() {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('admin_token')
    };
}

async function verificarAuth() {
    const token = localStorage.getItem('admin_token');
    if (!token) { location.href = '/login.html'; return; }

    const r = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) {
        localStorage.clear();
        location.href = '/login.html';
        return;
    }
    const data = await r.json();
    document.getElementById('navNombre').textContent = data.nombre;
    cargarListaCuestionarios();
    cargarResultados();
}

async function logout() {
    await fetch('/api/auth/logout', {
        method: 'POST', headers: headers()
    }).catch(() => {});
    localStorage.clear();
    location.href = '/login.html';
}

/* ── Tabs ───────────────────────────────────────────────────── */
function cambiarTab(id, btn) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
}

/* ── Crear cuestionario ─────────────────────────────────────── */
function addPregunta(contenedorId) {
    contadorPreguntas++;
    const id  = `p${contadorPreguntas}`;
    const div = document.createElement('div');
    div.className = 'pregunta-item';
    div.id        = id;
    div.innerHTML = `
        <div class="pitem-head">
            <span>Pregunta</span>
            <button class="btn btn-red" onclick="document.getElementById('${id}').remove()">✕ Quitar</button>
        </div>
        <input type="text" class="p-texto" placeholder="Escribe la pregunta aquí">
        <label style="font-size:16px; margin-top:12px;">Opciones de respuesta (separadas por coma)</label>
        <input type="text" class="p-opciones" placeholder="Bien, Regular, Mal">
    `;
    document.getElementById(contenedorId).appendChild(div);
}

function recopilarPreguntas(contenedorId) {
    const items = document.querySelectorAll(`#${contenedorId} .pregunta-item`);
    const lista = [];
    items.forEach(item => {
        const texto   = item.querySelector('.p-texto').value.trim();
        const opciones = item.querySelector('.p-opciones').value
            .split(',')
            .map(o => o.trim())
            .filter(Boolean);
        if (texto && opciones.length) {
            lista.push({ texto, opciones });
        }
    });
    return lista;
}

async function guardarCuestionario() {
    const titulo    = document.getElementById('titulo').value.trim();
    const videoUrl  = document.getElementById('videoUrl').value.trim();
    const antes     = recopilarPreguntas('preguntas-antes');
    const despues   = recopilarPreguntas('preguntas-despues');

    if (!titulo || !videoUrl) {
        toast('⚠️ Complete el título y la URL del video.');
        return;
    }
    if (!antes.length && !despues.length) {
        toast('⚠️ Agregue al menos una pregunta.');
        return;
    }

    const res = await fetch('/api/cuestionarios', {
        method:  'POST',
        headers: headers(),
        body:    JSON.stringify({
            titulo, videoUrl,
            preguntas: { antes, despues }
        })
    });
    const nuevo = await res.json();

    if (!res.ok) { toast('Error: ' + nuevo.error); return; }

    const link = `${location.origin}/cuestionario.html?c=${nuevo.link_token}`;
    document.getElementById('linkGenerado').value = link;
    document.getElementById('linkBox').style.display = 'block';
    document.getElementById('linkBox').scrollIntoView({ behavior: 'smooth' });

    toast('✅ Cuestionario publicado correctamente.');
    cargarListaCuestionarios();
}

function copiarLink() {
    const input = document.getElementById('linkGenerado');
    input.select();
    navigator.clipboard.writeText(input.value)
        .then(() => toast('📋 Enlace copiado al portapapeles.'))
        .catch(() => toast('Selecciona el enlace y cópialo manualmente.'));
}

/* ── Lista de cuestionarios ────────────────────────────────── */
async function cargarListaCuestionarios() {
    const res = await fetch('/api/cuestionarios', { headers: headers() });
    if (!res.ok) return;
    const lista  = await res.json();
    const tbody  = document.getElementById('tabla-cuestionarios');
    tbody.innerHTML = '';

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">Aún no hay cuestionarios.</td></tr>';
        return;
    }

    lista.forEach(c => {
        const link  = `${location.origin}/cuestionario.html?c=${c.link_token}`;
        const fecha = new Date(c.createdAt).toLocaleDateString('es-EC');
        const badge = c.activo
            ? '<span class="badge badge-on">Activo</span>'
            : '<span class="badge badge-off">Inactivo</span>';

        tbody.innerHTML += `
            <tr>
                <td>${c.titulo}</td>
                <td>${badge}</td>
                <td>${fecha}</td>
                <td>
                    <input style="width:260px;padding:7px 10px;border:1px solid #cdd6e8;border-radius:7px;font-size:16px;color:var(--azul-principal)"
                           value="${link}" readonly onclick="this.select()">
                    <button class="btn btn-gray" style="margin-left:6px"
                            onclick="navigator.clipboard.writeText('${link}').then(()=>toast('📋 Copiado'))">
                        Copiar
                    </button>
                </td>
                <td style="white-space:nowrap">
                    <button class="btn btn-gray" style="margin-right:6px"
                            onclick="toggleActivo(${c.id}, ${!c.activo})">
                        ${c.activo ? '⏸ Pausar' : '▶ Activar'}
                    </button>
                    <button class="btn btn-red"
                            onclick="eliminarCuestionario(${c.id})">🗑</button>
                </td>
            </tr>`;
    });
}

async function toggleActivo(id, estado) {
    await fetch(`/api/cuestionarios/${id}/activo`, {
        method:  'PATCH',
        headers: headers(),
        body:    JSON.stringify({ activo: estado })
    });
    cargarListaCuestionarios();
}

async function eliminarCuestionario(id) {
    if (!confirm('¿Eliminar este cuestionario y todos sus resultados?')) return;
    await fetch(`/api/cuestionarios/${id}`, {
        method: 'DELETE', headers: headers()
    });
    toast('Cuestionario eliminado.');
    cargarListaCuestionarios();
    cargarResultados();
}

/* ── Resultados ────────────────────────────────────────────── */
async function cargarResultados() {
    const res = await fetch('/api/resultados-admin', { headers: headers() });
    if (!res.ok) return;
    resultadosCache     = await res.json();
    const tbody         = document.getElementById('tabla-resultados');
    tbody.innerHTML     = '';

    if (!resultadosCache.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">Sin respuestas aún.</td></tr>';
        return;
    }

    resultadosCache.forEach(r => {
        const fecha  = new Date(r.createdAt).toLocaleString('es-EC');
        const titulo = r.Cuestionario ? r.Cuestionario.titulo : '—';
        const edad   = r.edad ? `${r.edad} años` : '—';

        tbody.innerHTML += `
            <tr>
                <td style="white-space:nowrap">${fecha}</td>
                <td>${titulo}</td>
                <td style="font-weight:700;color:var(--texto)">${r.nombreUsuario}</td>
                <td>${edad}</td>
                <td style="white-space:nowrap">
                    <button class="btn btn-blue" style="margin-right:6px"
                            onclick="verDetalleResultado(${r.id})">👁 Ver</button>
                    <button class="btn btn-red"
                            onclick="eliminarResultado(${r.id}, this)">🗑</button>
                </td>
            </tr>`;
    });
}

/* ── Modal de detalle ─────────────────────────────────────── */
function verDetalleResultado(id) {
    const registro = resultadosCache.find(x => x.id === id);
    if (!registro) return;

    const modal    = document.getElementById('modalResultados');
    const body     = document.getElementById('modalBody');
    const respuestas = Array.isArray(registro.respuestas) ? registro.respuestas : [];
    const antes    = respuestas.filter(x => x.fase.toLowerCase() === 'antes');
    const despues  = respuestas.filter(x => x.fase.toLowerCase() === 'despues');

    let html = `
        <div class="meta-usuario">
            <div class="meta-item"><b>Participante:</b> ${registro.nombreUsuario}</div>
            <div class="meta-item"><b>Edad:</b> ${registro.edad || '—'} años</div>
            <div class="meta-item"><b>Actividad:</b> ${registro.Cuestionario ? registro.Cuestionario.titulo : '—'}</div>
        </div>
    `;

    // Fase ANTES
    html += `<div class="fase-seccion">
        <span class="fase-titulo fase-antes">Fase 1: Antes del Video</span>`;
    if (antes.length) {
        antes.forEach(r => {
            html += `<div class="res-item">
                <div class="res-pregunta">${r.pregunta}</div>
                <div>Respuesta: <span class="res-respuesta">${r.respuesta}</span></div>
            </div>`;
        });
    } else {
        html += `<p style="color:#999;margin:6px 0 0">No se registraron respuestas en esta fase.</p>`;
    }
    html += `</div>`;

    // Fase DESPUÉS
    html += `<div class="fase-seccion">
        <span class="fase-titulo fase-despues">Fase 2: Después del Video</span>`;
    if (despues.length) {
        despues.forEach(r => {
            html += `<div class="res-item">
                <div class="res-pregunta">${r.pregunta}</div>
                <div>Respuesta: <span class="res-respuesta">${r.respuesta}</span></div>
            </div>`;
        });
    } else {
        html += `<p style="color:#999;margin:6px 0 0">No se registraron respuestas en esta fase.</p>`;
    }
    html += `</div>`;

    body.innerHTML = html;
    modal.classList.add('open');
}

function cerrarModal(event) {
    if (!event ||
        event.target.classList.contains('modal-overlay') ||
        event.target.classList.contains('modal-close')) {
        document.getElementById('modalResultados').classList.remove('open');
    }
}

async function eliminarResultado(id, btn) {
    if (!confirm('¿Eliminar este resultado?')) return;
    btn.disabled   = true;
    const res = await fetch(`/api/resultados/${id}`, {
        method: 'DELETE', headers: headers()
    });
    if (res.ok) {
        toast('Resultado eliminado.');
        cargarResultados();
    } else {
        btn.disabled = false;
        toast('Error al eliminar.');
    }
}

/* ── Toast ─────────────────────────────────────────────────── */
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── Inicio ─────────────────────────────────────────────────── */
verificarAuth();
