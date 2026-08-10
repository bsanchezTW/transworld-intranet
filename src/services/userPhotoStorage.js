const sharepoint = require("./sharepointService");
const fileStorage = require("./fileStorage");

const PUBLIC_PREFIX = "/content/user";
const USER_FOLDER = "user";

function getPublicUrl(userId) {
  return `${PUBLIC_PREFIX}/${userId}.jpg`;
}

function getRelativePath(userId) {
  return `${USER_FOLDER}/${userId}.jpg`;
}

async function saveUserPhoto(userId, buffer) {
  if (!userId && userId !== 0) {
    throw new Error("ID de usuario inválido para guardar foto.");
  }
  if (!buffer || !buffer.length) {
    throw new Error("Buffer de imagen vacío.");
  }

  const relativePath = getRelativePath(userId);
  await sharepoint.uploadFile(buffer, relativePath);

  return `${getPublicUrl(userId)}?v=${Date.now()}`;
}

async function deleteUserPhoto(userId) {
  if (userId === null || userId === undefined) return false;
  return sharepoint.deleteFile(getRelativePath(userId));
}

async function deleteLegacyPhoto(url) {
  if (!url) return false;

  const cleanUrl = String(url).split("?")[0];

  if (cleanUrl.startsWith(`${PUBLIC_PREFIX}/`)) {
    const fileName = cleanUrl.slice(`${PUBLIC_PREFIX}/`.length);
    return sharepoint.deleteFile(`${USER_FOLDER}/${fileName}`);
  }

  if (cleanUrl.startsWith("/content/")) {
    return fileStorage.deleteFile(cleanUrl);
  }

  return false;
}

async function saveUserPhotoReplacing(userId, buffer, previousUrl = null) {
  if (previousUrl) {
    await deleteLegacyPhoto(previousUrl);
  }
  return saveUserPhoto(userId, buffer);
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
  saveUserPhoto,
  saveUserPhotoReplacing,
  deleteUserPhoto,
  deleteLegacyPhoto,
  removeUserPhoto,
};
