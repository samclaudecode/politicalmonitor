"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addSource, deleteSource, setSourceActive, updateSource } from "@/lib/db";
import { runIngest } from "@/lib/ingest";
import { triggerBackgroundIngest } from "@/lib/trigger-ingest";
import { importFeedbinSources } from "@/lib/feedbin";
import { normalizeTwitterInput } from "@/lib/nitter";
import { isAdmin } from "@/lib/auth";

async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** redirect() throws a NEXT_REDIRECT error that must be allowed to propagate. */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function addSourceAction(formData: FormData) {
  await requireAdmin();
  let feed_url = String(formData.get("feed_url") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const kind = String(formData.get("kind")) === "twitter" ? "twitter" : "email";
  if (!feed_url || !name) {
    redirect("/sources?error=" + encodeURIComponent("Feed URL and name are required"));
  }
  if (kind === "twitter") {
    const normalized = normalizeTwitterInput(feed_url);
    if (!normalized) {
      redirect(
        "/sources?error=" +
          encodeURIComponent(
            "Could not parse the X handle — enter e.g. @Nigel_Farage, an x.com profile URL, or a Nitter RSS URL"
          )
      );
    }
    feed_url = normalized;
  } else {
    try {
      new URL(feed_url);
    } catch {
      redirect("/sources?error=" + encodeURIComponent("Feed URL is not a valid URL"));
    }
  }
  try {
    await addSource({
      feed_url,
      name,
      kind,
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

export async function updateSourceAction(formData: FormData) {
  await requireAdmin();
  const id = parseInt(String(formData.get("id") || ""), 10);
  const name = String(formData.get("name") || "").trim();
  let feed_url = String(formData.get("feed_url") || "").trim();
  const kind = String(formData.get("kind")) === "twitter" ? "twitter" : "email";
  if (Number.isNaN(id) || !name || !feed_url) {
    redirect("/sources?error=" + encodeURIComponent("Name and feed URL are required"));
  }
  if (kind === "twitter") {
    const normalized = normalizeTwitterInput(feed_url);
    if (!normalized) {
      redirect(
        "/sources?error=" +
          encodeURIComponent(
            "Could not parse the X handle — enter e.g. @Nigel_Farage, an x.com profile URL, or a Nitter RSS URL"
          )
      );
    }
    feed_url = normalized;
  } else {
    try {
      new URL(feed_url);
    } catch {
      redirect("/sources?error=" + encodeURIComponent("Feed URL is not a valid URL"));
    }
  }
  try {
    await updateSource(id, {
      name,
      feed_url,
      kind,
      candidate: String(formData.get("candidate") || "").trim() || undefined,
      party: String(formData.get("party") || "").trim() || undefined,
      office: String(formData.get("office") || "").trim() || undefined,
      state: String(formData.get("state") || "").trim() || undefined,
    });
  } catch (err) {
    console.error("updateSourceAction:", err);
    const message =
      err instanceof Error && /duplicate key|unique/i.test(err.message)
        ? "That feed URL is already registered on another source"
        : "Could not update source";
    redirect("/sources?error=" + encodeURIComponent(message));
  }
  revalidatePath("/sources");
  revalidatePath("/");
  redirect("/sources?ok=" + encodeURIComponent(`Updated “${name}”`));
}

export async function importFeedbinAction() {
  await requireAdmin();
  let result;
  try {
    result = await importFeedbinSources();
  } catch (err) {
    console.error("importFeedbinAction:", err);
    const message = err instanceof Error ? err.message : "Feedbin import failed";
    redirect("/sources?error=" + encodeURIComponent(message.slice(0, 400)));
  }
  revalidatePath("/sources");
  const message = result.imported
    ? `Imported ${result.imported} feed${result.imported === 1 ? "" : "s"} from Feedbin: ${result.names.join(", ")}. Use Edit to tag each with candidate and party, then run an ingest.`
    : `No new feeds to import (${result.skipped} already registered).`;
  redirect("/sources?ok=" + encodeURIComponent(message.slice(0, 600)));
}

export async function deleteSourceAction(formData: FormData) {
  await requireAdmin();
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (!Number.isNaN(id)) await deleteSource(id);
  revalidatePath("/sources");
  redirect("/sources?ok=" + encodeURIComponent("Source deleted"));
}

export async function toggleSourceAction(formData: FormData) {
  await requireAdmin();
  const id = parseInt(String(formData.get("id") || ""), 10);
  const active = String(formData.get("active")) === "1";
  if (!Number.isNaN(id)) await setSourceActive(id, active);
  revalidatePath("/sources");
  redirect("/sources");
}

export async function ingestNowAction() {
  await requireAdmin();
  // On Netlify, hand off to the ingest-background function (15-minute budget)
  // and return immediately — running the sync inline here would exceed the
  // short page-function timeout with many feeds. Only run inline in local dev.
  const trigger = await triggerBackgroundIngest();
  if (trigger !== "no-url") {
    revalidatePath("/");
    revalidatePath("/sources");
    if (trigger === "unavailable") {
      redirect(
        "/sources?error=" +
          encodeURIComponent(
            "Couldn't reach the background sync function (404). The scheduled sync still runs every 30 minutes — check the ingest-background function deployed."
          )
      );
    }
    redirect(
      "/sources?ok=" +
        encodeURIComponent(
          "Sync started in the background — refresh in a minute or two and watch the Last fetch column."
        )
    );
  }

  // If we're serverless but couldn't determine the site URL, we still must
  // not run the heavy sync inline (it would time out). Point to the schedule.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY) {
    redirect(
      "/sources?error=" +
        encodeURIComponent(
          "Can't determine the site URL to start a background sync. Set the URL environment variable; the scheduled sync still runs every 30 minutes."
        )
    );
  }

  // Local dev / CLI: run the sync inline.
  let report;
  try {
    report = await runIngest();
  } catch (err) {
    if (isRedirectError(err)) throw err;
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
