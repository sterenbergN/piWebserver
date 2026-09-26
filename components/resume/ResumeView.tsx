import type { Resume } from '@/lib/resume';
import './resume.css';

/** Resume layout: header, summary, experience, skills and projects. */
export default function ResumeView({ resume, showEmpty = false }: { resume: Resume; /** Editor preview: show placeholders for empty sections. */ showEmpty?: boolean }) {
  const { profile, experience, skills, projects } = resume;
  return (
    <article className="resume-sheet">
      <header>
        <h1>{profile.name}</h1>
        {profile.headline && <p className="resume-headline">{profile.headline}</p>}
        <div className="resume-contact">
          {profile.location && <span>📍 {profile.location}</span>}
          {profile.email && <a href={`mailto:${profile.email}`}>✉️ {profile.email}</a>}
          {profile.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">🔗 {l.label}</a>
          ))}
        </div>
      </header>

      {profile.summary && (
        <section className="resume-section">
          <h2>Summary</h2>
          <p style={{ margin: 0 }}>{profile.summary}</p>
        </section>
      )}

      {(experience.length > 0 || showEmpty) && <section className="resume-section">
        <h2>Experience</h2>
        {experience.length === 0 && <p className="resume-empty">No experience added yet.</p>}
        {experience.map((job) => (
          <div key={job.id} className="resume-job">
            <div className="resume-job-head">
              <h3>{job.role}</h3>
              <span className="resume-job-period">{job.period}</span>
            </div>
            <div className="resume-job-company">{job.company}</div>
            {job.description && <p>{job.description}</p>}
            {job.details.length > 0 && (
              <ul>{job.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
            )}
          </div>
        ))}
      </section>}

      {skills.length > 0 && (
        <section className="resume-section">
          <h2>Skills</h2>
          <div className="resume-skills">{skills.map((s) => <span key={s.id}>{s.name}</span>)}</div>
        </section>
      )}

      {projects.length > 0 && (
        <section className="resume-section">
          <h2>Projects</h2>
          {projects.map((p) => (
            <div key={p.id} className="resume-job">
              <div className="resume-job-head">
                <h3>{p.name}</h3>
                <span className="resume-job-period">{p.category}</span>
              </div>
              {p.description && <p>{p.description}</p>}
              {(p.post || p.albumId) && (
                <p className="resume-project-links">
                  {p.post && <a href={`/blog/${p.post.slug}`}>Write-up</a>}
                  {p.albumId && <a href={`/gallery?album=${encodeURIComponent(p.albumId)}`}>Photos</a>}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {profile.updatedAt && (
        <p className="resume-updated">Updated {new Date(profile.updatedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
      )}
    </article>
  );
}
