// Estilos en línea para el HTML que se inyecta en un correo.
//
// Los clientes de correo (sobre todo Outlook y Gmail) ignoran o eliminan las
// hojas de estilo <style>, así que el HTML del editor y el convertido desde
// Word deben llevar los estilos en el atributo style de cada etiqueta.

const TAG_STYLES = {
  p: "margin:0 0 16px 0; color:#334155; font-size:16px; line-height:1.7;",
  h1: "margin:28px 0 12px 0; color:#0b3a63; font-size:24px; font-weight:800; line-height:1.3;",
  h2: "margin:28px 0 12px 0; color:#0b3a63; font-size:21px; font-weight:800; line-height:1.3;",
  h3: "margin:24px 0 10px 0; color:#0b3a63; font-size:18px; font-weight:700; line-height:1.35;",
  h4: "margin:20px 0 8px 0; color:#0b3a63; font-size:16px; font-weight:700; line-height:1.4;",
  h5: "margin:18px 0 8px 0; color:#0b3a63; font-size:15px; font-weight:700;",
  h6: "margin:18px 0 8px 0; color:#0b3a63; font-size:14px; font-weight:700;",
  ul: "margin:0 0 16px 0; padding-left:24px; color:#334155; font-size:16px; line-height:1.7;",
  ol: "margin:0 0 16px 0; padding-left:24px; color:#334155; font-size:16px; line-height:1.7;",
  li: "margin:0 0 6px 0;",
  blockquote:
    "margin:20px 0; padding:4px 0 4px 18px; border-left:3px solid #a6d84a; color:#51637a; font-size:16px; font-style:italic; line-height:1.6;",
  a: "color:#0f4c81; text-decoration:underline;",
  strong: "font-weight:700;",
  b: "font-weight:700;",
  em: "font-style:italic;",
  table:
    "width:100%; border-collapse:collapse; margin:0 0 20px 0; font-size:14px; color:#334155;",
  th: "border:1px solid #e3e9f0; padding:8px 10px; background:#f5f7fa; text-align:left; font-weight:700; color:#0b3a63;",
  td: "border:1px solid #e3e9f0; padding:8px 10px; vertical-align:top;",
  img: "max-width:100%; height:auto; display:block; margin:0 0 16px 0; border-radius:8px;",
  hr: "border:0; border-top:1px solid #e3e9f0; margin:24px 0;",
  figcaption: "margin:-8px 0 18px 0; color:#8494a7; font-size:13px; font-style:italic;",
  code: "font-family:Consolas,Monaco,monospace; font-size:14px; background:#f5f7fa; padding:2px 5px; border-radius:4px;",
  pre: "font-family:Consolas,Monaco,monospace; font-size:13px; background:#f5f7fa; padding:14px; border-radius:8px; overflow:auto; margin:0 0 16px 0;",
};

// Bloques que se pueden cortar sin dejar etiquetas abiertas.
const BLOCK_PATTERN = /<(p|h[1-6]|ul|ol|blockquote|table|figure|pre|hr|img)\b[^>]*>[\s\S]*?(?:<\/\1>|(?<=\/>)|(?<=>))/gi;

/**
 * Añade el estilo correspondiente a cada etiqueta conocida, respetando los
 * estilos que la etiqueta ya traiga (los suyos ganan).
 */
function inlineStyles(html) {
  if (!html) return "";

  return String(html).replace(
    /<([a-z][a-z0-9]*)\b([^>]*)>/gi,
    (match, tagName, attributes) => {
      const style = TAG_STYLES[tagName.toLowerCase()];
      if (!style) return match;

      const existing = attributes.match(/\sstyle\s*=\s*"([^"]*)"/i);
      if (existing) {
        const merged = `${style} ${existing[1]}`;
        return `<${tagName}${attributes.replace(existing[0], ` style="${merged}"`)}>`;
      }
      return `<${tagName}${attributes} style="${style}">`;
    },
  );
}

/**
 * Recorta el HTML por bloques completos, sin partir etiquetas.
 * @returns {{html: string, truncated: boolean}}
 */
function truncateHtml(html, maxLength) {
  const source = String(html || "");
  if (source.length <= maxLength) return { html: source, truncated: false };

  const blocks = source.match(BLOCK_PATTERN) || [];
  let out = "";

  for (const block of blocks) {
    if (out.length + block.length > maxLength) break;
    out += block;
  }

  // Si no se pudo aislar ni un bloque, es más seguro no enviar HTML parcial.
  if (!out) return { html: "", truncated: true };

  return { html: out, truncated: true };
}

module.exports = { inlineStyles, truncateHtml, TAG_STYLES };
