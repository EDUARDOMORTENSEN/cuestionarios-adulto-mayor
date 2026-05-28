/* ============================================================
   cuestionario.js — Lógica del flujo principal del cuestionario
   Sistema de Cuestionarios v3
   ============================================================ */

const params    = new URLSearchParams(location.search);
const linkToken = params.get('c');

let cuestionario   = null;
let respuestas     = [];
let indicePregunta = 0;

let fase         = 'BIENVENIDA';
let usuarioEdad  = null;
let usuarioSexo  = null;
let usuarioNombre = 'Participante';

const app = document.getElementById('app');

/* ── Carga inicial ─────────────────────────────────────────── */
async function init() {
    if (!linkToken) {
        mostrarError('Enlace inválido. Solicite uno nuevo al administrador.');
        return;
    }
    try {
        const res = await fetch(`/api/c/${linkToken}`);
        if (!res.ok) {
            const err = await res.json();
            mostrarError(err.error || 'El cuestionario no está disponible.');
            return;
        }
        cuestionario = await res.json();
        document.title = cuestionario.titulo || 'Actividad';
        flujo();
    } catch {
        mostrarError('No se pudo conectar con el servidor.');
    }
}

/* ── Control de Flujo Centralizado ─────────────────────────── */
function flujo() {
    const preguntas = cuestionario.preguntas;

    switch (fase) {
        case 'BIENVENIDA':
            mostrarBienvenida();
            break;
        case 'DEMOGRAFICOS':
            mostrarDemograficos();
            break;
        case 'INSTRUCCIONES':
            mostrarInstrucciones();
            break;
        case 'ANTES':
            if (indicePregunta < preguntas.antes.length) {
                mostrarPregunta(preguntas.antes[indicePregunta], preguntas.antes.length, 'ANTES');
            } else {
                fase = 'VIDEO';
                indicePregunta = 0;
                flujo();
            }
            break;
        case 'VIDEO':
            mostrarVideo();
            break;
        case 'DESPUES':
            if (indicePregunta < preguntas.despues.length) {
                mostrarPregunta(preguntas.despues[indicePregunta], preguntas.despues.length, 'DESPUES');
            } else {
                enviarRespuestas();
            }
            break;
    }
}

/* ── 1. Pantalla de Bienvenida ──────────────────────────────── */
function mostrarBienvenida() {
    app.innerHTML = `
        <span style="font-size:72px; display:block; margin-bottom:16px;">👋</span>
        <p class="etiqueta-fase">${cuestionario.titulo}</p>
        <h1 style="font-size:var(--fs-lg); margin: 18px 0 20px;">¡Bienvenido/a a la actividad!</h1>
        <p style="font-size:var(--fs-base); color:var(--texto-suave); line-height:1.7; margin-bottom:8px;">
            Le agradecemos sinceramente su tiempo y participación en este estudio.<br>
            A continuación, le haremos unas preguntas breves antes y después de ver un video.
        </p>
        <button class="btn-primario" onclick="avanzarFase('DEMOGRAFICOS')">EMPEZAR ACTIVIDAD ➔</button>
    `;
}

/* ── 2. Datos Demográficos ───────────────────────────────────── */
function mostrarDemograficos() {
    app.innerHTML = `
        <p class="etiqueta-fase">Sus Datos</p>
        <h1 style="font-size:var(--fs-lg); margin:14px 0 28px;">Por favor, ingrese sus datos</h1>

        <div style="text-align:left; max-width:560px; margin:0 auto;">

            <div class="form-grupo">
                <label class="form-label">1. Su nombre (opcional):</label>
                <input class="form-input" type="text" id="inputNombre" placeholder="Ej. Juan Pérez">
            </div>

            <div class="form-grupo">
                <label class="form-label">2. ¿Qué edad tiene?</label>
                <input class="form-input" type="number" id="inputEdad" min="1" placeholder="Ej. 65">
                <p id="errorEdad" style="color:var(--rojo); font-size:var(--fs-xs); display:none; margin-top:8px; font-weight:700;">
                    ⚠️ Lo sentimos, esta actividad está dirigida a personas de 50 años en adelante.
                </p>
            </div>

            <div class="form-grupo">
                <label class="form-label">3. Sexo:</label>
                <select class="form-input form-select" id="selectSexo">
                    <option value="">-- Seleccione una opción --</option>
                    <option value="Masculino">Masculino</option>
                    <option value="Femenino">Femenino</option>
                    <option value="Otro">Otro / Prefiero no decirlo</option>
                </select>
            </div>

        </div>

        <button class="btn-primario" onclick="validarDemograficos()">CONTINUAR ➔</button>
    `;
}

function validarDemograficos() {
    const edad   = parseInt(document.getElementById('inputEdad').value);
    const sexo   = document.getElementById('selectSexo').value;
    const nombre = document.getElementById('inputNombre').value.trim();
    const errorTxt = document.getElementById('errorEdad');

    if (!edad || !sexo) {
        alert('Por favor, complete los campos de Edad y Sexo.');
        return;
    }
    if (edad < 50) {
        errorTxt.style.display = 'block';
        return;
    }
    errorTxt.style.display = 'none';
    usuarioEdad  = edad;
    usuarioSexo  = sexo;
    if (nombre) usuarioNombre = nombre;
    avanzarFase('INSTRUCCIONES');
}

/* ── 3. Instrucciones ───────────────────────────────────────── */
function mostrarInstrucciones() {
    app.innerHTML = `
        <p class="etiqueta-fase">Instrucciones</p>
        <h1 style="font-size:var(--fs-lg); margin:14px 0 24px;">Lea con atención antes de comenzar</h1>

        <div class="instrucciones-box">
            
            <p> <strong>Paso 1:</strong> Responderá unas preguntas iniciales.</p>
            <p> <strong>Paso 2:</strong> Verá un video. Asegúrese de tener el volumen alto.</p>
            <p> <strong>Paso 3:</strong> Al terminar el video, responderá más preguntas.</p>
            <p> <strong>Paso 4:</strong> Al final presione el botón verde para guardar sus respuestas.</p>
        </div>

        <button class="btn-primario" onclick="avanzarFase('ANTES')">ENTENDIDO, EMPEZAR ➔</button>
    `;
}

/* ── 4 & 6. Renderizador de Preguntas ──────────────────────── */
function mostrarPregunta(p, total, faseLbl) {
    const pct      = Math.round((indicePregunta / total) * 100);
    const etiqueta = faseLbl === 'ANTES' ? 'Antes del video' : 'Después del video';

    app.innerHTML = `
        <p style="font-size:var(--fs-xs); color:var(--gris-medio); margin-bottom:6px;">
            ${etiqueta} — Pregunta ${indicePregunta + 1} de ${total}
        </p>
        <div class="progreso-bar"><div class="progreso-fill" style="width:${pct}%"></div></div>
        <p class="etiqueta-fase">${cuestionario.titulo}</p>
        <h1 style="font-size:var(--fs-lg); margin:18px 0 30px; line-height:1.4;">${p.texto}</h1>
        <div id="opciones"></div>
    `;

    const cont = document.getElementById('opciones');
    p.opciones.forEach(opt => {
        const btn = document.createElement('button');
        btn.className   = 'opcion-btn';
        btn.textContent = opt;
        btn.onclick     = () => registrar(p.texto, opt);
        cont.appendChild(btn);
    });
}

function registrar(pregunta, respuesta) {
    respuestas.push({ pregunta, respuesta, fase });
    indicePregunta++;
    flujo();
}

/* ── 5. Mostrar Video ───────────────────────────────────────── */
function mostrarVideo() {
    app.innerHTML = `
        <p class="etiqueta-fase">${cuestionario.titulo}</p>
        <h1 style="font-size:var(--fs-lg); margin:14px 0 24px;">Mire el video con atención 🎬</h1>
        <div class="video-wrap">
            <iframe src="${cuestionario.videoUrl}" frameborder="0" allowfullscreen></iframe>
        </div>
        <button class="btn-primario" onclick="avanzarFase('DESPUES')">YA TERMINÉ DE VER EL VIDEO ✔</button>
    `;
}

/* ── Helper de Navegación ───────────────────────────────────── */
function avanzarFase(nuevaFase) {
    fase           = nuevaFase;
    indicePregunta = 0;
    flujo();
}

/* ── Enviar respuestas al servidor ─────────────────────────── */
async function enviarRespuestas() {
    app.innerHTML = `<p class="cargando">Guardando sus respuestas... Por favor espere.</p>`;

    try {
        const res = await fetch(`/api/c/${linkToken}/responder`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                nombreUsuario: usuarioNombre,
                edad:          usuarioEdad,
                sexo:          usuarioSexo,
                respuestas
            })
        });

        if (res.ok) {
            mostrarFinal();
        } else {
            const err = await res.json();
            mostrarError(err.error || 'Hubo un problema al guardar las respuestas.');
        }
    } catch {
        mostrarError('No se pudo conectar con el servidor.');
    }
}

function mostrarFinal() {
    app.innerHTML = `
        <span class="final-icono">🎉</span>
        <p class="final-titulo">¡Muchas gracias, ${usuarioNombre}!</p>
        <p class="final-sub">
            Sus respuestas y datos han sido guardados con éxito.<br>
            Ya puede cerrar esta página de forma segura.
        </p>
    `;
}

function mostrarError(msg) {
    app.innerHTML = `<p class="estado-error">⚠️ ${msg}</p>`;
}

/* ── Inicio ─────────────────────────────────────────────────── */
init();
