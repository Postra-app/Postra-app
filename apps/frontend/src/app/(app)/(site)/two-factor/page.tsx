import { Suspense } from 'react';
import { Metadata } from 'next';
import { TwoFactorComponent } from '@gitroom/frontend/components/two-factor/two-factor.component';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Postra Two-step verification',
  description: '',
};
export default async function Index() {
  return (
    <Suspense>
      <TwoFactorComponent />
    </Suspense>
  );
}
