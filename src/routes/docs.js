const express = require('express');
const fileStorage = require('../services/fileStorage');
const router = express.Router();

const ALLOWED_SECTIONS = new Set(['procedimientos', 'protocolos', 'achs', 'reglamento']);

// GET /docs/:section/:filename
router.get('/:section/:filename', async (req, res) => {
  const { section, filename } = req.params;
  
  if (!ALLOWED_SECTIONS.has(section)) {
    return res.status(404).send('Sección no encontrada');
  }

  try {
    const relativePath = `documentos/${section}/${filename}`;
    const url = fileStorage.getPublicUrl(relativePath);
    res.redirect(url);
  } catch (err) {
    console.error('Error obteniendo documento local:', err);
    res.status(404).send('El documento no se encuentra.');
  }
});

module.exports = router;