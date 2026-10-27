/**
 * Freshsales (Freshworks CRM) API Client
 * Handles all HTTP communication with the Freshsales API.
 *
 * Schema notes gathered by probing a real Freshsales instance (see chat history
 * / README for how these were confirmed):
 *  - Auth: `Authorization: Token token=<api key>` (NOT Basic auth, unlike Freshdesk).
 *  - Listing records requires a *view* id, not a plain page query
 *    (GET /{module}/filters -> pick a view id -> GET /{module}/view/{id}).
 *  - Single-record GET/POST/PUT responses are wrapped in a singular key,
 *    e.g. `{ "contact": {...} }`; list responses use the plural module name
 *    plus a `meta` object, e.g. `{ "contacts": [...], "meta": { "total": 12 } }`.
 *  - Compound fields (emails, phone_numbers) are arrays of
 *    `{ value, is_primary, label }` objects, not plain strings.
 *  - Custom fields (cf_*) are sent nested under a `custom_field` object,
 *    never at the top level of the record body.
 *  - Custom PICKLIST fields (cf_* dropdowns) take the choice's `value`
 *    (the label string, e.g. "Medium"), NOT the numeric `id` shown by
 *    listFieldChoices. This is the opposite of built-in dropdown fields
 *    (deal_stage_id, lead_source_id, industry_type_id, etc.), which live
 *    at the top level and DO take the numeric id. Sending the numeric id
 *    for a cf_* picklist fails silently: the API returns 200/"success"
 *    but the field is left unchanged and `updated_at` does not advance —
 *    there is no error to catch, so verify by re-reading the record or
 *    checking `updated_at` moved.
 */

export interface FreshsalesConfig {
  domain: string; // bundle alias + path, e.g. "yourcompany.myfreshworks.com/crm/sales" (no protocol)
  apiKey: string;
}

// Modules that are customizable (have /settings/{module}/fields metadata,
// including per-org custom fields) and are listed via a view id.
export type FreshsalesModule = 'leads' | 'contacts' | 'sales_accounts' | 'deals';

export type TargetableType = 'Contact' | 'Deal' | 'SalesAccount' | 'Lead';

// ==================== SHARED SHAPES ====================

export interface EmailEntry {
  id?: number;
  value: string;
  is_primary?: boolean;
  label?: string | null;
}

export interface ListMeta {
  total?: number;
  total_pages?: number;
}

export interface ViewFilter {
  id: number;
  name: string;
}

export interface FieldChoice {
  id: number | string;
  value: string;
  position?: number;
  [key: string]: unknown; // e.g. deal_stage_id choices also carry deal_pipeline_id
}

export interface FieldDef {
  id: number;
  name: string;
  label: string;
  type: string;
  required?: boolean;
  default?: boolean;
  choices?: FieldChoice[];
}

export interface Owner {
  id: number;
  display_name: string;
  email: string;
  is_active: boolean;
}

export interface SearchResult {
  id: string;
  name?: string;
  email?: string;
  type: string; // "lead" | "contact" | "sales_account" | "deal"
  updated_at?: string;
  [key: string]: unknown;
}

// ==================== CONTACTS ====================

export interface Contact {
  id: number;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  job_title?: string;
  email?: string;
  emails?: EmailEntry[];
  mobile_number?: string;
  work_number?: string;
  owner_id?: number;
  sales_accounts?: unknown[];
  tags?: string[];
  city?: string;
  state?: string;
  country?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateContactParams {
  first_name: string;
  last_name?: string;
  email?: string;
  mobile_number?: string;
  work_number?: string;
  job_title?: string;
  owner_id?: number;
  company_id?: number; // maps to sales_accounts: [{ id, is_primary: true }]
  lead_source_id?: number;
  contact_status_id?: number;
  city?: string;
  state?: string;
  country?: string;
  tags?: string[];
  custom_field?: Record<string, unknown>;
}

export interface UpdateContactParams extends Partial<CreateContactParams> {}

// ==================== ACCOUNTS (sales_accounts) ====================

export interface Account {
  id: number;
  name: string;
  website?: string;
  phone?: string;
  owner_id?: number;
  industry_type_id?: number;
  business_type_id?: number;
  number_of_employees?: number;
  annual_revenue?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateAccountParams {
  name: string;
  website?: string;
  phone?: string;
  owner_id?: number;
  industry_type_id?: number;
  business_type_id?: number;
  number_of_employees?: number;
  annual_revenue?: number;
  parent_sales_account_id?: number;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  tags?: string[];
  custom_field?: Record<string, unknown>;
}

export interface UpdateAccountParams extends Partial<CreateAccountParams> {}

// ==================== DEALS ====================

export interface Deal {
  id: number;
  name: string;
  amount?: number;
  deal_stage_id?: number;
  deal_pipeline_id?: number;
  deal_type_id?: number;
  owner_id?: number;
  sales_account_id?: number;
  expected_close?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateDealParams {
  name: string;
  amount: number;
  sales_account_id?: number;
  contact_id?: number; // maps to contacts: [{ id, is_primary: true }]
  owner_id?: number;
  deal_type_id?: number;
  deal_pipeline_id?: number;
  deal_stage_id?: number;
  expected_close?: string;
  lead_source_id?: number;
  tags?: string[];
  custom_field?: Record<string, unknown>;
}

export interface UpdateDealParams extends Partial<CreateDealParams> {}

// ==================== LEADS ====================

export interface Lead {
  id: number;
  first_name?: string;
  last_name?: string;
  name?: string; // company name
  email?: string;
  emails?: EmailEntry[];
  job_title?: string;
  owner_id?: number;
  lead_stage_id?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateLeadParams {
  first_name?: string;
  last_name?: string;
  company_name?: string; // maps to "name"
  email?: string;
  mobile_number?: string;
  work_number?: string;
  job_title?: string;
  owner_id?: number;
  lead_stage_id?: number;
  lead_source_id?: number;
  city?: string;
  state?: string;
  country?: string;
  tags?: string[];
  custom_field?: Record<string, unknown>;
}

export interface UpdateLeadParams extends Partial<CreateLeadParams> {}

// ==================== TASKS ====================

export interface Task {
  id: number;
  title: string;
  due_date?: string;
  owner_id?: number;
  status?: string | number;
  targetable_type?: string;
  targetable_id?: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateTaskParams {
  title: string;
  due_date: string; // ISO date
  owner_id?: number;
  task_type_id?: number;
  targetable_type?: TargetableType;
  targetable_id?: number;
  description?: string;
}

export interface UpdateTaskParams extends Partial<CreateTaskParams> {
  status?: string; // e.g. "COMPLETED" — verify the exact accepted value against your instance
}

// ==================== APPOINTMENTS ====================

export interface Appointment {
  id: number;
  title: string;
  from_date: string;
  end_date: string;
  description?: string;
  targetable_type?: string;
  targetable_id?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateAppointmentParams {
  title: string;
  from_date: string; // ISO datetime
  end_date: string; // ISO datetime
  description?: string;
  time_zone?: string;
  targetable_type?: TargetableType;
  targetable_id?: number;
}

// ==================== NOTES ====================

export interface Note {
  id: number;
  description: string;
  targetable_type?: string;
  targetable_id?: number;
  created_at?: string;
}

export interface CreateNoteParams {
  description: string;
  targetable_type: TargetableType;
  targetable_id: number;
}

// ==================== LIST PARAMS ====================

export interface ListParams {
  page?: number;
  per_page?: number;
  sort?: string;
  sort_type?: 'asc' | 'desc';
}

// ==================== CLIENT CLASS ====================

export class FreshsalesClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: FreshsalesConfig) {
    this.baseUrl = `https://${config.domain}/api`;
    this.authHeader = `Token token=${config.apiKey}`;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Freshsales API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return {} as T;

    return response.json() as Promise<T>;
  }

  // ---- generic helpers reused by every module ----

  private async listByView(
    module: string,
    viewId: number | string,
    params?: ListParams
  ): Promise<{ items: unknown[]; meta: ListMeta }> {
    const qp = new URLSearchParams();
    if (params?.page) qp.set('page', String(params.page));
    if (params?.per_page) qp.set('per_page', String(params.per_page));
    if (params?.sort) qp.set('sort', params.sort);
    if (params?.sort_type) qp.set('sort_type', params.sort_type);
    const qs = qp.toString();

    const data = await this.request<Record<string, unknown>>(
      'GET',
      `/${module}/view/${viewId}${qs ? `?${qs}` : ''}`
    );
    return { items: (data[module] as unknown[]) || [], meta: (data.meta as ListMeta) || {} };
  }

  private async getOne<T>(module: string, singularKey: string, id: number | string): Promise<T> {
    const data = await this.request<Record<string, unknown>>('GET', `/${module}/${id}`);
    return data[singularKey] as T;
  }

  private async createOne<T>(
    module: string,
    singularKey: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const data = await this.request<Record<string, unknown>>('POST', `/${module}`, {
      [singularKey]: body,
    });
    return data[singularKey] as T;
  }

  private async updateOne<T>(
    module: string,
    singularKey: string,
    id: number | string,
    body: Record<string, unknown>
  ): Promise<T> {
    const data = await this.request<Record<string, unknown>>('PUT', `/${module}/${id}`, {
      [singularKey]: body,
    });
    return data[singularKey] as T;
  }

  // ---- discovery (works for any customizable module, including custom cf_* fields) ----

  async listViews(module: FreshsalesModule): Promise<ViewFilter[]> {
    const data = await this.request<{ filters: ViewFilter[] }>('GET', `/${module}/filters`);
    return data.filters;
  }

  async listFieldChoices(module: FreshsalesModule, field: string): Promise<FieldDef> {
    const data = await this.request<{ fields: FieldDef[] }>('GET', `/settings/${module}/fields`);
    const found = data.fields.find((f) => f.name === field);
    if (!found) {
      throw new Error(
        `Field "${field}" not found on module "${module}". Call listFieldChoices without a known field name to see available names, or check /settings/${module}/fields.`
      );
    }
    return found;
  }

  async listFields(module: FreshsalesModule): Promise<FieldDef[]> {
    const data = await this.request<{ fields: FieldDef[] }>('GET', `/settings/${module}/fields`);
    return data.fields;
  }

  async listOwners(): Promise<Owner[]> {
    const data = await this.request<{ users: Owner[] }>('GET', '/selector/owners');
    return data.users;
  }

  async search(query: string, include?: string[]): Promise<SearchResult[]> {
    const inc = include && include.length > 0 ? include.join(',') : 'lead,contact,sales_account,deal';
    return this.request<SearchResult[]>(
      'GET',
      `/search?q=${encodeURIComponent(query)}&include=${inc}`
    );
  }

  // ---- body builders: translate task-shaped tool params into the API's actual shapes ----

  private buildContactBody(params: CreateContactParams | UpdateContactParams): Record<string, unknown> {
    const { email, company_id, custom_field, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (email) body.emails = [{ value: email, is_primary: true }];
    if (company_id) body.sales_accounts = [{ id: company_id, is_primary: true }];
    if (custom_field) body.custom_field = custom_field;
    return body;
  }

  private buildLeadBody(params: CreateLeadParams | UpdateLeadParams): Record<string, unknown> {
    const { email, company_name, custom_field, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (email) body.emails = [{ value: email, is_primary: true }];
    if (company_name) body.name = company_name;
    if (custom_field) body.custom_field = custom_field;
    return body;
  }

  private buildDealBody(params: CreateDealParams | UpdateDealParams): Record<string, unknown> {
    const { contact_id, custom_field, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (contact_id) body.contacts = [{ id: contact_id, is_primary: true }];
    if (custom_field) body.custom_field = custom_field;
    return body;
  }

  private buildAccountBody(params: CreateAccountParams | UpdateAccountParams): Record<string, unknown> {
    const { custom_field, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };
    if (custom_field) body.custom_field = custom_field;
    return body;
  }

  // ==================== CONTACTS ====================

  async listContacts(viewId: number | string, params?: ListParams): Promise<{ contacts: Contact[]; meta: ListMeta }> {
    const { items, meta } = await this.listByView('contacts', viewId, params);
    return { contacts: items as Contact[], meta };
  }

  async viewContact(contactId: number): Promise<Contact> {
    return this.getOne<Contact>('contacts', 'contact', contactId);
  }

  async createContact(params: CreateContactParams): Promise<Contact> {
    return this.createOne<Contact>('contacts', 'contact', this.buildContactBody(params));
  }

  async updateContact(contactId: number, params: UpdateContactParams): Promise<Contact> {
    return this.updateOne<Contact>('contacts', 'contact', contactId, this.buildContactBody(params));
  }

  async searchContacts(query: string): Promise<SearchResult[]> {
    const results = await this.search(query, ['contact']);
    return results.filter((r) => r.type === 'contact');
  }

  // ==================== ACCOUNTS ====================

  async listAccounts(viewId: number | string, params?: ListParams): Promise<{ sales_accounts: Account[]; meta: ListMeta }> {
    const { items, meta } = await this.listByView('sales_accounts', viewId, params);
    return { sales_accounts: items as Account[], meta };
  }

  async viewAccount(accountId: number): Promise<Account> {
    return this.getOne<Account>('sales_accounts', 'sales_account', accountId);
  }

  /** All contacts linked to an account (GET /sales_accounts/{id}?include=contacts). */
  async listAccountContacts(accountId: number): Promise<{ contacts: Contact[]; totalContactIds: number }> {
    const data = await this.request<{ contacts?: Contact[]; sales_account?: { contact_ids?: number[] } }>(
      'GET',
      `/sales_accounts/${accountId}?include=contacts`
    );
    const contacts = data.contacts || [];
    return { contacts, totalContactIds: data.sales_account?.contact_ids?.length ?? contacts.length };
  }

  async createAccount(params: CreateAccountParams): Promise<Account> {
    return this.createOne<Account>('sales_accounts', 'sales_account', this.buildAccountBody(params));
  }

  async updateAccount(accountId: number, params: UpdateAccountParams): Promise<Account> {
    return this.updateOne<Account>('sales_accounts', 'sales_account', accountId, this.buildAccountBody(params));
  }

  async searchAccounts(query: string): Promise<SearchResult[]> {
    const results = await this.search(query, ['sales_account']);
    return results.filter((r) => r.type === 'sales_account');
  }

  // ==================== DEALS ====================

  async listDeals(viewId: number | string, params?: ListParams): Promise<{ deals: Deal[]; meta: ListMeta }> {
    const { items, meta } = await this.listByView('deals', viewId, params);
    return { deals: items as Deal[], meta };
  }

  async viewDeal(dealId: number): Promise<Deal> {
    return this.getOne<Deal>('deals', 'deal', dealId);
  }

  async createDeal(params: CreateDealParams): Promise<Deal> {
    return this.createOne<Deal>('deals', 'deal', this.buildDealBody(params));
  }

  async updateDeal(dealId: number, params: UpdateDealParams): Promise<Deal> {
    return this.updateOne<Deal>('deals', 'deal', dealId, this.buildDealBody(params));
  }

  async searchDeals(query: string): Promise<SearchResult[]> {
    const results = await this.search(query, ['deal']);
    return results.filter((r) => r.type === 'deal');
  }

  // ==================== LEADS ====================
  // Note: some API keys may lack the Leads module permission (403 on record
  // reads/writes even though /settings/leads/fields is readable). Handlers
  // surface that as a normal tool error.

  async listLeads(viewId: number | string, params?: ListParams): Promise<{ leads: Lead[]; meta: ListMeta }> {
    const { items, meta } = await this.listByView('leads', viewId, params);
    return { leads: items as Lead[], meta };
  }

  async viewLead(leadId: number): Promise<Lead> {
    return this.getOne<Lead>('leads', 'lead', leadId);
  }

  async createLead(params: CreateLeadParams): Promise<Lead> {
    return this.createOne<Lead>('leads', 'lead', this.buildLeadBody(params));
  }

  async updateLead(leadId: number, params: UpdateLeadParams): Promise<Lead> {
    return this.updateOne<Lead>('leads', 'lead', leadId, this.buildLeadBody(params));
  }

  async searchLeads(query: string): Promise<SearchResult[]> {
    const results = await this.search(query, ['lead']);
    return results.filter((r) => r.type === 'lead');
  }

  // ==================== TASKS ====================

  async listTasks(
    filter: 'open' | 'due_today' | 'overdue' | 'all' = 'open',
    params?: ListParams
  ): Promise<{ tasks: Task[]; meta: ListMeta }> {
    const qp = new URLSearchParams({ filter });
    if (params?.page) qp.set('page', String(params.page));
    if (params?.per_page) qp.set('per_page', String(params.per_page));
    return this.request<{ tasks: Task[]; meta: ListMeta }>('GET', `/tasks?${qp.toString()}`);
  }

  async createTask(params: CreateTaskParams): Promise<Task> {
    return this.createOne<Task>('tasks', 'task', params as unknown as Record<string, unknown>);
  }

  async updateTask(taskId: number, params: UpdateTaskParams): Promise<Task> {
    return this.updateOne<Task>('tasks', 'task', taskId, params as unknown as Record<string, unknown>);
  }

  // ==================== APPOINTMENTS ====================

  async listAppointments(
    filter: 'upcoming' | 'past' | 'all' = 'upcoming',
    params?: ListParams
  ): Promise<{ appointments: Appointment[]; meta: ListMeta }> {
    const qp = new URLSearchParams({ filter });
    if (params?.page) qp.set('page', String(params.page));
    if (params?.per_page) qp.set('per_page', String(params.per_page));
    return this.request<{ appointments: Appointment[]; meta: ListMeta }>(
      'GET',
      `/appointments?${qp.toString()}`
    );
  }

  async createAppointment(params: CreateAppointmentParams): Promise<Appointment> {
    return this.createOne<Appointment>(
      'appointments',
      'appointment',
      params as unknown as Record<string, unknown>
    );
  }

  // ==================== NOTES ====================

  async createNote(params: CreateNoteParams): Promise<Note> {
    return this.createOne<Note>('notes', 'note', params as unknown as Record<string, unknown>);
  }
}
