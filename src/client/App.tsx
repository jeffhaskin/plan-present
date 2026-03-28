function parseSlug(): string | null {
  const match = window.location.pathname.match(/^\/doc\/([^/]+)$/);
  return match ? match[1] : null;
}

function Editor({ slug }: { slug: string }) {
  return (
    <main>
      <h1>Editing: {slug}</h1>
      <p>Editor placeholder — Tiptap integration coming soon.</p>
    </main>
  );
}

export default function App() {
  const slug = parseSlug();

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
