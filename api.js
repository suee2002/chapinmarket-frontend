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
 * @param {boolean} silenciarErrores - Si es true, no se loguea en consola cuando falla (ej: /auth/me al inicio)
 * @returns {Promise<{ok: boolean, datos: any, mensaje: string}>}
 */
export async function llamarApi(endpoint, opciones = {}, silenciarErrores = false) {
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
      credentials: 'include',
    };

    if (opciones.body && ['POST', 'PUT', 'DELETE'].includes((opciones.method || 'GET').toUpperCase())) {
      fetchOptions.body = opciones.body;
    }

    const response = await fetch(url, fetchOptions);

    const data = await response.json().catch(() => ({}));

    emitirEventoCarga(false);

    const exito = response.ok && (data.success === true || data.ok === true);
    const datos = data.data !== undefined ? data.data 
      : data.datos !== undefined ? data.datos 
        : data;  
    const mensaje = data.message || data.mensaje || '';

    if (!exito && !silenciarErrores) {
      const esAuthMeNoAutenticado = ruta.includes('/auth/me') && response.status === 401;
      if (!esAuthMeNoAutenticado) {
        console.error(`[API] ${response.status} en ${url}:`, mensaje || data);
      }
    }

    return { ok: exito, datos, mensaje };

  } catch (error) {
    emitirEventoCarga(false);
    if (!silenciarErrores) {
      console.error(`[API] Error al llamar ${url}:`, error);
    }
    return { ok: false, datos: null, mensaje: 'No se pudo conectar con el servidor' };
  }
}

export default llamarApi;