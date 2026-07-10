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
        <form action={updateSourceAction}>
          <input type="hidden" name="id" value={source.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="kind">Source type *</label>
              <select id="kind" name="kind" defaultValue={source.kind}>
                <option value="email">Email feed (ATOM/RSS or Feedbin)</option>
                <option value="twitter">X / Twitter (via Nitter)</option>
              </select>
            </div>
            <div className="full">
              <label htmlFor="feed_url">
                Feed URL — or X handle for X sources *
              </label>
              <input
                id="feed_url"
                name="feed_url"
                required
                defaultValue={source.feed_url}
              />
            </div>
            <div>
              <label htmlFor="name">Source name *</label>
              <input id="name" name="name" required defaultValue={source.name} />
            </div>
            <div>
              <label htmlFor="candidate">Person / MP</label>
              <input
                id="candidate"
                name="candidate"
                defaultValue={source.candidate ?? ""}
                placeholder="Nigel Farage"
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
              <label htmlFor="office">Role</label>
              <input
                id="office"
                name="office"
                defaultValue={source.office ?? ""}
                placeholder="MP / Party Leader"
              />
            </div>
            <div>
              <label htmlFor="state">Constituency</label>
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
