/**
 * ChatGPT Provider Adapter (v0.1.0)
 *
 * Designed to work in TWO environments with zero build step:
 *  1. Injected into a ChatGPT browser tab via chrome.scripting.executeScript
 *     (attaches to globalThis.ContinuumChatGPTAdapter).
 *  2. Imported in Node.js for automated unit tests with synthetic DOM fixtures.
 */

(function initChatGPTAdapter(root) {
  const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  /**
   * Inspect a URL and page title to determine if this is a supported ChatGPT page.
   */
  function detectPage(urlString, pageTitle = "") {
    if (!urlString) {
      return {
        supported: false,
        provider: null,
        pageType: "unknown",
        conversationId: null,
        projectId: null,
        title: pageTitle || "",
        reason: "No active page URL was available.",
      };
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return {
        supported: false,
        provider: null,
        pageType: "invalid_url",
        conversationId: null,
        projectId: null,
        title: pageTitle || "",
        reason: "The current tab URL could not be parsed.",
      };
    }

    if (!SUPPORTED_HOSTS.has(parsed.hostname)) {
      return {
        supported: false,
        provider: null,
        pageType: "unsupported",
        conversationId: null,
        projectId: null,
        title: pageTitle || "",
        reason: `Unsupported site (${parsed.hostname}). Open a conversation on chatgpt.com to export.`,
      };
    }

    const path = parsed.pathname;
    const convMatch = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
    const projectMatch = path.match(/\/g\/(g-p-[a-zA-Z0-9_-]+)/);

    const conversationId = convMatch ? convMatch[1] : null;
    const projectId = projectMatch ? projectMatch[1] : null;

    let pageType = "home";
    if (conversationId) {
      pageType = "conversation";
    } else if (projectId) {
      pageType = "project";
    }

    return {
      supported: true,
      provider: "chatgpt",
      pageType,
      conversationId,
      projectId,
      title: cleanTitle(pageTitle),
      reason:
        pageType === "conversation"
          ? "Ready to extract this ChatGPT conversation."
          : pageType === "project"
            ? "Detected a ChatGPT project page. Open a specific conversation inside it for single-chat export (multi-chat project export is planned for a later milestone)."
            : "Detected ChatGPT, but no active conversation URL (/c/...) is open yet.",
    };
  }

  /**
   * Strip standard ChatGPT tab suffixes from document.title.
   */
  function cleanTitle(rawTitle) {
    if (!rawTitle) return "Untitled conversation";
    return (
      rawTitle
        .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
        .replace(/^ChatGPT\s*[-|]\s*/i, "")
        .trim() || "Untitled conversation"
    );
  }

  /**
   * Convert a rendered ChatGPT DOM element into faithful Markdown.
   * Tracks any non-text elements (images, audio, video, attachments) in `omissions`.
   */
  function domNodeToMarkdown(node, omissions, context = { listDepth: 0 }) {
    if (!node) return "";

    // Text node (nodeType === 3)
    if (node.nodeType === 3) {
      return node.textContent || "";
    }

    // Ignore non-element nodes (comments, etc.)
    if (node.nodeType !== 1) return "";

    const tag = (node.tagName || "").toLowerCase();

    // Skip invisible or UI-only chrome elements
    if (
      tag === "script" ||
      tag === "style" ||
      tag === "button" ||
      tag === "noscript"
    ) {
      return "";
    }

    if (
      typeof node.getAttribute === "function" &&
      (node.getAttribute("aria-hidden") === "true" ||
        node.getAttribute("data-testid") === "copy-code-button")
    ) {
      // Exception: KaTeX puts visual HTML in aria-hidden, so only skip here
      // if we aren't inside a .katex handler (handled below).
      return "";
    }

    // Handle KaTeX math blocks by reading the original LaTeX <annotation>
    const className =
      typeof node.className === "string" ? node.className : "";
    if (className.includes("katex-display") || className.includes("katex")) {
      const annotation =
        typeof node.querySelector === "function"
          ? node.querySelector('annotation[encoding="application/x-tex"]')
          : null;
      if (annotation && annotation.textContent) {
        const tex = annotation.textContent.trim();
        return className.includes("katex-display")
          ? `\n\n$$\n${tex}\n$$\n\n`
          : `$${tex}$`;
      }
    }

    // Non-text media: record honest omission markers instead of silently dropping
    if (tag === "img") {
      const alt =
        typeof node.getAttribute === "function" ? node.getAttribute("alt") : "";
      const label = alt ? `image: ${alt}` : "image";
      omissions.push(`Non-text content omitted (${label}).`);
      return `[Omitted: ${label}]`;
    }

    if (tag === "audio" || tag === "video" || tag === "canvas") {
      omissions.push(`Non-text content omitted (${tag}).`);
      return `[Omitted: ${tag}]`;
    }

    // Code blocks (<pre>)
    if (tag === "pre") {
      return renderCodeBlock(node);
    }

    // Inline code (<code> outside <pre>)
    if (tag === "code") {
      const text = (node.textContent || "").replace(/`/g, "\\`");
      return `\`${text}\``;
    }

    // Line break & horizontal rule
    if (tag === "br") return "\n";
    if (tag === "hr") return "\n\n---\n\n";

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const inner = renderChildren(node, omissions, context).trim();
      return inner ? `\n\n${"#".repeat(level)} ${inner}\n\n` : "";
    }

    // Paragraphs
    if (tag === "p") {
      const inner = renderChildren(node, omissions, context).trim();
      return inner ? `\n\n${inner}\n\n` : "";
    }

    // Emphasis
    if (tag === "strong" || tag === "b") {
      const inner = renderChildren(node, omissions, context);
      return inner.trim() ? `**${inner}**` : "";
    }
    if (tag === "em" || tag === "i") {
      const inner = renderChildren(node, omissions, context);
      return inner.trim() ? `*${inner}*` : "";
    }
    if (tag === "del" || tag === "s") {
      const inner = renderChildren(node, omissions, context);
      return inner.trim() ? `~~${inner}~~` : "";
    }

    // Links
    if (tag === "a") {
      const inner = renderChildren(node, omissions, context).trim();
      const href =
        typeof node.getAttribute === "function"
          ? node.getAttribute("href")
          : "";
      if (!href) return inner;
      return `[${inner || href}](${href})`;
    }

    // Blockquotes
    if (tag === "blockquote") {
      const inner = renderChildren(node, omissions, context).trim();
      if (!inner) return "";
      const quoted = inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }

    // Lists
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.childNodes || []).filter(
        (child) => (child.tagName || "").toLowerCase() === "li"
      );
      const indent = "  ".repeat(context.listDepth);
      const renderedItems = items.map((li, idx) => {
        const bullet = tag === "ol" ? `${idx + 1}. ` : "- ";
        const text = renderChildren(li, omissions, {
          listDepth: context.listDepth + 1,
        }).trim();
        // Indent multiline list items cleanly
        const indented = text.replace(/\n/g, `\n${indent}  `);
        return `${indent}${bullet}${indented}`;
      });
      return `\n\n${renderedItems.join("\n")}\n\n`;
    }

    // Tables
    if (tag === "table") {
      return renderTable(node, omissions, context);
    }

    // Default container (div, span, section, etc.)
    return renderChildren(node, omissions, context);
  }

  function renderChildren(node, omissions, context) {
    const children = Array.from(node.childNodes || []);
    return children
      .map((child) => domNodeToMarkdown(child, omissions, context))
      .join("");
  }

  /**
   * Extract fenced code block with language tag, ignoring ChatGPT's "Copy code" header UI.
   */
  function renderCodeBlock(preNode) {
    const codeNode =
      typeof preNode.querySelector === "function"
        ? preNode.querySelector("code")
        : null;

    let language = "";
    if (codeNode && typeof codeNode.className === "string") {
      const langMatch = codeNode.className.match(/language-([a-zA-Z0-9_+-]+)/);
      if (langMatch) {
        language = langMatch[1];
      }
    }

    const rawCode = codeNode
      ? codeNode.textContent || ""
      : preNode.textContent || "";
    const trimmedCode = rawCode.replace(/\n$/, "");

    // Use a 4-backtick fence if the code itself contains triple backticks
    const fence = trimmedCode.includes("```") ? "````" : "```";
    return `\n\n${fence}${language}\n${trimmedCode}\n${fence}\n\n`;
  }

  /**
   * Convert an HTML <table> into a GitHub-flavored Markdown table.
   */
  function renderTable(tableNode, omissions, context) {
    const rows =
      typeof tableNode.querySelectorAll === "function"
        ? Array.from(tableNode.querySelectorAll("tr"))
        : [];
    if (rows.length === 0) return "";

    const matrix = rows.map((tr) =>
      Array.from(tr.childNodes || [])
        .filter((c) => {
          const t = (c.tagName || "").toLowerCase();
          return t === "th" || t === "td";
        })
        .map((cell) =>
          renderChildren(cell, omissions, context)
            .replace(/\s+/g, " ")
            .replace(/\|/g, "\\|")
            .trim()
        )
    );

    const colCount = Math.max(...matrix.map((r) => r.length), 0);
    if (colCount === 0) return "";

    const normalizeRow = (r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push("");
      return `| ${padded.join(" | ")} |`;
    };

    const header = normalizeRow(matrix[0]);
    const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;
    const body = matrix.slice(1).map(normalizeRow);

    return `\n\n${[header, separator, ...body].join("\n")}\n\n`;
  }

  /**
   * Normalize extra blank lines without touching code block interiors.
   */
  function normalizeMarkdown(md) {
    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Extract the active conversation from the ChatGPT DOM.
   *
   * Returns a raw extraction result ready for lib/schema.js:
   * { page, conversation, stats }
   */
  function extractConversation(doc, urlString, onMessage) {
    const page = detectPage(urlString, doc?.title || "");
    const omissions = [];
    const errors = [];

    if (!page.supported) {
      return {
        page,
        conversation: {
          id: null,
          title: page.title,
          source_url: urlString || null,
          capture_status: "failed",
          completeness_basis: page.reason,
          messages: [],
          omissions: [],
          errors: [page.reason],
        },
        stats: { messageCount: 0, userCount: 0, assistantCount: 0 },
      };
    }

    // Locate message elements in chronological DOM order
    const authorNodes = Array.from(
      doc.querySelectorAll("[data-message-author-role]")
    );
    const useClassFallback = authorNodes.length === 0;
    const userBubbleSelector = ".bg-user-message.text-user-message";
    const markdownRootSelector = '[class^="MarkdownRoot-"], [class*=" MarkdownRoot-"]';
    const fallbackSelector = `${userBubbleSelector}, ${markdownRootSelector}`;
    const messageNodes = useClassFallback
      ? Array.from(doc.querySelectorAll(fallbackSelector)).filter(
          (node) => !node.parentElement?.closest(fallbackSelector)
        )
      : authorNodes;

    if (messageNodes.length === 0) {
      return {
        page,
        conversation: {
          id: page.conversationId,
          title: page.title,
          source_url: urlString || null,
          capture_status: "unread",
          completeness_basis:
            "No rendered messages matching ChatGPT message selectors were found on this page.",
          messages: [],
          omissions: [],
          errors: [
            "Could not find any conversation messages in the current DOM.",
          ],
        },
        stats: { messageCount: 0, userCount: 0, assistantCount: 0 },
      };
    }

    const messages = [];
    let userCount = 0;
    let assistantCount = 0;
    let emptyCount = 0;

    for (const [index, node] of messageNodes.entries()) {
      const role = useClassFallback
        ? (node.matches(userBubbleSelector) ? "user" : "assistant")
        : node.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") {
        omissions.push(`Skipped non-user/assistant message role: "${role}".`);
        continue;
      }

      // Prefer the inner markdown/text container when present
      const contentRoot = useClassFallback && role === "assistant"
        ? node
        : node.querySelector(".markdown") ||
          node.querySelector(".whitespace-pre-wrap") ||
          node;

      const turnOmissions = [];
      const rawMarkdown = domNodeToMarkdown(contentRoot, turnOmissions);
      const content = normalizeMarkdown(rawMarkdown);

      const omissionCounts = new Map();
      for (const note of turnOmissions) {
        omissionCounts.set(note, (omissionCounts.get(note) || 0) + 1);
      }
      const label = content
        ? `Exported message ${messages.length + 1}`
        : `Page element ${index + 1}`;
      for (const [note, count] of omissionCounts) {
        omissions.push(`${label}: ${note}${count > 1 ? ` (×${count})` : ""}`);
      }

      if (!content) {
        emptyCount++;
        omissions.push(
          `Page element ${index + 1} (matched as ${role}) had no extractable text.`
        );
        continue;
      }

      messages.push({
        sequence: messages.length + 1,
        role,
        content,
        content_format: "markdown",
      });
      onMessage?.(node, messages[messages.length - 1], omissionCounts);

      if (role === "user") userCount++;
      if (role === "assistant") assistantCount++;
    }

    // Completeness heuristics — be honest about uncertainty
    const partialReasons = [];

    if (useClassFallback) {
      partialReasons.push(
        "Messages were identified by their rendered layout. Some turns or reply content may be missing."
      );
      if (assistantCount === 0) {
        partialReasons.push("No assistant responses were captured.");
      }
    }

    // 1. Check if ChatGPT is currently generating a response
    const isStreaming = Boolean(
      doc.querySelector('button[aria-label*="Stop"]') ||
        doc.querySelector('[data-testid="stop-button"]')
    );
    if (isStreaming) {
      partialReasons.push(
        "The assistant appears to still be generating a response."
      );
    }

    // 2. Check if the main scroll container is scrolled past the top
    //    (in long chats, earlier turns may be virtualized or not yet loaded)
    const scrollContainer =
      doc.querySelector("main [class*='overflow-y-auto']") ||
      doc.documentElement;
    if (scrollContainer && scrollContainer.scrollTop > 50) {
      partialReasons.push(
        "The conversation is scrolled down; earlier messages may not all be loaded in the DOM. Scroll to the top of the chat before exporting for best coverage."
      );
    }

    if (emptyCount === 1) {
      partialReasons.push("One matched page element had no extractable text.");
    } else if (emptyCount > 1) {
      partialReasons.push(`${emptyCount} matched page elements had no extractable text.`);
    }
    if (omissions.length > emptyCount) {
      partialReasons.push(
        "See the omission notes for media and other skipped content."
      );
    }

    const captureStatus =
      messages.length === 0
        ? "failed"
        : partialReasons.length > 0
          ? "partial"
          : "complete";

    const completenessBasis =
      captureStatus === "complete"
        ? `Captured all ${messages.length} rendered message(s) in the active branch from the DOM. Non-active edit branches and hidden provider metadata are not included.`
        : partialReasons.join(" ");

    return {
      page,
      conversation: {
        id: page.conversationId,
        title: page.title,
        source_url: urlString || null,
        capture_status: captureStatus,
        completeness_basis: completenessBasis,
        messages,
        omissions,
        errors,
      },
      stats: {
        messageCount: messages.length,
        userCount,
        assistantCount,
      },
    };
  }

  const api = {
    detectPage,
    cleanTitle,
    domNodeToMarkdown,
    extractConversation,
  };

  // Expose globally for Chrome tab injection
  root.ContinuumChatGPTAdapter = api;

  // Also support CommonJS/Node imports if needed
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
