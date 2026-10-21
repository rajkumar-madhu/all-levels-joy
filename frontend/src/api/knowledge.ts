import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Article } from "./types";

export type ArticleStatus = "draft" | "review" | "published" | "retired";

export type ArticleInput = {
  title: string;
  summary: string;
  content: string;
  category: string;
  status: ArticleStatus;
  tags: string[];
  /** Required when editing an existing article. */
  expectedUpdatedAt?: string;
};

export type KnowledgeCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  article_count: number;
};

export type AuthoredArticle = Article & { author_id: string | null; author_name: string | null };

const knowledgeKey = (org: string) => ["orgs", org, "knowledge"] as const;

export function useKnowledgeCategories(org: string) {
  return useQuery({
    queryKey: ["orgs", org, "knowledge-categories"],
    queryFn: () => api<{ results: KnowledgeCategory[] }>(`orgs/${org}/knowledge/categories`).then((r) => r.results),
    staleTime: 60_000,
  });
}

export function useSaveArticle(org: string, id?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ArticleInput) =>
      api<AuthoredArticle>(id ? `orgs/${org}/knowledge/${id}` : `orgs/${org}/knowledge`, {
        method: id ? "PATCH" : "POST",
        body,
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: knowledgeKey(org) }),
        client.invalidateQueries({ queryKey: ["orgs", org, "article"] }),
        client.invalidateQueries({ queryKey: ["orgs", org, "knowledge-categories"] }),
      ]),
  });
}

export function useSaveCategory(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; description: string; active: boolean }) =>
      api(id ? `orgs/${org}/knowledge/categories/${id}` : `orgs/${org}/knowledge/categories`, {
        method: id ? "PATCH" : "POST",
        body,
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["orgs", org, "knowledge-categories"] }),
        client.invalidateQueries({ queryKey: knowledgeKey(org) }),
      ]),
  });
}

export { parseTags } from "@/lib/tags";
