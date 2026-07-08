"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addSource, deleteSource, setSourceActive } from "@/lib/db";
import { runIngest } from "@/lib/ingest";

export async function addSourceAction(formData: FormData) {
  const feed_url = String(formData.get("feed_url") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!feed_url || !name) {
    redirect("/sources?error=" + encodeURIComponent("Feed URL and name are required"));
  }
  try {
    new URL(feed_url);
  } catch {
    redirect("/sources?error=" + encodeURIComponent("Feed URL is not a valid URL"));
  }
  try {
    await addSource({
      feed_url,
      name,
      candidate: String(formData.get("candidate") || "").trim() || undefined,
      party: String(formData.get("party") || "").trim() || undefined,
      office: String(formData.get("office") || "").trim() || undefined,
      state: String(formData.get("state") || "").trim() || undefined,
    });
  } catch (err) {
    const message =
      err instanceof Error && /duplicate key|unique/i.test(err.message)
        ? "That feed URL is already registered"
        : `Could not add source: ${err instanceof Error ? err.message : "unknown error"}`;
    redirect("/sources?error=" + encodeURIComponent(message.slice(0, 300)));
  }
  revalidatePath("/sources");
  redirect("/sources?ok=" + encodeURIComponent(`Added source “${name}”`));
}

export async function deleteSourceAction(formData: FormData) {
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (!Number.isNaN(id)) await deleteSource(id);
  revalidatePath("/sources");
  redirect("/sources?ok=" + encodeURIComponent("Source deleted"));
}

export async function toggleSourceAction(formData: FormData) {
  const id = parseInt(String(formData.get("id") || ""), 10);
  const active = String(formData.get("active")) === "1";
  if (!Number.isNaN(id)) await setSourceActive(id, active);
  revalidatePath("/sources");
  redirect("/sources");
}

export async function ingestNowAction() {
  let report;
  try {
    report = await runIngest();
  } catch (err) {
    console.error("ingestNowAction: error:", err);
    const message = err instanceof Error ? err.message : "ingest failed";
    redirect("/sources?error=" + encodeURIComponent(`Ingest failed: ${message}`.slice(0, 400)));
  }
  const errors = report.sources.filter((s) => s.error);
  const catErrors = report.categorization.errors.length;
  let message = `Ingest complete: ${report.totalNew} new email${
    report.totalNew === 1 ? "" : "s"
  }, ${report.categorization.succeeded} categorized`;
  if (errors.length) {
    message += `. Feed errors: ${errors
      .map((e) => `${e.sourceName} (${e.error})`)
      .join("; ")}`;
  }
  if (catErrors) {
    message += `. ${catErrors} categorization issue${catErrors === 1 ? "" : "s"}`;
  }
  revalidatePath("/");
  revalidatePath("/sources");
  const param = errors.length || catErrors ? "error" : "ok";
  redirect(`/sources?${param}=` + encodeURIComponent(message.slice(0, 600)));
}
