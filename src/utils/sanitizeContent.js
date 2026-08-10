// Saneamiento de HTML que se inyecta con <%- %> o dentro de un correo.
//
// Dos orígenes: el editor TinyMCE (autoría de administradores) y la conversión
// de documentos Word con mammoth. Ninguno debería poder introducir scripts,
// iframes ni manejadores de eventos en la página ni en el correo.

const sanitizeHtml = require("sanitize-html");

const TEXT_TAGS = [
  "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup", "small", "mark",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "a", "img", "figure", "figcaption", "span", "div",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
];

const BASE_OPTIONS = {
  allowedTags: TEXT_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    td: ["colspan", "rowspan", "align"],
    th: ["colspan", "rowspan", "align", "scope"],
    "*": ["style", "class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Las imágenes pueden venir como ruta relativa (/content, /media) o absoluta.
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  allowedStyles: {
    "*": {
      "color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\(/i],
      "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\(/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^(bold|bolder|normal|[1-9]00)$/],
      "font-style": [/^(italic|normal)$/],
      "text-decoration": [/^(underline|line-through|none)$/],
      "width": [/^\d+(\.\d+)?(px|%|em|rem)$/],
      "max-width": [/^\d+(\.\d+)?(px|%|em|rem)$/],
      "margin": [/^[\d.\s]+(px|%|em|rem|auto)?$/],
      "padding": [/^[\d.\s]+(px|%|em|rem)?$/],
    },
  },
  transformTags: {
    // Todo enlace sale del contexto actual de forma segura.
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }, true),
  },
};

/**
 * HTML del editor de noticias (TinyMCE).
 */
function sanitizeArticleHtml(html) {
  if (!html) return "";
  return sanitizeHtml(String(html), BASE_OPTIONS);
}

/**
 * HTML producido por mammoth a partir de un .docx.
 */
function sanitizeDocumentHtml(html) {
  if (!html) return "";
  return sanitizeHtml(String(html), BASE_OPTIONS);
}

/**
 * Texto plano legible a partir de HTML: para extractos y la versión text/plain
 * del correo.
 */
function htmlToText(html) {
  if (!html) return "";
  const withBreaks = String(html)
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracto de N caracteres cortado en el último espacio, sin palabras partidas.
 */
function excerptFrom(htmlOrText, maxLength = 320) {
  const text = /<[a-z][\s\S]*>/i.test(String(htmlOrText || ""))
    ? htmlToText(htmlOrText)
    : String(htmlOrText || "").trim();

  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= maxLength) return flat;

  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

module.exports = {
  sanitizeArticleHtml,
  sanitizeDocumentHtml,
  htmlToText,
  excerptFrom,
};
