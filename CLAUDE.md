This project is Postra, a tool to schedule social media and chat posts. The channels offered to customers are listed in `enabledProviders` in `libraries/nestjs-libraries/src/integrations/integration.manager.ts`; the rest of the registered providers show as "Coming soon".

## Project direction

Postra is still being built, and we make it better whenever there is a chance. Fix bugs when you find them. Port from upstream Postiz whatever is good for Postra: fixes, security and new features alike, never by `git merge upstream/main`. When a feature or any other part of the project can be improved or extended in a way that is good for Postra as a whole, do it rather than only noting it.

Every such change follows the usual rules: a test that fails on the old code, proof on the real service, review before the PR, one branch and one PR per repo per session. Ask Krzysztof first, with a recommendation, only about text customers see, money, legal matters, or anything irreversible.

You can add posts to the calendar, they will be added into a workflow and posted at the right time.
You can find things like:
- Schedule posts
- Calendar view
- Analytics
- Team management
- Media library

This project is a monorepo with a root only package.json of dependencies.
Made with PNPM.
We have 3 important folders

- apps/backend - this is where the API code is (NESTJS)
- apps/orchestrator - this is temporal, it's for background jobs (NESTJS) it contains all the workflows and activities
- apps/frontend - this is the code of the frontend (Next.js, React)
- /libraries contains a lot of services shared between backend and orchestrator and frontend components.

We are using only pnpm, don't use any other dependency manager.
Never install frontend components from npmjs, focus on writing native components.

The project uses tailwind 3, before writing any component look at:
- /apps/frontend/src/app/colors.scss
- /apps/frontend/src/app/global.scss
- /apps/frontend/tailwind.config.cjs

All the --color-custom* are deprecated, don't use them.

And check other components in the system before to get the right design.

When working on the backend we need to pass the 3 layers:
Controller >> Service >> Repository (no shortcuts)
In some cases we will have
Controller >> Mananger >> Service >> Repository.

Most of the server logic should be inside of libraries/nestjs-libraries.
The backend app is mostly used to write controllers, and imports from libraries/nestjs-libraries. A library never imports from an app.

For the frontend follow this:
- Many of the UI components lives in /apps/frontend/src/components/ui
- Routing is in /apps/frontend/src/app
- Components are in /apps/frontend/src/components
- always use SWR to fetch stuff, and use "useFetch" hook from /libraries/helpers/src/utils/custom.fetch.tsx

When using SWR, each one have to be in a seperate hook and must comply with react-hooks/rules-of-hooks, never put eslint-disable-next-line on it.

It means that this is valid:
const useCommunity = () => {
   return useSWR....
}

This is not valid:
const useCommunity = () => {
  return {
    communities: () => useSWR<CommunitiesListResponse>("communities", getCommunities),
    providers: () => useSWR<ProvidersListResponse>("providers", getProviders),
  };
}

- Linting of the project can run only from the root.
- Use only pnpm.
- The system runs in production, if you want to change something, you need to be sure that you are not breaking anything for existing users and a migration might be needed