# MR Board hands review off through the clipboard, not through a chat API

Status: accepted

The MR Board needs to take a merge request from a card and start a Qoder code review session. Qoder CN exposes no extension-facing way to do that: the chat panel's `workbench.action.newChat` is an entry in the chat WebView's own command table (registered with its internal `registerCommand`, bound to `Ctrl+N`), not a VS Code command, and the "add to chat" actions in the review and selection menus only append attachments to a draft that lives inside that WebView. The only programmatic conversation surface is the agent-side host tools (`createChatSession` / `sendMessageToChatSession`), which are available to Qoder's own agent, not to third-party extensions.

We therefore split the handoff in two halves the extension can actually own. It materialises the MR diff as a local artifact, then puts a ready-to-send `/code-review` instruction on the clipboard and tells the person to open a new chat session, paste, and press Enter. The extension does not call `executeCommand` on the chat command id at all — a failure there surfaces as a "command not found" error with no user value, and a half-working call is worse than a predictable two-keystroke flow.

## Considered Options

- **Run `qoderclicn --prompt-interactive` in an integrated terminal.** Fully automatic and the CLI is a stable, documented surface, but the review session lands in a terminal session rather than the IDE chat panel, which is where the person actually reviews code.
- **Call `workbench.action.newChat` and hope it exists as a VS Code command.** Rejected: it is a WebView-internal id, so the call fails; even if a future Qoder version registered it, there is still no way to seed the prompt.
- **Let the agent fetch the diff itself from the MR URL.** Rejected as the primary path: it depends on the session having the GitLab MCP server loaded and on the agent choosing to use it, so the same right-click could produce different results on different days. It survives only as the degraded text used when the diff fetch fails.

## Consequences

- The person performs two keystrokes (paste, Enter) after the right-click. That is the cost of not having a chat API, and it is cheaper than a review session that silently reviewed the wrong thing.
- Review is **diff-only**: the workspace holds no checkout of the target repository, so the agent cannot see surrounding code. This is the floor of the feature, not its ceiling; a configured local checkout is the obvious follow-up.
- Diff artifacts accumulate under `.scratch/mr-board/diffs/`. They are local traces, overwritten per MR, and deliberately not cleaned up automatically.
- If Qoder later ships a real "open a session with this prompt" command, only the final step changes: the instruction text and the diff artifact remain the contract.
