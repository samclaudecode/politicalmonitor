import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/db";
import { PARTIES } from "@/lib/taxonomy";
import { updateSourceAction } from "../../actions";
import DbSetupNotice from "../../../components/DbSetupNotice";

export const dynamic = "force-dynamic";

export default async function EditSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  const sourceId = parseInt(id, 10);
  if (Number.isNaN(sourceId)) notFound();

  let source;
  try {
    source = await getSource(sourceId);
  } catch (err) {
    console.error("Edit source page: database error:", err);
    return <DbSetupNotice error={err} />;
  }
  if (!source) notFound();

  return (
    <>
      <p style={{ marginTop: 24 }}>
        <Link href="/sources">← Back to sources</Link>
      </p>
      <div className="form-card">
        <h2>Edit source</h2>
        <p style={{ color: "var(--ink-faint)", fontSize: "0.85rem" }}>
          Feed: <code>{source.feed_url}</code>
        </p>
        <form action={updateSourceAction}>
          <input type="hidden" name="id" value={source.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="name">Source name *</label>
              <input id="name" name="name" required defaultValue={source.name} />
            </div>
            <div>
              <label htmlFor="candidate">Candidate / politician</label>
              <input
                id="candidate"
                name="candidate"
                defaultValue={source.candidate ?? ""}
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label htmlFor="party">Party</label>
              <select id="party" name="party" defaultValue={source.party}>
                {PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="office">Office sought / held</label>
              <input
                id="office"
                name="office"
                defaultValue={source.office ?? ""}
                placeholder="U.S. Senate"
              />
            </div>
            <div>
              <label htmlFor="state">State</label>
              <input
                id="state"
                name="state"
                defaultValue={source.state ?? ""}
                maxLength={40}
              />
            </div>
          </div>
          <button type="submit">Save changes</button>
        </form>
      </div>
    </>
  );
}
