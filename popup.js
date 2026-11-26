/**
 * Continuum Popup Controller
 *
 * Responsibilities:
 *  1. Inspect the active tab URL/title (Milestone 1: page detection).
 *  2. On explicit user click, inject adapters/chatgpt.js into the active tab
 *     and run extraction (Milestone 2: single-conversation export).
 *  3. Wrap the result in the versioned v0.1.0 schema, validate it, render a
 *     safe text preview, and let the user Copy Markdown, Download .md, or
 *     Download .json locally.
 */

import { buildExportPackage, validateExportPackage } from "./lib/schema.js";
import { exportPackageToMarkdown, recordedCounts, transcriptNote } from "./lib/markdown.js";
import {
  copyTextToClipboard,
  downloadTextFile,
  makeSafeFilename,
} from "./lib/export.js";

// Load the ChatGPT adapter's pure URL-detection helper in the popup context too
import "./adapters/chatgpt.js";

const els = {
  pageBadge: document.getElementById("page-badge"),
  pageTitle: document.getElementById("page-title"),
  pageReason: document.getElementById("page-reason"),
  extractBtn: document.getElementById("extract-btn"),
  resultSection: document.getElementById("result-section"),
  captureBadge: document.getElementById("capture-badge"),
  statsLine: document.getElementById("stats-line"),
  completenessNote: document.getElementById("completeness-note"),
  errorsBox: document.getElementById("errors-box"),
  errorsList: document.getElementById("errors-list"),
  optHandoff: document.getElementById("opt-handoff"),
  optMetadata: document.getElementById("opt-metadata"),
  previewChars: document.getElementById("preview-chars"),
  previewText: document.getElementById("preview-text"),
  copyMdBtn: document.getElementById("copy-md-btn"),
  downloadMdBtn: document.getElementById("download-md-btn"),
  downloadJsonBtn: document.getElementById("download-json-btn"),
  feedbackMsg: document.getElementById("feedback-msg"),
};

let activeTab = null;
let currentPackage = null;
const scrollButton = document.getElementById("scroll-btn");
const scrollStatus = document.getElementById("scroll-status");
let recording = false;

async function scrollCommand(command) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: action => globalThis.continuumScrollCapture?.(action),
    args: [command],
  });
  return result;
}

function showRecording(active, count = 0) {
  recording = active;
  els.extractBtn.disabled = active;
  scrollButton.textContent = active ? "Stop and extract" : "Start scroll capture";
  scrollStatus.textContent = active
    ? `Recording in this tab. Close the popup and scroll up slowly. Reopen Continuum to stop. ${count} messages collected so far.`
    : "For scroll capture, start at the newest reply you want to include.";
}

function setBadge(el, text, variant) {
  el.textContent = text;
  el.className = `badge badge-${variant}`;
}

function showFeedback(message, isError = false) {
  els.feedbackMsg.textContent = message;
  els.feedbackMsg.style.color = isError ? "var(--err-text)" : "var(--ok-text)";
}

/**
 * Safely populate a <ul> using textContent (never innerHTML).
 */
function renderList(containerEl, listEl, items) {
  listEl.replaceChildren();
  if (!items || items.length === 0) {
    containerEl.classList.add("hidden");
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    listEl.appendChild(li);
  }
  containerEl.classList.remove("hidden");
}

function getCurrentMarkdown() {
  if (!currentPackage) return "";
  return exportPackageToMarkdown(currentPackage, {
    includeHandoffPrompt: els.optHandoff.checked,
    includeMetadata: els.optMetadata.checked,
  });
}

function refreshPreview() {
  const md = getCurrentMarkdown();
  els.previewText.textContent = md;
  els.previewChars.textContent = `${md.length.toLocaleString()} chars`;
}

/**
 * Milestone 1: Detect the active tab when the popup opens.
 */
async function initPageDetection() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    activeTab = tab || null;

    if (!activeTab) {
      setBadge(els.pageBadge, "No tab", "error");
      els.pageReason.textContent = "Could not inspect the active browser tab.";
      return;
    }

    const detection = globalThis.ContinuumChatGPTAdapter.detectPage(
      activeTab.url,
      activeTab.title
    );

    els.pageTitle.textContent = detection.title || activeTab.title || "Untitled";
    els.pageReason.textContent = detection.reason;

    if (detection.supported && detection.pageType === "conversation") {
      setBadge(els.pageBadge, "ChatGPT Chat", "ok");
      const state = await scrollCommand("status");
      showRecording(state?.running || false, state?.count);
      if (state?.stopped) displayExport(await scrollCommand("stop"), "browser_dom_scroll");
      scrollButton.disabled = false;
    } else if (detection.supported) {
      setBadge(els.pageBadge, `ChatGPT (${detection.pageType})`, "warn");
      // Still allow extraction attempt in case a conversation is rendered at a non-standard URL
      els.extractBtn.disabled = false;
    } else {
      setBadge(els.pageBadge, "Unsupported", "neutral");
      els.extractBtn.disabled = true;
    }
  } catch (err) {
    setBadge(els.pageBadge, "Error", "error");
    els.pageReason.textContent = `Tab detection failed: ${err.message}`;
  }
}

/**
 * Milestone 2: Inject the ChatGPT adapter and extract the active conversation.
 */
async function handleExtract() {
  if (!activeTab?.id) return;

  els.extractBtn.disabled = true;
  els.extractBtn.textContent = "Extracting…";
  showFeedback("");

  try {
    // 1. Inject the adapter script into the active tab
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["adapters/chatgpt.js"],
    });

    // 2. Run extraction inside the active tab's DOM
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        return globalThis.ContinuumChatGPTAdapter.extractConversation(
          document,
          window.location.href
        );
      },
    });

    if (!result) {
      throw new Error("Extractor returned an empty result.");
    }

    displayExport(result, "browser_dom");
  } catch (err) {
    els.resultSection.classList.remove("hidden");
    setBadge(els.captureBadge, "Failed", "error");
    els.statsLine.textContent = "0 messages captured";
    els.completenessNote.textContent = "Extraction could not run on this page.";
    renderList(els.errorsBox, els.errorsList, [err.message]);
    els.previewText.textContent = "";
    els.previewChars.textContent = "0 chars";
  } finally {
    els.extractBtn.disabled = recording;
    els.extractBtn.textContent = "Re-extract Conversation";
  }
}

function displayExport(result, captureMethod) {
    const pkg = buildExportPackage({
      provider: "chatgpt",
      captureMethod,
      project: {
        id: result.page.projectId,
        name: null,
        source_url: null,
        instructions: {
          status: "not_captured",
          text: null,
        },
      },
      conversations: [result.conversation],
    });

    const validation = validateExportPackage(pkg);
    if (!validation.valid) {
      pkg.conversations[0].errors.push(
        ...validation.errors.map((e) => `Schema validation: ${e}`)
      );
    }

    currentPackage = pkg;
    renderResult(pkg);
}

function renderResult(pkg) {
  const conv = pkg.conversations[0];
  els.resultSection.classList.remove("hidden");

  const hasMessages = conv.messages.length > 0;
  setBadge(els.captureBadge, hasMessages ? "Recorded" : conv.capture_status, hasMessages ? "ok" : "error");
  els.statsLine.textContent = recordedCounts(conv.messages);
  els.completenessNote.textContent = hasMessages ? transcriptNote : conv.completeness_basis;
  renderList(els.errorsBox, els.errorsList, conv.errors);

  els.copyMdBtn.disabled = !hasMessages;
  els.downloadMdBtn.disabled = !hasMessages;
  els.downloadJsonBtn.disabled = false;

  refreshPreview();
}

// Event listeners
scrollButton.addEventListener("click", async () => {
  scrollButton.disabled = true;
  els.extractBtn.disabled = true;
  try {
    if (recording) {
      const result = await scrollCommand("stop");
      showRecording(false);
      displayExport(result, "browser_dom_scroll");
    } else {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["adapters/chatgpt.js", "adapters/scroll-capture.js"],
      });
      await scrollCommand("start");
      const state = await scrollCommand("status");
      showRecording(state.running, state.count);
      els.resultSection.classList.add("hidden");
    }
  } catch (err) {
    scrollStatus.textContent = `Scroll capture failed: ${err.message}`;
  } finally {
    scrollButton.disabled = false;
    els.extractBtn.disabled = recording;
  }
});
els.extractBtn.addEventListener("click", handleExtract);
els.optHandoff.addEventListener("change", refreshPreview);
els.optMetadata.addEventListener("change", refreshPreview);

els.copyMdBtn.addEventListener("click", async () => {
  try {
    await copyTextToClipboard(getCurrentMarkdown());
    showFeedback("Copied Markdown to clipboard — ready to paste into Gemini!");
  } catch (err) {
    showFeedback(`Could not copy: ${err.message}`, true);
  }
});

els.downloadMdBtn.addEventListener("click", () => {
  if (!currentPackage) return;
  const title = currentPackage.conversations[0]?.title;
  const filename = makeSafeFilename(title, "md");
  downloadTextFile(filename, getCurrentMarkdown(), "text/markdown;charset=utf-8");
  showFeedback(`Downloaded ${filename}`);
});

els.downloadJsonBtn.addEventListener("click", () => {
  if (!currentPackage) return;
  const title = currentPackage.conversations[0]?.title;
  const filename = makeSafeFilename(title, "json");
  const json = JSON.stringify(currentPackage, null, 2);
  downloadTextFile(filename, json, "application/json;charset=utf-8");
  showFeedback(`Downloaded ${filename}`);
});

initPageDetection();
