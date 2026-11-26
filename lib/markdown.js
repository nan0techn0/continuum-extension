/**
 * Provider-independent Markdown renderer.
 *
 * Converts a Continuum v0.1.0 JSON package into a clean Markdown document
 * that you can paste or upload directly into Gemini, Claude, or another AI.
 */

/**
 * Format a role string for display (e.g., "user" -> "User").
 */
function formatRole(role) {
  if (!role) return "Unknown";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export const transcriptNote =
  "This transcript preserves text. Images, audio, video, and interactive elements are omitted.";

export function recordedCounts(messages) {
  const users = messages.filter(message => message.role === "user").length;
  const assistants = messages.filter(message => message.role === "assistant").length;
  return `${messages.length} ${messages.length === 1 ? "message" : "messages"} recorded (${users} user · ${assistants} assistant)`;
}

/**
 * Render a Continuum export package to Markdown.
 *
 * @param {object} pkg - Validated Continuum v0.1.0 package
 * @param {object} [options]
 * @param {boolean} [options.includeHandoffPrompt=true] - Adds a short note for the destination AI
 * @param {boolean} [options.includeMetadata=true] - Adds provenance & completeness header
 */
export function exportPackageToMarkdown(
  pkg,
  { includeHandoffPrompt = true, includeMetadata = true } = {}
) {
  const lines = [];
  const primaryTitle =
    pkg.conversations?.[0]?.title || pkg.project?.name || "Continuum Export";

  lines.push(`# ${primaryTitle}`);
  lines.push("");

  if (includeHandoffPrompt) {
    lines.push(
      "> **Context handoff:** The following material was exported from another AI workspace using Continuum. Use it as background context so we can continue from where this conversation left off."
    );
    lines.push("");
  }

  if (includeMetadata) {
    lines.push("## Export Metadata");
    lines.push("");
    lines.push(`- **Source provider:** ${pkg.provider}`);
    lines.push(`- **Schema version:** ${pkg.schema_version}`);
    lines.push(`- **Captured at:** ${pkg.captured_at}`);
    if (pkg.project?.name) {
      lines.push(`- **Project:** ${pkg.project.name}`);
    }
    if (pkg.project?.instructions?.status) {
      lines.push(
        `- **Project instructions:** ${pkg.project.instructions.status}`
      );
    }
    lines.push("");
  }

  if (
    pkg.project?.instructions?.status === "captured" &&
    pkg.project.instructions.text
  ) {
    lines.push("## Project Instructions");
    lines.push("");
    lines.push(pkg.project.instructions.text.trim());
    lines.push("");
  }

  for (const conv of pkg.conversations || []) {
    if ((pkg.conversations || []).length > 1) {
      lines.push(`## Conversation: ${conv.title}`);
      lines.push("");
    }

    if (includeMetadata) {
      if (conv.messages?.length) {
        lines.push(`> **${recordedCounts(conv.messages)}**`, ">", `> ${transcriptNote}`);
      } else {
        lines.push(`> **Capture status:** ${conv.capture_status} — ${conv.completeness_basis}`);
      }
      if (conv.errors && conv.errors.length > 0) {
        lines.push(`>`);
        lines.push(`> **Errors:**`);
        for (const err of conv.errors) {
          lines.push(`> - ${err}`);
        }
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");

    if (!conv.messages || conv.messages.length === 0) {
      lines.push("_No messages were captured for this conversation._");
      lines.push("");
      continue;
    }

    for (const msg of conv.messages) {
      lines.push(`### ${formatRole(msg.role)}`);
      lines.push("");
      lines.push(msg.content.trim());
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
