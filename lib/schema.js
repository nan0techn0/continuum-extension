/**
 * Continuum portable data contract (schema v0.1.0).
 *
 * Provider-independent builder and validator so every future adapter
 * (ChatGPT, Claude, Gemini) outputs the exact same structure.
 */

export const SCHEMA_VERSION = "0.1.0";

export const VALID_CAPTURE_STATUSES = Object.freeze([
  "complete",
  "partial",
  "unread",
  "failed",
]);

export const VALID_INSTRUCTION_STATUSES = Object.freeze([
  "captured",
  "not_captured",
  "unavailable",
  "excluded",
]);

/**
 * Build a versioned Continuum export package.
 */
export function buildExportPackage({
  provider,
  captureMethod = "browser_dom",
  capturedAt = new Date().toISOString(),
  project = null,
  conversations = [],
}) {
  const normalizedProject = {
    id: project?.id ?? null,
    name: project?.name ?? null,
    source_url: project?.source_url ?? null,
    instructions: {
      status: VALID_INSTRUCTION_STATUSES.includes(project?.instructions?.status)
        ? project.instructions.status
        : "not_captured",
      text: project?.instructions?.text ?? null,
    },
  };

  const normalizedConversations = conversations.map((conv) => ({
    id: conv.id ?? null,
    title: conv.title || "Untitled conversation",
    source_url: conv.source_url ?? null,
    capture_status: VALID_CAPTURE_STATUSES.includes(conv.capture_status)
      ? conv.capture_status
      : "partial",
    completeness_basis:
      conv.completeness_basis ||
      "Captured from currently rendered page content.",
    messages: (conv.messages || []).map((msg, idx) => ({
      sequence: typeof msg.sequence === "number" ? msg.sequence : idx + 1,
      role: msg.role,
      content: msg.content,
      content_format: msg.content_format || "markdown",
    })),
    omissions: Array.isArray(conv.omissions) ? [...conv.omissions] : [],
    errors: Array.isArray(conv.errors) ? [...conv.errors] : [],
  }));

  return {
    schema_version: SCHEMA_VERSION,
    provider,
    captured_at: capturedAt,
    capture_method: captureMethod,
    project: normalizedProject,
    conversations: normalizedConversations,
  };
}

/**
 * Validate a Continuum export package against the v0.1.0 contract.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateExportPackage(pkg) {
  const errors = [];

  if (!pkg || typeof pkg !== "object") {
    return { valid: false, errors: ["Package must be an object."] };
  }

  if (pkg.schema_version !== SCHEMA_VERSION) {
    errors.push(
      `Unsupported schema_version: expected "${SCHEMA_VERSION}", got "${pkg.schema_version}".`
    );
  }

  if (!pkg.provider || typeof pkg.provider !== "string") {
    errors.push("Missing or invalid 'provider' string.");
  }

  if (!pkg.captured_at || Number.isNaN(Date.parse(pkg.captured_at))) {
    errors.push("Missing or invalid ISO timestamp 'captured_at'.");
  }

  if (!pkg.project || typeof pkg.project !== "object") {
    errors.push("Missing 'project' object.");
  } else if (
    !pkg.project.instructions ||
    !VALID_INSTRUCTION_STATUSES.includes(pkg.project.instructions.status)
  ) {
    errors.push("Invalid 'project.instructions.status'.");
  }

  if (!Array.isArray(pkg.conversations)) {
    errors.push("'conversations' must be an array.");
  } else {
    pkg.conversations.forEach((conv, cIdx) => {
      if (!VALID_CAPTURE_STATUSES.includes(conv.capture_status)) {
        errors.push(
          `conversations[${cIdx}]: invalid capture_status "${conv.capture_status}".`
        );
      }
      if (!Array.isArray(conv.messages)) {
        errors.push(`conversations[${cIdx}]: 'messages' must be an array.`);
      } else {
        conv.messages.forEach((msg, mIdx) => {
          if (typeof msg.sequence !== "number" || msg.sequence < 1) {
            errors.push(
              `conversations[${cIdx}].messages[${mIdx}]: invalid sequence.`
            );
          }
          if (!msg.role || typeof msg.role !== "string") {
            errors.push(
              `conversations[${cIdx}].messages[${mIdx}]: missing role.`
            );
          }
          if (typeof msg.content !== "string") {
            errors.push(
              `conversations[${cIdx}].messages[${mIdx}]: content must be a string.`
            );
          }
        });
      }
      if (!Array.isArray(conv.omissions)) {
        errors.push(`conversations[${cIdx}]: 'omissions' must be an array.`);
      }
      if (!Array.isArray(conv.errors)) {
        errors.push(`conversations[${cIdx}]: 'errors' must be an array.`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
