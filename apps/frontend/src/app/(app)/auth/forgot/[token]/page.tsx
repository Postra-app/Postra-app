export const dynamic = 'force-dynamic';
import { ForgotReturn } from '@gitroom/frontend/components/auth/forgot-return';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postra' : 'Gitroom'} Forgot Password`,
  description: '',
};
export default async function Auth(params: {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    confirmed?: string;
  }>;
}) {
  return (
    <ForgotReturn
      token={(await params.params).token}
      confirmed={(await params.searchParams)?.confirmed === '1'}
    />
  );
}
