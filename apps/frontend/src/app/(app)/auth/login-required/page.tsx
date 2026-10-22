import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Postra - Sign in required',
  description: 'Sign in to continue.',
};

// proxy.ts sends a signed-out visitor of /modal/* here. It used to be one
// unstyled line about "the wizard to generate API code" with nowhere to go.
export default async function LoginRequiredPage() {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="text-start text-[40px] font-[700] tracking-[-0.04em] text-white">
        Sign in required
      </h1>
      <p className="mt-[8px] text-[15px] text-textColor/58">
        This page is part of your Postra workspace. Sign in to continue.
      </p>
      <p className="mt-[24px] text-sm text-textColor/66">
        <Link
          href="/auth/login"
          className="underline underline-offset-4 cursor-pointer text-textColor hover:text-[#38bdf8]"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
