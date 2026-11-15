import { getCadProjects } from '@/lib/site-content';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { onshapeConfigured } from '@/lib/cad/onshape-export';
import CadSection from '@/components/home/CadSection';
import '../home.css';

export const dynamic = 'force-dynamic';

export default async function CadPage() {
  const [cadProjects, isAdmin] = await Promise.all([
    getCadProjects(),
    isAdminAuthenticated(),
  ]);

  return (
    <div className="cad-page">
      <CadSection
        projects={cadProjects}
        isAdmin={isAdmin}
        onshape={isAdmin && onshapeConfigured()}
        fullPage
      />
    </div>
  );
}
