'use client';

export default function PrintButton() {
  return (
    <button className="btn btn-secondary" onClick={() => window.print()}>
      🖨️ Print / Save as PDF
    </button>
  );
}
