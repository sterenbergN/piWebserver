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
