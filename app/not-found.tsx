import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '1rem' }}>
      <div style={{ fontSize: '4rem' }}>🛰️</div>
      <h1 style={{ margin: 0 }}>Page not found</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 420 }}>That page drifted off the Pi. Try one of these instead:</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" className="btn btn-primary">Home</Link>
        <Link href="/blog" className="btn btn-secondary">Posts</Link>
        <Link href="/gallery" className="btn btn-secondary">Gallery</Link>
        <Link href="/party" className="btn btn-secondary">Party</Link>
      </div>
    </div>
  );
}
