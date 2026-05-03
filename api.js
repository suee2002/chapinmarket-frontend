// api.js — Módulo de comunicación con el backend ChapínMarket

const BASE_URL = 'http://localhost/chapinmarket-backend';

function emitirEventoCarga(activo) {
  window.dispatchEvent(new CustomEvent('chapinmarket:carga', { detail: { activo } }));
}

/**
 * Función central para llamar a la API.
 *
 * El backend (Response.php) devuelve siempre:
 *   { "success": true/false, "data": {...}, "message": "...", "errors": null, "meta": null }
 *
 * El frontend (app.js) espera:
 *   { ok: true/false, datos: {...}, mensaje: "..." }
 *
 * Esta función hace la traducción automática entre ambos formatos.
 *
 * @param {string} endpoint - Ruta relativa, ej: '/public/perfil' o '/perfil/tarjetas'
 * @param {object} opciones - Opciones de fetch (method, body, headers…)
 * @returns {Promise<{ok: boolean, datos: any, mensaje: string}>}
 */
export async function llamarApi(endpoint, opciones = {}) {
  // Normalizar ruta: asegurarse de que siempre lleve /public/
  let ruta = endpoint;
  if (!ruta.startsWith('/public') && !ruta.startsWith('http')) {
    ruta = '/public' + ruta;
  }

  const url = BASE_URL + ruta;

  emitirEventoCarga(true);

  try {
    const fetchOptions = {
      method: opciones.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opciones.headers || {})
      },
      credentials: 'include', // ✅ La cookie de sesión PHP viaja en cada petición
    };

    // Solo adjuntar body en métodos que lo admiten
    if (opciones.body && ['POST', 'PUT', 'DELETE'].includes((opciones.method || 'GET').toUpperCase())) {
      fetchOptions.body = opciones.body;
    }

    const response = await fetch(url, fetchOptions);

    // Parsear JSON de forma segura
    const data = await response.json().catch(() => ({}));

    emitirEventoCarga(false);

    // ─────────────────────────────────────────────────────────────────────
    // TRADUCCIÓN DE FORMATOS:
    //   Backend (Response.php) → { success, data, message, errors, meta }
    //   Frontend (app.js)      → { ok,      datos, mensaje }
    // ─────────────────────────────────────────────────────────────────────
    const exito = response.ok && (data.success === true || data.ok === true);
    const datos = data.data !== undefined ? data.data    // formato backend estándar
      : data.datos !== undefined ? data.datos   // formato alternativo
        : data;                                     // fallback: respuesta completa
    const mensaje = data.message || data.mensaje || '';

    return { ok: exito, datos, mensaje };

  } catch (error) {
    emitirEventoCarga(false);
    console.error(`[API] Error al llamar ${url}:`, error);
    return { ok: false, datos: null, mensaje: 'No se pudo conectar con el servidor' };
  }
}

export default llamarApi;