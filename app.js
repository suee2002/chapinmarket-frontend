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
const productosAgregandoCarrito = new Set();

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
    configurarHeaderScroll();  // <-- agregar esta línea
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

/**
 * Cierra todos los paneles abiertos: carrito, dropdown categorías, menú móvil.
 * Si se pasa un panel para exceptuar, no se cierra (se usa al abrir uno específico).
 */
function cerrarTodosLosPaneles(excepcion = null) {
  // Carrito
  if (excepcion !== 'carrito') {
    const panelCarrito = document.getElementById('panel-carrito');
    if (panelCarrito && !panelCarrito.classList.contains('translate-x-full')) {
      panelCarrito.classList.add('translate-x-full');
    }
  }

  // Dropdown categorías desktop
  if (excepcion !== 'categorias') {
    const dropdown = document.getElementById('dropdown-categorias');
    const flecha = document.getElementById('flecha-categorias');
    if (dropdown) {
      dropdown.classList.add('hidden');
      dropdown.classList.remove('dropdown-abierto');
    }
    if (flecha) {
      flecha.classList.remove('rotate-arrow');
    }
  }

  // Menú móvil (hamburguesa)
  if (excepcion !== 'menu-movil') {
    const menuPanel = document.getElementById('panel-menu-movil');
    if (menuPanel && menuPanel.classList.contains('menu-abierto')) {
      menuPanel.classList.remove('menu-abierto');
    }
    // También cierra el submenú de categorías dentro del menú móvil
    const submenuCat = document.getElementById('submenu-categorias-movil');
    const flechaCatMovil = document.getElementById('flecha-categorias-movil');
    if (submenuCat) submenuCat.classList.add('hidden');
    if (flechaCatMovil) flechaCatMovil.classList.remove('rotate-arrow');
  }
}

async function cargarDatosIniciales() {
  try {
    // Peticiones individuales con manejo de error por separado
    const respCategorias = await llamarApi('/public/categorias').catch(e => ({ ok: false, datos: [] }));
    const respProductos = await llamarApi('/public/productos').catch(e => ({ ok: false, datos: [] }));
    const respTemporadas = await llamarApi('/public/temporadas').catch(e => ({ ok: false, datos: [] }));

    estadoApp.categorias = respCategorias.ok && Array.isArray(respCategorias.datos) ? respCategorias.datos : [];
    estadoApp.productos = respProductos.ok && Array.isArray(respProductos.datos) ? respProductos.datos : [];
    estadoApp.temporadas = respTemporadas.ok && Array.isArray(respTemporadas.datos) ? respTemporadas.datos : [];

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
    construirMenuMovilCategorias();

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
      return;
    }
  } catch (e) {
    console.warn('Fallo /auth/me, intentando recuperar de localStorage', e);
  }

  // Fallback: recuperar de localStorage
  const datosLocales = localStorage.getItem('chapinMarket_usuario');
  if (datosLocales) {
    try {
      const usuario = JSON.parse(datosLocales);
      if (usuario && usuario.id) {
        estadoApp.usuarioActual = usuario;
        actualizarTextoUsuario();
        console.log('Sesión restaurada desde localStorage');
        // Cargar datos completos en segundo plano
        cargarPerfilCompletoDesdeLocalStorage();
        return;
      }
    } catch (e) { }
  }
  estadoApp.usuarioActual = null;
}

// Nueva función auxiliar para cargar el perfil completo usando el id de localStorage
async function cargarPerfilCompletoDesdeLocalStorage() {
  const uid = estadoApp.usuarioActual?.id;
  if (!uid) return;
  const url = `/public/perfil?uid=${uid}`;
  const resp = await llamarApi(url, { method: 'GET' });
  if (resp.ok && resp.datos) {
    estadoApp.usuarioActual = {
      ...estadoApp.usuarioActual,
      nombre: resp.datos.nombre,
      correo: resp.datos.correo,
      telefono: resp.datos.telefono,
      direccion: resp.datos.direccion,
      direcciones: resp.datos.direcciones || [],
      tarjetas: resp.datos.tarjetas || [],
      pedidos: resp.datos.pedidos || []
    };
    guardarSesionEnLocalStorage();
    actualizarTextoUsuario();
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

  if (partes[0] === 'pedido' && partes[1]) {
    return { nombre: 'pedido', parametros: { id: parseInt(partes[1]) } };
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
    case 'pedido':
      contenedor.innerHTML = vistaDetallePedido(estadoApp.parametrosVista.id);
      configurarEventosVistaDetallePedido(estadoApp.parametrosVista.id);
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

function construirMenuMovilCategorias() {
  const contenedor = document.getElementById('submenu-categorias-movil');
  if (!contenedor) return;

  const raices = estadoApp.categorias.filter(c => c.padreId === null);
  let html = '';
  raices.forEach(cat => {
    const hijos = estadoApp.categorias.filter(c => c.padreId === cat.id);
    html += `<div class="mb-2">
      <button class="w-full text-left font-medium text-chapinAzul text-xs hover:text-chapinNaranja py-1" data-ir-categoria="${cat.id}">
        ${obtenerEmojiCategoria(cat.nombre)} ${cat.nombre}
      </button>`;
    if (hijos.length) {
      html += `<div class="pl-3 space-y-0.5">`;
      hijos.forEach(hijo => {
        html += `<button class="block w-full text-left text-[11px] text-slate-600 hover:text-chapinNaranja py-0.5" data-ir-categoria="${hijo.id}">
          ${hijo.nombre}
        </button>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  });
  contenedor.innerHTML = html;

  // Delegación de clics para navegar a categoría
  contenedor.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ir-categoria]');
    if (btn) {
      const id = parseInt(btn.dataset.irCategoria);
      if (!isNaN(id)) {
        cerrarTodosLosPaneles();
        window.location.hash = `#/categoria/${id}`;
      }
    }
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
      <!-- ========== NUEVA PORTADA REDISEÑADA ========== -->
      <div class="hero-wrapper relative rounded-2xl overflow-hidden bg-gradient-to-br from-chapinAzul via-[#0a2a4a] to-chapinAzulClaro text-white shadow-2xl shadow-chapinAzul/30">
        
        <!-- Contenedor de slides rotativos -->
        <div class="hero-container relative w-full min-h-[280px] sm:min-h-[320px] md:min-h-[340px] overflow-hidden">
          
          <!-- Slide 1: Envíos a toda Guatemala -->
          <div class="hero-slide absolute inset-0 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-4 sm:p-6 md:p-8 transition-all duration-700 ease-in-out"
               data-slide="0">
            <div class="flex-1 z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
              <div class="flex-1 space-y-1 sm:space-y-2 text-center sm:text-left">
                <h2 class="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight leading-tight">
                  Envíos a toda
                  <span class="text-chapinNaranja block sm:inline">Guatemala</span>
                </h2>
                <p class="text-xs sm:text-sm text-white/80 max-w-md">
                  Compra en ChapínMarket y recibe en la puerta de tu casa. Cobertura nacional con los mejores tiempos de entrega.
                </p>
              </div>
              <div class="hero-icon-grande flex items-center justify-center">
                <img src="https://cdn3d.iconscout.com/3d/premium/thumb/camion-3d-icon-png-download-3918064.png" 
                     alt="Camión de envíos" class="w-full h-full object-contain drop-shadow-lg" />
              </div>
            </div>
            <div class="hero-image-wrapper relative w-full sm:w-[45%] md:w-[50%] h-36 sm:h-48 md:h-56 rounded-xl overflow-hidden flex-shrink-0">
              <div class="hero-image-mask absolute inset-0 z-10 pointer-events-none"></div>
              <img src="https://kayakguatemala.com/wp-content/uploads/2024/01/c9fa6cc5-4afe-44b3-af83-44ca556ca995.png" 
                   alt="Envíos a toda Guatemala" 
                   class="w-full h-full object-cover"
                   loading="eager" />
            </div>
          </div>

          <!-- Slide 2: Promociones de fiestas patrias -->
          <div class="hero-slide absolute inset-0 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-4 sm:p-6 md:p-8 transition-all duration-700 ease-in-out opacity-0 translate-x-8 pointer-events-none"
               data-slide="1">
            <div class="flex-1 z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
              <div class="flex-1 space-y-1 sm:space-y-2 text-center sm:text-left">
                <h2 class="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight leading-tight">
                  Promociones de
                  <span class="text-chapinNaranja block sm:inline">Fiestas Patrias</span>
                </h2>
                <p class="text-xs sm:text-sm text-white/80 max-w-md">
                  Aprovecha descuentos especiales en productos con sabor chapín. ¡Celebra Guatemala con las mejores ofertas!
                </p>
              </div>
              <div class="hero-icon-grande flex items-center justify-center">
                <img src="https://img.freepik.com/3d-models/v2/Q/0/I/R/F/1/Z/Q0IRF1ZR/marimba-icon-poster-1.png" 
                     alt="Marimba" class="w-full h-full object-contain drop-shadow-lg" />
              </div>
            </div>
            <div class="hero-image-wrapper relative w-full sm:w-[45%] md:w-[50%] h-36 sm:h-48 md:h-56 rounded-xl overflow-hidden flex-shrink-0">
              <div class="hero-image-mask absolute inset-0 z-10 pointer-events-none"></div>
              <img src="https://radiotgw.gob.gt/wp-content/uploads/2024/09/Captura-de-pantalla-2024-09-06-113910-1140x570-1-920x425.png" 
                   alt="Promociones fiestas patrias" 
                   class="w-full h-full object-cover"
                   loading="lazy" />
            </div>
          </div>

          <!-- Slide 3: Tecnología para estudiar -->
          <div class="hero-slide absolute inset-0 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-4 sm:p-6 md:p-8 transition-all duration-700 ease-in-out opacity-0 translate-x-8 pointer-events-none"
               data-slide="2">
            <div class="flex-1 z-10 flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
              <div class="flex-1 space-y-1 sm:space-y-2 text-center sm:text-left">
                <h2 class="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight leading-tight">
                  Tecnología para
                  <span class="text-chapinNaranja block sm:inline">Estudiar</span>
                </h2>
                <p class="text-xs sm:text-sm text-white/80 max-w-md">
                  Laptops, tablets y más para el regreso a clases. Equípate con la mejor tecnología al mejor precio.
                </p>
              </div>
              <div class="hero-icon-grande flex items-center justify-center">
                <img src="https://static.vecteezy.com/system/resources/thumbnails/047/588/455/small/cartoon-computer-monitor-with-keyboard-and-mouse-3d-icon-isolated-on-the-transparent-background-png.png" 
                     alt="Tecnología" class="w-full h-full object-contain drop-shadow-lg" />
              </div>
            </div>
            <div class="hero-image-wrapper relative w-full sm:w-[45%] md:w-[50%] h-36 sm:h-48 md:h-56 rounded-xl overflow-hidden flex-shrink-0">
              <div class="hero-image-mask absolute inset-0 z-10 pointer-events-none"></div>
              <img src="https://www.campustraining.es/wp-content/uploads/2025/04/aprender-informatica-desde-cero.jpg.webp" 
                   alt="Tecnología para estudiar" 
                   class="w-full h-full object-cover"
                   loading="lazy" />
            </div>
          </div>
        </div>

        <!-- Badges informativos (parte inferior del hero, siempre visibles) -->
        <div class="hero-badges-container relative z-20 flex gap-2 sm:gap-3 justify-center sm:justify-end flex-wrap px-4 pb-3">
          <div class="info-badge flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-3 py-1.5 sm:px-4 sm:py-2 border border-white/20 hover:bg-white/20 transition-all duration-300 cursor-default">
            <div class="info-badge-icon w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/95 flex items-center justify-center p-1 shadow-md">
              <img src="https://static.vecteezy.com/system/resources/previews/009/590/479/non_2x/3d-parcel-box-delivery-with-trolley-shipping-icon-ecommerce-illustration-free-png.png" 
                   alt="Envíos" class="w-full h-full object-contain" loading="lazy" />
            </div>
            <div class="flex flex-col leading-tight">
              <span class="text-[10px] sm:text-[11px] font-bold">Envíos Rápidos</span>
              <span class="text-[9px] sm:text-[10px] text-white/70">a todo el país</span>
            </div>
          </div>

          <div class="info-badge flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-3 py-1.5 sm:px-4 sm:py-2 border border-white/20 hover:bg-white/20 transition-all duration-300 cursor-default">
            <div class="info-badge-icon w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/95 flex items-center justify-center p-1 shadow-md">
              <img src="https://cdn3d.iconscout.com/3d/premium/thumb/pago-3d-icon-png-download-11202874.png" 
                   alt="Pagos" class="w-full h-full object-contain" loading="lazy" />
            </div>
            <div class="flex flex-col leading-tight">
              <span class="text-[10px] sm:text-[11px] font-bold">Pagos Seguros</span>
              <span class="text-[9px] sm:text-[10px] text-white/70">y protegidos</span>
            </div>
          </div>

          <div class="info-badge flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-3 py-1.5 sm:px-4 sm:py-2 border border-white/20 hover:bg-white/20 transition-all duration-300 cursor-default">
            <div class="info-badge-icon w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/95 flex items-center justify-center p-1 shadow-md">
              <img src="https://cdn3d.iconscout.com/3d/premium/thumb/producto-de-calidad-3d-icon-png-download-6508245.png" 
                   alt="Calidad" class="w-full h-full object-contain" loading="lazy" />
            </div>
            <div class="flex flex-col leading-tight">
              <span class="text-[10px] sm:text-[11px] font-bold">Productos de Calidad</span>
              <span class="text-[9px] sm:text-[10px] text-white/70">para toda la familia</span>
            </div>
          </div>
        </div>

        <!-- Indicadores de slide (dots) -->
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-20">
          <button class="hero-dot w-2.5 h-2.5 rounded-full bg-white transition-all duration-300" data-dot="0" aria-label="Slide 1"></button>
          <button class="hero-dot w-2.5 h-2.5 rounded-full bg-white/40 hover:bg-white/70 transition-all duration-300" data-dot="1" aria-label="Slide 2"></button>
          <button class="hero-dot w-2.5 h-2.5 rounded-full bg-white/40 hover:bg-white/70 transition-all duration-300" data-dot="2" aria-label="Slide 3"></button>
        </div>
      </div>

      <!-- Sección de categorías destacadas (se mantiene igual) -->
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

      <!-- Resto de secciones (temporadas, productos recomendados) se mantienen igual -->
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
    const stockDisponible = obtenerStockProducto(p);
    const estaAgotado = stockDisponible <= 0;

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
              ${estaAgotado ? productoAgotadoHTML('mt-auto') : `
                <button data-agregar-carrito="${p.id}" class="mt-auto bg-chapinAzul text-white rounded-full py-1 text-[11px] hover:bg-chapinAzulClaro">
                  Agregar al carrito
                </button>
              `}
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

function obtenerStockProducto(producto) {
  if (!producto) return 0;
  const stock = producto.stock !== undefined ? producto.stock : producto.STOCK;
  const stockNumerico = Number(stock);
  return Number.isFinite(stockNumerico) ? Math.max(0, stockNumerico) : 0;
}

function obtenerCantidadProductoEnCarrito(productoId) {
  const item = estadoApp.carrito?.find(i => Number(i.productoId) === Number(productoId));
  return item ? Number(item.cantidad) || 0 : 0;
}

function productoAgotadoHTML(clasesExtra = '') {
  return `<p class="font-bold text-red-600 text-sm sm:text-base ${clasesExtra}">AGOTADO</p>`;
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
  const stockDisponible = obtenerStockProducto(producto);
  const estaAgotado = stockDisponible <= 0;

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
        ${estaAgotado ? productoAgotadoHTML('mt-2') : `
          <p class="text-xs text-slate-500">Stock disponible: ${stockDisponible}</p>
          <div class="flex items-center gap-2">
            <label class="text-xs" for="detalle-cantidad">Cantidad:</label>
            <input id="detalle-cantidad" type="number" min="1" max="${stockDisponible}" value="1"
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
        `}
      </div>
    </section>
  `;
}

function configurarEventosVistaDetalleProducto() {
  const miniaturas = document.querySelectorAll('[data-miniatura-index]');
  const imagenPrincipal = document.getElementById('detalle-imagen-principal');
  const btnAgregarElem = document.getElementById('detalle-agregar-carrito');
  const productoId = parseInt(btnAgregarElem?.dataset.idProducto || window.location.hash.split('/').pop());
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
      const stockDisponible = obtenerStockProducto(producto);
      const cantidad = Math.min(stockDisponible, Math.max(1, parseInt(inputCantidad.value) || 1));
      inputCantidad.value = cantidad;
      agregarAlCarrito(productoId, cantidad);
    });
  }

  const btnComprarAhora = document.getElementById('detalle-comprar-ahora');
  if (btnComprarAhora && inputCantidad) {
    btnComprarAhora.addEventListener('click', async () => {
      const stockDisponible = obtenerStockProducto(producto);
      const cantidad = Math.min(stockDisponible, Math.max(1, parseInt(inputCantidad.value) || 1));
      inputCantidad.value = cantidad;
      const agregado = await agregarAlCarrito(productoId, cantidad);
      if (agregado) window.location.hash = '#/checkout';
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
      const productoCatalogo = estadoApp.productos.find(p => Number(p.id) === Number(item.productoId));
      const stockDisponible = obtenerStockProducto(productoCatalogo || producto);
      const estaAgotado = stockDisponible <= 0;
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
                        ${estaAgotado ? productoAgotadoHTML('my-1') : `<p class="text-xs text-slate-500">Stock disponible: ${stockDisponible}</p>`}
                        <div class="flex items-center gap-2 mt-2">
                            <button data-carrito-decrementar="${item.productoId}" 
                                    class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 hover:bg-chapinAzul hover:text-white transition"
                                    ${item.cantidad <= 1 ? 'disabled' : ''}>-</button>
                            <input type="number" value="${item.cantidad}" min="1" max="${stockDisponible}"
                                   data-carrito-cantidad="${item.productoId}" class="w-12 text-center border rounded-md text-sm"
                                   ${estaAgotado ? 'disabled' : ''} />
                            <button data-carrito-incrementar="${item.productoId}"
                                    class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 hover:bg-chapinAzul hover:text-white transition"
                                    ${estaAgotado || item.cantidad >= stockDisponible ? 'disabled' : ''}>+</button>
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
    if (btnPago.disabled) return;

    if (!estadoApp.usuarioActual || !estadoApp.usuarioActual.id) {
      mostrarModal('Inicia sesion', '<p class="text-sm">Debes iniciar sesion para procesar el pago.</p>');
      return;
    }

    const productosSeleccionados = estadoApp.carrito.filter(item => item.seleccionado);
    if (!productosSeleccionados.length) {
      mostrarModal('Carrito vacio', '<p class="text-sm">Selecciona al menos un producto para pagar.</p>');
      return;
    }

    btnPago.disabled = true;
    btnPago.classList.add('opacity-60', 'cursor-not-allowed');

    mostrarModalCargaPago();

    const pagoPromise = (async () => {
      const datosPago = await obtenerDatosPagoCheckout();
      if (!datosPago.ok) {
        return { ok: false, mensaje: datosPago.mensaje };
      }

      return llamarApi('/public/pago', {
        method: 'POST',
        body: JSON.stringify(datosPago.payload)
      });
    })();

    const [resp] = await Promise.all([
      pagoPromise,
      esperar(5000)
    ]);

    cerrarModal();

    if (resp.ok) {
      window.location.hash = '/';
      
      setTimeout(() => {
        mostrarModal(
          '✅ Hemos recibido tu pedido exitosamente!',
          '<p class="text-sm">Gracias por tu pedido! Puedes ver tus pedidos en tu perfil/pedidos</p>'
        );

        setTimeout(() => {
          cerrarModal();
          window.location.reload();
        }, 1500);
      }, 150);
    } else {
      btnPago.disabled = false;
      btnPago.classList.remove('opacity-60', 'cursor-not-allowed');
      mostrarModal('Pago no procesado', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo procesar el pago. Intenta nuevamente.'}</p>`);
    }
    return;

    const subtotal = estadoApp.carrito
      .filter(item => item.seleccionado)
      .reduce((sum, item) => {
        const prod = estadoApp.productos.find(p => p.id === item.productoId);
        return sum + (prod ? prod.precio * item.cantidad : 0);
      }, 0);

    const envio = 25;
    const total = subtotal + envio;

    const respMock = await llamarApi('/public/pago', {
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

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mostrarModalCargaPago() {
  mostrarModal('', `
    <div class="flex flex-col items-center justify-center py-8 text-center">
      <div class="w-12 h-12 border-4 border-slate-200 border-t-chapinNaranja rounded-full animate-spin mb-4"></div>
      <p id="texto-loading-pago" class="text-sm font-semibold text-chapinAzul">Ingresando pedido...</p>
    </div>
  `);

  const texto = document.getElementById('texto-loading-pago');
  if (!texto) return;

  setTimeout(() => { texto.textContent = 'Ingresando transaccion...'; }, 2000);
  setTimeout(() => { texto.textContent = 'Validando pago...'; }, 4000);
}

async function obtenerDatosPagoCheckout() {
  const perfilResp = await llamarApi('/public/perfil', { method: 'GET' });
  if (perfilResp.ok && perfilResp.datos) {
    estadoApp.usuarioActual = {
      ...estadoApp.usuarioActual,
      ...perfilResp.datos,
      direcciones: perfilResp.datos.direcciones || estadoApp.usuarioActual?.direcciones || [],
      tarjetas: perfilResp.datos.tarjetas || estadoApp.usuarioActual?.tarjetas || []
    };
    guardarSesionEnLocalStorage();
  }

  const carritoResp = await llamarApi('/public/carrito', { method: 'GET' });
  const datosCarrito = carritoResp.datos?.data || carritoResp.datos || {};
  const carritoId = datosCarrito.carrito_id || datosCarrito.carritoId;

  if (!carritoResp.ok || !carritoId) {
    return { ok: false, mensaje: 'No se pudo obtener el carrito activo.' };
  }

  const direccion = obtenerDireccionCheckout();
  if (!direccion || !direccion.id) {
    return { ok: false, mensaje: 'Necesitas tener una direccion guardada en tu perfil para procesar el pedido.' };
  }

  const tarjeta = obtenerTarjetaCheckout();
  if (!tarjeta.ok) {
    return tarjeta;
  }

  return {
    ok: true,
    payload: {
      usuarioId: estadoApp.usuarioActual.id,
      carritoId: carritoId,
      direccionId: direccion.id,
      titular: tarjeta.titular,
      numeroTarjeta: tarjeta.numeroTarjeta,
      vencimiento: tarjeta.vencimiento
    }
  };
}

function obtenerDireccionCheckout() {
  const direcciones = estadoApp.usuarioActual?.direcciones || [];
  return direcciones.find(d => Number(d.esPredeterminada) === 1) || direcciones[0] || null;
}

function obtenerTarjetaCheckout() {
  const selectTarjeta = document.getElementById('select-tarjeta');
  const tarjetaSeleccionada = selectTarjeta ? selectTarjeta.value : '';

  if (tarjetaSeleccionada === 'nueva') {
    const titular = document.getElementById('nueva-titular')?.value.trim();
    const numeroTarjeta = document.getElementById('nueva-numero')?.value.trim();
    const vencimiento = document.getElementById('nueva-vencimiento')?.value.trim();

    if (!titular || !numeroTarjeta || !vencimiento) {
      return { ok: false, mensaje: 'Completa titular, numero y vencimiento de la tarjeta.' };
    }

    return { ok: true, titular, numeroTarjeta, vencimiento };
  }

  if (!tarjetaSeleccionada) {
    return { ok: false, mensaje: 'Selecciona una tarjeta guardada o ingresa una nueva.' };
  }

  const tarjeta = estadoApp.usuarioActual?.tarjetas?.find(t => String(t.id) === String(tarjetaSeleccionada));
  if (!tarjeta) {
    return { ok: false, mensaje: 'No se encontro la tarjeta seleccionada.' };
  }

  return {
    ok: true,
    titular: tarjeta.titular || estadoApp.usuarioActual.nombre || 'Cliente',
    numeroTarjeta: tarjeta.numeroEnmascarado || tarjeta.numeroTarjeta || tarjetaSeleccionada,
    vencimiento: tarjeta.vencimiento || ''
  };
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
      const stockDisponible = obtenerStockProducto(producto);
      if (!producto || stockDisponible <= 0) {
        mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
        renderizarVista();
        return;
      }
      if (cantidad > stockDisponible) {
        cantidad = stockDisponible;
        inputCantidad.value = cantidad;
        mostrarModal('Stock limitado', `<p class="text-sm">Solo tenemos ${stockDisponible} unidades disponibles.</p>`);
      }
      cantidad = Math.max(1, Math.min(cantidad, stockDisponible));
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
      const stockDisponible = obtenerStockProducto(producto);
      if (!producto || stockDisponible <= 0) {
        mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
      } else if (item && producto && item.cantidad < stockDisponible) {
        const nuevaCantidad = item.cantidad + 1;
        await actualizarCantidadCarrito(productoId, nuevaCantidad);
        actualizarValoresCarritoEnTiempoReal();
      } else if (producto && item && item.cantidad >= stockDisponible) {
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

  const usuario = estadoApp.usuarioActual;

  return `
    <section class="max-w-4xl mx-auto space-y-6">
      <!-- Cabecera -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-full bg-gradient-to-br from-chapinAzul to-chapinAzulClaro flex items-center justify-center text-white text-2xl font-bold shadow-lg">
            ${usuario.nombre ? usuario.nombre.charAt(0).toUpperCase() : '👤'}
          </div>
          <div>
            <h1 class="text-xl font-bold">${usuario.nombre || 'Usuario'}</h1>
            <p class="text-sm text-slate-500">${usuario.correo || ''}</p>
          </div>
        </div>
        <button onclick="cerrarSesion()" 
                class="text-red-500 hover:text-red-600 text-sm font-medium flex items-center gap-1 px-4 py-2 border border-red-200 rounded-full hover:bg-red-50 transition">
          <span>🚪</span> Cerrar sesión
        </button>
      </div>

      <!-- Pestañas mejoradas (responsive) -->
      <div class="perfil-tabs-container border-b border-slate-200 pb-3 mb-4">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2" id="perfil-tabs">
          <button class="perfil-tab perfil-tab-activo px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-center transition-colors"
                  data-tab="datos">
            <span class="block sm:inline">👤</span> Datos
          </button>
          <button class="perfil-tab px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 text-center transition-colors"
                  data-tab="direcciones">
            <span class="block sm:inline">📍</span> Direcciones
          </button>
          <button class="perfil-tab px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 text-center transition-colors"
                  data-tab="seguridad">
            <span class="block sm:inline">🔒</span> Seguridad
          </button>
          <button class="perfil-tab px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 text-center transition-colors"
                  data-tab="tarjetas">
            <span class="block sm:inline">💳</span> Tarjetas
          </button>
          <button class="perfil-tab px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 text-center transition-colors"
                  data-tab="pedidos">
            <span class="block sm:inline">📦</span> Pedidos
          </button>
        </div>
      </div>

      <!-- Contenido de pestañas -->
      <div id="perfil-tab-content" class="bg-white rounded-xl shadow-sm p-6">
        ${tabDatosPersonales(usuario)}
      </div>
    </section>
  `;
}

// Funciones para cada pestaña
function tabDatosPersonales(usuario) {
  const nombre = usuario?.nombre || 'Cargando...';
  const correo = usuario?.correo || 'Cargando...';
  const telefono = usuario?.telefono || '';
  return `
    <div id="tab-datos">
      <h2 class="text-lg font-semibold mb-4">Datos Personales</h2>
      <form id="form-datos-personales" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Nombre completo</label>
          <input type="text" id="perfil-nombre" value="${usuario.nombre || ''}" 
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Correo electrónico</label>
          <input type="email" id="perfil-correo" value="${correo}" readonly
                 class="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-500 cursor-not-allowed">
          <p class="text-xs text-slate-400 mt-1">El correo no se puede modificar</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Teléfono</label>
          <input type="tel" id="perfil-telefono" value="${usuario.telefono || ''}" placeholder="+502 1234-5678"
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja">
        </div>
        <button type="submit" 
                class="bg-chapinAzul text-white px-8 py-3 rounded-full font-semibold hover:bg-chapinAzulClaro transition">
          💾 Guardar Cambios
        </button>
      </form>
      <div id="mensaje-datos" class="mt-3 text-sm hidden"></div>
    </div>
  `;
}

function tabDirecciones(direcciones) {
  const lista = direcciones && direcciones.length
    ? direcciones.map(d => `
        <div class="flex items-start justify-between p-4 border border-slate-200 rounded-xl mb-3 ${d.esPredeterminada ? 'border-chapinNaranja bg-orange-50' : ''}">
          <div class="flex items-start gap-3">
            <span class="text-2xl">📍</span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold">${d.etiqueta || 'Dirección'}</span>
                ${d.esPredeterminada ? '<span class="text-xs bg-chapinNaranja text-white px-2 py-0.5 rounded-full">Predeterminada</span>' : ''}
              </div>
              <p class="text-sm text-slate-600">${d.linea1}${d.linea2 ? ', ' + d.linea2 : ''}</p>
              <p class="text-xs text-slate-400">${d.ciudad}, ${d.departamento} ${d.codigoPostal || ''}</p>
            </div>
          </div>
          <div class="flex gap-2">
            ${!d.esPredeterminada ? `<button data-marcar-predeterminada="${d.id}" class="text-xs text-chapinAzul hover:text-chapinNaranja">⭐</button>` : ''}
            <button data-editar-direccion="${d.id}" class="text-xs text-slate-500 hover:text-chapinAzul">✏️</button>
            <button data-eliminar-direccion="${d.id}" class="text-xs text-red-400 hover:text-red-600">🗑️</button>
          </div>
        </div>
      `).join('')
    : '<p class="text-slate-400 text-sm text-center py-8">No tienes direcciones guardadas</p>';

  return `
    <div id="tab-direcciones">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Mis Direcciones</h2>
        <button id="btn-agregar-direccion" class="text-sm bg-chapinNaranja text-white px-4 py-2 rounded-full hover:bg-orange-500 transition">
          + Nueva Dirección
        </button>
      </div>
      <div id="lista-direcciones">${lista}</div>
      
      <!-- Formulario para agregar/editar dirección (oculto por defecto) -->
      <div id="form-direccion-container" class="hidden border border-slate-200 rounded-xl p-4 mt-4">
        <h3 class="font-semibold mb-3" id="form-direccion-titulo">Nueva Dirección</h3>
        <form id="form-direccion" class="space-y-3">
          <input type="hidden" id="dir-id" value="">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium mb-1">Etiqueta</label>
              <select id="dir-etiqueta" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="Casa">🏠 Casa</option>
                <option value="Trabajo">🏢 Trabajo</option>
                <option value="Otro">📍 Otro</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium mb-1">Código Postal</label>
              <input type="text" id="dir-codigo-postal" placeholder="01001" class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Dirección (línea 1) *</label>
            <input type="text" id="dir-linea1" placeholder="Ej: 5ta Avenida 8-42" required class="w-full border rounded-lg px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Referencia (línea 2)</label>
            <input type="text" id="dir-linea2" placeholder="Zona 1, frente al parque" class="w-full border rounded-lg px-3 py-2 text-sm">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium mb-1">Ciudad</label>
              <input type="text" id="dir-ciudad" value="Ciudad de Guatemala" class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium mb-1">Departamento</label>
              <input type="text" id="dir-departamento" value="Guatemala" class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" id="dir-predeterminada" class="rounded">
            <label for="dir-predeterminada" class="text-sm">Marcar como dirección predeterminada</label>
          </div>
          <div class="flex gap-3">
            <button type="submit" class="bg-chapinAzul text-white px-6 py-2 rounded-full text-sm font-semibold">Guardar</button>
            <button type="button" id="btn-cancelar-direccion" class="border border-slate-300 px-6 py-2 rounded-full text-sm">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function tabSeguridad() {
  const correoUsuario = estadoApp.usuarioActual?.correo || '';
  return `
    <div id="tab-seguridad">
      <h2 class="text-lg font-semibold mb-4">Cambiar Contraseña</h2>
      <form id="form-cambiar-password" class="space-y-4 max-w-md">
        <!-- Campo oculto requerido por accesibilidad del navegador para evitar advertencia de username -->
        <input type="text" name="username" value="${correoUsuario}"
               autocomplete="username" style="display:none;" aria-hidden="true" tabindex="-1" readonly>
        <div>
          <label class="block text-sm font-medium mb-1">Contraseña actual</label>
          <input type="password" id="pass-actual" required placeholder="••••••••"
                 autocomplete="current-password"
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja">
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Nueva contraseña</label>
          <input type="password" id="pass-nueva" required placeholder="Mínimo 6 caracteres"
                 autocomplete="new-password"
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja">
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Confirmar nueva contraseña</label>
          <input type="password" id="pass-confirmar" required placeholder="Repite la nueva contraseña"
                 autocomplete="new-password"
                 class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-chapinNaranja">
        </div>
        <button type="submit" 
                class="bg-chapinNaranja text-white px-8 py-3 rounded-full font-semibold hover:bg-orange-500 transition">
          🔒 Actualizar Contraseña
        </button>
      </form>
      <div id="mensaje-password" class="mt-3 text-sm hidden"></div>
    </div>
  `;
}

function tabTarjetas(tarjetas) {
  const lista = tarjetas && tarjetas.length
    ? tarjetas.map(t => `
        <div class="flex items-center justify-between p-4 bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl mb-3">
          <div class="flex items-center gap-3">
            <span class="text-2xl">💳</span>
            <div>
              <p class="font-semibold">${t.tipo || 'Tarjeta'} **** ${t.numeroEnmascarado || '****'}</p>
              <p class="text-xs text-slate-300">${t.titular || ''} • Vence: ${t.vencimiento || ''}</p>
            </div>
          </div>
          <button data-eliminar-tarjeta="${t.id}" class="text-red-400 hover:text-red-300 text-sm">🗑️</button>
        </div>
      `).join('')
    : '<p class="text-slate-400 text-sm text-center py-8">No tienes tarjetas guardadas</p>';

  return `
    <div id="tab-tarjetas">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Tarjetas Guardadas</h2>
        <button id="btn-agregar-tarjeta" class="text-sm bg-chapinNaranja text-white px-4 py-2 rounded-full hover:bg-orange-500 transition">
          + Agregar Tarjeta
        </button>
      </div>
      <div id="lista-tarjetas">${lista}</div>
      
      <div id="form-tarjeta-container" class="hidden border border-slate-200 rounded-xl p-4 mt-4">
        <h3 class="font-semibold mb-3">Nueva Tarjeta</h3>
        <p class="text-xs text-slate-400 mb-3">🔒 Solo guardamos los últimos 4 dígitos de tu tarjeta</p>
        <form id="form-tarjeta" class="space-y-3">
          <div>
            <label class="block text-xs font-medium mb-1">Nombre del titular</label>
            <input type="text" id="tarjeta-titular" required placeholder="Como aparece en la tarjeta"
                   class="w-full border rounded-lg px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-xs font-medium mb-1">Número de tarjeta</label>
            <input type="text" id="tarjeta-numero" required placeholder="0000 0000 0000 0000" maxlength="19"
                   class="w-full border rounded-lg px-3 py-2 text-sm">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium mb-1">Vencimiento</label>
              <input type="text" id="tarjeta-vencimiento" required placeholder="MM/AA" maxlength="5"
                     class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium mb-1">CVV</label>
              <input type="text" id="tarjeta-cvv" placeholder="123" maxlength="4"
                     class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
          </div>
          <div class="flex gap-3">
            <button type="submit" class="bg-chapinAzul text-white px-6 py-2 rounded-full text-sm font-semibold">Guardar</button>
            <button type="button" id="btn-cancelar-tarjeta" class="border border-slate-300 px-6 py-2 rounded-full text-sm">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function formatearFechaPedido(fecha) {
  if (!fecha) return 'Fecha no disponible';
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' });
}

function obtenerEstiloEstadoPedido(estado) {
  const estadosEstilos = {
    'pendiente': 'bg-yellow-100 text-yellow-700',
    'enviado': 'bg-blue-100 text-blue-700',
    'entregado': 'bg-green-100 text-green-700',
    'cancelado': 'bg-red-100 text-red-700'
  };

  return estadosEstilos[String(estado || '').toLowerCase()] || 'bg-slate-100 text-slate-600';
}

function tabPedidos(pedidos) {

  const lista = pedidos && pedidos.length
    ? pedidos.map(p => `
        <div data-ver-pedido="${p.id}" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-slate-200 rounded-xl mb-3 hover:shadow-md hover:border-chapinAzul/30 transition cursor-pointer">
          <div class="flex items-center gap-4">
            <span class="text-2xl">📦</span>
            <div>
              <p class="font-semibold">Pedido #${p.id}</p>
              <p class="text-xs text-slate-500">${formatearFechaPedido(p.fecha)}</p>
              <p class="text-xs text-slate-400">${p.cantidadItems || 0} artículo(s)</p>
            </div>
          </div>
          <div class="flex items-center justify-between sm:justify-end gap-3 sm:text-right">
            <button data-ver-pedido="${p.id}" class="bg-chapinAzul text-white rounded-full px-4 py-2 text-xs font-semibold hover:bg-chapinAzulClaro transition">
              Ver detalle
            </button>
            <div>
              <p class="font-bold text-chapinAzul">Q${(p.total || 0).toFixed(2)}</p>
              <span class="text-xs px-2 py-1 rounded-full ${obtenerEstiloEstadoPedido(p.estado)}">${p.estado || 'pendiente'}</span>
            </div>
          </div>
        </div>
      `).join('')
    : '<p class="text-slate-400 text-sm text-center py-8">No tienes pedidos aún</p>';

  return `
    <div id="tab-pedidos">
      <h2 class="text-lg font-semibold mb-4">Historial de Pedidos</h2>
      <div id="lista-pedidos">${lista}</div>
    </div>
  `;
}

function vistaDetallePedido(idPedido) {
  if (!estadoApp.usuarioActual) {
    window.location.hash = '#/login';
    return '';
  }

  return `
    <section class="max-w-5xl mx-auto space-y-4" id="detalle-pedido" data-pedido-id="${idPedido}">
      <button id="volver-a-pedidos" class="text-chapinAzul hover:text-chapinNaranja text-sm font-semibold">
        ← Volver a mis pedidos
      </button>
      <div id="detalle-pedido-contenido" class="bg-white rounded-xl shadow-sm p-6">
        <div class="animate-pulse space-y-4">
          <div class="h-5 bg-slate-200 rounded w-48"></div>
          <div class="h-4 bg-slate-100 rounded w-full"></div>
          <div class="h-24 bg-slate-100 rounded"></div>
        </div>
      </div>
    </section>
  `;
}

function renderDetallePedido(pedido) {
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  const subtotal = Number(pedido.subtotalItems ?? items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0));
  const total = Number(pedido.total) || 0;
  const diferencia = Math.max(0, total - subtotal);

  const itemsHTML = items.length
    ? items.map(item => {
      const producto = item.producto || {};
      const imagen = producto.imagen || obtenerImagenProducto(producto);
      const cantidad = Number(item.cantidad) || 0;
      const precioUnitario = Number(item.precioUnitario) || 0;
      const subtotalItem = Number(item.subtotal) || cantidad * precioUnitario;

      return `
        <div class="flex gap-3 p-3 border border-slate-100 rounded-lg">
          <div class="w-16 h-16 rounded-md bg-slate-100 overflow-hidden flex-shrink-0">
            <img src="${imagen}" alt="${producto.nombre || 'Producto'}" class="w-full h-full object-cover" onerror="this.style.display='none'" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm">${producto.nombre || 'Producto'}</p>
            <p class="text-xs text-slate-500 mt-1">Cantidad vendida: ${cantidad}</p>
            <p class="text-xs text-slate-500">Precio unitario: Q${precioUnitario.toFixed(2)}</p>
          </div>
          <div class="text-right font-semibold text-chapinAzul whitespace-nowrap">
            Q${subtotalItem.toFixed(2)}
          </div>
        </div>
      `;
    }).join('')
    : '<p class="text-sm text-slate-400 text-center py-8">Este pedido no tiene items registrados.</p>';

  return `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold">Pedido #${pedido.id}</h1>
          <p class="text-sm text-slate-500">${formatearFechaPedido(pedido.fecha)}</p>
        </div>
        <span class="self-start text-xs px-3 py-1 rounded-full font-semibold ${obtenerEstiloEstadoPedido(pedido.estado)}">
          ${pedido.estado || 'pendiente'}
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div class="border border-slate-100 rounded-lg p-3">
          <p class="text-xs text-slate-500">Método de pago</p>
          <p class="font-semibold">${pedido.metodoPago || 'No disponible'}</p>
        </div>
        <div class="border border-slate-100 rounded-lg p-3">
          <p class="text-xs text-slate-500">Productos</p>
          <p class="font-semibold">${pedido.cantidadItems || items.length} item(s), ${pedido.totalUnidades || 0} unidad(es)</p>
        </div>
        <div class="border border-slate-100 rounded-lg p-3">
          <p class="text-xs text-slate-500">Total del pedido</p>
          <p class="font-semibold text-chapinAzul">Q${total.toFixed(2)}</p>
        </div>
      </div>

      ${pedido.direccionEnvio ? `
        <div class="border border-slate-100 rounded-lg p-3 text-sm">
          <p class="text-xs text-slate-500">Dirección de envío</p>
          <p class="font-medium">${pedido.direccionEnvio}</p>
        </div>
      ` : ''}

      <div>
        <h2 class="font-semibold mb-3">Productos del pedido</h2>
        <div class="space-y-3">${itemsHTML}</div>
      </div>

      <div class="border-t pt-4 space-y-2 text-sm max-w-sm ml-auto">
        <p class="flex justify-between"><span>Subtotal items:</span><span>Q${subtotal.toFixed(2)}</span></p>
        <p class="flex justify-between"><span>Cargos/envío:</span><span>${diferencia > 0 ? 'Q' + diferencia.toFixed(2) : 'Incluido'}</span></p>
        <p class="flex justify-between text-lg font-bold text-chapinAzul"><span>Total:</span><span>Q${total.toFixed(2)}</span></p>
      </div>
    </div>
  `;
}

function configurarTabPedidos() {
  document.querySelectorAll('[data-ver-pedido]').forEach((elem) => {
    elem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = parseInt(elem.dataset.verPedido);
      if (id) window.location.hash = `#/pedido/${id}`;
    });
  });
}

async function configurarEventosVistaDetallePedido(idPedido) {
  const btnVolver = document.getElementById('volver-a-pedidos');
  if (btnVolver) {
    btnVolver.addEventListener('click', () => {
      window.location.hash = '#/perfil';
      setTimeout(() => {
        const tabPedidosBtn = document.querySelector('[data-tab="pedidos"]');
        if (tabPedidosBtn) tabPedidosBtn.click();
      }, 100);
    });
  }

  const contenedor = document.getElementById('detalle-pedido-contenido');
  if (!contenedor) return;

  const uid = estadoApp.usuarioActual?.id || JSON.parse(localStorage.getItem('chapinMarket_usuario') || '{}')?.id;
  const url = uid ? `/public/pedidos/${idPedido}?uid=${uid}` : `/public/pedidos/${idPedido}`;
  const resp = await llamarApi(url, { method: 'GET' });

  if (resp.ok && resp.datos) {
    contenedor.innerHTML = renderDetallePedido(resp.datos);
  } else {
    contenedor.innerHTML = `
      <div class="text-center py-10">
        <p class="text-sm text-red-600 mb-3">${resp.mensaje || 'No se pudo cargar el detalle del pedido.'}</p>
        <button onclick="window.location.hash='#/perfil'" class="bg-chapinAzul text-white rounded-full px-5 py-2 text-sm font-semibold">
          Volver al perfil
        </button>
      </div>
    `;
  }
}

function configurarEventosVistaPerfil() {
  // Variables para almacenar datos completos del perfil
  let perfilCompleto = null;
  let cargando = false;

  // Cargar datos completos del perfil
  async function cargarPerfilCompleto() {
    if (cargando) return;
    cargando = true;
    try {
      const uid = (estadoApp.usuarioActual && estadoApp.usuarioActual.id)
        || (JSON.parse(localStorage.getItem('chapinMarket_usuario'))?.id);
      const url = uid ? `/public/perfil?uid=${uid}` : '/public/perfil';
      const resp = await llamarApi(url, { method: 'GET' });
      if (resp.ok && resp.datos) {
        perfilCompleto = resp.datos;
        estadoApp.usuarioActual = {
          ...estadoApp.usuarioActual,
          nombre: perfilCompleto.nombre,
          correo: perfilCompleto.correo,
          telefono: perfilCompleto.telefono,
          direccion: perfilCompleto.direccion,
          direcciones: perfilCompleto.direcciones || [],
          tarjetas: perfilCompleto.tarjetas || [],
          pedidos: perfilCompleto.pedidos || []
        };
        guardarSesionEnLocalStorage();
        actualizarTextoUsuario();
      }
    } catch (e) {
      console.error('Error cargando perfil:', e);
    } finally {
      cargando = false;
    }
  }

  // Función para recargar y actualizar pestaña específica
  async function cargarPerfilCompletoYActualizarTab(tabName) {
    try {
      const uid = estadoApp.usuarioActual?.id || JSON.parse(localStorage.getItem('chapinMarket_usuario'))?.id;
      const url = uid ? `/public/perfil?uid=${uid}` : '/public/perfil';
      const resp = await llamarApi(url, { method: 'GET' });
      if (resp.ok && resp.datos) {
        perfilCompleto = resp.datos;
        estadoApp.usuarioActual = {
          ...estadoApp.usuarioActual,
          nombre: resp.datos.nombre,
          correo: resp.datos.correo,
          telefono: resp.datos.telefono,
          direccion: resp.datos.direccion,
          direcciones: resp.datos.direcciones || [],
          tarjetas: resp.datos.tarjetas || [],
          pedidos: resp.datos.pedidos || []
        };
        guardarSesionEnLocalStorage();
        actualizarTextoUsuario();

        // Actualizar solo el contenido de la pestaña activa
        const tabContent = document.getElementById('perfil-tab-content');
        if (tabContent) {
          switch (tabName) {
            case 'direcciones':
              tabContent.innerHTML = tabDirecciones(estadoApp.usuarioActual.direcciones);
              configurarTabDirecciones();
              break;
            case 'tarjetas':
              tabContent.innerHTML = tabTarjetas(estadoApp.usuarioActual.tarjetas);
              configurarTabTarjetas();
              break;
            case 'pedidos':
              tabContent.innerHTML = tabPedidos(estadoApp.usuarioActual.pedidos);
              configurarTabPedidos();
              break;
            case 'datos':
              tabContent.innerHTML = tabDatosPersonales(estadoApp.usuarioActual);
              configurarTabDatos();
              break;
          }
        }
      }
    } catch (e) {
      console.error('Error recargando perfil:', e);
    }
  }

  // ============ PESTAÑAS ============
  document.querySelectorAll('.perfil-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      // Actualizar estilos de pestañas
      document.querySelectorAll('.perfil-tab').forEach(t => {
        t.classList.remove('perfil-tab-activo');
      });
      tab.classList.add('perfil-tab-activo');

      const tabName = tab.dataset.tab;

      // Cargar datos completos si es necesario
      if ((!estadoApp.usuarioActual?.direcciones || !estadoApp.usuarioActual?.direcciones.length) &&
        (tabName === 'direcciones' || tabName === 'tarjetas' || tabName === 'pedidos')) {
        await cargarPerfilCompleto();           // actualiza estadoApp.usuarioActual
      }

      // ✅ Leer SIEMPRE del estado más reciente después del await
      const usuario = estadoApp.usuarioActual;

      let contenido = '';
      switch (tabName) {
        case 'datos':
          contenido = tabDatosPersonales(usuario);
          break;
        case 'direcciones':
          contenido = tabDirecciones(usuario?.direcciones || []);
          break;
        case 'seguridad':
          contenido = tabSeguridad();
          break;
        case 'tarjetas':
          contenido = tabTarjetas(usuario?.tarjetas || []);
          break;
        case 'pedidos':
          contenido = tabPedidos(usuario?.pedidos || []);
          break;
      }

      document.getElementById('perfil-tab-content').innerHTML = contenido;
      configurarEventosTabActiva(tabName);
    });
  });

  // Cargar perfil completo al entrar y luego rellenar campos
  // Cargar perfil completo al entrar, luego re-renderizar el tab con datos reales de la BD
  cargarPerfilCompleto().then(() => {
    const usuario = estadoApp.usuarioActual;
    if (usuario) {
      // Re-renderizar el tab de datos con los datos frescos del backend
      const tabContent = document.getElementById('perfil-tab-content');
      if (tabContent) {
        tabContent.innerHTML = tabDatosPersonales(usuario);
      }
      // También actualizar la cabecera del perfil (nombre y correo visibles arriba)
      const h1Perfil = document.querySelector('#vista-principal h1');
      if (h1Perfil) h1Perfil.textContent = usuario.nombre || 'Usuario';
      const emailPerfil = document.querySelector('#vista-principal .text-slate-500');
      if (emailPerfil && usuario.correo) emailPerfil.textContent = usuario.correo;
      // Actualizar el avatar (inicial del nombre)
      const avatar = document.querySelector('#vista-principal .rounded-full.bg-gradient-to-br');
      if (avatar && usuario.nombre) avatar.textContent = usuario.nombre.charAt(0).toUpperCase();
    }
    configurarEventosTabActiva('datos');
  });
}

async function recargarDatosPerfilYActualizarTab(tabName) {
  try {
    const uid = estadoApp.usuarioActual?.id || JSON.parse(localStorage.getItem('chapinMarket_usuario'))?.id;
    const url = uid ? `/public/perfil?uid=${uid}` : '/public/perfil';
    const resp = await llamarApi(url, { method: 'GET' });
    if (resp.ok && resp.datos) {
      estadoApp.usuarioActual = {
        ...estadoApp.usuarioActual,
        nombre: resp.datos.nombre,
        correo: resp.datos.correo,
        telefono: resp.datos.telefono,
        direccion: resp.datos.direccion,
        direcciones: resp.datos.direcciones || [],
        tarjetas: resp.datos.tarjetas || [],
        pedidos: resp.datos.pedidos || []
      };
      guardarSesionEnLocalStorage();
      actualizarTextoUsuario();

      const tabContent = document.getElementById('perfil-tab-content');
      if (tabContent) {
        switch (tabName) {
          case 'direcciones':
            tabContent.innerHTML = tabDirecciones(estadoApp.usuarioActual.direcciones);
            configurarTabDirecciones();
            break;
          case 'tarjetas':
            tabContent.innerHTML = tabTarjetas(estadoApp.usuarioActual.tarjetas);
            configurarTabTarjetas();
            break;
          case 'pedidos':
            tabContent.innerHTML = tabPedidos(estadoApp.usuarioActual.pedidos);
            configurarTabPedidos();
            break;
          case 'datos':
            tabContent.innerHTML = tabDatosPersonales(estadoApp.usuarioActual);
            configurarTabDatos();
            break;
        }
      }
    }
  } catch (e) {
    console.error('Error recargando perfil:', e);
  }
}

function configurarEventosTabActiva(tabName) {
  switch (tabName) {
    case 'datos':
      configurarTabDatos();
      break;
    case 'direcciones':
      configurarTabDirecciones();
      break;
    case 'seguridad':
      configurarTabSeguridad();
      break;
    case 'tarjetas':
      configurarTabTarjetas();
      break;
    case 'pedidos':
      configurarTabPedidos();
      // Solo lectura, no requiere eventos específicos
      break;
  }
}

// ============ TAB DATOS PERSONALES ============
function configurarTabDatos() {
  const form = document.getElementById('form-datos-personales');
  if (!form) return;

  // Precargar datos del usuario actual
  const usuario = estadoApp.usuarioActual;
  if (usuario) {
    const nombreInput = document.getElementById('perfil-nombre');
    const correoInput = document.getElementById('perfil-correo');
    const telefonoInput = document.getElementById('perfil-telefono');

    if (nombreInput) nombreInput.value = usuario.nombre || '';
    if (correoInput) correoInput.value = usuario.correo || '';
    if (telefonoInput) telefonoInput.value = usuario.telefono || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('perfil-nombre').value.trim();
    const telefono = document.getElementById('perfil-telefono').value.trim();

    if (!nombre) {
      mostrarModal('Error', '<p class="text-sm text-red-600">El nombre es requerido</p>');
      return;
    }

    const resp = await llamarApi('/public/perfil/datos', {
      method: 'PUT',
      body: JSON.stringify({ nombre, telefono })
    });

    const mensaje = document.getElementById('mensaje-datos');
    if (!mensaje) return;

    if (resp.ok) {
      // Actualizar estado local
      estadoApp.usuarioActual.nombre = nombre;
      estadoApp.usuarioActual.telefono = telefono;
      guardarSesionEnLocalStorage();
      actualizarTextoUsuario();

      mensaje.className = 'mt-3 text-sm text-green-600 bg-green-50 p-3 rounded-lg';
      mensaje.textContent = '✅ Datos actualizados correctamente';
    } else {
      mensaje.className = 'mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-lg';
      mensaje.textContent = '❌ ' + (resp.mensaje || 'Error al actualizar');
    }
    mensaje.classList.remove('hidden');
    setTimeout(() => mensaje.classList.add('hidden'), 3000);
  });
}

// ============ TAB DIRECCIONES ============
function configurarTabDirecciones() {
  const btnAgregar = document.getElementById('btn-agregar-direccion');
  const formContainer = document.getElementById('form-direccion-container');
  const btnCancelar = document.getElementById('btn-cancelar-direccion');
  const form = document.getElementById('form-direccion');

  if (btnAgregar && formContainer) {
    btnAgregar.addEventListener('click', () => {
      document.getElementById('form-direccion-titulo').textContent = 'Nueva Dirección';
      document.getElementById('dir-id').value = '';
      if (form) form.reset();
      formContainer.classList.remove('hidden');
    });
  }

  if (btnCancelar && formContainer) {
    btnCancelar.addEventListener('click', () => {
      formContainer.classList.add('hidden');
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('dir-id').value;
      const data = {
        etiqueta: document.getElementById('dir-etiqueta').value,
        linea1: document.getElementById('dir-linea1').value,
        linea2: document.getElementById('dir-linea2').value,
        ciudad: document.getElementById('dir-ciudad').value,
        departamento: document.getElementById('dir-departamento').value,
        codigoPostal: document.getElementById('dir-codigo-postal').value,
        esPredeterminada: document.getElementById('dir-predeterminada').checked ? 1 : 0
      };

      if (!data.linea1 || !data.linea1.trim()) {
        mostrarModal('Error', '<p class="text-sm text-red-600">La dirección es requerida</p>');
        return;
      }

      const url = id
        ? '/public/perfil/direcciones/' + id
        : '/public/perfil/direcciones';
      const method = id ? 'PUT' : 'POST';

      const resp = await llamarApi(url, { method, body: JSON.stringify(data) });

      if (resp.ok) {
        mostrarModal(id ? 'Dirección actualizada' : 'Dirección agregada',
          '<p class="text-sm">Los cambios se guardaron correctamente.</p>');
        formContainer.classList.add('hidden');
        // Recargar lista de direcciones
        await recargarDatosPerfilYActualizarTab('direcciones');
      } else {
        mostrarModal('Error', '<p class="text-sm text-red-600">' + (resp.mensaje || 'No se pudo guardar') + '</p>');
      }
    });
  }

  // Botones eliminar dirección
  document.querySelectorAll('[data-eliminar-direccion]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.eliminarDireccion;
      if (confirm('¿Eliminar esta dirección?')) {
        const resp = await llamarApi('/public/perfil/direcciones/' + id, { method: 'DELETE' });
        if (resp.ok) {
          mostrarModal('Dirección eliminada', '<p class="text-sm">Se eliminó correctamente.</p>');
          await recargarDatosPerfilYActualizarTab('direcciones');
        } else {
          mostrarModal('Error', '<p class="text-sm text-red-600">' + (resp.mensaje || 'No se pudo eliminar') + '</p>');
        }
      }
    });
  });

  // Botones editar dirección
  document.querySelectorAll('[data-editar-direccion]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.editarDireccion);
      const dir = estadoApp.usuarioActual.direcciones?.find(d => d.id === id);
      if (dir) {
        document.getElementById('form-direccion-titulo').textContent = 'Editar Dirección';
        document.getElementById('dir-id').value = dir.id;
        document.getElementById('dir-etiqueta').value = dir.etiqueta || 'Casa';
        document.getElementById('dir-linea1').value = dir.linea1 || '';
        document.getElementById('dir-linea2').value = dir.linea2 || '';
        document.getElementById('dir-ciudad').value = dir.ciudad || 'Ciudad de Guatemala';
        document.getElementById('dir-departamento').value = dir.departamento || 'Guatemala';
        document.getElementById('dir-codigo-postal').value = dir.codigoPostal || '';
        document.getElementById('dir-predeterminada').checked = dir.esPredeterminada === 1;
        if (formContainer) formContainer.classList.remove('hidden');
      }
    });
  });

  // Botones marcar como predeterminada
  document.querySelectorAll('[data-marcar-predeterminada]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.marcarPredeterminada);
      const resp = await llamarApi('/public/perfil/direcciones/' + id, {
        method: 'PUT',
        body: JSON.stringify({ esPredeterminada: 1 })
      });
      if (resp.ok) {
        mostrarModal('Dirección predeterminada', '<p class="text-sm">Se actualizó correctamente.</p>');
        await recargarDatosPerfilYActualizarTab('direcciones');
      } else {
        mostrarModal('Error', '<p class="text-sm text-red-600">' + (resp.mensaje || 'No se pudo actualizar') + '</p>');
      }
    });
  });
}

// ============ TAB SEGURIDAD ============
function configurarTabSeguridad() {
  const form = document.getElementById('form-cambiar-password');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordActual = document.getElementById('pass-actual').value;
    const passwordNueva = document.getElementById('pass-nueva').value;
    const passwordConfirmar = document.getElementById('pass-confirmar').value;

    // Validaciones frontend completas
    if (!passwordActual || !passwordNueva || !passwordConfirmar) {
      mostrarModal('Error', '<p class="text-sm text-red-600">Todos los campos son requeridos</p>');
      return;
    }

    if (passwordNueva.length < 6) {
      mostrarModal('Error', '<p class="text-sm text-red-600">La nueva contraseña debe tener al menos 6 caracteres</p>');
      return;
    }

    if (passwordNueva !== passwordConfirmar) {
      mostrarModal('Error', '<p class="text-sm text-red-600">Las contraseñas no coinciden</p>');
      return;
    }

    if (passwordActual === passwordNueva) {
      mostrarModal('Error', '<p class="text-sm text-red-600">La nueva contraseña debe ser diferente a la actual</p>');
      return;
    }

    const resp = await llamarApi('/public/perfil/password', {
      method: 'PUT',
      body: JSON.stringify({
        passwordActual: passwordActual,
        passwordNueva: passwordNueva,
        passwordConfirmar: passwordConfirmar
      })
    });

    const mensaje = document.getElementById('mensaje-password');
    if (!mensaje) return;

    if (resp.ok) {
      mensaje.className = 'mt-3 text-sm text-green-600 bg-green-50 p-3 rounded-lg';
      mensaje.textContent = '✅ Contraseña actualizada correctamente';
      form.reset();
    } else {
      mensaje.className = 'mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-lg';
      mensaje.textContent = '❌ ' + (resp.mensaje || 'Error al cambiar la contraseña');
    }
    mensaje.classList.remove('hidden');
    setTimeout(() => mensaje.classList.add('hidden'), 4000);
  });
}

// ============ TAB TARJETAS ============
function configurarTabTarjetas() {
  const btnAgregar = document.getElementById('btn-agregar-tarjeta');
  const formContainer = document.getElementById('form-tarjeta-container');
  const btnCancelar = document.getElementById('btn-cancelar-tarjeta');
  const form = document.getElementById('form-tarjeta');

  if (btnAgregar && formContainer) {
    btnAgregar.addEventListener('click', () => {
      formContainer.classList.remove('hidden');
      if (form) form.reset();
    });
  }

  if (btnCancelar && formContainer) {
    btnCancelar.addEventListener('click', () => {
      formContainer.classList.add('hidden');
      if (form) form.reset();
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titular = document.getElementById('tarjeta-titular').value.trim();
      const numeroCompleto = document.getElementById('tarjeta-numero').value.replace(/\s/g, '');
      const vencimiento = document.getElementById('tarjeta-vencimiento').value.trim();

      if (!titular || !numeroCompleto || !vencimiento) {
        mostrarModal('Error', '<p class="text-sm text-red-600">Todos los campos son requeridos</p>');
        return;
      }

      if (numeroCompleto.length < 4) {
        mostrarModal('Error', '<p class="text-sm text-red-600">El número de tarjeta debe tener al menos 4 dígitos</p>');
        return;
      }

      // Solo extraer últimos 4 dígitos para seguridad
      const ultimos4 = numeroCompleto.slice(-4);

      // ✅ USAR /perfil/tarjetas (CORREGIDO)
      const resp = await llamarApi('/public/perfil/tarjetas', {
        method: 'POST',
        body: JSON.stringify({
          titular: titular,
          numeroEnmascarado: ultimos4,
          tipo: 'Tarjeta',
          vencimiento: vencimiento
        })
      });

      if (resp.ok) {
        mostrarModal('Tarjeta guardada',
          '<p class="text-sm">✅ Tarjeta guardada de forma segura.<br>Solo almacenamos: ****' + ultimos4 + '</p>');
        form.reset();
        formContainer.classList.add('hidden');
        // Recargar lista de tarjetas
        await recargarDatosPerfilYActualizarTab('tarjetas');
      } else {
        mostrarModal('Error', '<p class="text-sm text-red-600">' + (resp.mensaje || 'No se pudo guardar la tarjeta') + '</p>');
      }
    });
  }

  // Eliminar tarjeta
  document.querySelectorAll('[data-eliminar-tarjeta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.eliminarTarjeta;
      if (confirm('¿Eliminar esta tarjeta?')) {
        // ✅ USAR /perfil/tarjetas/{id} (CORREGIDO)
        const resp = await llamarApi('/public/perfil/tarjetas/' + id, { method: 'DELETE' });
        if (resp.ok) {
          mostrarModal('Tarjeta eliminada', '<p class="text-sm">Se eliminó correctamente.</p>');
          await recargarDatosPerfilYActualizarTab('tarjetas');
        } else {
          mostrarModal('Error', '<p class="text-sm text-red-600">' + (resp.mensaje || 'No se pudo eliminar') + '</p>');
        }
      }
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
  const producto = estadoApp.productos.find(p => Number(p.id) === Number(productoId));
  const stockDisponible = obtenerStockProducto(producto);
  const cantidadSolicitada = Math.max(1, Number(cantidad) || 1);
  const cantidadActual = obtenerCantidadProductoEnCarrito(productoId);

  if (!producto || stockDisponible <= 0) {
    mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
    return false;
  }

  if (cantidadActual + cantidadSolicitada > stockDisponible) {
    const unidadesRestantes = Math.max(0, stockDisponible - cantidadActual);
    mostrarModal(
      'Stock limitado',
      `<p class="text-sm">Solo puedes agregar ${unidadesRestantes} unidad(es) m&aacute;s de "${producto.nombre}". Stock disponible: ${stockDisponible}.</p>`
    );
    return false;
  }

  const claveProducto = Number(productoId);
  if (productosAgregandoCarrito.has(claveProducto)) return false;
  productosAgregandoCarrito.add(claveProducto);

  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'POST',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId,
        cantidad: cantidadSolicitada
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

      if (producto) {
        mostrarModal('Producto agregado', `<p class="text-sm">${producto.nombre} (x${cantidadSolicitada}) a&ntilde;adido al carrito.</p>`);
      }
      return true;
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'No se pudo agregar el producto'}</p>`);
      return false;
    }
  } catch (e) {
    console.error('Error agregando al carrito', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo conectar con el servidor.</p>');
    return false;
  } finally {
    productosAgregandoCarrito.delete(claveProducto);
  }
}

async function actualizarCantidadCarrito(productoId, cantidad) {
  const producto = estadoApp.productos.find(p => Number(p.id) === Number(productoId));
  const stockDisponible = obtenerStockProducto(producto);
  const cantidadSolicitada = Math.max(1, Number(cantidad) || 1);

  if (!producto || stockDisponible <= 0) {
    mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
    if (estadoApp.vistaActual === 'carrito') renderizarVista();
    actualizarPanelCarrito();
    return false;
  }

  if (cantidadSolicitada > stockDisponible) {
    mostrarModal('Stock limitado', `<p class="text-sm">Solo tenemos ${stockDisponible} unidades disponibles.</p>`);
    if (estadoApp.vistaActual === 'carrito') renderizarVista();
    actualizarPanelCarrito();
    return false;
  }

  try {
    const resp = await llamarApi('/public/carrito', {
      method: 'PUT',
      body: JSON.stringify({
        usuarioId: estadoApp.usuarioActual ? estadoApp.usuarioActual.id : null,
        productoId,
        cantidad: cantidadSolicitada
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
      return true;
    } else {
      mostrarModal('Error', `<p class="text-sm text-red-600">${resp.mensaje || 'Stock insuficiente'}</p>`);
      await sincronizarCarritoDesdeApi();
      if (estadoApp.vistaActual === 'carrito') {
        renderizarVista();
      }
      return false;
    }
  } catch (e) {
    console.error('Error actualizando cantidad', e);
    mostrarModal('Error', '<p class="text-sm">No se pudo actualizar la cantidad.</p>');
    return false;
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

      const productoCatalogo = estadoApp.productos.find(p => Number(p.id) === Number(item.productoId));
      const stockDisponible = obtenerStockProducto(productoCatalogo || producto);
      const estaAgotado = stockDisponible <= 0;
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
            ${estaAgotado ? productoAgotadoHTML('mt-1') : `<p class="text-[11px] text-slate-500 mt-1">Stock disponible: ${stockDisponible}</p>`}
            <div class="flex items-center justify-between mt-2">
              <div class="cantidad-control">
                <button data-cantidad-decrementar="${item.productoId}" 
                  ${item.cantidad <= 1 ? 'disabled' : ''}
                  class="text-slate-600 hover:text-chapinAzul">−</button>
                <input type="number" value="${item.cantidad}" data-cantidad-input="${item.productoId}"
                  min="1" max="${stockDisponible}" class="text-xs" ${estaAgotado ? 'disabled' : ''} />
                <button data-cantidad-incrementar="${item.productoId}"
                  ${estaAgotado || item.cantidad >= stockDisponible ? 'disabled' : ''}
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
  const stockDisponible = obtenerStockProducto(producto);

  if (!producto || stockDisponible <= 0) {
    mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
  } else if (item && producto && item.cantidad < stockDisponible) {
    const nuevaCantidad = item.cantidad + 1;
    await actualizarCantidadCarrito(productoId, nuevaCantidad);
    actualizarPanelCarrito();
  } else if (producto && item && item.cantidad >= stockDisponible) {
    mostrarModal('Stock limitado',
      `<p class="text-sm">Solo hay ${stockDisponible} unidades disponibles de "${producto.nombre}".</p>`);
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
  const stockDisponible = obtenerStockProducto(producto);

  if (!producto || stockDisponible <= 0) {
    mostrarModal('Producto agotado', '<p class="text-sm text-red-600 font-semibold">AGOTADO</p>');
    actualizarPanelCarrito();
    return;
  }

  if (cantidad > stockDisponible) {
    cantidad = stockDisponible;
    input.value = cantidad;
    mostrarModal('Stock limitado',
      `<p class="text-sm">Cantidad ajustada a ${stockDisponible} unidades (m&aacute;ximo disponible).</p>`);
  }

  cantidad = Math.max(1, Math.min(cantidad, stockDisponible));
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
  cerrarTodosLosPaneles('carrito');  // Cierra menú y dropdown, pero no el carrito
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

function manejarBusqueda(valor) {
  const texto = valor.trim().toLowerCase();
  if (!texto) return;
  const resultados = estadoApp.productos.filter(
    (p) => p.nombre.toLowerCase().includes(texto) || p.descripcion.toLowerCase().includes(texto)
  );
  mostrarResultadosBusqueda(texto, resultados);
}

function configurarEventosGlobales() {
  const botonLogo = document.getElementById('boton-logo');
  const cerrarPanel = document.getElementById('cerrar-panel-carrito');
  const botonUsuario = document.getElementById('boton-usuario');
  const botonFlotanteCarrito = document.getElementById('boton-flotante-carrito');
  const btnCheckoutEscritorio = document.getElementById('boton-ir-checkout');
  const contadorFlotante = document.getElementById('contador-carrito-flotante');
  const modal = document.getElementById('modal-general');
  const modalCerrar = document.getElementById('modal-cerrar');
  const iconoBusqueda = document.getElementById('icono-busqueda');
  const inputBusqueda = document.getElementById('input-busqueda-global');
  const botonCategorias = document.getElementById('boton-categorias-dropdown');
  const botonHamburguesa = document.getElementById('boton-hamburguesa');
  const cerrarMenuMovil = document.getElementById('cerrar-menu-movil');
  const btnCatMovil = document.getElementById('btn-categorias-movil');
  const menuMovilPromo = document.getElementById('menu-movil-promociones');
  const menuMovilTodas = document.getElementById('menu-movil-todas-categorias');
  const menuMovilTemp = document.getElementById('menu-movil-temporadas');
  const botonIrPromociones = document.getElementById('boton-ir-promociones');
  const botonIrCategorias = document.getElementById('boton-ir-categorias');
  const botonIrTemporadas = document.getElementById('boton-ir-temporadas');

  // --- Logo ---
  if (botonLogo) {
    botonLogo.addEventListener('click', () => {
      window.location.hash = '#/';
    });
  }

  // --- Cerrar carrito ---
  if (cerrarPanel) {
    cerrarPanel.addEventListener('click', () => {
      cerrarPanelCarrito();
    });
  }

  // --- Botón flotante carrito (único acceso) ---
  if (botonFlotanteCarrito) {
    botonFlotanteCarrito.addEventListener('click', () => {
      actualizarPanelCarrito();
      abrirPanelCarrito();  // abrirPanelCarrito ahora cierra otros paneles
    });
  }

  // --- Botón "Ir a pagar" del carrito ---
  if (btnCheckoutEscritorio) {
    btnCheckoutEscritorio.addEventListener('click', () => {
      cerrarPanelCarrito();
      window.location.hash = '#/checkout';
    });
  }

  // --- Sincronizar contador flotante ---
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

  // --- Usuario ---
  if (botonUsuario) {
    botonUsuario.addEventListener('click', () => {
      if (estadoApp.usuarioActual) {
        window.location.hash = '#/perfil';
      } else {
        window.location.hash = '#/login';
      }
    });
  }

  // --- Modal general ---
  if (modal && modalCerrar) {
    modalCerrar.addEventListener('click', cerrarModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModal();
    });
  }

  // ========== NUEVAS INTERACCIONES ==========

  // --- Ícono de búsqueda clickable (reutiliza lógica de Enter) ---
  if (iconoBusqueda && inputBusqueda) {
    iconoBusqueda.addEventListener('click', () => {
      const valor = inputBusqueda.value.trim();
      if (valor) manejarBusqueda(valor);
    });
  }

  // --- Búsqueda por Enter (desktop) ---
  if (inputBusqueda) {
    inputBusqueda.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const valor = inputBusqueda.value.trim();
        if (valor) manejarBusqueda(valor);
      }
    });
  }

  // --- Dropdown Categorías (click, ya no hover) ---
  if (botonCategorias) {
    botonCategorias.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('dropdown-categorias');
      const flecha = document.getElementById('flecha-categorias');
      const estaAbierto = dropdown && dropdown.classList.contains('dropdown-abierto');

      cerrarTodosLosPaneles(estaAbierto ? null : 'categorias'); // si está abierto lo cerramos

      if (!estaAbierto) {
        // Abrir
        if (dropdown) {
          dropdown.classList.remove('hidden');
          dropdown.classList.add('dropdown-abierto');
        }
        if (flecha) flecha.classList.add('rotate-arrow');
      }
    });
  }

  // --- Hamburger menú (móvil) ---
  if (botonHamburguesa) {
    botonHamburguesa.addEventListener('click', () => {
      const menuPanel = document.getElementById('panel-menu-movil');
      const estaAbierto = menuPanel && menuPanel.classList.contains('menu-abierto');
      cerrarTodosLosPaneles(estaAbierto ? null : 'menu-movil');
      if (!estaAbierto && menuPanel) {
        menuPanel.classList.add('menu-abierto');
      }
    });
  }

  // --- Cerrar menú móvil (botón X) ---
  if (cerrarMenuMovil) {
    cerrarMenuMovil.addEventListener('click', () => {
      cerrarTodosLosPaneles();
    });
  }

  // --- Acordeón de Categorías dentro del menú móvil ---
  if (btnCatMovil) {
    btnCatMovil.addEventListener('click', () => {
      const submenu = document.getElementById('submenu-categorias-movil');
      const flecha = document.getElementById('flecha-categorias-movil');
      if (submenu && flecha) {
        const oculto = submenu.classList.contains('hidden');
        if (oculto) {
          submenu.classList.remove('hidden');
          flecha.classList.add('rotate-arrow');
        } else {
          submenu.classList.add('hidden');
          flecha.classList.remove('rotate-arrow');
        }
      }
    });
  }

  // --- Navegación desde el menú móvil ---
  const navegarYcerrar = (hash) => {
    cerrarTodosLosPaneles();
    window.location.hash = hash;
  };

  if (menuMovilPromo) menuMovilPromo.addEventListener('click', () => navegarYcerrar('#/promociones'));
  if (menuMovilTodas) menuMovilTodas.addEventListener('click', () => navegarYcerrar('#/categorias'));
  if (menuMovilTemp) menuMovilTemp.addEventListener('click', () => navegarYcerrar('#/temporadas'));

  // --- Navegación de los botones de escritorio (segunda fila) ---
  if (botonIrPromociones) {
    botonIrPromociones.addEventListener('click', () => {
      window.location.hash = '#/promociones';
    });
  }
  if (botonIrCategorias) {
    botonIrCategorias.addEventListener('click', () => {
      window.location.hash = '#/categorias';
    });
  }
  if (botonIrTemporadas) {
    botonIrTemporadas.addEventListener('click', () => {
      window.location.hash = '#/temporadas';
    });
  }

  // ========== CIERRE GLOBAL ==========

  // Clic fuera de los paneles activos → cierra todos
  document.addEventListener('click', (e) => {
    const target = e.target;
    const panelCarrito = document.getElementById('panel-carrito');
    const botonFlotante = document.getElementById('boton-flotante-carrito');
    const dropdownCat = document.getElementById('dropdown-categorias');
    const botonCat = document.getElementById('boton-categorias-dropdown');
    const menuMovil = document.getElementById('panel-menu-movil');
    const botonHam = document.getElementById('boton-hamburguesa');

    const carritoAbierto = panelCarrito && !panelCarrito.classList.contains('translate-x-full');
    const catAbierto = dropdownCat && dropdownCat.classList.contains('dropdown-abierto');
    const menuAbierto = menuMovil && menuMovil.classList.contains('menu-abierto');

    if (carritoAbierto && !target.closest('#panel-carrito') && !target.closest('#boton-flotante-carrito')) {
      cerrarTodosLosPaneles();
      return;
    }
    if (catAbierto && !target.closest('#dropdown-categorias') && !target.closest('#boton-categorias-dropdown')) {
      cerrarTodosLosPaneles();
      return;
    }
    if (menuAbierto && !target.closest('#panel-menu-movil') && !target.closest('#boton-hamburguesa')) {
      cerrarTodosLosPaneles();
      return;
    }
  });

  // Redimensionar ventana → cerrar todo
  window.addEventListener('resize', () => {
    cerrarTodosLosPaneles();
  });

  // ===================================
}

/**
 * Configura el header para que reaccione al scroll:
 * - Se oculta hacia abajo (después de cierta distancia)
 * - Reaparece hacia arriba
 * - No oculta si hay paneles abiertos (carrito, menú móvil, dropdown categorías)
 */
function configurarHeaderScroll() {
  const header = document.getElementById('header-principal');
  const main = document.getElementById('main-content');
  if (!header || !main) return;

  // Ajustar padding-top del main para que no tape contenido
  function ajustarPaddingMain() {
    const alturaHeader = header.offsetHeight;
    main.style.paddingTop = (alturaHeader + 10) + 'px';
  }

  ajustarPaddingMain();
  window.addEventListener('resize', ajustarPaddingMain);

  let lastScrollY = window.scrollY;
  let ticking = false;
  const deltaMinimo = 10; // pequeña zona muerta para evitar parpadeos

  function actualizarHeader() {
    const currentScrollY = window.scrollY;
    const diff = currentScrollY - lastScrollY;
    const headerAltura = header.offsetHeight;

    // Verificar si hay algún panel abierto que impida ocultar
    const panelCarritoAbierto = document.getElementById('panel-carrito')?.classList.contains('translate-x-full') === false;
    const menuMovilAbierto = document.getElementById('panel-menu-movil')?.classList.contains('menu-abierto');
    const dropdownAbierto = document.getElementById('dropdown-categorias')?.classList.contains('dropdown-abierto');
    const algunPanelAbierto = panelCarritoAbierto || menuMovilAbierto || dropdownAbierto;

    if (algunPanelAbierto) {
      // Con panel abierto: mostrar solo en la parte superior, ocultar en el resto
      if (currentScrollY <= headerAltura) {
        header.classList.remove('header-oculto');
      } else {
        header.classList.add('header-oculto');
      }
    } else {
      if (currentScrollY <= headerAltura) {
        header.classList.remove('header-oculto');
      } else if (diff > deltaMinimo) {
        header.classList.add('header-oculto');
      } else if (diff < -deltaMinimo) {
        header.classList.remove('header-oculto');
      }
    }

    lastScrollY = currentScrollY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(actualizarHeader);
      ticking = true;
    }
  }, { passive: true });

  // Al abrir/cerrar paneles, forzar visibilidad (se cubre con la lógica de arriba,
  // pero podemos llamar una actualización inmediata tras cambios de panel).
  // Con la comprobación dentro de actualizarHeader es suficiente.
}

function mostrarResultadosBusqueda(texto, resultados) {
  const html = `
    <section class="space-y-3 text-sm">
      <div class="flex items-center justify-between">
        <h1 class="text-base sm:text-lg font-semibold">Resultados para "${texto}"</h1>
        <button class="text-xs text-chapinAzul hover:text-chapinNaranja cursor-pointer" onclick="window.location.hash='#/'; setTimeout(function(){ window.scrollTo({top:0,behavior:'smooth'}); }, 50);">Volver al inicio</button>
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

function iniciarHeroRotativo() {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');

  if (!slides.length) return;

  let currentSlide = 0;
  const totalSlides = slides.length;
  let intervalo;
  let transicionEnCurso = false;

  // Configurar estado inicial
  slides.forEach((slide, index) => {
    if (index === 0) {
      slide.classList.remove('opacity-0', 'translate-x-8', 'pointer-events-none');
      slide.classList.add('opacity-100', 'translate-x-0');
    }
  });

  if (dots.length && dots[0]) {
    dots[0].classList.add('bg-white');
    dots[0].classList.remove('bg-white/40');
    dots[0].classList.add('w-6');
  }

  function actualizarDots(index) {
    dots.forEach((dot, i) => {
      if (i === index) {
        dot.classList.add('bg-white');
        dot.classList.remove('bg-white/40');
        dot.classList.add('w-6');
        dot.classList.remove('w-2.5');
      } else {
        dot.classList.remove('bg-white');
        dot.classList.add('bg-white/40');
        dot.classList.remove('w-6');
        dot.classList.add('w-2.5');
      }
    });
  }

  function cambiarASlide(nuevoIndex) {
    if (transicionEnCurso || nuevoIndex === currentSlide) return;
    transicionEnCurso = true;

    const slideActual = slides[currentSlide];
    const slideSiguiente = slides[nuevoIndex];

    // Ocultar slide actual
    slideActual.classList.add('opacity-0', 'translate-x-8', 'pointer-events-none');
    slideActual.classList.remove('opacity-100', 'translate-x-0');

    // Mostrar nuevo slide
    slideSiguiente.classList.remove('opacity-0', 'translate-x-8', 'pointer-events-none');
    slideSiguiente.classList.add('opacity-100', 'translate-x-0');

    actualizarDots(nuevoIndex);
    currentSlide = nuevoIndex;

    setTimeout(() => {
      transicionEnCurso = false;
    }, 700);
  }

  function siguienteSlide() {
    const siguiente = (currentSlide + 1) % totalSlides;
    cambiarASlide(siguiente);
  }

  // Event listeners en los dots
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const index = parseInt(dot.dataset.dot);
      cambiarASlide(index);
      reiniciarIntervalo();
    });
  });

  function reiniciarIntervalo() {
    clearInterval(intervalo);
    intervalo = setInterval(siguienteSlide, 5000);
  }

  // Iniciar rotación automática
  intervalo = setInterval(siguienteSlide, 5000);

  // Pausar al hover
  const heroWrapper = document.querySelector('.hero-wrapper');
  if (heroWrapper) {
    heroWrapper.addEventListener('mouseenter', () => {
      clearInterval(intervalo);
    });
    heroWrapper.addEventListener('mouseleave', () => {
      intervalo = setInterval(siguienteSlide, 5000);
    });
  }
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
