export const dynamic = 'force-dynamic';
import { DeleteAccountConfirm } from '@gitroom/frontend/components/auth/delete-account-confirm';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Postra Delete Account',
  description: '',
};
// Opened from the "Confirm deleting your Postra account" email. The page only
// shows a button; nothing is deleted until it is pressed.
export default async function Auth(params: {
  params: Promise<{
    token: string;
  }>;
}) {
  return <DeleteAccountConfirm token={(await params.params).token} />;
}
