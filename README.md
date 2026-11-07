# Todo Panel

A sidebar extension for **QoderCN** that helps you manage to-do items with automatic sync from Jira and GitLab.

## Features

- **Manual Todo Management** — Add, edit, complete, and delete to-do items directly in the sidebar panel.
- **Jira Sync** — Pull your current sprint's assigned issues and merge them into the todo list. Existing items update their status; manually added items are preserved.
- **GitLab MR Sync** — Fetch open Merge Requests where you are an **Assignee** or **Reviewer**. Already-approved MRs are automatically filtered out.
- **Smart Merge** — Syncing never overwrites your manual entries. External items are matched by Jira key or GitLab MR ID, updating titles and statuses while keeping your completion state.
- **Persistent Storage** — Todo data is saved locally per workspace, so your list survives IDE restarts.

## Requirements

- [QoderCN IDE](https://www.qoder.com) installed
- [Node.js](https://nodejs.org/) 18+
- (Optional) **ScrumBuddy** configured at `~/.scrumbuddy/config.json` for Jira and GitLab sync

### ScrumBuddy Config Format

```json
{
  "jira": {
    "baseUrl": "http://your-jira-host:8080",
    "username": "your-username",
    "password": "your-api-token"
  },
  "gitlab": {
    "baseUrl": "https://your-gitlab-host",
    "token": "your-private-token"
  }
}
```

## Installation

### Quick Install (Recommended)

Double-click `install.bat` or run from a terminal:

```powershell
.\install.ps1
```

The script will:

1. Verify QoderCN CLI is available
2. Install npm dependencies
3. Compile TypeScript
4. Package the `.vsix`
5. Install the extension via QoderCN CLI

After installation, press `Ctrl+Shift+P` → **Reload Window** to activate the extension.

### Manual Install

```bash
npm install
npm run package
```

Run the unit tests with `npm test` (no IDE, no network required).

Then install the generated `.vsix`:

```bash
& "C:\Program Files\QoderCN\bin\qoder-cn.cmd" --install-extension todo-panel-0.0.1.vsix
```

> **Note:** Do NOT use `code --install-extension` — that installs into VS Code, not QoderCN.

## Usage

1. Click the **Todo Panel** icon in the Activity Bar (left sidebar).
2. Use the **+** button to add manual to-do items.
3. Click the **Sync** (↻) button to pull Jira sprint issues.
4. Click the **GitLab** (⎇) button to fetch your related Merge Requests.
5. Check/uncheck items to mark them complete. Right-click for more options.

## Project Structure

```
src/
├── extension.ts              # Extension entry point
├── models/
│   └── Todo.ts               # Todo data model
├── providers/
│   └── TodoWebviewProvider.ts # Webview UI and message handling
└── services/
    ├── LocalFileTodoService.ts # Local file persistence & merge logic
    ├── JiraService.ts         # Jira API integration
    └── GitLabService.ts       # GitLab API integration
```

## License

MIT
