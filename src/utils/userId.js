function generateSixDigitId() {
  return Math.floor(100000 + Math.random() * 900000);
}

async function generateUniqueUsuarioId(db, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const candidateId = generateSixDigitId();
    const { rows } = await db.query(
      "SELECT id FROM users WHERE id = $1 LIMIT 1",
      [candidateId],
    );
    if (!rows.length) return candidateId;
  }
  throw new Error("No fue posible generar un ID único de 6 dígitos.");
}

module.exports = {
  generateSixDigitId,
  generateUniqueUsuarioId,
};
