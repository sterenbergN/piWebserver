'use client';

/** What the journal shows when signed out: nothing of anyone's, just a way in. */
export default function SignInPrompt({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="jr-locked">
      <div className="jr-lock" aria-hidden>🔒</div>
      <h2>{title}</h2>
      <p className="jr-hint">{children}</p>
      <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
    </section>
  );
}
