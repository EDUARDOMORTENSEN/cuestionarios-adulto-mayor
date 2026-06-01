/* ============================================================
   cuestionario.js — Lógica del flujo principal del cuestionario
   Sistema de Cuestionarios v4 — Con métricas, CSV y consentimiento
   ============================================================ */

const params    = new URLSearchParams(location.search);
const linkToken = params.get('c');

let cuestionario   = null;
let indicePregunta = 0;

let fase          = 'BIENVENIDA';
let usuarioEdad   = null;
let usuarioSexo   = null;
let usuarioNombre = 'Participante';

/* ── Módulo de Tiempo ────────────────────────────────────────
   Registra hora de inicio total y por pregunta.
   ─────────────────────────────────────────────────────────── */
const Tiempo = (() => {
    let horaInicio    = null;
    let horaFin       = null;
    let inicioPregunta = null;

    return {
        iniciar()       { horaInicio = new Date(); },
        terminar()      { horaFin   = new Date(); },
        iniciarPregunta() { inicioPregunta = Date.now(); },
        tiempoPregunta()  {
            if (!inicioPregunta) return 0;
            return Math.round((Date.now() - inicioPregunta) / 1000); // segundos
        },
        horaInicioStr() { return horaInicio ? _formatHora(horaInicio) : '--'; },
        horaFinStr()    { return horaFin    ? _formatHora(horaFin)    : '--'; },
        duracionStr()   {
            if (!horaInicio || !horaFin) return '--';
            const seg = Math.round((horaFin - horaInicio) / 1000);
            const m   = Math.floor(seg / 60);
            const s   = seg % 60;
            return m > 0 ? `${m} min ${s} seg` : `${s} seg`;
        },
        fechaStr()      { return horaInicio ? _formatFecha(horaInicio) : '--'; }
    };

    function _formatHora(d) {
        return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function _formatFecha(d) {
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
    }
})();

/* ── Módulo Matriz de Respuestas ─────────────────────────────
   Almacena dinámicamente: [pregunta, respuesta, fase, tiempoSeg]
   ─────────────────────────────────────────────────────────── */
const MatrizRespuestas = (() => {
    const _datos = []; // [ [pregunta, respuesta, fase, tiempoSeg], ... ]

    return {
        agregar(pregunta, respuesta, fase, tiempoSeg) {
            _datos.push([pregunta, respuesta, fase, tiempoSeg]);
        },
        obtenerTodo()    { return [..._datos]; },
        comoObjetos()    {
            return _datos.map(([pregunta, respuesta, fase, tiempo_respuesta]) =>
                ({ pregunta, respuesta, fase, tiempo_respuesta }));
        },
        limpiar()        { _datos.length = 0; },
        longitud()       { return _datos.length; }
    };
})();

/* ── Módulo CSV ──────────────────────────────────────────────
   Genera y descarga el archivo CSV con todos los datos.
   ─────────────────────────────────────────────────────────── */
const CSV = (() => {
    // Escapa un valor para CSV (maneja comas, comillas, saltos)
    function _esc(v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n'))
            return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    return {
        generar(nombre, edad, sexo, consentimiento, matriz) {
            const encabezados = [
                'usuario', 'edad', 'sexo', 'fecha',
                'hora_inicio', 'hora_fin', 'duracion',
                'consentimiento', 'num_pregunta', 'pregunta',
                'respuesta', 'fase', 'tiempo_respuesta_seg'
            ];

            const filas = matriz.map((fila, idx) => {
                const [pregunta, respuesta, fase, tiempoSeg] = fila;
                return [
                    nombre, edad, sexo,
                    Tiempo.fechaStr(), Tiempo.horaInicioStr(),
                    Tiempo.horaFinStr(), Tiempo.duracionStr(),
                    consentimiento ? 'si' : 'no',
                    idx + 1, pregunta, respuesta, fase,
                    tiempoSeg + 's'
                ].map(_esc).join(',');
            });

            return [encabezados.join(','), ...filas].join('\r\n');
        },

        descargar(contenido, nombreArchivo) {
            // BOM para que Excel en español abra bien con tildes
            const bom  = '\uFEFF';
            const blob = new Blob([bom + contenido], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = nombreArchivo;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };
})();

/* ── Estado de consentimiento ────────────────────────────── */
let consentimientoAceptado = false;

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
                finalizarPrueba();
            }
            break;
    }
}

/* ── 1. Pantalla de Bienvenida con Consentimiento ─────────── */
function mostrarBienvenida() {
    // Estimamos el total de preguntas para el tiempo estimado
    const nAntes  = cuestionario.preguntas?.antes?.length  || 0;
    const nDespues = cuestionario.preguntas?.despues?.length || 0;
    const totalP   = nAntes + nDespues;
    const minEst   = Math.max(5, Math.ceil(totalP * 0.5 + 3)); // aprox

    app.innerHTML = `
        <span style="font-size:72px; display:block; margin-bottom:16px;"></span>
        <p class="etiqueta-fase">${cuestionario.titulo}</p>
        <h1 style="font-size:var(--fs-lg); margin: 18px 0 20px;">¡Bienvenido/a a la actividad!</h1>

        <!-- Tarjeta de información general -->
        <div class="bienvenida-info">
            <div class="info-item">
                <span class="info-icono"></span>
                <div>
                    <strong>Objetivo</strong>
                    <p>Esta actividad busca conocer sus opiniones y percepciones antes y después de ver un video educativo.</p>
                </div>
            </div>
            <div class="info-item">
                <span class="info-icono">⏱</span>
                <div>
                    <strong>Tiempo estimado</strong>
                    <p>Aproximadamente <strong>${minEst} minutos</strong>. Le pedimos completarla sin interrupciones.</p>
                </div>
            </div>
            <div class="info-item">
                <span class="info-icono"></span>
                <div>
                    <strong>Confidencialidad</strong>
                    <p>Sus respuestas son anónimas y se usarán únicamente con fines académicos o de investigación.</p>
                </div>
            </div>
            <div class="info-item">
                <span class="info-icono"></span>
                <div>
                    <strong>Importante</strong>
                    <p>Por favor, <strong>no cierre ni recargue</strong> esta página hasta finalizar. Sus respuestas se guardan al terminar.</p>
                </div>
            </div>
        </div>

        <!-- Checkbox de consentimiento obligatorio -->
        <div class="consentimiento-wrap" id="consentimientoWrap">
            <label class="consentimiento-label" for="checkConsentimiento">
                <input type="checkbox" id="checkConsentimiento" onchange="toggleConsentimiento()">
                <span class="check-texto">
                    ✔ He leído las instrucciones y acepto participar voluntariamente en esta actividad.
                </span>
            </label>
            <p id="errorConsentimiento" class="error-consentimiento" style="display:none;">
                 Debe aceptar el consentimiento para continuar.
            </p>
        </div>

        <button class="btn-primario" id="btnIniciar" onclick="validarConsentimiento()"
                style="opacity:0.45; cursor:not-allowed;">
            EMPEZAR ACTIVIDAD ➔
        </button>
    `;
}

function toggleConsentimiento() {
    const check  = document.getElementById('checkConsentimiento');
    const btn    = document.getElementById('btnIniciar');
    consentimientoAceptado = check.checked;

    if (consentimientoAceptado) {
        btn.style.opacity = '1';
        btn.style.cursor  = 'pointer';
        document.getElementById('errorConsentimiento').style.display = 'none';
    } else {
        btn.style.opacity = '0.45';
        btn.style.cursor  = 'not-allowed';
    }
}

function validarConsentimiento() {
    if (!consentimientoAceptado) {
        document.getElementById('errorConsentimiento').style.display = 'block';
        document.getElementById('consentimientoWrap').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    // Registrar hora de inicio real de la prueba
    Tiempo.iniciar();
    avanzarFase('DEMOGRAFICOS');
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
                <input class="form-input" type="number" id="inputEdad" min="1" placeholder="Ej. 18">
                <p id="errorEdad" style="color:var(--rojo); font-size:var(--fs-xs); display:none; margin-top:8px; font-weight:700;">
                    Lo sentimos, esta actividad está dirigida a personas de 18 años en adelante.
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
    if (edad < 18) {
        errorTxt.style.display = 'block';
        return;
    }
    errorTxt.style.display = 'none';
    usuarioEdad  = edad;
    usuarioSexo  = sexo;
    if (nombre) usuarioNombre = nombre;
    avanzarFase('INSTRUCCIONES');
}

/* ── 3. Instrucciones como Flujograma ──────────────────────── */
function mostrarInstrucciones() {
    const nAntes   = cuestionario.preguntas?.antes?.length  || 0;
    const nDespues = cuestionario.preguntas?.despues?.length || 0;

    app.innerHTML = `
        <p class="etiqueta-fase">Instrucciones</p>
        <h1 style="font-size:var(--fs-lg); margin:14px 0 24px;">¿Cómo funciona esta actividad?</h1>
        <p style="color:var(--texto-suave); font-size:var(--fs-sm); margin-bottom:28px;">
            Siga estos pasos en orden. La actividad avanzará automáticamente.
        </p>

        <!-- Flujograma visual -->
        <div class="flujo-wrap">

            <div class="flujo-paso flujo-inicio">
                <div class="flujo-icono"></div>
                <div class="flujo-texto">
                    <strong>INICIO</strong>
                    <span>Usted ya está aquí</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso">
                <div class="flujo-icono">✅</div>
                <div class="flujo-texto">
                    <strong>Consentimiento</strong>
                    <span>Ya aceptado</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-activo">
                <div class="flujo-icono">📋</div>
                <div class="flujo-texto">
                    <strong>Leer instrucciones</strong>
                    <span>Está aquí ahora</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-pendiente">
                <div class="flujo-icono">❓</div>
                <div class="flujo-texto">
                    <strong>Preguntas iniciales</strong>
                    <span>${nAntes} pregunta${nAntes !== 1 ? 's' : ''} antes del video</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-pendiente">
                <div class="flujo-icono">🎬</div>
                <div class="flujo-texto">
                    <strong>Ver el video</strong>
                    <span>Con atención y volumen activado</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-pendiente">
                <div class="flujo-icono">❓</div>
                <div class="flujo-texto">
                    <strong>Preguntas finales</strong>
                    <span>${nDespues} pregunta${nDespues !== 1 ? 's' : ''} después del video</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-pendiente">
                <div class="flujo-icono">💾</div>
                <div class="flujo-texto">
                    <strong>Guardar resultados</strong>
                    <span>Sus respuestas se registran</span>
                </div>
            </div>

            <div class="flujo-flecha">↓</div>

            <div class="flujo-paso flujo-fin">
                <div class="flujo-icono">🏁</div>
                <div class="flujo-texto">
                    <strong>FIN</strong>
                    <span>¡Muchas gracias!</span>
                </div>
            </div>

        </div>

        <div class="instrucciones-box" style="margin-top:28px;">
            <p><strong>Recuerde:</strong> No cierre ni recargue la página hasta llegar al final.</p>
            <p>Asegúrese de tener el <strong>volumen activado</strong> antes de ver el video.</p>
        </div>

        <button class="btn-primario" onclick="avanzarFase('ANTES')">ENTENDIDO, EMPEZAR ➔</button>
    `;
}

/* ── 4 & 6. Renderizador de Preguntas con medición de tiempo ─ */
function mostrarPregunta(p, total, faseLbl) {
    // Iniciar cronómetro de pregunta
    Tiempo.iniciarPregunta();

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
        const btn       = document.createElement('button');
        btn.className   = 'opcion-btn';
        btn.textContent = opt;
        btn.onclick     = () => registrar(p.texto, opt, faseLbl);
        cont.appendChild(btn);
    });
}

function registrar(pregunta, respuesta, faseLbl) {
    // Capturar tiempo de respuesta de esta pregunta
    const tiempoSeg = Tiempo.tiempoPregunta();
    // Guardar en la matriz de respuestas
    MatrizRespuestas.agregar(pregunta, respuesta, faseLbl, tiempoSeg);
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

/* ── Finalizar prueba: tiempo, CSV y envío ─────────────────── */
async function finalizarPrueba() {
    // Registrar hora de fin
    Tiempo.terminar();

    app.innerHTML = `<p class="cargando">Guardando sus respuestas... Por favor espere.</p>`;

    // Construir payload para el servidor (compatible con API existente)
    const respuestasParaAPI = MatrizRespuestas.comoObjetos();

    try {
        const res = await fetch(`/api/c/${linkToken}/responder`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                nombreUsuario: usuarioNombre,
                edad:          usuarioEdad,
                sexo:          usuarioSexo,
                respuestas:    respuestasParaAPI,
                // Metadatos extra (el servidor los ignora si no está preparado, pero no rompe nada)
                meta: {
                    fecha:        Tiempo.fechaStr(),
                    hora_inicio:  Tiempo.horaInicioStr(),
                    hora_fin:     Tiempo.horaFinStr(),
                    duracion:     Tiempo.duracionStr(),
                    consentimiento: consentimientoAceptado
                }
            })
        });

        if (res.ok) {
            // Generar y descargar CSV automáticamente
            const csvContent = CSV.generar(
                usuarioNombre,
                usuarioEdad,
                usuarioSexo,
                consentimientoAceptado,
                MatrizRespuestas.obtenerTodo()
            );
            const nombreCSV = `resultado_${usuarioNombre.replace(/\s+/g,'_')}_${Tiempo.fechaStr()}.csv`;
            CSV.descargar(csvContent, nombreCSV);

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
            Sus respuestas han sido guardadas con éxito.<br>
            Se ha descargado automáticamente un archivo con sus resultados.<br><br>
            Ya puede cerrar esta página de forma segura.
        </p>
        <div class="resumen-final">
            <p>Fecha: <strong>${Tiempo.fechaStr()}</strong></p>
            <p>Inicio: <strong>${Tiempo.horaInicioStr()}</strong></p>
            <p>Fin: <strong>${Tiempo.horaFinStr()}</strong></p>
            <p>Duración total: <strong>${Tiempo.duracionStr()}</strong></p>
            <p>Preguntas respondidas: <strong>${MatrizRespuestas.longitud()}</strong></p>
        </div>
    `;
}

function mostrarError(msg) {
    app.innerHTML = `<p class="estado-error">⚠️ ${msg}</p>`;
}

/* ── Inicio ─────────────────────────────────────────────────── */
init();
