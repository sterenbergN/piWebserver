import Link from 'next/link';
import { getResume } from '@/lib/resume-store';
import { getCadProjects, getGalleryAlbums, getLibraryDocuments, getPosts, type GalleryAlbum } from '@/lib/site-content';
import { mediaSrc, mediaSrcSet } from '@/lib/media-url';
import ContactLinks from '@/components/home/ContactLinks';
import ExperienceCard from '@/components/home/ExperienceCard';
import SkillsCard from '@/components/home/SkillsCard';
import CadSection from '@/components/home/CadSection';
import PiBadge from '@/components/home/PiBadge';
import './home.css';

// Rendered on the server from the content files, so the page arrives complete
// (no blank screen while the browser fetches the resume, posts and CAD list).

const CATEGORY_COLORS: Record<string, string> = {
  Automation: '#3b82f6',
  Infrastructure: '#8b5cf6',
  Software: '#10b981',
  Hardware: '#f59e0b',
  Other: '#64748b',
};

const countPhotos = (albums: GalleryAlbum[]): number => albums.reduce((n, a) => n + a.images.length + countPhotos(a.albums), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
);

export default async function Home() {
  const [{ profile, experience, skills, projects }, posts, cadProjects, albums, documents] = await Promise.all([
    getResume(), getPosts(), getCadProjects(), getGalleryAlbums(), getLibraryDocuments(),
  ]);
  const latestPosts = [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 3);
  const photoCount = countPhotos(albums);

  const explore = [
    { href: '/gallery', icon: '📷', title: 'Gallery', text: photoCount ? plural(photoCount, 'photo') : 'Photo albums' },
    { href: '/blog', icon: '✍️', title: 'Posts', text: posts.length ? plural(posts.length, 'write-up') : 'Write-ups' },
    { href: '/library', icon: '📚', title: 'Library', text: documents.length ? plural(documents.length, 'document') : 'Books & manuals' },
    { href: '/game', icon: '🎮', title: 'Play', text: 'Arcade games' },
    { href: '/party', icon: '🎉', title: 'Party', text: 'Games for a group' },
    { href: '/tools', icon: '🧰', title: 'Tools', text: 'Handy calculators' },
  ];

  return (
    <div className="home">
      {/* Hero */}
      <section className="hero-gradient home-hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <PiBadge />
          <h1 className="home-name">{profile.name}</h1>
          <p className="home-headline">{profile.headline}</p>
          {profile.location && <p className="home-location">📍 {profile.location}</p>}
          <div className="home-ctas">
            <Link href="/gallery" className="btn btn-primary home-cta">View gallery</Link>
            <Link href="/blog" className="btn btn-secondary home-cta">Read the blog</Link>
          </div>
          <ContactLinks links={profile.links} email={profile.email} />
        </div>
      </section>

      {/* Explore the site */}
      <section aria-label="Explore">
        <div className="home-explore">
          {explore.map(item => (
            <Link key={item.href} href={item.href} className="home-explore-item">
              <span className="home-explore-icon" aria-hidden>{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Now: what I'm up to lately (edited in the resume editor) */}
      {profile.now?.length > 0 && (
        <section className="premium-card">
          <div className="home-section-head">
            <h2 style={{ fontSize: '1.5rem' }}>Now</h2>
            {profile.updatedAt && <span className="home-muted-sm">Updated {formatDate(profile.updatedAt)}</span>}
          </div>
          <div className="home-now">
            {profile.now.map((item, i) => (
              <div key={i}>
                <div className="home-now-label">{item.label}</div>
                <div>{item.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Experience & Skills */}
      {(experience.length > 0 || skills.length > 0) && (
        <section className="home-two-up">
          {experience.length > 0 && <ExperienceCard experience={experience} />}
          {skills.length > 0 && <SkillsCard skills={skills} intro={profile.skillsIntro} />}
        </section>
      )}

      {/* Latest posts */}
      {latestPosts.length > 0 && (
        <section>
          <div className="home-section-head">
            <h2>Latest posts</h2>
            <Link href="/blog" className="home-more">All posts <Arrow /></Link>
          </div>
          <div className="home-posts">
            {latestPosts.map((post, i) => (
              <Link key={post.slug} href={`/blog/${post.slug}`} className="premium-card home-post">
                {post.image && (
                  <img
                    src={mediaSrc(post.image, 640)}
                    srcSet={mediaSrcSet(post.image, [400, 640, 960])}
                    sizes="(max-width: 700px) 100vw, 400px"
                    alt=""
                    loading={i === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                  />
                )}
                <div className="home-post-body">
                  {post.date && <div className="home-muted-sm">{formatDate(post.date)}{post.category ? ` · ${post.category}` : ''}</div>}
                  <h3>{post.title}</h3>
                  {post.description && <p>{post.description}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Projects (hidden until there is something to feature) */}
      {projects.length > 0 && (
        <section id="projects">
          <div className="home-section-head" style={{ display: 'block', textAlign: 'center' }}>
            <h2>Featured projects</h2>
            <p className="home-muted">Highlights from my blog and portfolio.</p>
          </div>
          <div className="home-projects">
            {projects.map(project => {
              const color = CATEGORY_COLORS[project.category] || CATEGORY_COLORS.Other;
              return (
                <div key={project.id} className="premium-card home-project">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <h3>{project.name}</h3>
                    <span className="home-tag" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>{project.category}</span>
                  </div>
                  <p>{project.description}</p>
                  {(project.post || project.albumId) && (
                    <div className="home-project-links">
                      {project.post && <Link href={`/blog/${project.post.slug}`}>Read write-up <Arrow /></Link>}
                      {project.albumId && <Link href={`/gallery?album=${encodeURIComponent(project.albumId)}`}>Photos <Arrow /></Link>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {cadProjects.length > 0 && <CadSection projects={cadProjects} />}

      {/* Philosophy */}
      <section className="home-philosophy">
        <div className="home-philosophy-icon" aria-hidden>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
        </div>
        <h2>Self-hosted architecture</h2>
        <p className="home-muted">
          This entire portfolio, gallery, and blog is served by a self-hosted Next.js application running on a low-power Raspberry Pi in my home lab — a small bet on digital independence, privacy, and full-stack engineering.
        </p>
        <Link href="/stats" className="home-more" style={{ justifyContent: 'center', marginTop: '1rem' }}>See the server&apos;s live stats <Arrow /></Link>
      </section>
    </div>
  );
}
