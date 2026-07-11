"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { deleteDocument } from "@/lib/db";
import { ingestDocument } from "@/lib/documents";

async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function uploadDocumentAction(formData: FormData) {
  await requireAdmin();
  const file = formData.get("file");
  const title = String(formData.get("title") || "").trim() || undefined;
  if (!(file instanceof File) || file.size === 0) {
    redirect("/documents?error=" + encodeURIComponent("Choose a PDF or markdown file to upload"));
  }
  let stored;
  try {
    stored = await ingestDocument(file as File, title);
  } catch (err) {
    console.error("uploadDocumentAction:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    redirect("/documents?error=" + encodeURIComponent(message.slice(0, 400)));
  }
  revalidatePath("/documents");
  redirect(
    "/documents?ok=" +
      encodeURIComponent(
        `Added “${stored.title}” — ${stored.chunkCount} chunks indexed for grounding.`
      )
  );
}

export async function deleteDocumentAction(formData: FormData) {
  await requireAdmin();
  const id = parseInt(String(formData.get("id") || ""), 10);
  if (!Number.isNaN(id)) await deleteDocument(id);
  revalidatePath("/documents");
  redirect("/documents?ok=" + encodeURIComponent("Document removed"));
}
