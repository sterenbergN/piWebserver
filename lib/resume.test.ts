import test from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeResume } from './resume';

test('normalizeResume cleans every section and keeps ids unique', () => {
  const resume = normalizeResume({
    profile: {
      name: '  Ada  ',
      email: 'not-an-email',
      links: [
        { label: 'Site', url: 'https://example.com' },
        { label: 'Bad', url: 'javascript:alert(1)' },
        { label: '', url: 'https://nolabel.com' },
      ],
    },
    experience: [
      { role: 'Engineer', company: 'Acme', details: ['Built things', '  ', 'Shipped'] },
      { role: 'Engineer', company: 'Acme' },
      { role: '', company: '' },
    ],
    skills: [{ name: 'CAD' }, { name: 'cad' }, { name: 'Python', linkedPosts: [{ title: 'Post', slug: 'post' }, { title: 'x' }] }],
    projects: [{ name: 'Robot', category: 'Nope' }, { name: '' }],
  });

  assert.equal(resume.profile.name, 'Ada');
  assert.equal(resume.profile.email, '');
  assert.deepEqual(resume.profile.links, [{ label: 'Site', url: 'https://example.com/' }]);
  assert.equal(resume.experience.length, 2);
  assert.deepEqual(resume.experience[0].details, ['Built things', 'Shipped']);
  assert.notEqual(resume.experience[0].id, resume.experience[1].id);
  assert.deepEqual(resume.skills.map((s) => s.name), ['CAD', 'Python']);
  assert.deepEqual(resume.skills[1].linkedPosts, [{ title: 'Post', slug: 'post' }]);
  assert.deepEqual(resume.projects, [{ id: 'robot', name: 'Robot', description: '', category: 'Other', blogSlug: '' }]);
});

test('normalizeResume keeps existing ids and falls back to a default name', () => {
  const resume = normalizeResume({ profile: {}, experience: [{ id: 'job-1', role: 'A', company: 'B' }] });
  assert.equal(resume.profile.name, 'Noah Sterenberg');
  assert.equal(resume.experience[0].id, 'job-1');
});

test('normalizeProfile keeps complete "Now" items only', () => {
  const resume = normalizeResume({ profile: { now: [{ label: 'Building', text: 'A robot' }, { label: 'Reading', text: '' }, { text: 'no label' }] } });
  assert.deepEqual(resume.profile.now, [{ label: 'Building', text: 'A robot' }]);
});

test('linkProjects finds write-ups by slug or name and albums by slug', async () => {
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await fs.mkdir('public/uploads/blog', { recursive: true });
    await fs.mkdir('public/uploads/gallery', { recursive: true });
    await fs.writeFile('public/uploads/blog/posts.json', JSON.stringify([{ slug: 'robot-arm', title: 'Robot Arm!' }, { slug: 'cnc', title: 'CNC build' }]));
    await fs.writeFile('public/uploads/gallery/albums.json', JSON.stringify([{ id: 'blog', albums: [{ id: 'robot-arm' }] }]));
    const { linkProjects } = await import('./resume-store');
    const [byName, bySlug, none] = await linkProjects([
      { id: 'a', name: 'Robot arm', description: '', category: 'Hardware', blogSlug: '' },
      { id: 'b', name: 'Mill', description: '', category: 'Hardware', blogSlug: 'cnc' },
      { id: 'c', name: 'Other', description: '', category: 'Other', blogSlug: '' },
    ]);
    assert.deepEqual(byName.post, { slug: 'robot-arm', title: 'Robot Arm!' });
    assert.equal(byName.albumId, 'robot-arm');
    assert.equal(bySlug.post?.slug, 'cnc');
    assert.equal(bySlug.albumId, undefined);
    assert.equal(none.post, undefined);
  } finally {
    process.chdir(cwd);
  }
});
