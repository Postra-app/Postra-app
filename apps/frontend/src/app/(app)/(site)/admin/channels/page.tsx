export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { AdminChannelsComponent } from '@gitroom/frontend/components/admin/admin-channels.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postra' : 'Gitroom'} Admin Channels`,
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-transparent flex-1 flex-col flex p-[20px] gap-[12px]">
      {/* useSearchParams needs a Suspense boundary above it, or the whole
          route opts out of static rendering at build time. */}
      <Suspense fallback={null}>
        <AdminChannelsComponent />
      </Suspense>
    </div>
  );
}
