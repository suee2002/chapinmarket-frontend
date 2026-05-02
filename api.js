const BASE_URL = 'http://localhost/chapinmarket-backend';

function emitirEventoCarga(activo) {
  window.dispatchEvent(new CustomEvent('chapinmarket:carga', { detail: { activo } }));
}

export async function llamarApi(ruta, opciones = {}) {
  const url = BASE_URL + ruta;
  emitirEventoCarga(true);
  try {
    const fetchOptions = {
      method: opciones.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (opciones.body && ['POST', 'PUT', 'DELETE'].includes((opciones.method || 'GET').toUpperCase())) {
      fetchOptions.body = opciones.body;
    }
    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => ({}));
    emitirEventoCarga(false);
    return {
      ok: response.ok && data.ok !== false,
      datos: data.datos || data,
      mensaje: data.mensaje || ''
    };
  } catch (error) {
    emitirEventoCarga(false);
    console.error('Error en llamada API:', error);
    return { ok: false, mensaje: 'No se pudo conectar con el servidor' };
  }
}