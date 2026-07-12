"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { deleteEmail, deleteRebuttal, deleteFactCheck } from "@/lib/db";
import { draftAndSaveRebuttal, type RebuttalTone } from "@/lib/rebuttal";
import {
  runFactCheck,
  markFactCheckPending,
  markFactCheckError,
} from "@/lib/factcheck";
import { triggerBackgroundFactCheck } from "@/lib/trigger-ingest";

export async function deleteEmailAction(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (!Number.isNaN(id)) {
    try {
      await deleteEmail(id);
    } catch (err) {
      console.error("deleteEmailAction:", err);
      redirect(`/email/${id}`);
    }
  }
  revalidatePath("/");
  redirect("/");
}

const TONES: RebuttalTone[] = ["measured", "punchy", "detailed"];

export async function draftRebuttalAction(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (Number.isNaN(id)) redirect("/");
  const toneInput = String(formData.get("tone") || "measured");
  const tone: RebuttalTone = TONES.includes(toneInput as RebuttalTone)
    ? (toneInput as RebuttalTone)
    : "measured";
  try {
    await draftAndSaveRebuttal(id, tone);
  } catch (err) {
    console.error("draftRebuttalAction:", err);
    const message = err instanceof Error ? err.message : "Draft failed";
    redirect(`/email/${id}?rberror=` + encodeURIComponent(message.slice(0, 300)));
  }
  revalidatePath(`/email/${id}`);
  revalidatePath("/");
  redirect(`/email/${id}#rebuttals`);
}

export async function factCheckAction(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (Number.isNaN(id)) redirect("/");

  // A Fusion check can take minutes — never run it inside this short-lived
  // page function. Mark it pending and hand off to factcheck-background.
  await markFactCheckPending(id);
  const trigger = await triggerBackgroundFactCheck(id);

  if (trigger === "no-url") {
    // Local dev: run inline (no function timeout to worry about).
    try {
      await runFactCheck(id);
    } catch (err) {
      if (isRedirectError(err)) throw err;
      console.error("factCheckAction:", err);
      const message = err instanceof Error ? err.message : "Fact-check failed";
      await markFactCheckError(id, message).catch(() => {});
      redirect(`/email/${id}?fcerror=` + encodeURIComponent(message.slice(0, 300)));
    }
  } else if (trigger === "unavailable") {
    await markFactCheckError(
      id,
      "Background function not found (factcheck-background) — redeploy with cleared cache."
    ).catch(() => {});
    redirect(
      `/email/${id}?fcerror=` +
        encodeURIComponent(
          "Couldn't reach the factcheck-background function (404) — redeploy with 'Clear cache and deploy site'."
        )
    );
  }

  revalidatePath(`/email/${id}`);
  revalidatePath("/");
  redirect(`/email/${id}#factcheck`);
}

/** redirect() throws NEXT_REDIRECT which must propagate. */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function deleteFactCheckAction(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (!Number.isNaN(id)) await deleteFactCheck(id);
  revalidatePath(`/email/${id}`);
  revalidatePath("/");
  redirect(`/email/${id}#factcheck`);
}

export async function deleteRebuttalAction(formData: FormData) {
  if (!(await isAdmin())) redirect("/admin/login");
  const id = parseInt(String(formData.get("id") || ""), 10);
  const emailId = parseInt(String(formData.get("email_id") || ""), 10);
  if (!Number.isNaN(id)) await deleteRebuttal(id);
  revalidatePath(`/email/${emailId}`);
  redirect(`/email/${emailId}#rebuttals`);
}
