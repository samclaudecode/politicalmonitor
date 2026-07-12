"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { deleteEmail, deleteRebuttal, deleteFactCheck } from "@/lib/db";
import { draftAndSaveRebuttal, type RebuttalTone } from "@/lib/rebuttal";
import { runFactCheck } from "@/lib/factcheck";

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
  try {
    await runFactCheck(id);
  } catch (err) {
    console.error("factCheckAction:", err);
    const message = err instanceof Error ? err.message : "Fact-check failed";
    redirect(`/email/${id}?fcerror=` + encodeURIComponent(message.slice(0, 300)));
  }
  revalidatePath(`/email/${id}`);
  revalidatePath("/");
  redirect(`/email/${id}#factcheck`);
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
