// Fachada neutral del almacenamiento de contenido. El proveedor se crea de
// forma lazy: importar este módulo no lee credenciales ni conecta a Supabase.
module.exports = require("../supabaseStorageService");
