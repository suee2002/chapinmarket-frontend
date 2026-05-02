import { llamarApi } from './api.js';

const estadoApp = {
  categorias: [],
  productos: [],
  temporadas: [],
  usuarioActual: null,
  carrito: [],
  vistaActual: 'home',
  parametrosVista: {},
  filtrosProductos: {
    texto: '',
    categoriaId: null,
    temporadaId: null,
    pagina: 1,
    porPagina: 12,
    precioMin: null,
    precioMax: null
  }
};

let costoEnvio = 0;

// Fuerza la ocultación del overlay después de 10 segundos (por si algo falla)
let forceHideTimeout = setTimeout(() => {
  const overlay = document.getElementById('overlay-carga');
  if (overlay && !overlay.classList.contains('hidden')) {
    console.warn('Forzando ocultación del overlay por timeout global');
    overlay.classList.add('hidden');
    const main = document.getElementById('vista-principal');
    if (main && main.innerHTML.trim() === '') {
      main.innerHTML = '<div class="bg-red-100 text-red-700 p-4 rounded">⚠️ El sitio tardó demasiado en responder. Verifica que el backend esté corriendo.</div>';
    }
  }
}, 10000);

document.addEventListener('DOMContentLoaded', async () => {
  // Timeout de seguridad: si el backend no responde en 10 segundos,
  // forzamos la ocultación del overlay y mostramos un mensaje.
  let forceHideTimeout = setTimeout(() => {
    const overlay = document.getElementById('overlay-carga');
    if (overlay && !overlay.classList.contains('hidden')) {
      console.warn('Forzando ocultación del overlay por timeout global');
      overlay.classList.add('hidden');
      const main = document.getElementById('vista-principal');
      if (main && main.innerHTML.trim() === '') {
        main.innerHTML = '<div class="bg-red-100 text-red-700 p-4 rounded">⚠️ El sitio tardó demasiado en responder. Verifica que el backend esté corriendo.</div>';
      }
    }
  }, 10000);

  try {
    document.getElementById('anio-actual').textContent = new Date().getFullYear();

    window.addEventListener('chapinmarket:carga', (e) => {
      const overlay = document.getElementById('overlay-carga');
      if (!overlay) return;
      if (e.detail && e.detail.activo) {
        overlay.classList.remove('hidden');
      } else {
        overlay.classList.add('hidden');
      }
    });

    await cargarDatosIniciales();
    await restaurarSesionDesdeApi();
    await restaurarCarritoDesdeApi();

    // Forzar actualización visual del carrito después de la carga
    setTimeout(() => {
      actualizarIconoCarrito();
      actualizarPanelCarrito();
      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    }, 100);

    configurarEventosGlobales();
    configurarRouter();

    manejarCambioRuta();
    iniciarHeroRotativo();
  } catch (error) {
    console.error('Error crítico en la inicialización:', error);
  } finally {
    clearTimeout(forceHideTimeout);
    const overlay = document.getElementById('overlay-carga');
    if (overlay) overlay.classList.add('hidden');
  }
});

async function cargarDatosIniciales() {
  try {
    // Peticiones individuales con manejo de error por separado
    const respCategorias = await llamarApi('/public/categorias').catch(e => ({ ok: false, datos: [] }));
    const respProductos = await llamarApi('/public/productos').catch(e => ({ ok: false, datos: [] }));
    const respTemporadas = await llamarApi('/public/temporadas').catch(e => ({ ok: false, datos: [] }));

    estadoApp.categorias = respCategorias.ok && Array.isArray(respCategorias.datos.data) ? respCategorias.datos.data : [];
    estadoApp.productos = respProductos.ok && Array.isArray(respProductos.datos.data) ? respProductos.datos.data : [];
    estadoApp.temporadas = respTemporadas.ok && Array.isArray(respTemporadas.datos.data) ? respTemporadas.datos.data : [];

    if (!respCategorias.ok) console.error('Error cargando categorías:', respCategorias.mensaje);
    if (!respProductos.ok) console.error('Error cargando productos:', respProductos.mensaje);
    if (!respTemporadas.ok) console.error('Error cargando temporadas:', respTemporadas.mensaje);

    // Normalizar productos
    estadoApp.productos = estadoApp.productos.map(p => {
      let imagenUrl = p.IMAGENES || p.imagenes || null;
      if (imagenUrl && typeof imagenUrl === 'object') {
        try {
          if (imagenUrl.load) imagenUrl = imagenUrl.load();
          else if (imagenUrl.toString && imagenUrl.toString() !== '[object Object]') imagenUrl = imagenUrl.toString();
          else imagenUrl = null;
        } catch (e) {
          console.error('Error cargando CLOB para producto', p.ID || p.id, e);
          imagenUrl = null;
        }
      }
      if (imagenUrl && typeof imagenUrl === 'string') {
        let cleaned = imagenUrl.trim();
        if (cleaned.startsWith('["') && cleaned.endsWith('"]')) {
          try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed) && parsed.length > 0) imagenUrl = parsed[0];
          } catch (e) { }
        }
      }
      let imagenesArray = [];
      if (imagenUrl && typeof imagenUrl === 'string' && imagenUrl.trim() !== '' && imagenUrl !== 'null' && imagenUrl !== 'undefined') {
        imagenesArray = [imagenUrl.trim()];
      }
      return {
        ...p,
        id: Number(p.ID || p.id),
        nombre: p.NOMBRE || p.nombre || 'Sin nombre',
        descripcion: p.DESCRIPCION || p.descripcion || '',
        precio: p.PRECIO !== undefined ? Number(p.PRECIO) : (p.precio !== undefined ? Number(p.precio) : 0),
        stock: p.STOCK !== undefined ? Number(p.STOCK) : (p.stock !== undefined ? Number(p.stock) : 0),
        imagenes: imagenesArray,
        categoriaIds: p.CATEGORIAIDS || p.categoriaIds || [],
        temporadaIds: p.TEMPORADAIDS || p.temporadaIds || []
      };
    });

    estadoApp.categorias = estadoApp.categorias.map(c => ({
      ...c,
      id: Number(c.ID || c.id),
      nombre: c.NOMBRE || c.nombre || 'Sin nombre',
      padreId: c.PADRE_ID !== undefined && c.PADRE_ID !== null ? Number(c.PADRE_ID) : (c.padreId !== undefined ? Number(c.padreId) : null)
    }));

    estadoApp.temporadas = estadoApp.temporadas.map(t => ({
      ...t,
      id: Number(t.ID || t.id),
      nombre: t.NOMBRE || t.nombre || '',
      fechaInicio: t.FECHA_INICIO || t.fechaInicio || '',
      fechaFin: t.FECHA_FIN || t.fechaFin || '',
      descripcion: t.DESCRIPCION || t.descripcion || ''
    }));

    console.log(`✅ Datos reales del backend | C: ${estadoApp.categorias.length} | P: ${estadoApp.productos.length} | T: ${estadoApp.temporadas.length}`);

    enrichProductosConCategorias();
    construirMegaMenu();

    // Si todas las respuestas fallaron, mostrar mensaje amigable
    if (!respCategorias.ok && !respProductos.ok && !respTemporadas.ok) {
      mostrarModal('Error de conexión', '<p>No se pudo cargar la información del servidor. Verifica que el backend esté funcionando y que la base de datos Oracle esté activa.</p>');
    }
  } catch (error) {
    console.error('Error crítico en cargarDatosIniciales:', error);
    estadoApp.categorias = [];
    estadoApp.productos = [];
    estadoApp.temporadas = [];
    construirMegaMenu();
    mostrarModal('Error crítico', '<p>Ocurrió un error inesperado al cargar los datos. Revisa la consola para más detalles.</p>');
  }
}

async function restaurarSesionDesdeApi() {
  try {
    const resp = await llamarApi('/public/auth/me', { method: 'GET' });
    if (resp.ok && resp.datos) {
      estadoApp.usuarioActual = resp.datos;
      guardarSesionEnLocalStorage();
      actualizarTextoUsuario();
    } else {
      estadoApp.usuarioActual = null;
    }
  } catch (e) {
    estadoApp.usuarioActual = null;
  }
}

function guardarSesionEnLocalStorage() {
  if (estadoApp.usuarioActual) {
    localStorage.setItem('chapinMarket_usuario', JSON.stringify(estadoApp.usuarioActual));
  } else {
    localStorage.removeItem('chapinMarket_usuario');
  }
}

function guardarCarritoLocal() {
  localStorage.setItem('chapinMarket_carrito_local', JSON.stringify(estadoApp.carrito));
}

function cargarCarritoLocal() {
  const guardado = localStorage.getItem('chapinMarket_carrito_local');
  if (guardado) {
    try {
      estadoApp.carrito = JSON.parse(guardado);
    } catch {
      estadoApp.carrito = [];
    }
  }
}

async function restaurarCarritoDesdeApi() {
  cargarCarritoLocal();
  await sincronizarCarritoDesdeApi();
  actualizarIconoCarrito();
  actualizarPanelCarrito();
}

async function sincronizarCarritoDesdeApi() {
  try {
    const resp = await llamarApi('/public/carrito', { method: 'GET' });

    console.log('Respuesta del carrito desde API:', resp);

    let itemsCarrito = null;

    if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
      itemsCarrito = resp.datos.items;
    }
    else if (resp.datos && resp.datos.data && resp.datos.data.items && Array.isArray(resp.datos.data.items)) {
      itemsCarrito = resp.datos.data.items;
    }
    else if (resp.datos && Array.isArray(resp.datos)) {
      itemsCarrito = resp.datos;
    }
    else if (resp.datos && resp.datos.data && Array.isArray(resp.datos.data)) {
      itemsCarrito = resp.datos.data;
    }

    if (itemsCarrito && itemsCarrito.length > 0) {
      estadoApp.carrito = itemsCarrito;
      console.log(`Carrito sincronizado: ${itemsCarrito.length} items`);
    } else if (itemsCarrito && itemsCarrito.length === 0) {
      estadoApp.carrito = [];
      console.log('Carrito sincronizado: vacío');
    } else {
      console.warn('No se pudieron extraer items del carrito, manteniendo estado actual');
    }

    guardarCarritoLocal();
    actualizarIconoCarrito();
    actualizarPanelCarrito();

    if (estadoApp.vistaActual === 'carrito') {
      renderizarVista();
    }
  } catch (e) {
    console.error('Error al sincronizar carrito:', e);
    if (!estadoApp.carrito || estadoApp.carrito.length === 0) {
      estadoApp.carrito = [];
      guardarCarritoLocal();
    }
    actualizarIconoCarrito();
    actualizarPanelCarrito();
  }
}

function configurarRouter() {
  window.addEventListener('hashchange', manejarCambioRuta);
}

function manejarCambioRuta() {
  const hash = window.location.hash || '#/';
  const vista = interpretarHash(hash);
  estadoApp.vistaActual = vista.nombre;
  estadoApp.parametrosVista = vista.parametros;
  renderizarVista();
}

function interpretarHash(hash) {
  const partes = hash.replace('#', '').split('/').filter(Boolean);

  if (partes.length === 0) return { nombre: 'home', parametros: {} };

  if (partes[0] === 'producto' && partes[1]) {
    return { nombre: 'producto', parametros: { id: parseInt(partes[1]) } };
  }

  if (partes[0] === 'categoria' && partes[1]) {
    return { nombre: 'categoria', parametros: { id: parseInt(partes[1]) } };
  }

  if (partes[0] === 'carrito') {
    return { nombre: 'carrito', parametros: {} };
  }

  if (partes[0] === 'checkout') {
    return { nombre: 'checkout', parametros: {} };
  }

  if (partes[0] === 'login') {
    return { nombre: 'login', parametros: {} };
  }

  if (partes[0] === 'registro') {
    return { nombre: 'registro', parametros: {} };
  }

  if (partes[0] === 'perfil') {
    return { nombre: 'perfil', parametros: {} };
  }

  if (partes[0] === 'admin') {
    return { nombre: 'admin', parametros: {} };
  }

  if (partes[0] === 'categorias') {
    return { nombre: 'categorias', parametros: {} };
  }

  if (partes[0] === 'temporadas') {
    return { nombre: 'temporadas', parametros: {} };
  }

  if (partes[0] === 'promociones') {
    return { nombre: 'promociones', parametros: {} };
  }

  return { nombre: 'home', parametros: {} };
}

function renderizarVista() {
  const contenedor = document.getElementById('vista-principal');
  if (!contenedor) return;

  switch (estadoApp.vistaActual) {
    case 'home':
      contenedor.innerHTML = vistaHome();
      configurarEventosVistaHome();
      break;
    case 'producto':
      contenedor.innerHTML = vistaDetalleProducto(estadoApp.parametrosVista.id);
      configurarEventosVistaDetalleProducto();
      break;
    case 'categoria':
      contenedor.innerHTML = vistaCategoria(estadoApp.parametrosVista.id);
      configurarEventosVistaCategoria();
      break;
    case 'carrito':
      contenedor.innerHTML = vistaCarritoCompleto();
      configurarEventosVistaCarritoCompleto();
      break;
    case 'checkout':
      contenedor.innerHTML = vistaCheckout();
      configurarEventosVistaCheckout();
      break;
    case 'login':
      contenedor.innerHTML = vistaLogin();
      configurarEventosVistaLogin();
      break;
    case 'registro':
      contenedor.innerHTML = vistaRegistro();
      configurarEventosVistaRegistro();
      break;
    case 'perfil':
      contenedor.innerHTML = vistaPerfil();
      configurarEventosVistaPerfil();
      break;
    case 'admin':
      contenedor.innerHTML = vistaAdmin();
      configurarEventosVistaAdmin();
      break;
    case 'categorias':
      contenedor.innerHTML = vistaTodasCategorias();
      configurarEventosVistaTodasCategorias();
      break;
    case 'temporadas':
      contenedor.innerHTML = vistaTemporadas();
      configurarEventosVistaTemporadas();
      break;
    case 'promociones':
      contenedor.innerHTML = vistaPromociones();
      configurarEventosVistaPromociones();
      break;
    default:
      contenedor.innerHTML = '<p class="text-sm">Vista no encontrada.</p>';
  }
}

const EMOJIS_CATEGORIA = {};

function obtenerEmojiCategoria(nombreCategoria) {
  const defaultEmojis = ['🧸', '👕', '🏺', '🌮', '🥤', '🏠', '🌿', '🎵', '🎉', '📖'];
  const indice = nombreCategoria.length % defaultEmojis.length;
  return defaultEmojis[indice];
}

function obtenerImagenProducto(producto) {
  if (!producto) return '';

  // Array de posibles campos de imagen a verificar
  const posiblesCampos = [
    'imagen',           // Campo 'imagen' que usamos en el carrito
    'imagenes',         // Campo 'imagenes' (puede ser string o array)
    'IMAGENES',         // Campo en mayúsculas del backend
    'IMAGEN',           // Campo alternativo
    'imagenPrincipal'   // Campo adicional
  ];

  // Función auxiliar para validar si es una URL válida
  const esUrlValida = (url) => {
    if (!url || typeof url !== 'string') return false;
    url = url.trim();
    if (url === '' || url === 'null' || url === 'undefined') return false;
    // Verificar si es una URL válida (http, https, o data:image)
    return (url.startsWith('http') || url.startsWith('data:image') || url.startsWith('/'));
  };

  // Buscar en todos los campos posibles
  for (const campo of posiblesCampos) {
    const valor = producto[campo];
    if (!valor) continue;

    // Si es un string
    if (typeof valor === 'string') {
      const urlLimpia = valor.trim();
      if (esUrlValida(urlLimpia)) {
        // Si parece ser JSON, intentar decodificar
        if (urlLimpia.startsWith('[') || urlLimpia.startsWith('{"')) {
          try {
            const parsed = JSON.parse(urlLimpia);
            if (Array.isArray(parsed) && parsed.length > 0 && esUrlValida(parsed[0])) {
              return parsed[0];
            }
            if (typeof parsed === 'string' && esUrlValida(parsed)) {
              return parsed;
            }
          } catch (e) {
            // No es JSON válido, continuar
          }
        }
        return urlLimpia;
      }
    }

    // Si es un array
    if (Array.isArray(valor) && valor.length > 0) {
      const primeraImagen = valor[0];
      if (typeof primeraImagen === 'string' && esUrlValida(primeraImagen)) {
        return primeraImagen;
      }
    }

    // Si es un objeto (caso CLOB de Oracle)
    if (typeof valor === 'object' && valor !== null) {
      if (valor.load && typeof valor.load === 'function') {
        try {
          const contenido = valor.load();
          if (typeof contenido === 'string' && esUrlValida(contenido)) {
            return contenido;
          }
        } catch (e) {
          console.error('Error cargando CLOB:', e);
        }
      }
    }
  }

  // Si no se encontró ninguna imagen válida, retornar imagen por defecto
  return 'https://via.placeholder.com/300x300?text=Sin+Imagen';
}

const ESTRUCTURA_CATEGORIAS = {};

function enrichProductosConCategorias() {
  estadoApp.productos.forEach(producto => {
    if (!producto.categoriaIds) producto.categoriaIds = [];
    if (!producto.temporadaIds) producto.temporadaIds = [];
  });
}

function obtenerDescendientesCategoria(idPadre) {
  const visitados = new Set();
  const cola = [idPadre];
  const descendientes = [];

  while (cola.length > 0) {
    const actual = cola.shift();
    if (visitados.has(actual)) continue;
    visitados.add(actual);
    descendientes.push(actual);

    const hijos = obtenerHijosCategoria(actual);
    for (const hijo of hijos) {
      if (!visitados.has(hijo.id)) {
        cola.push(hijo.id);
      }
    }
  }
  return descendientes;
}

function vistaCategoria(idCategoria) {
  const cat = estadoApp.categorias.find(c => c.id === idCategoria);
  if (!cat) return `<p class="text-sm text-red-500">Categoría no encontrada.</p>`;

  const idsDescendientes = obtenerDescendientesCategoria(idCategoria);
  const productosFiltrados = estadoApp.productos.filter(p =>
    p.categoriaIds && p.categoriaIds.some(cid => idsDescendientes.includes(cid))
  );

  return `
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">${cat.nombre}</h1>
        <span class="text-xs bg-chapinAzul text-white px-3 py-1 rounded-full">${productosFiltrados.length} productos</span>
      </div>
      <div id="contenedor-grid-categoria">
        ${gridProductos(productosFiltrados, {
    mostrarPaginacion: true,
    pagina: estadoApp.filtrosProductos.pagina,
    porPagina: 12
  })}
      </div>
    </section>
  `;
}

function configurarEventosVistaCategoria() {
  configurarEventosGridProductos('#contenedor-grid-categoria', estadoApp.productos);
  configurarEventosBotonesAgregarCarrito();
}

function construirMegaMenu() {
  const col1 = document.getElementById('mega-menu-columna-1');
  const col2 = document.getElementById('mega-menu-columna-2');
  const col3 = document.getElementById('mega-menu-columna-3');
  if (!col1 || !col2 || !col3) return;

  const raiz = estadoApp.categorias.filter(c => c.padreId === null);
  const columnas = [col1, col2, col3];
  columnas.forEach(c => c.innerHTML = '');

  raiz.forEach((cat, indice) => {
    const columna = columnas[indice % 3];
    const hijos = estadoApp.categorias.filter(c => c.padreId === cat.id);

    const emoji = obtenerEmojiCategoria(cat.nombre);

    const div = document.createElement('div');
    div.innerHTML = `
      <h4 class="font-semibold text-chapinAzul text-sm mb-1 cursor-pointer hover:text-chapinNaranja" data-id-cat="${cat.id}">
        ${emoji} ${cat.nombre}
      </h4>
      <ul class="space-y-0.5 text-xs">
        ${hijos.map(hijo => `
          <li class="cursor-pointer text-slate-600 hover:text-chapinNaranja py-0.5" data-id-cat="${hijo.id}">
            ${hijo.nombre}
          </li>`).join('')}
      </ul>
    `;
    columna.appendChild(div);
  });

  columnas.forEach(columna => {
    columna.addEventListener('click', (e) => {
      const elem = e.target.closest('[data-id-cat]');
      if (elem) {
        const idCat = parseInt(elem.getAttribute('data-id-cat'));
        window.location.hash = `#/categoria/${idCat}`;
      }
    });
  });
}

function obtenerHijosCategoria(idPadre) {
  return estadoApp.categorias.filter((c) => c.padreId === idPadre);
}

function vistaHome() {
  const productosRecomendados = estadoApp.productos.slice(0, 8);
  const temporadasActivas = estadoApp.temporadas;
  const categoriasDestacadas = estadoApp.categorias.filter((c) => c.padreId === null).slice(0, 6);

  return `
    <section class="space-y-6">
      <div class="relative rounded-xl overflow-hidden bg-gradient-to-r from-chapinAzul to-chapinAzulClaro text-white p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-4">
        <div class="flex-1">
          <div id="hero-mensaje-1" class="hero-mensaje">
            <h2 class="text-xl sm:text-2xl font-bold mb-1">Envíos a toda Guatemala</h2>
            <p class="text-sm text-white/80">Compra en ChapínMarket y recibe en la puerta de tu casa.</p>
          </div>
          <div id="hero-mensaje-2" class="hero-mensaje hidden">
            <h2 class="text-xl sm:text-2xl font-bold mb-1">Promociones de fiestas patrias</h2>
            <p class="text-sm text-white/80">Aprovecha descuentos en productos con sabor chapín.</p>
          </div>
          <div id="hero-mensaje-3" class="hero-mensaje hidden">
            <h2 class="text-xl sm:text-2xl font-bold mb-1">Tecnología para estudiar</h2>
            <p class="text-sm text-white/80">Laptops, tablets y más para el regreso a clases.</p>
          </div>
        </div>
        <div class="w-28 h-28 sm:w-40 sm:h-40 bg-white/10 rounded-full flex items-center justify-center text-4xl">
          🛍️
        </div>
      </div>

      <section>
        <h3 class="font-semibold text-base mb-2">Categorías destacadas</h3>
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
          ${categoriasDestacadas.map((cat) => {
    const emoji = obtenerEmojiCategoria(cat.nombre);
    return `
              <button class="bg-white rounded-lg shadow-sm px-2 py-3 flex flex-col items-center justify-center hover:shadow-md"
                      data-ir-categoria="${cat.id}">
                <div class="text-2xl mb-1">${emoji}</div>
                <span class="text-center">${cat.nombre}</span>
              </button>`;
  }).join('')}
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-base">Temporadas y promociones</h3>
          <button id="boton-ver-todas-temporadas" class="text-xs text-chapinAzul hover:text-chapinNaranja">Ver todas</button>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-1 text-xs">
          ${temporadasActivas.map((t) => `
            <div class="min-w-[180px] bg-white rounded-lg shadow-sm px-3 py-2 border border-chapinNaranja/30">
              <div class="flex items-center justify-between mb-1">
                <span class="font-semibold text-chapinAzul">${t.nombre}</span>
                <span class="text-[10px] bg-chapinNaranja text-white rounded-full px-2 py-0.5">Promoción</span>
              </div>
              <p class="text-slate-600 line-clamp-2 mb-1">${t.descripcion}</p>
              <p class="text-[11px] text-slate-500">Del ${t.fechaInicio} al ${t.fechaFin}</p>
            </div>`
  ).join('')}
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-base">Productos recomendados</h3>
          <button id="boton-ir-productos-home" class="text-xs text-chapinAzul hover:text-chapinNaranja">Ver más productos</button>
        </div>
        ${gridProductos(productosRecomendados)}
      </section>
    </section>
  `;
}

function configurarEventosVistaHome() {
  document.querySelectorAll('[data-ir-categoria]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.irCategoria);
      window.location.hash = `#/categoria/${id}`;
    });
  });

  const btnVerTodasTemporadas = document.getElementById('boton-ver-todas-temporadas');
  if (btnVerTodasTemporadas) {
    btnVerTodasTemporadas.addEventListener('click', () => {
      window.location.hash = '#/temporadas';
    });
  }

  const btnIrProductos = document.getElementById('boton-ir-productos-home');
  if (btnIrProductos) {
    btnIrProductos.addEventListener('click', () => {
      window.location.hash = '#/categorias';
    });
  }

  configurarEventosBotonesAgregarCarrito();
}

function gridProductos(listaProductos, opciones = {}) {
  const mostrarPaginacion = !!opciones.mostrarPaginacion;
  const pagina = opciones.pagina || 1;
  const porPagina = opciones.porPagina || 12;

  let productosPagina = listaProductos;
  let totalPaginas = 1;

  if (mostrarPaginacion) {
    const inicio = (pagina - 1) * porPagina;
    productosPagina = listaProductos.slice(inicio, inicio + porPagina);
    totalPaginas = Math.max(1, Math.ceil(listaProductos.length / porPagina));
  }

  return `
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
      ${productosPagina.map((p) => {
    const precio = p.precio !== undefined && p.precio !== null ? Number(p.precio) : 0;
    const precioFormateado = precio.toFixed(2);
    const promo = p.temporadaIds && Array.isArray(p.temporadaIds) && p.temporadaIds.length > 0;
    const img = obtenerImagenProducto(p);

    return `
          <div class="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
            <button data-ver-producto="${p.id}" class="relative w-full pb-[100%] overflow-hidden">
              <img src="${img}" alt="${p.nombre || 'Producto'}" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'" />
              ${promo ? '<span class="absolute top-1 left-1 bg-chapinNaranja text-white text-[10px] px-2 py-0.5 rounded-full">Promoción</span>' : ''}
            </button>
            <div class="p-2 flex-1 flex flex-col">
              <button data-ver-producto="${p.id}" class="text-[11px] font-medium line-clamp-2 text-left mb-1 hover:text-chapinNaranja">
                ${p.nombre || 'Producto sin nombre'}
              </button>
              <div class="text-chapinAzul font-semibold mb-1">Q${precioFormateado}</div>
              <button data-agregar-carrito="${p.id}" class="mt-auto bg-chapinAzul text-white rounded-full py-1 text-[11px] hover:bg-chapinAzulClaro">
                Agregar al carrito
              </button>
            </div>
          </div>`;
  }).join('')}
    </div>
    ${mostrarPaginacion ? `
      <div class="flex items-center justify-center gap-2 mt-3 text-xs">
        <button class="px-2 py-1 border rounded-full ${pagina <= 1 ? 'opacity-40 cursor-default' : 'hover:bg-slate-100'}"
                data-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>
          ◀
        </button>
        <span>Página ${pagina} de ${totalPaginas}</span>
        <button class="px-2 py-1 border rounded-full ${pagina >= totalPaginas ? 'opacity-40 cursor-default' : 'hover:bg-slate-100'}"
                data-pagina="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''}>
          ▶
        </button>
      </div>` : ''
    }
  `;
}

function configurarEventosGridProductos(contenedorSelector, listaCompleta) {
  const contenedor = document.querySelector(contenedorSelector);
  if (!contenedor) return;

  contenedor.addEventListener('click', (evento) => {
    const btnVer = evento.target.closest('[data-ver-producto]');
    if (btnVer) {
      const id = parseInt(btnVer.dataset.verProducto);
      window.location.hash = `#/producto/${id}`;
      return;
    }

    const btnAgregar = evento.target.closest('[data-agregar-carrito]');
    if (btnAgregar) {
      const id = parseInt(btnAgregar.dataset.agregarCarrito);
      agregarAlCarrito(id, 1);
      return;
    }

    const btnPagina = evento.target.closest('[data-pagina]');
    if (btnPagina && listaCompleta) {
      const nuevaPagina = parseInt(btnPagina.dataset.pagina);
      if (nuevaPagina < 1) return;
      estadoApp.filtrosProductos.pagina = nuevaPagina;
      renderizarVista();
    }
  });
}

function configurarEventosBotonesAgregarCarrito() {
  document.querySelectorAll('[data-agregar-carrito]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.agregarCarrito);
      agregarAlCarrito(id, 1);
    });
  });

  document.querySelectorAll('[data-ver-producto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.verProducto);
      window.location.hash = `#/producto/${id}`;
    });
  });
}

function vistaDetalleProducto(idProducto) {
  const producto = estadoApp.productos.find((p) => p.id === idProducto);
  if (!producto) {
    return `<p class="text-sm">Producto no encontrado.</p>`;
  }

  const promo = producto.temporadaIds && producto.temporadaIds.length > 0;
  const temporadaNombre = promo && producto.temporadaIds.length
    ? (estadoApp.temporadas.find((t) => t.id === producto.temporadaIds[0]) || {}).nombre
    : null;

  let imagenes = [];
  if (producto.imagenes && Array.isArray(producto.imagenes) && producto.imagenes.length > 0) {
    imagenes = producto.imagenes;
  } else if (producto.imagenes && typeof producto.imagenes === 'string' && producto.imagenes.trim() !== '') {
    imagenes = [producto.imagenes];
  } else if (producto.IMAGENES && typeof producto.IMAGENES === 'string' && producto.IMAGENES.trim() !== '') {
    imagenes = [producto.IMAGENES];
  } else {
    imagenes = [];
  }

  const tieneImagenes = imagenes.length > 0 && imagenes[0];
  const imagenPrincipal = tieneImagenes ? imagenes[0] : '';

  return `
    <section class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <div class="relative w-full pb-[100%] bg-white rounded-lg overflow-hidden shadow-sm mb-2">
          <img id="detalle-imagen-principal" src="${imagenPrincipal}" alt="${producto.nombre}" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'" />
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1">
          ${imagenes.map((img, indice) => `
            <button data-miniatura-index="${indice}" class="relative w-16 h-16 rounded-md overflow-hidden border ${indice === 0 ? 'border-chapinNaranja' : 'border-transparent'}">
              <img src="${img}" alt="Imagen ${indice + 1}" class="w-full h-full object-cover" />
            </button>`
  ).join('')}
        </div>
      </div>
      <div class="space-y-3 text-sm">
        <h1 class="text-base sm:text-lg font-semibold">${producto.nombre}</h1>
        <div class="flex items-center gap-2">
          <div class="text-2xl font-bold text-chapinAzul">Q${producto.precio.toFixed(2)}</div>
          ${promo ? `<span class="text-xs bg-chapinNaranja text-white px-2 py-0.5 rounded-full">Promoción ${temporadaNombre ? ' - ' + temporadaNombre : ''}</span>` : ''}
        </div>
        <p class="text-slate-700">${producto.descripcion}</p>
        <p class="text-xs text-slate-500">Stock disponible: ${producto.stock}</p>
        <div class="flex items-center gap-2">
          <label class="text-xs" for="detalle-cantidad">Cantidad:</label>
          <input id="detalle-cantidad" type="number" min="1" max="${producto.stock}" value="1"
                 class="w-20 border rounded-md px-2 py-1 text-xs" />
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          <button id="detalle-agregar-carrito" data-id-producto="${producto.id}" class="flex-1 bg-chapinAzul text-white py-2 rounded-full text-xs sm:text-sm font-semibold hover:bg-chapinAzulClaro">
            Agregar al carrito
          </button>
          <button id="detalle-comprar-ahora" data-id-producto="${producto.id}" class="flex-1 bg-chapinNaranja text-white py-2 rounded-full text-xs sm:text-sm font-semibold hover:bg-orange-500">
            Comprar ahora
          </button>
        </div>
      </div>
    </section>
  `;
}

function configurarEventosVistaDetalleProducto() {
  const miniaturas = document.querySelectorAll('[data-miniatura-index]');
  const imagenPrincipal = document.getElementById('detalle-imagen-principal');
  const btnAgregarElem = document.getElementById('detalle-agregar-carrito');
  if (!btnAgregarElem) return;
  const productoId = parseInt(btnAgregarElem.dataset.idProducto);
  const producto = estadoApp.productos.find((p) => p.id === productoId);
  if (!producto) return;

  miniaturas.forEach((btn) => {
    btn.addEventListener('click', () => {
      const indice = parseInt(btn.dataset.miniaturaIndex);
      if (producto.imagenes[indice]) {
        imagenPrincipal.src = producto.imagenes[indice];
      }
      miniaturas.forEach((b) => b.classList.remove('border-chapinNaranja'));
      btn.classList.add('border-chapinNaranja');
    });
  });

  const btnAgregar = document.getElementById('detalle-agregar-carrito');
  const inputCantidad = document.getElementById('detalle-cantidad');
  if (btnAgregar && inputCantidad) {
    btnAgregar.addEventListener('click', () => {
      const cantidad = Math.max(1, parseInt(inputCantidad.value) || 1);
      agregarAlCarrito(productoId, cantidad);
    });
  }

  const btnComprarAhora = document.getElementById('detalle-comprar-ahora');
  if (btnComprarAhora && inputCantidad) {
    btnComprarAhora.addEventListener('click', () => {
      const cantidad = Math.max(1, parseInt(inputCantidad.value) || 1);
      agregarAlCarrito(productoId, cantidad).then(() => {
        window.location.hash = '#/checkout';
      });
    });
  }
}

function vistaPromociones() {
  const productosPromo = estadoApp.productos.filter(p => p.temporadaIds && p.temporadaIds.length > 0);
  return `
    <section class="space-y-6">
      <h1 class="text-xl font-bold">Promociones Activas</h1>
      <div class="bg-orange-100 p-4 rounded-lg text-center">
        <p class="font-semibold">¡Ofertas especiales de temporada!</p>
      </div>
      ${gridProductos(productosPromo)}
    </section>
  `;
}

function configurarEventosVistaPromociones() {
  configurarEventosBotonesAgregarCarrito();
}

// Función EN app.js - NO REQUIERE CAMBIOS para la solicitud actual
function vistaCarritoCompleto() {
  // ... código existente hasta la parte de generar filas ...
  let itemsValidos = 0;
  let totalGeneral = 0;
  let subtotalSeleccionados = 0;

  if (!estadoApp.carrito || estadoApp.carrito.length === 0) {
    return `
      <div class="text-center py-12">
        <p class="text-slate-500 text-sm">Tu carrito está vacío. ¡Agrega productos para continuar!</p>
        <button onclick="window.location.hash='#/categorias'" class="mt-3 bg-chapinAzul text-white px-6 py-2 rounded-full text-sm">
          Ver productos
        </button>
      </div>
    `;
  }

  const filas = estadoApp.carrito
    .map((item) => {
      const producto = item.producto;
      if (!producto) return '';
      itemsValidos++;
      const subtotalProducto = producto.precio * item.cantidad;
      totalGeneral += subtotalProducto;
      if (item.seleccionado) subtotalSeleccionados += subtotalProducto;

      // OBTENER LA IMAGEN CORRECTAMENTE
      let imagenUrl = '';

      // Priorizar product.imagen (que es la que seteamos en el backend)
      if (producto.imagen && typeof producto.imagen === 'string' && producto.imagen.trim() !== '') {
        imagenUrl = producto.imagen.trim();
      }
      // Si no, buscar en imagenes[0]
      else if (producto.imagenes && Array.isArray(producto.imagenes) && producto.imagenes.length > 0) {
        imagenUrl = producto.imagenes[0];
      }
      // Si no, usar la función obtenerImagenProducto
      else {
        imagenUrl = obtenerImagenProducto(producto);
      }

      // Validar que la imagen sea válida
      const tieneImagenValida = imagenUrl &&
        imagenUrl !== '' &&
        imagenUrl !== 'null' &&
        imagenUrl !== 'undefined' &&
        (imagenUrl.startsWith('http') || imagenUrl.startsWith('data:') || imagenUrl.startsWith('/'));

      return `
                <div class="flex gap-3 bg-white rounded-lg p-3 shadow-sm border border-slate-100" data-producto-id="${item.productoId}">
                    <input type="checkbox" data-carrito-seleccion="${item.productoId}" class="mt-4 w-4 h-4" ${item.seleccionado ? 'checked' : ''} />
                    <div class="w-20 h-20 rounded-md overflow-hidden flex-shrink-0 bg-slate-100 flex items-center justify-center">
                        ${tieneImagenValida ?
          `<img src="${imagenUrl}" alt="${producto.nombre}" class="w-full h-full object-cover" 
                                  onerror="this.onerror=null; this.src='https://via.placeholder.com/300x300?text=Sin+Imagen';" />` :
          `<div class="w-full h-full flex items-center justify-center text-slate-400 text-2xl">📷</div>`
        }
                    </div>
                    <div class="flex-1">
                        <button data-ver-producto="${producto.id}" class="font-medium text-sm hover:text-chapinNaranja text-left">
                            ${producto.nombre}
                        </button>
                        <div class="text-chapinAzul font-bold my-1">Q${producto.precio.toFixed(2)}</div>
                        <div class="flex items-center gap-2 mt-2">
                            <button data-carrito-decrementar="${item.productoId}" 
                                    class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 hover:bg-chapinAzul hover:text-white transition"
                                    ${item.cantidad <= 1 ? 'disabled' : ''}>-</button>
                            <input type="number" value="${item.cantidad}" min="1" max="${producto.stock}"
                                   data-carrito-cantidad="${item.productoId}" class="w-12 text-center border rounded-md text-sm" />
                            <button data-carrito-incrementar="${item.productoId}"
                                    class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 hover:bg-chapinAzul hover:text-white transition"
                                    ${item.cantidad >= producto.stock ? 'disabled' : ''}>+</button>
                            <button data-carrito-eliminar="${item.productoId}" 
                                    class="ml-auto text-red-500 hover:text-red-700 text-xs">🗑️ Eliminar</button>
                        </div>
                    </div>
                    <div class="text-right font-semibold text-chapinAzul whitespace-nowrap" id="subtotal-producto-${item.productoId}">
                        Q${subtotalProducto.toFixed(2)}
                    </div>
                </div>
            `;
    })
    .filter(row => row !== '')
    .join('');

  const envio = 25; // Costo fijo de envío
  const totalSeleccionadosConEnvio = subtotalSeleccionados + (subtotalSeleccionados > 0 ? envio : 0);

  return `
    <div class="space-y-4">
      <h1 class="text-xl font-bold">Mi Carrito</h1>
      
      <div class="bg-white rounded-lg shadow-sm overflow-hidden">
        <div class="hidden md:grid grid-cols-[40px,80px,1fr,auto] gap-3 p-3 bg-chapinAzul text-white text-xs font-medium">
          <div></div>
          <div>Producto</div>
          <div>Descripción</div>
          <div>Subtotal</div>
        </div>
        
        <div class="divide-y divide-slate-100">
          ${filas}
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow-sm p-4 space-y-3">
        <div class="flex justify-between text-sm">
          <span>Subtotal (${itemsValidos} productos):</span>
          <span id="total-productos" class="font-semibold">${itemsValidos}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span>Subtotal seleccionados:</span>
          <span id="subtotal-seleccionado" class="font-semibold text-chapinAzul">Q${subtotalSeleccionados.toFixed(2)}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span>Envío (zona metropolitana):</span>
          <span class="text-chapinNaranja">Q${envio.toFixed(2)}</span>
        </div>
        <div class="flex justify-between text-lg font-bold border-t pt-2">
          <span>Total a pagar:</span>
          <span id="total-general-carrito" class="text-chapinAzul">Q${totalSeleccionadosConEnvio.toFixed(2)}</span>
        </div>
        
        <div class="flex flex-col sm:flex-row gap-3 pt-2">
          <button id="carrito-vaciar-seleccionados" class="flex-1 border border-red-300 text-red-600 py-2 rounded-full text-sm hover:bg-red-50">
            Vaciar seleccionados
          </button>
          <button id="carrito-vaciar-todo" class="flex-1 border border-red-300 text-red-600 py-2 rounded-full text-sm hover:bg-red-50">
            Vaciar todo
          </button>
          <button id="carrito-ir-pagar" class="flex-1 bg-chapinNaranja text-white py-2 rounded-full text-sm font-semibold hover:bg-orange-500">
            Proceder al pago
          </button>
        </div>
      </div>
    </div>
  `;
}

function actualizarValoresCarritoEnTiempoReal() {
  if (!estadoApp.carrito || !estadoApp.carrito.length) return;

  let subtotalSeleccionados = 0;
  let totalGeneral = 0;
  let itemsValidos = 0;

  estadoApp.carrito.forEach((item) => {
    const producto = item.producto;
    if (!producto) return;
    itemsValidos++;
    const subtotalProducto = producto.precio * item.cantidad;
    totalGeneral += subtotalProducto;
    if (item.seleccionado) subtotalSeleccionados += subtotalProducto;

    const subtotalElem = document.getElementById(`subtotal-producto-${item.productoId}`);
    if (subtotalElem) {
      subtotalElem.textContent = `Q${subtotalProducto.toFixed(2)}`;
    }
  });

  const totalProductosElem = document.getElementById('total-productos');
  const subtotalSeleccionadoElem = document.getElementById('subtotal-seleccionado');
  const totalGeneralElem = document.getElementById('total-general-carrito');

  if (totalProductosElem) totalProductosElem.textContent = itemsValidos;
  if (subtotalSeleccionadoElem) subtotalSeleccionadoElem.textContent = `Q${subtotalSeleccionados.toFixed(2)}`;
  if (totalGeneralElem) totalGeneralElem.textContent = `Q${totalGeneral.toFixed(2)}`;
}

function vistaCheckout() {
  const productosSeleccionados = estadoApp.carrito.filter(item => item.seleccionado);

  const subtotal = productosSeleccionados.reduce((sum, item) => {
    const prod = estadoApp.productos.find(p => p.id === item.productoId);
    return sum + (prod ? prod.precio * item.cantidad : 0);
  }, 0);

  const envio = 25;
  const total = subtotal + envio;

  const direccion = estadoApp.usuarioActual ? estadoApp.usuarioActual.direccion : '';

  return `
    <section class="max-w-2xl mx-auto space-y-6">
      <h1 class="text-xl font-bold">Finalizar compra</h1>
      
      <div class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-3">Productos a pagar</h2>
        ${productosSeleccionados.map(item => {
    const prod = estadoApp.productos.find(p => p.id === item.productoId);
    return prod ? `
            <div class="flex gap-3 py-3 border-b">
              <img src="${prod.imagenes && prod.imagenes[0] ? prod.imagenes[0] : ''}" class="w-16 h-16 object-cover rounded" onerror="this.style.display='none'" />
              <div class="flex-1">
                <p class="font-medium">${prod.nombre}</p>
                <p class="text-xs text-slate-500">Cant: ${item.cantidad} × Q${prod.precio.toFixed(2)}</p>
              </div>
              <p class="font-semibold">Q${(prod.precio * item.cantidad).toFixed(2)}</p>
            </div>
          ` : '';
  }).join('')}
        
        <div class="mt-4 space-y-1 text-sm">
          <div class="flex justify-between">
            <span>Subtotal</span>
            <span>Q${subtotal.toFixed(2)}</span>
          </div>
          <div class="flex justify-between border-t pt-2">
            <span>Envío</span>
            <span class="text-chapinNaranja">Q${envio.toFixed(2)}</span>
          </div>
          <div class="flex justify-between font-bold text-lg border-t pt-2">
            <span>Total a pagar</span>
            <span class="text-chapinAzul">Q${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-2">Dirección de envío</h2>
        <input id="direccion-envio" type="text" value="${direccion}" 
               class="w-full border rounded-md px-3 py-2" placeholder="Ingresa tu dirección" />
      </div>

      <div class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-3">Método de pago</h2>
        <select id="select-tarjeta" class="w-full border rounded-md px-3 py-2 mb-3">
          <option value="">Seleccionar tarjeta guardada</option>
          ${estadoApp.usuarioActual && estadoApp.usuarioActual.tarjetas ?
      estadoApp.usuarioActual.tarjetas.map(t =>
        `<option value="${t.id}">VISA **** ${t.numeroEnmascarado.slice(-4)} - ${t.vencimiento}</option>`
      ).join('') : ''}
          <option value="nueva">Nueva tarjeta</option>
        </select>
        <div id="form-nueva-tarjeta" class="hidden space-y-3">
          <input id="nueva-titular" placeholder="Titular" class="w-full border rounded-md px-3 py-2" />
          <input id="nueva-numero" placeholder="Número de tarjeta" class="w-full border rounded-md px-3 py-2" />
          <div class="grid grid-cols-2 gap-3">
            <input id="nueva-vencimiento" placeholder="MM/AA" class="border rounded-md px-3 py-2" />
            <input id="nueva-cvv" placeholder="CVV" class="border rounded-md px-3 py-2" />
          </div>
        </div>
      </div>

      <button id="btn-procesar-pago" 
              class="w-full bg-chapinNaranja text-white font-bold py-4 rounded-full text-lg">
        Procesar Pago
      </button>
    </section>
  `;
}

function configurarEventosVistaCheckout() {
  const btnPago = document.getElementById('btn-procesar-pago');
  if (!btnPago) return;

  btnPago.addEventListener('click', async () => {
    const subtotal = estadoApp.carrito
      .filter(item => item.seleccionado)
      .reduce((sum, item) => {
        const prod = estadoApp.productos.find(p => p.id === item.productoId);
        return sum + (prod ? prod.precio * item.cantidad : 0);
      }, 0);

    const envio = 25;
    const total = subtotal + envio;

    const resp = await llamarApi('/public/pago', {
      method: 'POST',
      body: JSON.stringify({
        monto: total,
        tarjeta: { numero: "4111111111111111" }
      })
    });

    if (resp.ok && resp.datos.estado === 'Autorizado') {
      const facturaHTML = construirFacturaMock(
        resp.datos,
        estadoApp.carrito.filter(i => i.seleccionado),
        subtotal,
        envio,
        total,
        document.getElementById('direccion-envio').value || 'Guatemala'
      );

      mostrarModal('¡Compra exitosa! 🎉', facturaHTML);

      estadoApp.carrito = estadoApp.carrito.filter(item => !item.seleccionado);
      guardarCarritoLocal();
      actualizarIconoCarrito();
      window.location.hash = '#/';
    } else {
      mostrarModal('Pago denegado', `
        <p class="text-red-600 font-bold">Transacción rechazada</p>
        <p>${resp.datos.mensaje || 'Intenta con otra tarjeta'}</p>
      `);
    }
  });

  const selectTarjeta = document.getElementById('select-tarjeta');
  const formNueva = document.getElementById('form-nueva-tarjeta');
  if (selectTarjeta && formNueva) {
    selectTarjeta.addEventListener('change', () => {
      formNueva.classList.toggle('hidden', selectTarjeta.value !== 'nueva');
    });
  }
}

function configurarEventosVistaCarritoCompleto() {
  const contenedor = document.getElementById('vista-principal');
  if (!contenedor) return;

  contenedor.addEventListener('change', async (evento) => {
    const inputCantidad = evento.target.closest('[data-carrito-cantidad]');
    if (inputCantidad) {
      const productoId = parseInt(inputCantidad.dataset.carritoCantidad);
      let cantidad = parseInt(inputCantidad.value) || 1;
      const producto = estadoApp.productos.find(p => p.id === productoId);
      if (producto && cantidad > producto.stock) {
        cantidad = producto.stock;
        inputCantidad.value = cantidad;
        mostrarModal('Stock limitado', `<p class="text-sm">Solo tenemos ${producto.stock} unidades disponibles.</p>`);
      }
      cantidad = Math.max(1, cantidad);
      await actualizarCantidadCarrito(productoId, cantidad);
      actualizarValoresCarritoEnTiempoReal();
      return;
    }

    const inputSel = evento.target.closest('[data-carrito-seleccion]');
    if (inputSel) {
      const productoId = parseInt(inputSel.dataset.carritoSeleccion);
      const seleccionado = inputSel.checked;
      await actualizarSeleccionCarrito(productoId, seleccionado);
      actualizarValoresCarritoEnTiempoReal();
      return;
    }
  });

  contenedor.addEventListener('click', async (evento) => {
    const btnDecrementar = evento.target.closest('[data-carrito-decrementar]');
    if (btnDecrementar && !btnDecrementar.disabled) {
      const productoId = parseInt(btnDecrementar.dataset.carritoDecrementar);
      const item = estadoApp.carrito.find(i => i.productoId === productoId);
      if (item && item.cantidad > 1) {
        await decrementarCantidadCarrito(productoId);
        actualizarValoresCarritoEnTiempoReal();
      }
      return;
    }

    const btnIncrementar = evento.target.closest('[data-carrito-incrementar]');
    if (btnIncrementar) {
      const productoId = parseInt(btnIncrementar.dataset.carritoIncrementar);
      const item = estadoApp.carrito.find(i => i.productoId === productoId);
      const producto = estadoApp.productos.find(p => p.id === productoId);
      if (item && producto && item.cantidad < producto.stock) {
        const nuevaCantidad = item.cantidad + 1;
        await actualizarCantidadCarrito(productoId, nuevaCantidad);
        actualizarValoresCarritoEnTiempoReal();
      } else if (producto && item && item.cantidad >= producto.stock) {
        mostrarModal('Stock limitado', `<p class="text-sm">No hay más stock disponible de este producto.</p>`);
      }
      return;
    }

    const btnEliminar = evento.target.closest('[data-carrito-eliminar]');
    if (btnEliminar) {
      const productoId = parseInt(btnEliminar.dataset.carritoEliminar);
      await eliminarDelCarrito(productoId);
      return;
    }

    const btnEliminarTodo = evento.target.closest('[data-carrito-eliminar-todo]');
    if (btnEliminarTodo) {
      const productoId = parseInt(btnEliminarTodo.dataset.carritoEliminarTodo);
      await eliminarDelCarrito(productoId);
      return;
    }

    const btnVer = evento.target.closest('[data-ver-producto]');
    if (btnVer) {
      const id = parseInt(btnVer.dataset.verProducto);
      window.location.hash = `#/producto/${id}`;
      return;
    }
  });

  const btnVaciarSel = document.getElementById('carrito-vaciar-seleccionados');
  const btnVaciarTodo = document.getElementById('carrito-vaciar-todo');
  const btnIrPagar = document.getElementById('carrito-ir-pagar');

  if (btnVaciarSel) {
    btnVaciarSel.addEventListener('click', async () => {
      const resp = await llamarApi('/public/carrito', {
        method: 'DELETE',
        body: JSON.stringify({
          usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
          soloSeleccionados: true
        })
      });

      if (resp.ok) {
        let nuevosItems = null;
        if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
          nuevosItems = resp.datos.items;
        } else if (resp.datos && Array.isArray(resp.datos)) {
          nuevosItems = resp.datos;
        }

        if (nuevosItems) {
          estadoApp.carrito = nuevosItems;
        } else {
          estadoApp.carrito = [];
        }

        guardarCarritoLocal();
        actualizarIconoCarrito();
        actualizarPanelCarrito();
        renderizarVista();
      } else {
        mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo eliminar'}</p>`);
      }
    });
  }

  if (btnVaciarTodo) {
    btnVaciarTodo.addEventListener('click', async () => {
      const resp = await llamarApi('/public/carrito', {
        method: 'DELETE',
        body: JSON.stringify({
          usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null
        })
      });

      if (resp.ok) {
        estadoApp.carrito = [];
        guardarCarritoLocal();
        actualizarIconoCarrito();
        actualizarPanelCarrito();
        renderizarVista();
      } else {
        mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo vaciar el carrito'}</p>`);
      }
    });
  }

  if (btnIrPagar) {
    btnIrPagar.addEventListener('click', () => {
      window.location.hash = '#/checkout';
    });
  }
}

function construirFacturaMock(datosPago, itemsSeleccionados, subtotal, envio, total, direccion) {
  const productosPorId = new Map(estadoApp.productos.map((p) => [p.id, p]));

  const filas = itemsSeleccionados
    .map((item) => {
      const producto = productosPorId.get(item.productoId);
      if (!producto) return '';
      const totalItem = producto.precio * item.cantidad;
      return `
        <tr class="text-xs">
          <td class="border px-2 py-1">${producto.nombre}</td>
          <td class="border px-2 py-1 text-center">${item.cantidad}</td>
          <td class="border px-2 py-1 text-right">Q${producto.precio.toFixed(2)}</td>
          <td class="border px-2 py-1 text-right">Q${totalItem.toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');

  const numeroOrden = 'CHM-' + Math.floor(Math.random() * 900000 + 100000);

  return `
    <div class="text-xs space-y-2">
      <p class="text-sm font-semibold text-chapinAzul mb-1">Factura de compra ChapínMarket 🇬🇹</p>
      <p>Número de orden: <span class="font-mono">${numeroOrden}</span></p>
      <p>Código de autorización: <span class="font-mono">${datosPago.codigoAutorizacion}</span></p>
      <p>Fecha: ${new Date(datosPago.fecha).toLocaleString('es-GT')}</p>
      <p>Cliente: ${estadoApp.usuarioActual ? estadoApp.usuarioActual.nombre : 'Cliente invitado'}</p>
      <p>Dirección de envío: ${direccion}</p>
      <table class="w-full border-collapse mt-2">
        <thead>
          <tr class="bg-slate-100 text-[11px]">
            <th class="border px-2 py-1 text-left">Producto</th>
            <th class="border px-2 py-1 text-center">Cant.</th>
            <th class="border px-2 py-1 text-right">Precio</th>
            <th class="border px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${filas}
        </tbody>
      </table>
      <div class="mt-2 space-y-0.5">
        <p class="flex justify-between"><span>Subtotal:</span><span>Q${subtotal.toFixed(2)}</span></p>
        <p class="flex justify-between"><span>Envío:</span><span>${envio === 0 ? 'Gratis' : 'Q' + envio.toFixed(2)}</span></p>
        <p class="flex justify-between font-semibold text-chapinAzul"><span>Total pagado:</span><span>Q${total.toFixed(2)}</span></p>
      </div>
      <p class="mt-2 text-[11px] text-slate-500">Gracias por comprar en ChapínMarket. Esta factura es un comprobante mock para pruebas de integración.</p>
    </div>
  `;
}

function vistaLogin() {
  return `
    <div class="max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 mt-12">
      <h1 class="text-2xl font-semibold text-center mb-6">Iniciar sesión</h1>
      <form id="form-login" class="space-y-5">
        <div>
          <label class="block text-sm font-medium mb-1">Usuario o correo electrónico</label>
          <input id="login-correo" type="text" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="admin@chapinmarket.gt o admin" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Contraseña</label>
          <input id="login-password" type="password" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="••••••••" required>
        </div>
        <button type="submit"
                class="w-full bg-chapinAzul hover:bg-chapinAzulClaro text-white font-semibold py-3.5 rounded-2xl transition">
          Entrar
        </button>
      </form>
      <div class="text-center mt-4 text-xs text-slate-500">
        Usuario admin: <span class="font-mono text-chapinNaranja">admin@chapinmarket.gt</span> / <span class="font-medium">password</span>
      </div>
      <div class="text-center mt-6">
        <span class="text-sm">¿No tienes cuenta?</span>
        <a onclick="window.location.hash='#/registro'" class="text-chapinNaranja hover:underline font-medium ml-1 cursor-pointer">Crear cuenta</a>
      </div>
    </div>
  `;
}

function configurarEventosVistaLogin() {
  const form = document.getElementById('form-login');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = document.getElementById('login-correo').value.trim();
    const password = document.getElementById('login-password').value;

    const resp = await llamarApi('/public/auth/login', {
      method: 'POST',
      body: JSON.stringify({ correo, password })
    });

    if (resp.ok) {
      estadoApp.usuarioActual = resp.datos;
      guardarSesionEnLocalStorage();
      actualizarTextoUsuario();
      // --- CORRECCIÓN: forzar sincronización del carrito al iniciar sesión ---
      await refrescarCarritoCompleto();
      // --- fin corrección ---
      window.location.hash = '#/';
      mostrarModal('¡Bienvenido!', `<p class="text-sm">${resp.mensaje}</p>`);
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'Credenciales incorrectas'}</p>`);
    }
  });
}

function vistaRegistro() {
  return `
    <div class="max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 mt-12">
      <h1 class="text-2xl font-semibold text-center mb-6">Crear cuenta</h1>
      <form id="form-registro" class="space-y-5" novalidate>
        <div>
          <label class="block text-sm font-medium mb-1">Nombre completo</label>
          <input id="reg-nombre" type="text" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="Nombre completo" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Correo electrónico</label>
          <input id="reg-correo" type="email" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="tu@email.com" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Contraseña</label>
          <input id="reg-password" type="password" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="Mínimo 6 caracteres" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Dirección (opcional)</label>
          <input id="reg-direccion" type="text" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja"
                 placeholder="Zona 1, Ciudad de Guatemala">
        </div>
        <button type="submit"
                class="w-full bg-chapinNaranja hover:bg-orange-600 text-white font-semibold py-3.5 rounded-2xl transition">
          Registrarme
        </button>
      </form>
      <div class="text-center mt-6">
        <span class="text-sm">¿Ya tienes cuenta?</span>
        <a onclick="window.location.hash='#/login'" class="text-chapinAzul hover:underline font-medium ml-1 cursor-pointer">Iniciar sesión</a>
      </div>
    </div>
  `;
}

function configurarEventosVistaRegistro() {
  const form = document.getElementById('form-registro');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('reg-nombre').value.trim();
    const correo = document.getElementById('reg-correo').value.trim();
    const password = document.getElementById('reg-password').value;
    const direccion = document.getElementById('reg-direccion').value.trim();

    const resp = await llamarApi('/public/auth/registro', {
      method: 'POST',
      body: JSON.stringify({ nombre, correo, password, direccion })
    });

    if (resp.ok) {
      mostrarModal('¡Cuenta creada!', `<p class="text-sm">${resp.mensaje}</p>`);
      setTimeout(() => { window.location.hash = '#/login'; }, 1500);
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje}</p>`);
    }
  });
}

function vistaPerfil() {
  if (!estadoApp.usuarioActual) {
    window.location.hash = '#/login';
    return '';
  }

  const tarjetasHTML = estadoApp.usuarioActual.tarjetas && estadoApp.usuarioActual.tarjetas.length
    ? estadoApp.usuarioActual.tarjetas.map(t => `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-md">
          <div>
            <span class="font-semibold">${t.tipo} **** ${t.numeroEnmascarado}</span><br>
            <span class="text-xs text-slate-500">Vence: ${t.vencimiento}</span>
          </div>
          <button data-eliminar-tarjeta="${t.id}" class="text-red-500 hover:text-red-700 text-xs">Eliminar</button>
        </div>
      `).join('')
    : '<p class="text-xs text-slate-500">Aún no tienes tarjetas guardadas.</p>';

  return `
    <section class="space-y-6 max-w-2xl mx-auto">
      <div class="flex justify-between items-center">
        <h1 class="text-xl font-bold">Mi Perfil</h1>
        <button onclick="cerrarSesion()" 
                class="text-red-500 hover:text-red-600 text-sm font-medium flex items-center gap-1">
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
      
      <div class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-3">Datos personales</h2>
        <form id="form-perfil">
          <input type="text" id="perfil-nombre" value="${estadoApp.usuarioActual.nombre || ''}" class="w-full border rounded-md px-3 py-2 mb-3" />
          <input type="text" id="perfil-direccion" value="${estadoApp.usuarioActual.direccion || ''}" placeholder="Dirección" class="w-full border rounded-md px-3 py-2" />
          <button type="submit" class="mt-3 bg-chapinAzul text-white px-6 py-2 rounded-full">Guardar cambios</button>
        </form>
      </div>

      <div class="bg-white rounded-lg p-4">
        <h2 class="font-semibold mb-3">Mis tarjetas guardadas</h2>
        <div id="lista-tarjetas" class="space-y-3">
          ${tarjetasHTML}
        </div>
        
        <div class="mt-6">
          <h3 class="font-medium mb-2">Agregar nueva tarjeta</h3>
          <form id="form-nueva-tarjeta">
            <input id="tarjeta-titular" placeholder="Titular" class="w-full border rounded-md px-3 py-2 mb-2" />
            <input id="tarjeta-numero" placeholder="Número de tarjeta" class="w-full border rounded-md px-3 py-2 mb-2" />
            <div class="grid grid-cols-2 gap-3">
              <input id="tarjeta-vencimiento" placeholder="MM/AA" class="border rounded-md px-3 py-2" />
              <input id="tarjeta-cvv" placeholder="CVV" class="border rounded-md px-3 py-2" />
            </div>
            <button type="submit" class="mt-3 w-full bg-chapinNaranja text-white py-2 rounded-full">Guardar tarjeta</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function configurarEventosVistaPerfil() {
  const formPerfil = document.getElementById('form-perfil');
  if (formPerfil) {
    formPerfil.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('perfil-nombre').value;
      const direccion = document.getElementById('perfil-direccion').value;
      await llamarApi('/public/usuarios/perfil', {
        method: 'PUT',
        body: JSON.stringify({ id: estadoApp.usuarioActual.id, nombre, direccion })
      });
      estadoApp.usuarioActual.nombre = nombre;
      estadoApp.usuarioActual.direccion = direccion;
      guardarSesionEnLocalStorage();
      mostrarModal('Perfil actualizado', 'Los datos se guardaron correctamente.');
      renderizarVista();
    });
  }

  const formTarjeta = document.getElementById('form-nueva-tarjeta');
  if (formTarjeta) {
    formTarjeta.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tarjeta = {
        titular: document.getElementById('tarjeta-titular').value,
        numeroEnmascarado: document.getElementById('tarjeta-numero').value.slice(-4),
        vencimiento: document.getElementById('tarjeta-vencimiento').value,
        tipo: 'VISA'
      };
      await llamarApi('/public/usuarios/tarjetas', {
        method: 'POST',
        body: JSON.stringify({ usuarioId: estadoApp.usuarioActual.id, tarjeta })
      });
      mostrarModal('Tarjeta guardada', 'La tarjeta se agregó correctamente.');
      renderizarVista();
    });
  }

  document.querySelectorAll('[data-eliminar-tarjeta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tarjetaId = parseInt(btn.dataset.eliminarTarjeta);
      await llamarApi('/public/usuarios/tarjetas', {
        method: 'DELETE',
        body: JSON.stringify({ usuarioId: estadoApp.usuarioActual.id, tarjetaId })
      });
      mostrarModal('Tarjeta eliminada', 'Se quitó correctamente.');
      renderizarVista();
    });
  });
}

function vistaAdmin() {
  if (!estadoApp.usuarioActual || !estadoApp.usuarioActual.esAdmin) {
    return `
      <section class="text-sm">
        <h1 class="text-base sm:text-lg font-semibold mb-2">Panel de administración</h1>
        <p>Esta sección está protegida. Inicia sesión como administrador.</p>
        <button onclick="window.location.hash='#/login'" class="mt-2 bg-chapinAzul text-white rounded-full px-4 py-1.5 text-xs">Ir a login</button>
      </section>
    `;
  }

  const arbolCategoriasHTML = construirArbolCategoriasHTML();

  const temporadas = estadoApp.temporadas
    .map((t) => `
      <tr class="text-xs">
        <td class="border px-2 py-1">${t.nombre}</td>
        <td class="border px-2 py-1">${t.fechaInicio}</td>
        <td class="border px-2 py-1">${t.fechaFin}</td>
      </tr>
    `)
    .join('');

  return `
    <section class="space-y-4 text-sm">
      <h1 class="text-base sm:text-lg font-semibold">Panel de administración</h1>
      <p class="text-xs text-slate-600">Gestión básica de categorías, productos y temporadas.</p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div class="bg-white rounded-lg shadow-sm p-3 space-y-2">
          <h2 class="font-semibold mb-1">Categorías y subcategorías</h2>
          <div class="max-h-52 overflow-y-auto border rounded-md p-2 scrollbar-delgada text-[11px]">
            ${arbolCategoriasHTML}
          </div>
          <form id="formulario-categoria" class="space-y-1 mt-2">
            <div>
              <label class="block mb-1">Nombre de nueva categoría</label>
              <input type="text" name="nombre" required class="w-full border rounded-md px-2 py-1" />
            </div>
            <div>
              <label class="block mb-1">Categoría padre (opcional)</label>
              <select name="padreId" class="w-full border rounded-md px-2 py-1">
                <option value="">Ninguna (nivel raíz)</option>
                ${estadoApp.categorias.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')}
              </select>
            </div>
            <button class="bg-chapinAzul text-white rounded-full px-3 py-1 mt-1 font-semibold text-xs">Agregar categoría</button>
          </form>
        </div>

        <div class="bg-white rounded-lg shadow-sm p-3 space-y-2">
          <h2 class="font-semibold mb-1">Agregar producto</h2>
          <form id="formulario-producto" class="space-y-1 text-[11px]">
            <div>
              <label class="block mb-1">Nombre</label>
              <input type="text" name="nombre" required class="w-full border rounded-md px-2 py-1" />
            </div>
            <div>
              <label class="block mb-1">Descripción</label>
              <textarea name="descripcion" rows="2" required class="w-full border rounded-md px-2 py-1"></textarea>
            </div>
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block mb-1">Precio (Q)</label>
                <input type="number" name="precio" step="0.01" required class="w-full border rounded-md px-2 py-1" />
              </div>
              <div class="w-24">
                <label class="block mb-1">Stock</label>
                <input type="number" name="stock" required class="w-full border rounded-md px-2 py-1" />
              </div>
            </div>
            
            <div>
              <label class="block mb-1">Categorías (puedes elegir varias)</label>
              <select name="categoriaIds" multiple size="4" class="w-full border rounded-md px-2 py-1">
                ${estadoApp.categorias.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block mb-1">Temporadas / Promociones (mantén Ctrl o Cmd para seleccionar varias)</label>
              <select id="select-temporadas-producto" name="temporadaIds" multiple size="4" 
                      class="w-full border rounded-md px-2 py-1">
              </select>
            </div>

            <div>
              <label class="block mb-1">URLs de imágenes (máx. 10, separadas por coma)</label>
              <textarea name="imagenes" rows="2" class="w-full border rounded-md px-2 py-1" 
                        placeholder="https://picsum.photos/600/600, https://picsum.photos/601/601"></textarea>
            </div>
            
            <button class="bg-chapinNaranja text-white rounded-full px-3 py-1 mt-1 font-semibold text-xs">Crear producto</button>
          </form>
        </div>

        <div class="bg-white rounded-lg shadow-sm p-3 space-y-2">
          <h2 class="font-semibold mb-1">Temporadas / promociones</h2>
          <table class="w-full border-collapse text-[11px]">
            <thead>
              <tr class="bg-slate-100">
                <th class="border px-2 py-1 text-left">Nombre</th>
                <th class="border px-2 py-1 text-left">Inicio</th>
                <th class="border px-2 py-1 text-left">Fin</th>
              </tr>
            </thead>
            <tbody>
              ${temporadas || ''}
            </tbody>
          </table>
          <form id="formulario-temporada" class="space-y-1 text-[11px] mt-2">
            <div>
              <label class="block mb-1">Nombre</label>
              <input type="text" name="nombre" required class="w-full border rounded-md px-2 py-1" />
            </div>
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block mb-1">Fecha inicio</label>
                <input type="date" name="fechaInicio" required class="w-full border rounded-md px-2 py-1" />
              </div>
              <div class="flex-1">
                <label class="block mb-1">Fecha fin</label>
                <input type="date" name="fechaFin" required class="w-full border rounded-md px-2 py-1" />
              </div>
            </div>
            <div>
              <label class="block mb-1">Descripción</label>
              <textarea name="descripcion" rows="2" class="w-full border rounded-md px-2 py-1"></textarea>
            </div>
            <button class="bg-chapinAzul text-white rounded-full px-3 py-1 mt-1 font-semibold text-xs">Crear temporada</button>
          </form>
        </div>

        <div class="bg-white rounded-lg shadow-sm p-3 space-y-2">
          <h2 class="font-semibold mb-1">Carga masiva de productos (mock CSV)</h2>
          <p class="text-[11px] text-slate-600">Formato: <code>nombre;precio</code> por línea.</p>
          <form id="formulario-carga-masiva" class="space-y-1 text-[11px]">
            <textarea name="csv" rows="5" class="w-full border rounded-md px-2 py-1" placeholder="Pantalón deportivo;189.99&#10;Camisa manga larga;159.50"></textarea>
            <button class="bg-chapinNaranja text-white rounded-full px-3 py-1 mt-1 font-semibold text-xs">Simular carga masiva</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function construirArbolCategoriasHTML() {
  const mapaHijos = new Map();
  estadoApp.categorias.forEach((c) => {
    const clave = c.padreId == null ? 'raiz' : c.padreId;
    if (!mapaHijos.has(clave)) mapaHijos.set(clave, []);
    mapaHijos.get(clave).push(c);
  });

  const construirLista = (padreId, nivel) => {
    const hijos = mapaHijos.get(padreId === null ? 'raiz' : padreId) || [];

    if (!hijos.length) return '';

    let html = `<ul class="ml-${nivel * 3}">`;
    for (const hijo of hijos) {
      html += `
        <li class="flex items-center justify-between mb-1">
          <button class="texto-categoria inline text-left text-[13px] py-0.5" data-id-cat="${hijo.id}">
            ${'— '.repeat(nivel)}${hijo.nombre}
          </button>
        </li>`;
      html += construirLista(hijo.id, nivel + 1);
    }
    html += `</ul>`;
    return html;
  };

  return construirLista(null, 0);
}

function configurarEventosVistaAdmin() {
  const formCategoria = document.getElementById('formulario-categoria');
  const formProducto = document.getElementById('formulario-producto');
  const formTemporada = document.getElementById('formulario-temporada');
  const formCarga = document.getElementById('formulario-carga-masiva');

  if (formCategoria) {
    formCategoria.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formCategoria);
      const nombre = fd.get('nombre');
      const padreId = fd.get('padreId') ? parseInt(fd.get('padreId')) : null;

      const resp = await llamarApi('/public/categorias', {
        method: 'POST',
        body: JSON.stringify({ nombre, padreId })
      });

      if (!resp.ok) {
        mostrarModal('Error', `<p class="text-sm">${resp.mensaje || 'No se pudo crear la categoría.'}</p>`);
        return;
      }

      await cargarDatosIniciales();
      renderizarVista();
    });
  }

  if (formProducto) {
    formProducto.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formProducto);
      const nombre = fd.get('nombre');
      const descripcion = fd.get('descripcion');
      const precio = parseFloat(fd.get('precio'));
      const stock = parseInt(fd.get('stock'));
      const categoriaIds = fd.getAll('categoriaIds').map((v) => parseInt(v));
      const temporadaIds = fd.getAll('temporadaIds').map((v) => parseInt(v)).filter(v => !isNaN(v));
      const imagenesTexto = fd.get('imagenes') || '';
      const imagenes = imagenesTexto
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);

      const resp = await llamarApi('/public/productos', {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          descripcion,
          precio,
          stock,
          categoriaIds,
          imagenes,
          temporadaIds
        })
      });

      if (!resp.ok) {
        mostrarModal('Error', `<p class="text-sm">${resp.mensaje || 'No se pudo crear el producto.'}</p>`);
        return;
      }

      await cargarDatosIniciales();
      mostrarModal('Producto creado', '<p class="text-sm">Producto agregado correctamente.</p>');
      formProducto.reset();
    });
  }

  if (formTemporada) {
    formTemporada.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formTemporada);
      const nombre = fd.get('nombre');
      const fechaInicio = fd.get('fechaInicio');
      const fechaFin = fd.get('fechaFin');
      const descripcion = fd.get('descripcion');

      const resp = await llamarApi('/public/temporadas', {
        method: 'POST',
        body: JSON.stringify({ nombre, fechaInicio, fechaFin, descripcion })
      });

      if (!resp.ok) {
        mostrarModal('Error', `<p class="text-sm">${resp.mensaje || 'No se pudo crear la temporada.'}</p>`);
        return;
      }

      await cargarDatosIniciales();
      renderizarVista();
    });
  }

  if (formCarga) {
    formCarga.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formCarga);
      const csvProductos = fd.get('csv');

      const resp = await llamarApi('/public/admin/carga-masiva', {
        method: 'POST',
        body: JSON.stringify({ csvProductos })
      });

      if (!resp.ok) {
        mostrarModal('Error', `<p class="text-sm">${resp.mensaje || 'No se pudo procesar la carga masiva.'}</p>`);
        return;
      }

      await cargarDatosIniciales();
      mostrarModal('Carga masiva completada', `<p class="text-sm">${resp.datos.length} productos agregados (mock).</p>`);
      formCarga.reset();
    });
  }

  const selectTemporadasProd = document.getElementById('select-temporadas-producto');
  if (selectTemporadasProd && estadoApp.temporadas.length > 0) {
    selectTemporadasProd.innerHTML = estadoApp.temporadas
      .map(t => `<option value="${t.id}">${t.nombre} (${t.fechaInicio} → ${t.fechaFin})</option>`)
      .join('');
  }
}

function vistaTodasCategorias() {
  const arbolHTML = construirArbolCategoriasHTML();
  const productos = estadoApp.productos;

  return `
    <section class="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 text-sm">
      <aside class="bg-white rounded-lg shadow-sm p-3 text-xs">
        <h1 class="text-base font-semibold mb-2">Todas las categorías</h1>
        <p class="text-[11px] text-slate-600 mb-2">Navega por el árbol de categorías ChapínMarket.</p>
        <div class="max-h-64 overflow-y-auto scrollbar-delgada">
          ${arbolHTML}
        </div>
      </aside>
      <div>
        <h2 class="text-base font-semibold mb-2">Productos destacados</h2>
        <div id="contenedor-grid-categorias">
          ${gridProductos(productos, {
    mostrarPaginacion: true,
    pagina: estadoApp.filtrosProductos.pagina,
    porPagina: 12
  })}
        </div>
      </div>
    </section>
  `;
}

function configurarEventosVistaTodasCategorias() {
  document.querySelectorAll('.texto-categoria').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.idCat);
      if (!isNaN(id)) window.location.hash = `#/categoria/${id}`;
    });
  });

  configurarEventosGridProductos('#contenedor-grid-categorias', estadoApp.productos);
  configurarEventosBotonesAgregarCarrito();
}

function vistaTemporadas() {
  return `
    <section class="space-y-3 text-sm">
      <h1 class="text-base sm:text-lg font-semibold">Temporadas y promociones</h1>
      <p class="text-xs text-slate-600">Descubre campañas activas y productos destacados en cada temporada.</p>
      <div class="space-y-3">
        ${estadoApp.temporadas.map((t) => {
    const productosTemporada = estadoApp.productos.filter((p) => p.temporadaIds && p.temporadaIds.includes(t.id));
    return `
            <div class="bg-white rounded-lg shadow-sm p-3 space-y-2">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="font-semibold text-sm">${t.nombre}</h2>
                  <p class="text-[11px] text-slate-500">Del ${t.fechaInicio} al ${t.fechaFin}</p>
                </div>
                <span class="text-[11px] bg-chapinNaranja text-white px-2 py-0.5 rounded-full">Activa</span>
              </div>
              <p class="text-xs text-slate-700">${t.descripcion}</p>
              ${productosTemporada.length
        ? `<div class="mt-2">${gridProductos(productosTemporada.slice(0, 8))}</div>`
        : '<p class="text-[11px] text-slate-500 mt-1">Aún no hay productos asociados a esta temporada.</p>'
      }
            </div>
          `;
  }).join('')}
      </div>
    </section>
  `;
}

function configurarEventosVistaTemporadas() {
  configurarEventosBotonesAgregarCarrito();
}

async function agregarAlCarrito(productoId, cantidad) {
  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'POST',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId,
        cantidad
      })
    });

    if (resp.ok) {
      let nuevosItems = null;
      if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
        nuevosItems = resp.datos.items;
      } else if (resp.datos && Array.isArray(resp.datos)) {
        nuevosItems = resp.datos;
      }

      if (nuevosItems) {
        estadoApp.carrito = nuevosItems;
        guardarCarritoLocal();
      } else {
        await sincronizarCarritoDesdeApi();
      }

      abrirPanelCarrito();
      actualizarIconoCarrito();
      actualizarPanelCarrito();

      const producto = estadoApp.productos.find(p => p.id === productoId);
      if (producto) {
        mostrarModal('Producto agregado', `<p class="text-sm">${producto.nombre} (x${cantidad}) añadido al carrito.</p>`);
      }
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo agregar el producto'}</p>`);
    }
  } catch (e) {
    console.error('Error agregando al carrito', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo conectar con el servidor.</p>');
  }
}

async function actualizarCantidadCarrito(productoId, cantidad) {
  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'PUT',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId,
        cantidad
      })
    });

    if (resp.ok) {
      let nuevosItems = null;
      if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
        nuevosItems = resp.datos.items;
      } else if (resp.datos && Array.isArray(resp.datos)) {
        nuevosItems = resp.datos;
      }

      if (nuevosItems) {
        estadoApp.carrito = nuevosItems;
      } else {
        await sincronizarCarritoDesdeApi();
      }

      guardarCarritoLocal();
      actualizarIconoCarrito();
      actualizarPanelCarrito();

      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'Stock insuficiente'}</p>`);
      await sincronizarCarritoDesdeApi();
      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    }
  } catch (e) {
    console.error('Error actualizando cantidad', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo actualizar la cantidad.</p>');
  }
}

async function decrementarCantidadCarrito(productoId) {
  try {
    const resp = await llamarApi(`/public/carrito/decrementar/${productoId}`, {
      method: 'PUT',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null
      })
    });

    if (resp.ok) {
      let nuevosItems = null;
      if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
        nuevosItems = resp.datos.items;
      } else if (resp.datos && Array.isArray(resp.datos)) {
        nuevosItems = resp.datos;
      }

      if (nuevosItems) {
        estadoApp.carrito = nuevosItems;
      } else {
        await sincronizarCarritoDesdeApi();
      }

      guardarCarritoLocal();
      actualizarIconoCarrito();
      actualizarPanelCarrito();

      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo disminuir la cantidad'}</p>`);
      await sincronizarCarritoDesdeApi();
      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    }
  } catch (e) {
    console.error('Error decrementando cantidad', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo disminuir la cantidad.</p>');
  }
}

async function actualizarSeleccionCarrito(productoId, seleccionado) {
  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'PUT',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId,
        seleccionado
      })
    });

    if (resp.ok) {
      let nuevosItems = null;
      if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
        nuevosItems = resp.datos.items;
      } else if (resp.datos && Array.isArray(resp.datos)) {
        nuevosItems = resp.datos;
      }

      if (nuevosItems) {
        estadoApp.carrito = nuevosItems;
      } else {
        await sincronizarCarritoDesdeApi();
      }

      guardarCarritoLocal();
      actualizarPanelCarrito();

      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
    }
  } catch (e) {
    console.error('Error actualizando selección', e);
  }
}

async function eliminarDelCarrito(productoId) {
  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'DELETE',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId
      })
    });

    if (resp.ok) {
      let nuevosItems = null;
      if (resp.datos && resp.datos.items && Array.isArray(resp.datos.items)) {
        nuevosItems = resp.datos.items;
      } else if (resp.datos && Array.isArray(resp.datos)) {
        nuevosItems = resp.datos;
      } else if (resp.datos && resp.datos.data && Array.isArray(resp.datos.data)) {
        nuevosItems = resp.datos.data;
      }

      if (nuevosItems !== null) {
        estadoApp.carrito = nuevosItems;
      } else if (resp.datos && resp.datos.carrito && resp.datos.carrito.items) {
        estadoApp.carrito = resp.datos.carrito.items;
      } else {
        await sincronizarCarritoDesdeApi();
      }

      guardarCarritoLocal();
      actualizarIconoCarrito();
      actualizarPanelCarrito();

      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }

      const botonesQuitar = document.querySelectorAll('[data-eliminar-carrito-panel]');
      botonesQuitar.forEach(btn => {
        const nuevoBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(nuevoBtn, btn);
        nuevoBtn.addEventListener('click', async () => {
          const id = parseInt(nuevoBtn.dataset.eliminarCarritoPanel);
          await eliminarDelCarrito(id);
        });
      });

    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo eliminar el producto'}</p>`);
    }
  } catch (e) {
    console.error('Error eliminando del carrito', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo conectar con el servidor.</p>');
  }
}

function actualizarIconoCarrito() {
  const contador = document.getElementById('contador-carrito');
  const contadorFlotante = document.getElementById('contador-carrito-flotante');

  const total = estadoApp.carrito && estadoApp.carrito.length
    ? estadoApp.carrito.reduce((sum, item) => sum + (item.cantidad || 0), 0)
    : 0;

  if (contador) contador.textContent = total;
  if (contadorFlotante) contadorFlotante.textContent = total;
}

// ========== FUNCIONES PARA EL CARRITO - VERSIÓN UNIFICADA ==========

function actualizarPanelCarrito() {
  const contenedor = document.getElementById('lista-carrito-panel');
  const subtotalElem = document.getElementById('subtotal-carrito-panel');

  if (!contenedor) return;

  if (!estadoApp.carrito || !estadoApp.carrito.length) {
    const mensajeVacio = `
      <div class="carrito-vacio-mensaje">
        <img src="https://cdn-icons-png.flaticon.com/512/5993/5993337.png" alt="Carrito vacío" class="opacity-40 icono-carrito-vacio">
        <p class="text-slate-500 font-medium">Tu carrito está vacío</p>
        <p class="text-slate-400 text-[11px]">Agrega productos y comienza a comprar</p>
      </div>
    `;
    contenedor.innerHTML = mensajeVacio;
    if (subtotalElem) subtotalElem.textContent = 'Q0.00';
    return;
  }

  let subtotal = 0;
  const itemsHTML = estadoApp.carrito
    .map((item) => {
      const producto = item.producto;
      if (!producto) return '';

      const subtotalItem = producto.precio * item.cantidad;
      subtotal += subtotalItem;

      let imagenUrl = '';
      if (producto.imagen && typeof producto.imagen === 'string' && producto.imagen.trim() !== '') {
        imagenUrl = producto.imagen.trim();
      } else if (producto.imagenes && Array.isArray(producto.imagenes) && producto.imagenes.length > 0) {
        imagenUrl = producto.imagenes[0];
      } else {
        imagenUrl = obtenerImagenProducto(producto);
      }

      const tieneImagen = imagenUrl && imagenUrl !== '' && imagenUrl !== 'null' &&
        (imagenUrl.startsWith('http') || imagenUrl.startsWith('data:'));

      return `
        <div class="flex gap-3 bg-slate-50 rounded-lg p-3 border border-slate-100">
          <div class="w-16 h-16 rounded-md overflow-hidden flex-shrink-0 bg-white flex items-center justify-center">
            ${tieneImagen ?
          `<img src="${imagenUrl}" alt="${producto.nombre}" class="w-full h-full object-cover" 
              onerror="this.onerror=null; this.src='https://via.placeholder.com/300x300?text=Error';" />` :
          `<div class="w-full h-full flex items-center justify-center text-slate-400 text-2xl">📷</div>`
        }
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="font-medium text-xs truncate">${producto.nombre}</h4>
            <p class="text-chapinAzul font-semibold text-sm mt-1">Q${producto.precio.toFixed(2)}</p>
            <div class="flex items-center justify-between mt-2">
              <div class="cantidad-control">
                <button data-cantidad-decrementar="${item.productoId}" 
                  ${item.cantidad <= 1 ? 'disabled' : ''}
                  class="text-slate-600 hover:text-chapinAzul">−</button>
                <input type="number" value="${item.cantidad}" data-cantidad-input="${item.productoId}"
                  min="1" max="${producto.stock}" class="text-xs" />
                <button data-cantidad-incrementar="${item.productoId}"
                  ${item.cantidad >= producto.stock ? 'disabled' : ''}
                  class="text-slate-600 hover:text-chapinAzul">+</button>
              </div>
              <span class="font-bold text-chapinAzul text-sm">Q${subtotalItem.toFixed(2)}</span>
            </div>
            <button data-eliminar-carrito-panel="${item.productoId}" 
              class="mt-1 text-xs text-red-400 hover:text-red-600 transition">🗑️ Eliminar</button>
          </div>
        </div>
      `;
    })
    .join('');

  contenedor.innerHTML = itemsHTML;
  if (subtotalElem) subtotalElem.textContent = `Q${subtotal.toFixed(2)}`;

  configurarEventosCantidadCarrito();
  configurarEventosEliminarCarrito();
}

function configurarEventosCantidadCarrito() {
  document.querySelectorAll('[data-cantidad-incrementar]').forEach(btn => {
    btn.removeEventListener('click', manejarIncremento);
    btn.addEventListener('click', manejarIncremento);
  });

  document.querySelectorAll('[data-cantidad-decrementar]').forEach(btn => {
    btn.removeEventListener('click', manejarDecremento);
    btn.addEventListener('click', manejarDecremento);
  });

  document.querySelectorAll('[data-cantidad-input]').forEach(input => {
    input.removeEventListener('change', manejarCambioCantidad);
    input.addEventListener('change', manejarCambioCantidad);
  });
}

async function manejarIncremento(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const productoId = parseInt(btn.dataset.cantidadIncrementar);
  const item = estadoApp.carrito.find(i => i.productoId === productoId);
  const producto = estadoApp.productos.find(p => p.id === productoId);

  if (item && producto && item.cantidad < producto.stock) {
    const nuevaCantidad = item.cantidad + 1;
    await actualizarCantidadCarrito(productoId, nuevaCantidad);
    actualizarPanelCarrito();
  } else if (producto && item && item.cantidad >= producto.stock) {
    mostrarModal('Stock limitado',
      `<p class="text-sm">Solo hay ${producto.stock} unidades disponibles de "${producto.nombre}".</p>`);
  }
}

async function manejarDecremento(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const productoId = parseInt(btn.dataset.cantidadDecrementar);
  const item = estadoApp.carrito.find(i => i.productoId === productoId);

  if (item && item.cantidad > 1) {
    const nuevaCantidad = item.cantidad - 1;
    await actualizarCantidadCarrito(productoId, nuevaCantidad);
    actualizarPanelCarrito();
  }
}

async function manejarCambioCantidad(e) {
  const input = e.currentTarget;
  const productoId = parseInt(input.dataset.cantidadInput);
  let cantidad = parseInt(input.value) || 1;
  const producto = estadoApp.productos.find(p => p.id === productoId);

  if (producto && cantidad > producto.stock) {
    cantidad = producto.stock;
    input.value = cantidad;
    mostrarModal('Stock limitado',
      `<p class="text-sm">Cantidad ajustada a ${producto.stock} unidades (máximo disponible).</p>`);
  }

  cantidad = Math.max(1, Math.min(cantidad, producto?.stock || 1));
  if (cantidad !== (estadoApp.carrito.find(i => i.productoId === productoId)?.cantidad || 0)) {
    await actualizarCantidadCarrito(productoId, cantidad);
    actualizarPanelCarrito();
  }
}

function configurarEventosEliminarCarrito() {
  document.querySelectorAll('[data-eliminar-carrito-panel]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const productoId = parseInt(btn.dataset.eliminarCarritoPanel);
      await eliminarDelCarrito(productoId);
    });
  });
}

function abrirPanelCarrito() {
  const panel = document.getElementById('panel-carrito');
  if (panel) {
    panel.classList.remove('translate-x-full');
  }
  actualizarPanelCarrito();
}

function cerrarPanelCarrito() {
  const panel = document.getElementById('panel-carrito');
  if (panel) panel.classList.add('translate-x-full');
}

function mostrarModal(titulo, contenidoHTML) {
  const modal = document.getElementById('modal-general');
  const modalTitulo = document.getElementById('modal-titulo');
  const modalContenido = document.getElementById('modal-contenido');

  if (!modal || !modalTitulo || !modalContenido) return;

  modalTitulo.textContent = titulo;
  modalContenido.innerHTML = contenidoHTML;
  modal.classList.remove('hidden');
}

function cerrarModal() {
  const modal = document.getElementById('modal-general');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function cerrarSesion() {
  try {
    const resp = await llamarApi('/public/auth/logout', { method: 'POST' });
    if (resp.ok) {
      estadoApp.usuarioActual = null;
      localStorage.removeItem('chapinMarket_usuario');
      actualizarTextoUsuario();

      // --- CORRECCIÓN: desvincular el carrito de la interfaz sin eliminarlo del backend ---
      estadoApp.carrito = [];                      // limpia la vista actual
      localStorage.removeItem('chapinMarket_carrito_local'); // evita que una recarga muestre datos viejos
      actualizarIconoCarrito();                    // badge a 0
      actualizarPanelCarrito();                    // panel lateral vacío
      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();                         // si está en la vista de carrito, refréscala
      }
      // --- fin corrección ---

      window.location.hash = '#/';
      mostrarModal('Sesión cerrada', '<p class="text-sm">Has cerrado sesión correctamente.</p>');
    }
  } catch (e) {
    console.error('Error al cerrar sesión', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo cerrar la sesión.</p>');
  }
}

function configurarEventosGlobales() {
  const botonLogo = document.getElementById('boton-logo');
  const cerrarPanel = document.getElementById('cerrar-panel-carrito');
  const botonUsuario = document.getElementById('boton-usuario');

  if (botonLogo) {
    botonLogo.addEventListener('click', () => {
      window.location.hash = '#/';
    });
  }

  if (cerrarPanel) {
    cerrarPanel.addEventListener('click', () => {
      cerrarPanelCarrito();
    });
  }

  // Botón flotante - ÚNICO punto de acceso al carrito
  const botonFlotanteCarrito = document.getElementById('boton-flotante-carrito');
  if (botonFlotanteCarrito) {
    botonFlotanteCarrito.addEventListener('click', () => {
      actualizarPanelCarrito();
      abrirPanelCarrito();
    });
  }

  const btnCheckoutEscritorio = document.getElementById('boton-ir-checkout');

  if (btnCheckoutEscritorio) {
    btnCheckoutEscritorio.addEventListener('click', () => {
      cerrarPanelCarrito();
      window.location.hash = '#/checkout';
    });
  }

  const contadorFlotante = document.getElementById('contador-carrito-flotante');
  if (contadorFlotante) {
    const observer = new MutationObserver(() => {
      const contadorPrincipal = document.getElementById('contador-carrito');
      if (contadorPrincipal) {
        contadorFlotante.textContent = contadorPrincipal.textContent;
      }
    });

    const contadorPrincipal = document.getElementById('contador-carrito');
    if (contadorPrincipal) {
      observer.observe(contadorPrincipal, { characterData: true, subtree: true, childList: true });
    }
  }

  if (botonUsuario) {
    botonUsuario.addEventListener('click', () => {
      if (estadoApp.usuarioActual) {
        window.location.hash = '#/perfil';
      } else {
        window.location.hash = '#/login';
      }
    });
  }

  const modal = document.getElementById('modal-general');
  const modalCerrar = document.getElementById('modal-cerrar');
  if (modal && modalCerrar) {
    modalCerrar.addEventListener('click', cerrarModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModal();
    });
  }

  const botonBusquedaMovil = document.getElementById('boton-busqueda-movil');
  const contenedorBusquedaMovil = document.getElementById('contenedor-busqueda-movil');
  if (botonBusquedaMovil && contenedorBusquedaMovil) {
    botonBusquedaMovil.addEventListener('click', () => {
      contenedorBusquedaMovil.classList.toggle('hidden');
    });
  }

  const inputBusqueda = document.getElementById('input-busqueda-global');
  const inputBusquedaMovil = document.getElementById('input-busqueda-global-movil');

  function manejarBusqueda(valor) {
    const texto = valor.trim().toLowerCase();
    if (!texto) return;
    const resultados = estadoApp.productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(texto) ||
        p.descripcion.toLowerCase().includes(texto)
    );
    mostrarResultadosBusqueda(texto, resultados);
  }

  if (inputBusqueda) {
    inputBusqueda.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        manejarBusqueda(inputBusqueda.value);
      }
    });
  }
  if (inputBusquedaMovil) {
    inputBusquedaMovil.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        manejarBusqueda(inputBusquedaMovil.value);
      }
    });
  }

  const botonIrPromociones = document.getElementById('boton-ir-promociones');
  if (botonIrPromociones) {
    botonIrPromociones.addEventListener('click', () => {
      window.location.hash = '#/promociones';
    });
  }

  const botonIrCategorias = document.getElementById('boton-ir-categorias');
  if (botonIrCategorias) {
    botonIrCategorias.addEventListener('click', () => {
      window.location.hash = '#/categorias';
    });
  }

  const botonIrTemporadas = document.getElementById('boton-ir-temporadas');
  if (botonIrTemporadas) {
    botonIrTemporadas.addEventListener('click', () => {
      window.location.hash = '#/temporadas';
    });
  }
}

function mostrarResultadosBusqueda(texto, resultados) {
  const html = `
    <section class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <h1 class="text-base sm:text-lg font-semibold">Resultados para "${texto}"</h1>
        <button class="text-xs text-chapinAzul hover:text-chapinNaranja" onclick="window.location.hash='#/'">Volver al inicio</button>
      </div>
      ${resultados.length
      ? `<div id="contenedor-busqueda-productos">${gridProductos(resultados.slice(0, 40))}</div>`
      : '<p class="text-xs">No se encontraron productos que coincidan con tu búsqueda.</p>'
    }
    </section>
  `;
  const contenedor = document.getElementById('vista-principal');
  if (!contenedor) return;
  contenedor.innerHTML = html;
  configurarEventosBotonesAgregarCarrito();
}

// Reemplazar la función iniciarHeroRotativo por una versión animada
function iniciarHeroRotativo() {
  const slides = document.querySelectorAll('.hero-slide');
  if (!slides.length) return;
  let current = 0;
  const total = slides.length;

  const showSlide = (index) => {
    slides.forEach((slide, i) => {
      if (i === index) {
        slide.classList.remove('hero-hidden');
        slide.style.position = 'relative';
      } else {
        slide.classList.add('hero-hidden');
        slide.style.position = 'absolute';
      }
    });
  };

  setInterval(() => {
    current = (current + 1) % total;
    showSlide(current);
  }, 5000);
}

function actualizarTextoUsuario() {
  const texto = document.getElementById('texto-usuario-actual');
  if (!texto) return;
  if (estadoApp.usuarioActual) {
    texto.textContent = estadoApp.usuarioActual.nombre;
  } else {
    texto.textContent = 'Iniciar sesión';
  }
}

async function refrescarCarritoCompleto() {
  await sincronizarCarritoDesdeApi();
  actualizarIconoCarrito();
  actualizarPanelCarrito();
  if (estadoApp.vistaActual === 'carrito') {
    renderizarVista();
  }
}

window.chapinMarket = {
  cerrarModal,
  cerrarPanelCarrito,
  cerrarSesion
};

window.cerrarSesion = cerrarSesion;