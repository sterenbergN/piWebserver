import './party.css';

export const metadata = {
  title: 'Party Games',
  description: 'Play Jackbox-style games with your friends.',
};

export default function PartyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="party-root">
      {children}
    </div>
  );
}
