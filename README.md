# Continuum Chrome Extension (v0.1.0)

**Early development / experimental.** Review the preview before relying on an export. Long conversations can have earlier messages that have not loaded in the browser.

Export AI conversations from your browser into clean, portable **Markdown** (ready to paste or upload into Gemini, Claude, or any other AI) and versioned **JSON** (`schema_version: "0.1.0"`)—100% locally, with no backend or API key.

## What’s Built So Far (Milestones 1 & 2)

- **Page detection:** Recognizes ChatGPT conversations, projects, home pages, and unsupported sites.
- **Single-conversation extraction:** Captures user & assistant turns in chronological order, preserving code blocks (with language tags, stripping "Copy code" UI text), lists, tables, links, Unicode, and KaTeX math.
- **Honest completeness reporting:** Flags `complete`, `partial`, `unread`, or `failed` with explicit `completeness_basis` and `omissions` (e.g., images, scrolled/possibly virtualized chats, or mid-generation responses).
- **Direct export:** Copy Markdown to clipboard, download `.md`, or download versioned `.json`.

## Project Layout

```text
continuum-extension/
  manifest.json         # Chrome Extension Manifest V3 config (activeTab + scripting)
  popup.html            # Extension popup UI
  popup.css             # Popup styling
  popup.js              # Popup controller: tab detection, injection, preview, export
  adapters/
    chatgpt.js          # ChatGPT URL detection + DOM-to-Markdown extractor
  lib/
    schema.js           # Versioned v0.1.0 data contract builder & validator
    markdown.js         # Provider-independent JSON -> Markdown renderer
    export.js           # Local file download & clipboard helpers
  tests/
    test.html           # Synthetic DOM fixture test suite (open in Chrome)
```

## How to Load in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder: `continuum-extension`.
5. Pin **Continuum** to your toolbar, open a conversation on `https://chatgpt.com`, click the Continuum icon, and press **Extract Conversation**.

## How to Run the Synthetic Fixture Tests

Because `tests/test.html` uses ES modules, serve the folder locally or open it via a simple local server, e.g.:

- If you have VS Code's Live Server, right-click `tests/test.html` → **Open with Live Server**.
- Or with Python: `python -m http.server 8000` and open `http://localhost:8000/tests/test.html`.

## What’s Next (Future Milestones)

- Multi-chat project discovery & selective export (pick specific chats + project instructions)
- Optional Custom Instructions / Saved Memories capture
- Additional provider adapters (Gemini, Claude)
- Connecting the v0.1.0 JSON schema to `migrate.py`

## Contributing

Use synthetic conversations in tests and bug reports. Keep real captures outside the repository or in the ignored `exports/` folder. JSON exports include the conversation text and source URL.

## License

[MIT License](LICENSE)
