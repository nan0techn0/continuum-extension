/**
 * Browser export helpers: local file download and clipboard copy.
 * Keeps everything local—no network requests, no servers.
 */

/**
 * Turn a conversation title into a safe local filename.
 */
export function makeSafeFilename(title, extension) {
  const slug = (title || "continuum-export")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const dateStamp = new Date().toISOString().slice(0, 10);
  return `${slug || "continuum-export"}-${dateStamp}.${extension}`;
}

/**
 * Trigger a local browser download for a text payload (JSON or Markdown).
 */
export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Release memory shortly after the download starts
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copy text to the user's clipboard.
 */
export async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(text);
}
