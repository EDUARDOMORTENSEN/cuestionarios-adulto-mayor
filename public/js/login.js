/* ============================================================
   login.js — Lógica de autenticación del administrador
   Sistema de Cuestionarios v3
   ============================================================ */

/* ── Redirigir si ya hay sesión activa ──────────────────────── */
const tokenGuardado = localStorage.getItem('admin_token');
if (tokenGuardado) {
    fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + tokenGuardado }
    }).then(r => { if (r.ok) location.href = '/admin.html'; });
}

/* ── Función principal de login ─────────────────────────────── */
async function login() {
    const email = document.getElementById('email').value.trim();
    const pass  = document.getElementById('pass').value;
    const btn   = document.getElementById('btn');
    const spin  = document.getElementById('spin');
    const err   = document.getElementById('errorMsg');

    err.style.display = 'none';

    if (!email || !pass) {
        mostrarError('Ingrese su correo y contraseña.');
        return;
    }

    btn.disabled            = true;
    spin.style.display      = 'inline-block';

    try {
        const res  = await fetch('/api/auth/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password: pass })
        });
        const data = await res.json();

        if (!res.ok) {
            mostrarError(data.error || 'Credenciales incorrectas.');
            return;
        }

        localStorage.setItem('admin_token',  data.token);
        localStorage.setItem('admin_nombre', data.nombre);
        location.href = '/admin.html';

    } catch {
        mostrarError('No se pudo conectar con el servidor.');
    } finally {
        btn.disabled       = false;
        spin.style.display = 'none';
    }
}

function mostrarError(msg) {
    const el = document.getElementById('errorMsg');
    el.textContent    = msg;
    el.style.display  = 'block';
}

/* ── Permitir Enter para enviar el formulario ───────────────── */
document.getElementById('pass')
    .addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
