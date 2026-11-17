import { StandaloneFeedback } from '@gitroom/frontend/components/layout/standalone.feedback';
import { ReactNode } from 'react';

export default async function IntegrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="bg-[#0B0A0A] flex flex-1 min-h-screen w-screen">
      <StandaloneFeedback />
      {children}
    </div>
  );
}
