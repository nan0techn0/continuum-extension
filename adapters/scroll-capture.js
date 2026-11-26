// Runs in the extension's isolated world in the conversation tab.
(() => {
  if (globalThis.continuumScrollCapture) return;
  let session;

  function stopWatching() {
    session.observer?.disconnect();
    clearTimeout(session.timer);
    document.removeEventListener("scroll", schedule, true);
    window.removeEventListener("pagehide", discard);
    session.running = false;
  }

  function discard() {
    if (session) stopWatching();
    session = undefined;
  }

  function checkPage() {
    if (session && session.path !== location.pathname) discard();
    return Boolean(session);
  }

  function schedule() {
    if (!checkPage() || session.timer) return;
    session.timer = setTimeout(() => {
      if (!checkPage()) return;
      session.timer = 0;
      sample();
    }, 80);
  }

  function sample() {
    const observed = [];
    const result = globalThis.ContinuumChatGPTAdapter.extractConversation(
      document, location.href, (node, message, notes) => {
        observed.push({ node, message, notes, id: node.getAttribute("data-message-id") });
      }
    );
    session.result = result;
    const entries = session.entries;
    const claimed = new Set();
    const key = message => JSON.stringify([message.role, message.content]);
    const byText = new Map();
    for (const entry of entries) {
      const text = key(entry.message);
      byText.set(text, byText.has(text) ? null : entry);
    }
    const keys = observed.map(item => key(item.message));
    const repeated = new Set();
    const seen = new Set();
    for (const text of keys) {
      if (seen.has(text)) repeated.add(text);
      seen.add(text);
    }
    const matches = observed.map(({ node, message, id }, i) => {
      let entry = id && session.ids.get(id);
      const previous = session.nodes.get(node);
      if (!entry && previous && previous.message.role === message.role &&
          (!id || id === previous.id) && (id || key(previous.message) === keys[i])) entry = previous;
      if (!entry && !id && !repeated.has(keys[i])) entry = byText.get(keys[i]);
      if (!entry || claimed.has(entry)) return null;
      claimed.add(entry);
      return entry;
    });
    // The user starts at the newest desired turn and moves toward older ones.
    let position = 0;
    if (entries.length && observed.length && !claimed.size) session.gap = true;
    for (const [i, item] of observed.entries()) {
      let entry = matches[i];
      if (entry) {
        position = entries.indexOf(entry) + 1;
      } else {
        if (i === 0 && claimed.size) position = entries.indexOf(matches.find(Boolean));
        entry = {};
        entries.splice(position++, 0, entry);
      }
      Object.assign(entry, { message: item.message, notes: item.notes, id: item.id });
      session.nodes.set(item.node, entry);
      if (item.id) session.ids.set(item.id, entry);
    }
    for (const note of result.conversation.omissions) {
      if (!note.startsWith("Exported message ")) session.otherNotes.add(note);
    }
  }

  globalThis.continuumScrollCapture = action => {
    checkPage();
    if (action === "status") return { running: Boolean(session?.running), stopped: session?.running === false,
      count: session?.entries.length || 0 };
    if (action === "start") {
      if (session?.running) return;
      discard();
      session = { path: location.pathname, running: true, entries: [], nodes: new WeakMap(),
        ids: new Map(), otherNotes: new Set(), observer: new MutationObserver(schedule) };
      session.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      document.addEventListener("scroll", schedule, true);
      window.addEventListener("pagehide", discard);
      sample();
      return;
    }
    if (!session) throw new Error("Scroll capture ended when the page changed.");
    if (session.running) {
      sample();
      stopWatching();
    }
    const { result, entries, otherNotes, gap } = session;
    if (!entries.length) return result;
    const messages = entries.map(({ message }, i) => ({ ...message, sequence: i + 1 }));
    const omissions = Array.from(otherNotes, note => "During a page snapshot: " + note);
    entries.forEach(({ notes }, i) => {
      for (const [note, count] of notes) omissions.push(`Exported message ${i + 1}: ${note}${count > 1 ? ` (×${count})` : ""}`);
    });
    const userCount = messages.filter(message => message.role === "user").length;
    return { page: result.page, conversation: { ...result.conversation, messages, omissions, errors: [],
      capture_status: "partial", completeness_basis: "Collected rendered messages during manual scrolling." +
        (gap ? " Some snapshots had no overlap. There may be gaps or uncertain ordering." : " Coverage is limited to the portions loaded during capture.") },
      stats: { messageCount: messages.length, userCount, assistantCount: messages.length - userCount } };
  };
})();
