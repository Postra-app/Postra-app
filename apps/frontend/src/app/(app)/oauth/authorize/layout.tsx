import { StandaloneFeedback } from '@gitroom/frontend/components/layout/standalone.feedback';
import { Metadata } from 'next';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Authorize Application',
};

export default async function OAuthLayout({
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
