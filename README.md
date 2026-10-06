# Freshsales MCP Server

An MCP (Model Context Protocol) server for the Freshsales (Freshworks CRM) API. Provides 30 tools for managing leads, contacts, accounts, deals, tasks, appointments and notes from any MCP client (Claude Desktop, Claude Code, VS Code, ...).

Freshworks does not ship an official Freshsales MCP server, so this one wraps the REST API directly. It is the CRM companion to [freshdesk_mcp](https://github.com/NeuraLegion/freshdesk_mcp) and follows the same structure.

> **Disclaimer:** Provided as-is, without warranty. You are solely responsible for how you use it and for any actions performed through the Freshsales API. Several tools create or modify real CRM records. Review tool actions before approving them in production.

## How it runs

This is a **local stdio server**: your MCP client launches `node dist/index.js` as a child process and talks to it over stdin/stdout. There is nothing to host, no port to open, and no inbound network access. "Deploying" means building it once and registering it with your client. Your API key stays in that process's environment and is never sent to the model, only the results of tool calls are.

## Prerequisites

- Node.js 18 or newer (20+ recommended)
- A Freshsales account and a personal API key
- An MCP client

## Setup

### 1. Get your API key and bundle alias

1. Log in to Freshsales, click your profile picture, then **Settings > API Settings**.
2. Copy your personal API key.
3. Work out your **bundle alias**: the host and path in your CRM's browser URL, up to and including `/crm/sales`, **without** `https://`. For most accounts this looks like `yourcompany.myfreshworks.com/crm/sales`.

### 2. Clone and build

```bash
git clone https://github.com/jonnyanarx/freshsales_mcp.git
cd freshsales_mcp
npm install
npm run build
```

This compiles `src/` to `dist/index.js`, which is the file your MCP client runs.

### 3. Register it with your MCP client

Use the **absolute path** to `dist/index.js` in every example below.

#### Claude Code

```bash
claude mcp add --env FRESHSALES_DOMAIN=yourcompany.myfreshworks.com/crm/sales --env FRESHSALES_API_KEY=your_api_key freshsales -- node /absolute/path/to/freshsales_mcp/dist/index.js
```

Or commit-free, project-scoped: copy [.mcp.json.example](.mcp.json.example) to `.mcp.json` in your project and fill in the values. `.mcp.json` is git-ignored in this repo so credentials are not committed by accident.

#### Claude Desktop

Edit `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`), then fully restart the app:

```json
{
  "mcpServers": {
    "freshsales": {
      "command": "node",
      "args": ["/absolute/path/to/freshsales_mcp/dist/index.js"],
      "env": {
        "FRESHSALES_DOMAIN": "yourcompany.myfreshworks.com/crm/sales",
        "FRESHSALES_API_KEY": "your_api_key"
      }
    }
  }
}
```

On Windows, escape backslashes in JSON paths (`C:\\Users\\you\\freshsales_mcp\\dist\\index.js`).

#### VS Code

Add the same block to `.vscode/mcp.json`, but VS Code names the top-level key `servers` instead of `mcpServers`.

### 4. Verify

Ask your client something read-only, such as *"List my Freshsales owners"* or *"What views exist for deals?"*. Or smoke-test the server directly (it should print the tool count and exit):

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | FRESHSALES_DOMAIN=yourcompany.myfreshworks.com/crm/sales FRESHSALES_API_KEY=your_api_key node dist/index.js
```

### 5. Updating

```bash
git pull
npm install
npm run build
```

Then restart your MCP client so it relaunches the server.

## Configuration

| Variable | Required | Example |
|----------|----------|---------|
| `FRESHSALES_DOMAIN` | yes | `yourcompany.myfreshworks.com/crm/sales` (no `https://`) |
| `FRESHSALES_API_KEY` | yes | your personal API key |

The server exits immediately with an error if either is missing.

## Available Tools (30 Total)

### Discovery (4 tools)
| Tool | Description |
|------|-------------|
| `list_views` | List saved views for a module; gives you the `view_id` the list tools need |
| `list_field_choices` | Look up a field's valid dropdown values and whether it is required, including custom `cf_*` fields |
| `list_owners` | List CRM users and their `owner_id` |
| `search` | Unified search across leads, contacts, accounts and deals |

### Contacts (5 tools)
| Tool | Description |
|------|-------------|
| `list_contacts` | List contacts from a view |
| `view_contact` | View contact details |
| `create_contact` | Create a contact |
| `update_contact` | Update a contact |
| `search_contacts` | Search contacts |

### Accounts (5 tools)
| Tool | Description |
|------|-------------|
| `list_accounts` | List accounts (companies) from a view |
| `view_account` | View account details |
| `create_account` | Create an account |
| `update_account` | Update an account |
| `search_accounts` | Search accounts |

### Deals (5 tools)
| Tool | Description |
|------|-------------|
| `list_deals` | List deals from a view |
| `view_deal` | View deal details |
| `create_deal` | Create a deal |
| `update_deal` | Update a deal, e.g. move stage, change amount or owner |
| `search_deals` | Search deals |

### Leads (5 tools)
| Tool | Description |
|------|-------------|
| `list_leads` | List leads from a view |
| `view_lead` | View lead details |
| `create_lead` | Create a lead |
| `update_lead` | Update a lead |
| `search_leads` | Search leads |

### Tasks (3 tools)
| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks (open, due today, overdue, all) |
| `create_task` | Create a task, optionally linked to a record |
| `update_task` | Reschedule, reassign or update a task |

### Appointments (2 tools)
| Tool | Description |
|------|-------------|
| `list_appointments` | List appointments (upcoming, past, all) |
| `create_appointment` | Create an appointment, optionally linked to a record |

### Notes (1 tool)
| Tool | Description |
|------|-------------|
| `create_note` | Add a note to a contact, account, deal or lead |

"Account" and "Company" are the same thing in Freshsales: the API module is `sales_accounts`, and a contact's link to its account is labelled "Company".

## Things that differ from other CRM APIs

These were found by probing a live account rather than assumed:

- **Auth** is `Authorization: Token token=<key>`, not Basic or Bearer.
- **Listing needs a view id.** There is no flat "list all contacts". Call `list_views` for the module, then pass one of the ids to `list_contacts`, `list_accounts`, `list_deals` or `list_leads`.
- **Compound fields are objects.** Emails and phone numbers are arrays of `{ value, is_primary, label }`. The tools hide this: pass a plain `email` string and the client builds the array.
- **Custom fields (`cf_*`) are nested** under `custom_field` in the request body, never at the top level. Each instance has its own set, so tools accept a generic `custom_field: {...}` object instead of hardcoding names.
- **Custom picklists take the label, built-in dropdowns take the id.** For a `cf_*` picklist send the label string (e.g. `"EMEA"`); for built-ins like `deal_stage_id` send the numeric id. Sending a numeric id to a `cf_*` picklist is *silently ignored*: the API returns success but nothing changes and `updated_at` does not move. Verify writes by re-reading the record.
- **Required custom fields** vary per instance and can make `create_deal` fail. `list_field_choices` reports whether a field is required.
- **Leads access is permission-gated.** Some roles can read the Leads field schema but get `403 Access Denied` on lead records. The lead tools return that error as a normal tool error.
- **`update_task` status:** the exact accepted value for completing a task (e.g. `"COMPLETED"`) has not been verified; check the result and adjust if it is rejected.
- **Rate limit:** Freshsales allows about 1000 API requests per hour per account (HTTP 429 beyond that).

## Usage examples

```
# Find views, then list deals in one
list_views with module "deals"
list_deals with view_id 12345, per_page 10

# Find a company, then its contacts' details
search_accounts with query "acme"
view_account with account_id 12345

# Look up valid values before writing
list_field_choices with module "deals", field "deal_stage_id"
update_deal with deal_id 12345, deal_stage_id 67890

# Create a contact linked to an account
create_contact with first_name "Ada", last_name "Lovelace", email "ada@example.com", company_id 12345

# Leave a note and schedule a follow-up
create_note with targetable_type "Deal", targetable_id 12345, description "Sent pricing"
create_task with title "Follow up", due_date "2026-12-01", targetable_type "Deal", targetable_id 12345
```

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Server exits immediately: *environment variables are required* | `FRESHSALES_DOMAIN` or `FRESHSALES_API_KEY` is not set in your client's `env` block |
| `401` / `403` on every call | Wrong API key, or the key belongs to a user without access to that module |
| `403 Access Denied` only on lead tools | Your role lacks Leads permission (see above) |
| `404` on every call | `FRESHSALES_DOMAIN` is wrong; it must include the `/crm/sales` path and no `https://` |
| `429` | Hourly rate limit reached; wait and retry |
| Tools do not appear in the client | Path to `dist/index.js` is not absolute, you skipped `npm run build`, or the client was not restarted |
| A write returns success but nothing changed | Likely a numeric id sent to a `cf_*` picklist; send the label string instead |

Server logs go to stderr (stdout is reserved for the MCP protocol), so check your client's MCP log for them.

## Security

- Treat the API key like a password. It carries all of your user's permissions in Freshsales.
- Never commit `.mcp.json` or `.env` (both are git-ignored). Use `.mcp.json.example` as the template.
- If a key is ever exposed, rotate it in **Settings > API Settings**.
- Consider using a dedicated, least-privilege CRM user for the key.

## Development

```bash
npm install
npm run build
npm start      # needs FRESHSALES_DOMAIN and FRESHSALES_API_KEY set
```

- `src/freshsales-client.ts`: plain TypeScript API client (auth, HTTP, request/response shapes). No MCP code.
- `src/index.ts`: the MCP layer. Zod schemas, tool registration, text formatting.

## License

MIT. See [LICENSE](LICENSE).
