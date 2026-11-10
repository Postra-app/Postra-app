export const dynamic = 'force-dynamic';

import { AdminSubscriptionsComponent } from '@gitroom/frontend/components/admin/admin-subscriptions.component';
import { AdminCompsComponent } from '@gitroom/frontend/components/admin/admin-comps.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postra' : 'Gitroom'} Admin Subscriptions`,
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-transparent flex-1 flex-col flex p-[20px] gap-[12px]">
      <AdminSubscriptionsComponent />
      <AdminCompsComponent />
    </div>
  );
}
