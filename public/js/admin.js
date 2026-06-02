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

/* ── Cargar preguntas desde archivo TXT ─────────────────────── */
function parseTXT(text) {
    const lines = text.split(/\r?\n/);
    const preguntas = [];
    let currentPregunta = null;

    for (let line of lines) {
        let cleanLine = line.trim();
        if (!cleanLine) continue;

        // Ignorar líneas divisorias típicas o encabezados
        if (cleanLine.startsWith('____') || cleanLine.startsWith('----') || cleanLine.toLowerCase().startsWith('instrucciones') || cleanLine.toLowerCase().startsWith('pretest')) {
            continue;
        }

        // Detectar si es una opción: A) o A. o B) o B. etc.
        const optMatch = cleanLine.match(/^([A-Za-z])[\)\.]\s*(.*)$/);
        if (optMatch) {
            if (currentPregunta) {
                // Limpiar la opción (quitar marca de correcto como ✅)
                let optText = optMatch[2].replace(/✅/g, '').trim();
                currentPregunta.opciones.push(optText);
            }
        } else {
            // Es texto de pregunta. Quitar número inicial si tiene, ej: "1. ¿Cuál..." -> "¿Cuál..."
            const qMatch = cleanLine.match(/^\d+[\.\)]\s*(.*)$/);
            const qText = qMatch ? qMatch[1].trim() : cleanLine;
            
            if (qText.length > 3) {
                currentPregunta = {
                    texto: qText,
                    opciones: []
                };
                preguntas.push(currentPregunta);
            }
        }
    }

    return preguntas.filter(p => p.texto && p.opciones.length > 0);
}

function cargarPreguntasDesdeArchivo(inputElement, contenedorId) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const preguntas = parseTXT(text);
        
        if (preguntas.length === 0) {
            toast('⚠️ No se encontraron preguntas válidas en el formato del TXT.');
            return;
        }

        // Vaciar el contenedor
        const container = document.getElementById(contenedorId);
        container.innerHTML = '';

        // Añadir cada pregunta al contenedor
        preguntas.forEach(p => {
            contadorPreguntas++;
            const id = `p${contadorPreguntas}`;
            const div = document.createElement('div');
            div.className = 'pregunta-item';
            div.id = id;
            div.innerHTML = `
                <div class="pitem-head">
                    <span>Pregunta</span>
                    <button class="btn btn-red" onclick="document.getElementById('${id}').remove()">✕ Quitar</button>
                </div>
                <input type="text" class="p-texto" placeholder="Escribe la pregunta aquí" value="${p.texto.replace(/"/g, '&quot;')}">
                <label style="font-size:16px; margin-top:12px;">Opciones de respuesta (separadas por coma)</label>
                <input type="text" class="p-opciones" placeholder="Bien, Regular, Mal" value="${p.opciones.join(', ').replace(/"/g, '&quot;')}">
            `;
            container.appendChild(div);
        });

        toast(`✅ Se cargaron ${preguntas.length} preguntas correctamente.`);
    };
    reader.readAsText(file, 'UTF-8');
    inputElement.value = '';
}

/* ── Encuesta de Percepción ────────────────────────────────── */
const defaultLikert = [
    "El contenido del podcast fue claro y fácil de comprender.",
    "La información presentada mantuvo mi atención durante la actividad.",
    "La explicación de los conceptos fue organizada y coherente.",
    "El ritmo de presentación del podcast fue adecuado.",
    "Considero que el podcast facilitó mi comprensión del tema.",
    "Los ejemplos utilizados ayudaron a entender mejor los conceptos.",
    "El audio y la narración fueron agradables de escuchar.",
    "El podcast generó interés por aprender más sobre el tema.",
    "Considero que el contenido presentado fue confiable.",
    "Me sentiría cómodo utilizando este tipo de recurso en otros cursos.",
    "El podcast transmitió la información de manera profesional.",
    "Después de escuchar el podcast, considero que comprendí mejor los riesgos relacionados con la huella digital."
];

const defaultAbiertas = [
    "¿Qué aspecto del podcast le resultó más útil para su aprendizaje?",
    "¿Qué aspecto podría mejorarse en el podcast?",
    "¿Hubo algún momento en que el contenido resultara confuso o poco claro? Explique.",
    "¿Qué tan natural le pareció la narración del podcast? Explique brevemente."
];

function toggleEncuestaSection(checked) {
    const wrap = document.getElementById('encuesta-config-wrap');
    if (checked) {
        wrap.style.display = 'block';
    } else {
        wrap.style.display = 'none';
    }
}

function toggleOtroDespues(checked) {
    const wrap = document.getElementById('despues-config-wrap');
    if (checked) {
        wrap.style.display = 'block';
    } else {
        wrap.style.display = 'none';
    }
}

function addEncuestaItem(tipo, valorDefault = '') {
    contadorPreguntas++;
    const id = `encuesta-item-${contadorPreguntas}`;
    const div = document.createElement('div');
    div.className = 'pregunta-item';
    div.id = id;
    div.style.borderLeft = tipo === 'likert' ? '6px solid var(--azul-principal)' : '6px solid #ff9f43';
    div.innerHTML = `
        <div class="pitem-head">
            <span>${tipo === 'likert' ? 'Afirmación Likert (Escala 1-5)' : 'Pregunta Abierta'}</span>
            <button class="btn btn-red" onclick="document.getElementById('${id}').remove()">✕ Quitar</button>
        </div>
        <input type="text" class="encuesta-pregunta-texto" placeholder="Escribe aquí la pregunta..." value="${valorDefault.replace(/"/g, '&quot;')}">
    `;
    const containerId = tipo === 'likert' ? 'encuesta-likert-items' : 'encuesta-abiertas-items';
    document.getElementById(containerId).appendChild(div);
}

function recopilarEncuestaItems(containerId) {
    const items = document.querySelectorAll(`#${containerId} .pregunta-item`);
    const lista = [];
    items.forEach(item => {
        const texto = item.querySelector('.encuesta-pregunta-texto').value.trim();
        if (texto) {
            lista.push(texto);
        }
    });
    return lista;
}

async function guardarCuestionario() {
    const titulo    = document.getElementById('titulo').value.trim();
    const videoUrl  = document.getElementById('videoUrl').value.trim();
    const antes     = recopilarPreguntas('preguntas-antes');
    
    const usarOtroDespues = document.getElementById('usar-otro-despues').checked;
    const despues   = usarOtroDespues ? recopilarPreguntas('preguntas-despues') : antes;

    const incluirEncuesta = document.getElementById('incluir-encuesta').checked;
    let encuesta = null;

    if (incluirEncuesta) {
        const encuestaTitulo = document.getElementById('encuesta-titulo').value.trim() || 'Encuesta de Percepción';
        const likert = recopilarEncuestaItems('encuesta-likert-items');
        const abiertas = recopilarEncuestaItems('encuesta-abiertas-items');
        encuesta = { titulo: encuestaTitulo, likert, abiertas };
    }

    if (!titulo || !videoUrl) {
        toast('⚠️ Complete el título y la URL del video.');
        return;
    }
    if (!antes.length) {
        toast('⚠️ Agregue al menos una pregunta en el cuestionario.');
        return;
    }
    if (usarOtroDespues && !despues.length) {
        toast('⚠️ Agregue al menos una pregunta para después del video.');
        return;
    }
    if (incluirEncuesta && (!encuesta.likert.length && !encuesta.abiertas.length)) {
        toast('⚠️ Agregue al menos una pregunta en la encuesta.');
        return;
    }

    const res = await fetch('/api/cuestionarios', {
        method:  'POST',
        headers: headers(),
        body:    JSON.stringify({
            titulo, videoUrl,
            preguntas: { antes, despues, encuesta }
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
    const encuesta = respuestas.filter(x => x.fase.toLowerCase() === 'encuesta');

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

    // Fase ENCUESTA
    html += `<div class="fase-seccion">
        <span class="fase-titulo fase-encuesta">Fase 3: Encuesta de Percepción</span>`;
    if (encuesta.length) {
        encuesta.forEach(r => {
            html += `<div class="res-item">
                <div class="res-pregunta">${r.pregunta}</div>
                <div>Respuesta: <span class="res-respuesta">${r.respuesta}</span></div>
            </div>`;
        });
    } else {
        html += `<p style="color:#999;margin:6px 0 0">No se registraron respuestas en esta encuesta.</p>`;
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

/* ── Exportar CSV completo desde el admin (v4) ──────────────── */
async function exportarCSV() {
    const token = localStorage.getItem('admin_token');
    const res   = await fetch('/api/resultados-admin/csv', {
        headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) { toast('Error al exportar CSV.'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'resultados_completos.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV descargado exitosamente.');
}
