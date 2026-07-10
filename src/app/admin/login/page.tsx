import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (await isAdmin()) redirect("/sources");
  const sp = await searchParams;
  const failed = Boolean(sp.error);

  return (
    <div className="form-card" style={{ maxWidth: 420, margin: "48px auto" }}>
      <h2>Admin sign in</h2>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.92rem" }}>
        Managing sources and deleting emails requires the admin password.
      </p>
      {failed ? <div className="notice">Wrong password — try again.</div> : null}
      <form method="post" action="/api/admin/login">
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
            />
          </div>
        </div>
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
