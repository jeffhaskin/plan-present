import { useEffect } from "react";
import Editor from "./Editor";

function parseSlug(): string | null {
  const match = window.location.pathname.match(/^\/doc\/([^/]+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const slug = parseSlug();

  useEffect(() => {
    document.title = slug ? `pp | ${slug}` : "plan-present";
  }, [slug]);

  if (!slug) {
    return (
      <main>
        <h1>plan-present</h1>
        <p>No document selected. Navigate to <code>/doc/:slug</code> to open a document.</p>
      </main>
    );
  }

  return <Editor slug={slug} />;
}
