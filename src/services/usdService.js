const https = require('https');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

// Cache para almacenar los 3 indicadores
let cache = {
  data: null,
  fetchedAt: 0
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };

    https.get(url, options, (res) => { 
      if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`API respondió con estado ${res.statusCode}`));
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchIndicator(codigo) {
  try {
    const data = await getJson(`https://mindicador.cl/api/${codigo}`);
    const serie = Array.isArray(data?.serie) ? data.serie : [];
    
    if (serie.length === 0) return null;
    const hoy = serie[0];
    const ayer = serie[1] || serie[0]; 

    return {
      codigo: codigo,
      valor: Number(hoy.valor),
      valorAyer: Number(ayer.valor), 
      fecha: hoy.fecha,
      historico: serie.slice(0, 10).reverse()
    };
  } catch (error) {
    console.error(`Error obteniendo ${codigo}:`, error.message);
    return null;
  }
}

async function getIndicadores() {
  const now = Date.now();

  // Si el caché es válido, devolverlo
  if (cache.data && (now - cache.fetchedAt < CACHE_TTL_MS)) {
    return cache.data;
  }

  try {
    // Consultamos los 3 en paralelo
    const [dolar, euro, uf] = await Promise.all([
      fetchIndicator('dolar'),
      fetchIndicator('euro'),
      fetchIndicator('uf')
    ]);

    // Si alguno falló (null), intentamos usar el valor del caché antiguo si existe, o ponemos 0
    const result = {
      dolar: dolar || (cache.data ? cache.data.dolar : { valor: 0, valorAyer: 0 }),
      euro: euro || (cache.data ? cache.data.euro : { valor: 0, valorAyer: 0 }),
      uf: uf || (cache.data ? cache.data.uf : { valor: 0, valorAyer: 0 })
    };

    // Solo actualizamos el caché si al menos uno trajo datos reales
    if (dolar || euro || uf) {
        cache.data = result;
        cache.fetchedAt = now;
    }

    return result;

  } catch (err) {
    console.error('Error fetching indicadores:', err.message);
    // Si falla todo, devolver caché viejo o ceros
    if (cache.data) return cache.data;
    return {
      dolar: { valor: 0, valorAyer: 0 },
      euro: { valor: 0, valorAyer: 0 },
      uf: { valor: 0, valorAyer: 0 }
    };
  }
}

module.exports = { getIndicadores, getUsdHoy: getIndicadores };