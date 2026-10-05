import { JoinOrganization } from '@gitroom/frontend/components/join/join.organization';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Join organization',
  description: '',
};
export default async function Index() {
  return <JoinOrganization />;
}
