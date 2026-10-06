#!/usr/bin/env node

/**
 * Freshsales (Freshworks CRM) MCP Server
 * Provides MCP tools for interacting with the Freshsales API.
 *
 * Structure mirrors the freshdesk_mcp-main server: this file is the MCP
 * (protocol) layer only — it validates input with Zod, calls the plain
 * FreshsalesClient, and formats results as text. See freshsales-client.ts
 * for the actual HTTP/auth/schema-mapping logic.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  FreshsalesClient,
  type FreshsalesModule,
  type CreateContactParams,
  type UpdateContactParams,
  type CreateAccountParams,
  type UpdateAccountParams,
  type CreateDealParams,
  type UpdateDealParams,
  type CreateLeadParams,
  type UpdateLeadParams,
  type CreateTaskParams,
  type UpdateTaskParams,
  type CreateAppointmentParams,
  type CreateNoteParams,
  type ListParams,
} from './freshsales-client.js';

// Get configuration from environment variables
const FRESHSALES_DOMAIN = process.env.FRESHSALES_DOMAIN; // e.g. "yourcompany.myfreshworks.com/crm/sales" (no protocol)
const FRESHSALES_API_KEY = process.env.FRESHSALES_API_KEY;

if (!FRESHSALES_DOMAIN || !FRESHSALES_API_KEY) {
  console.error('Error: FRESHSALES_DOMAIN and FRESHSALES_API_KEY environment variables are required');
  process.exit(1);
}

const client = new FreshsalesClient({
  domain: FRESHSALES_DOMAIN,
  apiKey: FRESHSALES_API_KEY,
});

// ==================== ID -> LABEL RESOLUTION ====================
// Dropdown fields come back from the API as opaque numeric ids. Labels are
// resolved from /settings/{module}/fields once at startup (best effort: if
// that fails, formatters just print the raw id) so nothing is hardcoded to a
// single Freshsales account. The model can always call list_field_choices.

const labels: Record<string, Record<number, string>> = {
  deal_type_id: {},
  deal_stage_id: {},
  deal_pipeline_id: {},
  contact_status_id: {},
  lead_stage_id: {},
};

const LABEL_FIELDS: Array<[FreshsalesModule, string[]]> = [
  ['deals', ['deal_type_id', 'deal_stage_id', 'deal_pipeline_id']],
  ['contacts', ['contact_status_id']],
  ['leads', ['lead_stage_id']],
];

async function loadLabels(): Promise<void> {
  await Promise.all(
    LABEL_FIELDS.map(async ([module, names]) => {
      try {
        const fields = await client.listFields(module);
        for (const f of fields) {
          if (!names.includes(f.name)) continue;
          for (const c of f.choices ?? []) labels[f.name][Number(c.id)] = c.value;
        }
      } catch (error) {
        console.error(`Could not load ${module} labels (showing raw ids): ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );
}

// ==================== HELPER FORMATTERS ====================

function fmtId(field: string, id: unknown): string {
  if (id === undefined || id === null) return 'N/A';
  const label = labels[field]?.[Number(id)];
  return label ? `${label} (#${id})` : String(id);
}

function formatContact(c: Record<string, unknown>): string {
  const email = (c.email as string) || ((c.emails as { value: string }[])?.[0]?.value ?? 'N/A');
  return `
Contact #${c.id}
Name: ${c.first_name || ''} ${c.last_name || ''}`.trim() + `
Email: ${email}
Job Title: ${c.job_title || 'N/A'}
Mobile: ${c.mobile_number || 'N/A'} | Work: ${c.work_number || 'N/A'}
Owner ID: ${c.owner_id || 'N/A'}
Status: ${fmtId('contact_status_id', c.contact_status_id)}
Created: ${c.created_at}
Updated: ${c.updated_at}
`.trim();
}

function formatAccount(a: Record<string, unknown>): string {
  return `
Account #${a.id}
Name: ${a.name}
Website: ${a.website || 'N/A'}
Phone: ${a.phone || 'N/A'}
Owner ID: ${a.owner_id || 'N/A'}
Employees: ${a.number_of_employees || 'N/A'}
Annual Revenue: ${a.annual_revenue || 'N/A'}
Created: ${a.created_at}
Updated: ${a.updated_at}
`.trim();
}

function formatDeal(d: Record<string, unknown>): string {
  return `
Deal #${d.id}
Name: ${d.name}
Amount: ${d.amount ?? 'N/A'}
Type: ${fmtId('deal_type_id', d.deal_type_id)}
Pipeline: ${fmtId('deal_pipeline_id', d.deal_pipeline_id)}
Stage: ${fmtId('deal_stage_id', d.deal_stage_id)}
Owner ID: ${d.owner_id || 'N/A'}
Account ID: ${d.sales_account_id || 'N/A'}
Expected Close: ${d.expected_close || 'N/A'}
Created: ${d.created_at}
Updated: ${d.updated_at}
`.trim();
}

function formatLead(l: Record<string, unknown>): string {
  const email = (l.email as string) || ((l.emails as { value: string }[])?.[0]?.value ?? 'N/A');
  return `
Lead #${l.id}
Name: ${l.first_name || ''} ${l.last_name || ''}`.trim() + `
Company: ${l.name || 'N/A'}
Email: ${email}
Job Title: ${l.job_title || 'N/A'}
Stage: ${fmtId('lead_stage_id', l.lead_stage_id)}
Owner ID: ${l.owner_id || 'N/A'}
Created: ${l.created_at}
Updated: ${l.updated_at}
`.trim();
}

function formatTask(t: Record<string, unknown>): string {
  return `
Task #${t.id}
Title: ${t.title}
Due: ${t.due_date || 'N/A'}
Status: ${t.status ?? 'N/A'}
Owner ID: ${t.owner_id || 'N/A'}
Linked to: ${t.targetable_type || 'N/A'} #${t.targetable_id || 'N/A'}
`.trim();
}

function formatAppointment(a: Record<string, unknown>): string {
  return `
Appointment #${a.id}
Title: ${a.title}
From: ${a.from_date} | To: ${a.end_date}
Linked to: ${a.targetable_type || 'N/A'} #${a.targetable_id || 'N/A'}
`.trim();
}

// Create MCP server
const server = new McpServer({
  name: 'freshsales-mcp-server',
  version: '1.0.0',
});

// ==================== DISCOVERY ====================
// Freshsales lists records by "view", and dropdown fields (both standard and
// the ~20-40 org-specific cf_* custom fields per module) have their own id
// spaces. These tools let the model look those up live instead of the server
// hardcoding every possible id.

server.tool(
  'list_views',
  'List the saved views (filters) available for a module. A view id is required by list_contacts/list_accounts/list_deals/list_leads — call this first to get one (e.g. "All Contacts", "Open Deals", "My Leads").',
  {
    module: z.enum(['leads', 'contacts', 'sales_accounts', 'deals']).describe('Module to list views for'),
  },
  async ({ module }) => {
    try {
      const views = await client.listViews(module as FreshsalesModule);
      const summary = views.map((v) => `#${v.id} | ${v.name}`).join('\n');
      return { content: [{ type: 'text', text: `Views for ${module}:\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'list_field_choices',
  'Look up a field\'s definition and valid dropdown choices (id -> label) for a module, including custom fields (cf_*). Use this before setting a dropdown/custom_field value you don\'t already know the id for — e.g. module="deals", field="deal_stage_id". IMPORTANT: for built-in fields (name has no cf_ prefix, e.g. deal_stage_id) pass the numeric id shown. For custom picklist fields (cf_* prefix) pass the label STRING (the "value" column) instead — the numeric id is silently ignored (200 response, no error, no change) for those.',
  {
    module: z.enum(['leads', 'contacts', 'sales_accounts', 'deals']).describe('Module the field belongs to'),
    field: z.string().describe('Field name, e.g. "lead_source_id", "deal_stage_id", "cf_my_custom_field"'),
  },
  async ({ module, field }) => {
    try {
      const def = await client.listFieldChoices(module as FreshsalesModule, field);
      if (!def.choices || def.choices.length === 0) {
        return { content: [{ type: 'text', text: `${field} (${def.type}) has no fixed choices — it's a free-text/number/date field. Required: ${def.required ?? false}` }] };
      }
      const summary = def.choices.map((c) => `${c.id} = ${c.value}${c.deal_pipeline_id ? ` (pipeline #${c.deal_pipeline_id})` : ''}`).join('\n');
      const usageNote = field.startsWith('cf_')
        ? `\n\nThis is a custom field — when setting it via custom_field, pass the label STRING from the right-hand column above (e.g. custom_field: { "${field}": "${def.choices[0].value}" }), not the numeric id. The numeric id is silently ignored for cf_* fields.`
        : `\n\nThis is a built-in field — pass the numeric id shown above directly as "${field}" (not nested under custom_field).`;
      return { content: [{ type: 'text', text: `${def.label} (${field}) | Required: ${def.required ?? false} | choices:\n\n${summary}${usageNote}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'list_owners',
  'List all CRM users who can own leads/contacts/accounts/deals, with their owner_id.',
  {},
  async () => {
    try {
      const owners = await client.listOwners();
      const summary = owners.map((o) => `#${o.id} | ${o.display_name} | ${o.email} | Active: ${o.is_active}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${owners.length} owner(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'search',
  'Unified search across leads, contacts, accounts and deals by name/email/keyword.',
  {
    query: z.string().describe('Search term'),
    include: z.array(z.enum(['lead', 'contact', 'sales_account', 'deal'])).optional()
      .describe('Restrict to these record types (default: all)'),
  },
  async ({ query, include }) => {
    try {
      const results = await client.search(query, include);
      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No results for: ${query}` }] };
      }
      const summary = results.map((r) => `[${r.type}] #${r.id} | ${r.name || r.email || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${results.length} result(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

const listParamsShape = {
  page: z.number().optional(),
  per_page: z.number().optional(),
  sort: z.string().optional().describe('Field name to sort by'),
  sort_type: z.enum(['asc', 'desc']).optional(),
};

// ==================== CONTACTS ====================

server.tool(
  'list_contacts',
  'List contacts from a saved view. Call list_views(module="contacts") first to get a view_id.',
  { view_id: z.union([z.string(), z.number()]).describe('View id from list_views'), ...listParamsShape },
  async ({ view_id, ...params }) => {
    try {
      const { contacts, meta } = await client.listContacts(view_id, params as ListParams);
      if (contacts.length === 0) return { content: [{ type: 'text', text: 'No contacts found in this view.' }] };
      const summary = contacts.map((c) => `#${c.id} | ${c.first_name || ''} ${c.last_name || ''} | ${c.email || (c.emails as { value: string }[])?.[0]?.value || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? contacts.length} contact(s) (showing ${contacts.length}):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'view_contact',
  'View detailed information about a contact.',
  { contact_id: z.number().describe('Contact ID') },
  async ({ contact_id }) => {
    try {
      const contact = await client.viewContact(contact_id);
      return { content: [{ type: 'text', text: formatContact(contact as unknown as Record<string, unknown>) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_contact',
  'Create a new contact.',
  {
    first_name: z.string().describe('First name'),
    last_name: z.string().optional(),
    email: z.string().optional(),
    mobile_number: z.string().optional(),
    work_number: z.string().optional(),
    job_title: z.string().optional(),
    owner_id: z.number().optional().describe('CRM user id — see list_owners'),
    company_id: z.number().optional().describe('Account (sales_account) id to link as this contact\'s company'),
    lead_source_id: z.number().optional().describe('See list_field_choices(module="contacts", field="lead_source_id")'),
    contact_status_id: z.number().optional().describe('See list_field_choices(module="contacts", field="contact_status_id")'),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional().describe('Custom (cf_*) field values, e.g. { "cf_website": "https://..." }'),
  },
  async (params) => {
    try {
      const contact = await client.createContact(params as CreateContactParams);
      return { content: [{ type: 'text', text: `Contact created!\n\n${formatContact(contact as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_contact',
  'Update an existing contact.',
  {
    contact_id: z.number().describe('Contact ID'),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string().optional(),
    mobile_number: z.string().optional(),
    work_number: z.string().optional(),
    job_title: z.string().optional(),
    owner_id: z.number().optional(),
    company_id: z.number().optional(),
    lead_source_id: z.number().optional(),
    contact_status_id: z.number().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional(),
  },
  async ({ contact_id, ...params }) => {
    try {
      const contact = await client.updateContact(contact_id, params as UpdateContactParams);
      return { content: [{ type: 'text', text: `Contact updated!\n\n${formatContact(contact as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'search_contacts',
  'Search contacts by name/email/keyword.',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    try {
      const results = await client.searchContacts(query);
      if (results.length === 0) return { content: [{ type: 'text', text: `No contacts found for: ${query}` }] };
      const summary = results.map((r) => `#${r.id} | ${r.name || 'N/A'} | ${r.email || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${results.length} contact(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== ACCOUNTS ====================

server.tool(
  'list_accounts',
  'List accounts (companies) from a saved view. Call list_views(module="sales_accounts") first to get a view_id.',
  { view_id: z.union([z.string(), z.number()]).describe('View id from list_views'), ...listParamsShape },
  async ({ view_id, ...params }) => {
    try {
      const { sales_accounts, meta } = await client.listAccounts(view_id, params as ListParams);
      if (sales_accounts.length === 0) return { content: [{ type: 'text', text: 'No accounts found in this view.' }] };
      const summary = sales_accounts.map((a) => `#${a.id} | ${a.name} | ${a.website || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? sales_accounts.length} account(s) (showing ${sales_accounts.length}):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'view_account',
  'View detailed information about an account (company).',
  { account_id: z.number().describe('Account ID') },
  async ({ account_id }) => {
    try {
      const account = await client.viewAccount(account_id);
      return { content: [{ type: 'text', text: formatAccount(account as unknown as Record<string, unknown>) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_account',
  'Create a new account (company).',
  {
    name: z.string().describe('Account/company name'),
    website: z.string().optional(),
    phone: z.string().optional(),
    owner_id: z.number().optional().describe('See list_owners'),
    industry_type_id: z.number().optional().describe('See list_field_choices(module="sales_accounts", field="industry_type_id")'),
    business_type_id: z.number().optional().describe('See list_field_choices(module="sales_accounts", field="business_type_id")'),
    number_of_employees: z.number().optional().describe('1, 11, 51, 201, 501, 1001, 5001, or 10001 (each is the low end of a band, e.g. 11 = "11-50")'),
    annual_revenue: z.number().optional(),
    parent_sales_account_id: z.number().optional().describe('Parent account id, for subsidiaries'),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional().describe('Custom (cf_*) field values, e.g. { "cf_region": "EMEA", "cf_renewal_date": "2026-01-01" }. For picklist fields like cf_region, use the label string (see list_field_choices) — NOT the numeric choice id, which is silently ignored (no error, updated_at unchanged).'),
  },
  async (params) => {
    try {
      const account = await client.createAccount(params as CreateAccountParams);
      return { content: [{ type: 'text', text: `Account created!\n\n${formatAccount(account as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_account',
  'Update an existing account (company).',
  {
    account_id: z.number().describe('Account ID'),
    name: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    owner_id: z.number().optional(),
    industry_type_id: z.number().optional(),
    business_type_id: z.number().optional(),
    number_of_employees: z.number().optional(),
    annual_revenue: z.number().optional(),
    parent_sales_account_id: z.number().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional().describe('Custom (cf_*) field values, e.g. { "cf_region": "EMEA", "cf_renewal_date": "2026-01-01" }. For picklist fields like cf_region, use the label string (see list_field_choices) — NOT the numeric choice id, which is silently ignored (no error, updated_at unchanged).'),
  },
  async ({ account_id, ...params }) => {
    try {
      const account = await client.updateAccount(account_id, params as UpdateAccountParams);
      return { content: [{ type: 'text', text: `Account updated!\n\n${formatAccount(account as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'search_accounts',
  'Search accounts (companies) by name/domain/keyword.',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    try {
      const results = await client.searchAccounts(query);
      if (results.length === 0) return { content: [{ type: 'text', text: `No accounts found for: ${query}` }] };
      const summary = results.map((r) => `#${r.id} | ${r.name || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${results.length} account(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== DEALS ====================

server.tool(
  'list_deals',
  'List deals from a saved view. Call list_views(module="deals") first to get a view_id (e.g. "Open Deals", "Won Deals").',
  { view_id: z.union([z.string(), z.number()]).describe('View id from list_views'), ...listParamsShape },
  async ({ view_id, ...params }) => {
    try {
      const { deals, meta } = await client.listDeals(view_id, params as ListParams);
      if (deals.length === 0) return { content: [{ type: 'text', text: 'No deals found in this view.' }] };
      const summary = deals.map((d) => `#${d.id} | ${d.name} | ${d.amount ?? 'N/A'} | ${fmtId('deal_stage_id', d.deal_stage_id)}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? deals.length} deal(s) (showing ${deals.length}):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'view_deal',
  'View detailed information about a deal.',
  { deal_id: z.number().describe('Deal ID') },
  async ({ deal_id }) => {
    try {
      const deal = await client.viewDeal(deal_id);
      return { content: [{ type: 'text', text: formatDeal(deal as unknown as Record<string, unknown>) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_deal',
  'Create a new deal. NOTE: many Freshsales instances mark extra custom (cf_*) fields as required on deal creation, and the create is rejected without them. list_field_choices(module="deals", field=...) reports whether a field is required; pass any required custom fields via custom_field.',
  {
    name: z.string().describe('Deal name'),
    amount: z.number().describe('Deal value'),
    sales_account_id: z.number().optional().describe('Related account id — see search_accounts/list_accounts'),
    contact_id: z.number().optional().describe('Related contact id — see search_contacts/list_contacts'),
    owner_id: z.number().optional().describe('See list_owners'),
    deal_type_id: z.number().optional().describe('See list_field_choices(module="deals", field="deal_type_id")'),
    deal_pipeline_id: z.number().optional().describe('See list_field_choices(module="deals", field="deal_pipeline_id")'),
    deal_stage_id: z.number().optional().describe('Must belong to the chosen pipeline — see list_field_choices(module="deals", field="deal_stage_id")'),
    expected_close: z.string().optional().describe('ISO date'),
    lead_source_id: z.number().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional().describe('Custom (cf_*) field values — several are required on this instance, see tool description'),
  },
  async (params) => {
    try {
      const deal = await client.createDeal(params as CreateDealParams);
      return { content: [{ type: 'text', text: `Deal created!\n\n${formatDeal(deal as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_deal',
  'Update an existing deal (e.g. move to a new stage, change amount/owner).',
  {
    deal_id: z.number().describe('Deal ID'),
    name: z.string().optional(),
    amount: z.number().optional(),
    sales_account_id: z.number().optional(),
    contact_id: z.number().optional(),
    owner_id: z.number().optional(),
    deal_type_id: z.number().optional(),
    deal_pipeline_id: z.number().optional(),
    deal_stage_id: z.number().optional().describe('See list_field_choices(module="deals", field="deal_stage_id")'),
    expected_close: z.string().optional(),
    lead_source_id: z.number().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional(),
  },
  async ({ deal_id, ...params }) => {
    try {
      const deal = await client.updateDeal(deal_id, params as UpdateDealParams);
      return { content: [{ type: 'text', text: `Deal updated!\n\n${formatDeal(deal as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'search_deals',
  'Search deals by name/keyword.',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    try {
      const results = await client.searchDeals(query);
      if (results.length === 0) return { content: [{ type: 'text', text: `No deals found for: ${query}` }] };
      const summary = results.map((r) => `#${r.id} | ${r.name || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${results.length} deal(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== LEADS ====================
// This API key may not have the Leads module permission — these tools will
// return a clear 403 error from Freshsales in that case rather than failing
// silently or crashing the server.

server.tool(
  'list_leads',
  'List leads from a saved view. Call list_views(module="leads") first to get a view_id.',
  { view_id: z.union([z.string(), z.number()]).describe('View id from list_views'), ...listParamsShape },
  async ({ view_id, ...params }) => {
    try {
      const { leads, meta } = await client.listLeads(view_id, params as ListParams);
      if (leads.length === 0) return { content: [{ type: 'text', text: 'No leads found in this view.' }] };
      const summary = leads.map((l) => `#${l.id} | ${l.first_name || ''} ${l.last_name || ''} | ${l.name || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? leads.length} lead(s) (showing ${leads.length}):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'view_lead',
  'View detailed information about a lead.',
  { lead_id: z.number().describe('Lead ID') },
  async ({ lead_id }) => {
    try {
      const lead = await client.viewLead(lead_id);
      return { content: [{ type: 'text', text: formatLead(lead as unknown as Record<string, unknown>) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_lead',
  'Create a new lead.',
  {
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    company_name: z.string().optional().describe('Lead\'s company name'),
    email: z.string().optional(),
    mobile_number: z.string().optional(),
    work_number: z.string().optional(),
    job_title: z.string().optional(),
    owner_id: z.number().optional().describe('See list_owners'),
    lead_stage_id: z.number().optional().describe('See list_field_choices(module="leads", field="lead_stage_id")'),
    lead_source_id: z.number().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional(),
  },
  async (params) => {
    try {
      const lead = await client.createLead(params as CreateLeadParams);
      return { content: [{ type: 'text', text: `Lead created!\n\n${formatLead(lead as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_lead',
  'Update an existing lead.',
  {
    lead_id: z.number().describe('Lead ID'),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    company_name: z.string().optional(),
    email: z.string().optional(),
    mobile_number: z.string().optional(),
    work_number: z.string().optional(),
    job_title: z.string().optional(),
    owner_id: z.number().optional(),
    lead_stage_id: z.number().optional(),
    lead_source_id: z.number().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    tags: z.array(z.string()).optional(),
    custom_field: z.record(z.unknown()).optional(),
  },
  async ({ lead_id, ...params }) => {
    try {
      const lead = await client.updateLead(lead_id, params as UpdateLeadParams);
      return { content: [{ type: 'text', text: `Lead updated!\n\n${formatLead(lead as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'search_leads',
  'Search leads by name/email/company/keyword.',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    try {
      const results = await client.searchLeads(query);
      if (results.length === 0) return { content: [{ type: 'text', text: `No leads found for: ${query}` }] };
      const summary = results.map((r) => `#${r.id} | ${r.name || 'N/A'} | ${r.email || 'N/A'}`).join('\n');
      return { content: [{ type: 'text', text: `Found ${results.length} lead(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== TASKS ====================

server.tool(
  'list_tasks',
  'List tasks, optionally filtered.',
  {
    filter: z.enum(['open', 'due_today', 'overdue', 'all']).optional().default('open'),
    page: z.number().optional(),
    per_page: z.number().optional(),
  },
  async ({ filter, ...params }) => {
    try {
      const { tasks, meta } = await client.listTasks(filter, params as ListParams);
      if (tasks.length === 0) return { content: [{ type: 'text', text: `No tasks found (filter: ${filter}).` }] };
      const summary = tasks.map((t) => formatTask(t as unknown as Record<string, unknown>)).join('\n---\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? tasks.length} task(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_task',
  'Create a task, optionally linked to a contact/account/deal/lead.',
  {
    title: z.string().describe('Task title'),
    due_date: z.string().describe('ISO date, e.g. "2026-10-01"'),
    owner_id: z.number().optional().describe('See list_owners'),
    task_type_id: z.number().optional(),
    targetable_type: z.enum(['Contact', 'Deal', 'SalesAccount', 'Lead']).optional().describe('What this task is linked to'),
    targetable_id: z.number().optional().describe('ID of the linked record'),
    description: z.string().optional(),
  },
  async (params) => {
    try {
      const task = await client.createTask(params as CreateTaskParams);
      return { content: [{ type: 'text', text: `Task created!\n\n${formatTask(task as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_task',
  'Update a task, e.g. to reschedule, reassign, or mark it done. The exact accepted "status" value (e.g. "COMPLETED") hasn\'t been verified against this instance — check the result and adjust if rejected.',
  {
    task_id: z.number().describe('Task ID'),
    title: z.string().optional(),
    due_date: z.string().optional(),
    owner_id: z.number().optional(),
    status: z.string().optional().describe('e.g. "COMPLETED"'),
    description: z.string().optional(),
  },
  async ({ task_id, ...params }) => {
    try {
      const task = await client.updateTask(task_id, params as UpdateTaskParams);
      return { content: [{ type: 'text', text: `Task updated!\n\n${formatTask(task as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== APPOINTMENTS ====================

server.tool(
  'list_appointments',
  'List appointments/meetings.',
  {
    filter: z.enum(['upcoming', 'past', 'all']).optional().default('upcoming'),
    page: z.number().optional(),
    per_page: z.number().optional(),
  },
  async ({ filter, ...params }) => {
    try {
      const { appointments, meta } = await client.listAppointments(filter, params as ListParams);
      if (appointments.length === 0) return { content: [{ type: 'text', text: `No appointments found (filter: ${filter}).` }] };
      const summary = appointments.map((a) => formatAppointment(a as unknown as Record<string, unknown>)).join('\n---\n');
      return { content: [{ type: 'text', text: `Found ${meta.total ?? appointments.length} appointment(s):\n\n${summary}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_appointment',
  'Create an appointment/meeting, optionally linked to a contact/account/deal/lead.',
  {
    title: z.string().describe('Appointment title'),
    from_date: z.string().describe('ISO datetime start'),
    end_date: z.string().describe('ISO datetime end'),
    description: z.string().optional(),
    time_zone: z.string().optional(),
    targetable_type: z.enum(['Contact', 'Deal', 'SalesAccount', 'Lead']).optional(),
    targetable_id: z.number().optional(),
  },
  async (params) => {
    try {
      const appt = await client.createAppointment(params as CreateAppointmentParams);
      return { content: [{ type: 'text', text: `Appointment created!\n\n${formatAppointment(appt as unknown as Record<string, unknown>)}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== NOTES ====================

server.tool(
  'create_note',
  'Add a note to a contact, account, deal, or lead.',
  {
    description: z.string().describe('Note text'),
    targetable_type: z.enum(['Contact', 'Deal', 'SalesAccount', 'Lead']).describe('Record type to attach the note to'),
    targetable_id: z.number().describe('ID of the record to attach the note to'),
  },
  async (params) => {
    try {
      const note = await client.createNote(params as CreateNoteParams);
      return { content: [{ type: 'text', text: `Note #${note.id} added to ${params.targetable_type} #${params.targetable_id}.` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ==================== START SERVER ====================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Freshsales MCP Server running on stdio');
  void loadLabels(); // best effort, non-blocking
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
