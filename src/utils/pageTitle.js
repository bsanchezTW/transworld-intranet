const PAGE_TITLE_SUFFIX = "Intranet Transworld Chile";

function formatPageTitle(title) {
  if (!title || typeof title !== "string") {
    return PAGE_TITLE_SUFFIX;
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return PAGE_TITLE_SUFFIX;
  }

  if (/\|\s*Intranet Transworld Chile\s*$/i.test(trimmed)) {
    return trimmed;
  }

  const base = trimmed.replace(/\s*\|\s*Transworld\s*$/i, "").trim();
  return `${base} | ${PAGE_TITLE_SUFFIX}`;
}

module.exports = { formatPageTitle, PAGE_TITLE_SUFFIX };
