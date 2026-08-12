const storage = require("./storage/storageService");
const fileStorage = require("./fileStorage");

const PUBLIC_PREFIX = "/content/user";
const USER_FOLDER = "user";

function getPublicUrl(userId) {
  return `${PUBLIC_PREFIX}/${userId}.jpg`;
}

function getRelativePath(userId) {
  return `${USER_FOLDER}/${userId}.jpg`;
}

// La ruta histórica termina en .jpg, pero los formularios aceptan cualquier
// imagen. Conservamos la ruta estable y guardamos el MIME real en metadata.
function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  const header = buffer.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (header.startsWith("BM")) return "image/bmp";
  if (header.slice(4, 12) === "ftypavif" || header.slice(4, 12) === "ftypavis") {
    return "image/avif";
  }
  return null;
}

async function saveUserPhoto(userId, buffer) {
  if (!userId && userId !== 0) {
    throw new Error("ID de usuario inválido para guardar foto.");
  }
  if (!buffer || !buffer.length) {
    throw new Error("Buffer de imagen vacío.");
  }

  const contentType = detectImageContentType(buffer);
  if (!contentType) {
    throw new Error("El archivo no contiene una imagen compatible.");
  }

  const relativePath = getRelativePath(userId);
  await storage.uploadFile(buffer, relativePath, {
    contentType,
    cacheControl: "no-cache",
    upsert: true,
  });

  return `${getPublicUrl(userId)}?v=${Date.now()}`;
}

async function deleteUserPhoto(userId) {
  if (userId === null || userId === undefined) return false;
  return storage.deleteFile(getRelativePath(userId));
}

async function deleteLegacyPhoto(url) {
  if (!url) return false;

  const cleanUrl = String(url).split("?")[0];

  if (cleanUrl.startsWith(`${PUBLIC_PREFIX}/`)) {
    const fileName = cleanUrl.slice(`${PUBLIC_PREFIX}/`.length);
    return storage.deleteFile(`${USER_FOLDER}/${fileName}`);
  }

  if (cleanUrl.startsWith("/content/")) {
    return fileStorage.deleteFile(cleanUrl);
  }

  return false;
}

async function saveUserPhotoReplacing(userId, buffer, previousUrl = null) {
  // La ruta actual es determinista y uploadFile hace upsert. Guardamos primero
  // para no perder la foto vigente si la subida nueva falla; después limpiamos
  // únicamente una referencia heredada que apunte a otro objeto.
  const savedUrl = await saveUserPhoto(userId, buffer);
  if (previousUrl) {
    const previousClean = String(previousUrl).split("?")[0];
    let previousRelative = "";
    if (previousClean.startsWith("/content/")) {
      try {
        previousRelative = storage.normalizeRelativePath(previousClean);
      } catch {
        previousRelative = "";
      }
    }
    if (previousRelative !== getRelativePath(userId)) {
      await deleteLegacyPhoto(previousUrl);
    }
  }
  return savedUrl;
}

async function removeUserPhoto(userId, previousUrl = null) {
  await deleteUserPhoto(userId);
  if (previousUrl) {
    await deleteLegacyPhoto(previousUrl);
  }
  return true;
}

module.exports = {
  PUBLIC_PREFIX,
  USER_FOLDER,
  getPublicUrl,
  getRelativePath,
  detectImageContentType,
  saveUserPhoto,
  saveUserPhotoReplacing,
  deleteUserPhoto,
  deleteLegacyPhoto,
  removeUserPhoto,
};
