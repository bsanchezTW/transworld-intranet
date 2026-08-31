// Tiempo estimado de lectura de una noticia.
//
// Se calcula sobre el HTML ya sanitizado del cuerpo: se descartan las etiquetas
// y se cuentan palabras. 200 ppm es el promedio habitual de lectura en pantalla
// para texto en español.

const PALABRAS_POR_MINUTO = 200;

/**
 * Cuenta las palabras de un fragmento HTML, ignorando etiquetas y entidades.
 * @param {string} html
 * @returns {number}
 */
function contarPalabras(html) {
  const texto = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .trim();

  if (!texto) return 0;
  return texto.split(/\s+/).length;
}

/**
 * Minutos estimados de lectura (mínimo 1).
 * @param {string} html Cuerpo de la noticia en HTML.
 * @returns {number}
 */
function minutosDeLectura(html) {
  const palabras = contarPalabras(html);
  if (!palabras) return 1;
  return Math.max(1, Math.round(palabras / PALABRAS_POR_MINUTO));
}

/**
 * Etiqueta lista para mostrar: "4 min de lectura".
 * @param {string} html Cuerpo de la noticia en HTML.
 * @returns {string}
 */
function etiquetaDeLectura(html) {
  return `${minutosDeLectura(html)} min de lectura`;
}

module.exports = { minutosDeLectura, etiquetaDeLectura };
