"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { deleteEmail } from "@/lib/db";

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
