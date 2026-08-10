// Almacenamiento unificado en SharePoint (Microsoft Graph)
const path = require("path");
const crypto = require("crypto");
const sharepoint = require("./sharepointService");

function getPublicUrl(relativePath) {
  const clean = sharepoint.normalizeRelativePath(relativePath);
  return `/content/${clean}`;
}

function sanitizeBaseName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "archivo";
}

function generateFileName(originalFileName = "file") {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  const ext = path.extname(originalFileName).toLowerCase() || "";
  const baseName = sanitizeBaseName(path.basename(originalFileName, ext));
  return `${baseName}-${timestamp}-${random}${ext}`;
}

function getResourceType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
    return "image";
  }
  if ([".mp4", ".webm", ".avi", ".mov", ".mkv"].includes(ext)) {
    return "video";
  }
  return "raw";
}

/**
 * Guarda un buffer en SharePoint.
 * @returns {Promise<{ secure_url, public_id, url, fileName, sharepointId, webUrl }>}
 */
async function saveFile(buffer, folder, originalFileName = "file") {
  const fileName = generateFileName(originalFileName);
  const folderClean = sharepoint.normalizeRelativePath(folder);
  const relativePath = folderClean ? `${folderClean}/${fileName}` : fileName;

  const uploaded = await sharepoint.uploadFile(buffer, relativePath);

  return {
    secure_url: getPublicUrl(relativePath),
    public_id: relativePath,
    url: getPublicUrl(relativePath),
    fileName,
    sharepointId: uploaded.sharepointId,
    webUrl: uploaded.webUrl,
    resource_type: getResourceType(fileName),
  };
}

async function deleteFile(publicIdOrUrl) {
  if (!publicIdOrUrl) return false;

  if (String(publicIdOrUrl).startsWith("/uploads/")) {
    return false;
  }

  return sharepoint.deleteFile(publicIdOrUrl);
}

async function deleteFolder(folder) {
  return sharepoint.deleteFolder(folder);
}

async function listFiles(folder, { limit } = {}) {
  const folderClean = sharepoint.normalizeRelativePath(folder);
  const items = await sharepoint.listFilesInFolder(folderClean, { limit });

  return items.map((item) => ({
    public_id: item.relativePath,
    secure_url: getPublicUrl(item.relativePath),
    url: getPublicUrl(item.relativePath),
    name: item.name,
    created_at: item.created_at,
    size: item.size,
    resource_type: getResourceType(item.name),
    sharepointId: item.sharepointId,
    webUrl: item.webUrl,
  }));
}

function validateFileSize(buffer, maxSizeMB = 100) {
  return buffer.length <= maxSizeMB * 1024 * 1024;
}

module.exports = {
  saveFile,
  deleteFile,
  deleteFolder,
  listFiles,
  getPublicUrl,
  generateFileName,
  validateFileSize,
  getResourceType,
};
