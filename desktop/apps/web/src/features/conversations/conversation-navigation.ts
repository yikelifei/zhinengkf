import type { Conversation, IdentityFilters } from "../../lib/api";
import { DEFAULT_CONVERSATION_FILTERS, type ConversationListFilters } from "./model";

export type ConversationNavigationSearchParams = Record<string, string | string[] | undefined>;

export type ConversationListNavigationState = {
  search?: string;
  scope?: string;
  channel?: string;
  status?: string;
  sort?: string;
  page?: number;
};

const validScopes = new Set(["all", "unread", "manual"]);
const validStatuses = new Set(["all", "unassigned", "overdue", "open", "pending", "resolved", "closed"]);
const validSorts = new Set(["priority", "latest", "oldest"]);

export function conversationNavigationFromSearchParams(
  params: ConversationNavigationSearchParams,
): ConversationListNavigationState {
  const search = firstParam(params.q).slice(0, 200);
  const scope = allowedParam(params.scope, validScopes);
  const channel = firstParam(params.channel).slice(0, 80);
  const status = allowedParam(params.status, validStatuses);
  const sort = allowedParam(params.sort, validSorts);
  const requestedPage = Number.parseInt(firstParam(params.page), 10);
  return {
    search: search || undefined,
    scope: scope || undefined,
    channel: channel || undefined,
    status: status || undefined,
    sort: sort || undefined,
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : undefined,
  };
}

export function conversationFiltersFromNavigation(
  navigation?: ConversationListNavigationState,
): ConversationListFilters {
  return {
    search: String(navigation?.search || "").slice(0, 200),
    scope: validScopes.has(String(navigation?.scope || ""))
      ? navigation?.scope as ConversationListFilters["scope"]
      : DEFAULT_CONVERSATION_FILTERS.scope,
    channel: String(navigation?.channel || DEFAULT_CONVERSATION_FILTERS.channel).slice(0, 80),
    status: validStatuses.has(String(navigation?.status || ""))
      ? navigation?.status as ConversationListFilters["status"]
      : DEFAULT_CONVERSATION_FILTERS.status,
    sort: validSorts.has(String(navigation?.sort || ""))
      ? navigation?.sort as ConversationListFilters["sort"]
      : DEFAULT_CONVERSATION_FILTERS.sort,
  };
}

export function conversationRouteHref(
  path: string,
  conversation: Pick<Conversation, "id" | "wechatAccountId" | "customerId">,
  navigation?: ConversationListNavigationState,
) {
  const params = new URLSearchParams();
  setParam(params, "wechatAccountId", conversation.wechatAccountId);
  setParam(params, "conversationId", conversation.id);
  setParam(params, "customerId", conversation.customerId);
  appendConversationNavigation(params, navigation);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function conversationListHref(navigation?: ConversationListNavigationState) {
  const params = new URLSearchParams();
  appendConversationNavigation(params, navigation);
  const query = params.toString();
  return query ? `/conversations?${query}` : "/conversations";
}

export function conversationMatchesIdentityFilters(
  conversation: Pick<Conversation, "id" | "wechatAccountId" | "customerId">,
  expected?: IdentityFilters,
) {
  return (!expected?.wechatAccountId || conversation.wechatAccountId === expected.wechatAccountId)
    && (!expected?.conversationId || conversation.id === expected.conversationId)
    && (!expected?.customerId || conversation.customerId === expected.customerId);
}

function appendConversationNavigation(params: URLSearchParams, navigation?: ConversationListNavigationState) {
  const filters = conversationFiltersFromNavigation(navigation);
  if (filters.search) params.set("q", filters.search);
  if (filters.scope !== DEFAULT_CONVERSATION_FILTERS.scope) params.set("scope", filters.scope);
  if (filters.channel !== DEFAULT_CONVERSATION_FILTERS.channel) params.set("channel", filters.channel);
  if (filters.status !== DEFAULT_CONVERSATION_FILTERS.status) params.set("status", filters.status);
  if (filters.sort !== DEFAULT_CONVERSATION_FILTERS.sort) params.set("sort", filters.sort);
  if (navigation?.page && navigation.page > 1) params.set("page", String(Math.min(Math.floor(navigation.page), 10_000)));
}

function allowedParam(value: string | string[] | undefined, allowed: Set<string>) {
  const parsed = firstParam(value);
  return allowed.has(parsed) ? parsed : "";
}

function firstParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return String(first || "").trim();
}

function setParam(params: URLSearchParams, key: string, value?: string | null) {
  const normalized = String(value || "").trim();
  if (normalized) params.set(key, normalized);
}
