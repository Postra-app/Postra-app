// Static content for the in-app Help page. Steps/gotchas/descriptions are
// filled in per channel and per tab as we write them — an empty array/string
// renders as a "coming soon" placeholder, so the page structure can ship first.
export type ChannelConnectType = 'oauth' | 'credentials' | 'bot';

export interface ChannelGuide {
  /** Matches /icons/platforms/<identifier>.png and the backend provider id. */
  identifier: string;
  name: string;
  connectType: ChannelConnectType;
  steps: string[];
  gotchas: string[];
  /** What the channel offers in the post composer (settings tab, limits, threads/first comment). */
  composer?: string[];
}

export interface AppTabGuide {
  id: string;
  name: string;
  description: string;
}

export interface SettingsSectionGuide {
  name: string;
  availability: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

// Channels with a non-standard connect flow (bot dialog, credentials form)
// come first — they generate the most confusion.
export const CHANNEL_GUIDES: ChannelGuide[] = [
  {
    identifier: 'telegram',
    name: 'Telegram',
    connectType: 'bot',
    steps: [
      "Postra publishes to a Telegram channel or group, not to your personal account. If you don't have one yet, create it inside your existing Telegram app: tap the pencil (new message) icon and choose \"New Channel\" — no new account or phone number needed, and it can be private.",
      'In Postra, click "Add Channel" and pick Telegram — a dialog shows our bot name and a one-time /connect code.',
      'In Telegram, open your channel, tap its name at the top, then Administrators → Add Admin (on desktop: ⋮ → Manage Channel → Administrators). Search for the bot by the name shown in the dialog and add it with the "Post Messages" permission ("Delete Messages" too, so it can clean up the connect code).',
      'Copy the /connect code from the dialog and send it as a post in that channel or group — not in a private chat with the bot.',
      'Go back to Postra — the channel is detected automatically within a few seconds and appears in your channel list.',
      'From now on, Telegram is just another channel in the composer: tick it when creating a post and the bot publishes the post to your channel. Nothing is posted unless you select it.',
    ],
    gotchas: [
      'Bots can only be added to a channel as administrators — if you can\'t add it as a member, that\'s expected; use Administrators → Add Admin.',
      "The bot must have the \"Post Messages\" admin permission — without it the connect code isn't detected and publishing fails.",
      "Send the /connect message in the channel or group you're connecting, not in a private chat with the bot.",
      'Posts are published by the bot, so keep it in the channel — removing it stops publishing.',
      'Media size limits (set by Telegram): images up to 10 MB, videos up to 50 MB. Larger files fail with a size error on the post.',
      'Character limit: 4,096 for text-only posts. With media attached, the text becomes the media caption, which Telegram limits to 1,024 characters.',
    ],
    composer: [
      'No extra settings tab — Telegram needs no per-post options.',
      'First comments: click "Add comment" to attach messages published right under the post. You can add several, and each has a Delay option (1 min – 2 h presets or a custom gap after the previous one).',
    ],
  },
  {
    identifier: 'bluesky',
    name: 'Bluesky',
    connectType: 'credentials',
    steps: [
      'In Bluesky, open Settings → Privacy and Security → App Passwords and create a new app password.',
      'In Postra, click "Add Channel" and pick Bluesky — a form appears with three fields: Service, Identifier and Password.',
      'Service: leave https://bsky.social as it is (change it only if you run your own Bluesky server).',
      'Identifier: your full Bluesky handle, e.g. yourname.bsky.social (or your custom domain if you use one).',
      'Password: paste the app password you created in step 1 (format xxxx-xxxx-xxxx-xxxx) and click Connect.',
    ],
    gotchas: [
      'Use an app password, not your main Bluesky password — app passwords can be revoked any time without changing your login.',
      'Enter the full handle, including .bsky.social (or your custom domain).',
    ],
    composer: [
      'Character limit: 300. For longer content click "Add post" to build a thread — each follow-up post can have its own Delay (1 min – 2 h or a custom gap after the previous one).',
      'Settings tab: optional "thread finisher" — a closing post appended at the end of a thread.',
      'Media: up to 4 images or 1 video per post.',
    ],
  },
  {
    identifier: 'mastodon',
    name: 'Mastodon',
    connectType: 'oauth',
    steps: [
      'Click "Add Channel" and pick Mastodon.',
      'Sign in to Mastodon and approve the requested permissions.',
    ],
    gotchas: [
      'Posts are limited to 500 characters (the standard Mastodon limit).',
      "Account on a different instance and can't connect? Email us and we'll help.",
    ],
    composer: [
      'No extra settings tab.',
      'Character limit: 500. For longer content click "Add post" to build a thread — each follow-up post can have its own Delay (1 min – 2 h or a custom gap).',
    ],
  },
  {
    identifier: 'discord',
    name: 'Discord',
    connectType: 'oauth',
    steps: [
      'Postra publishes to a Discord server you manage, not to a personal account. If you don\'t have one, create a server in the Discord app first — you need to be its admin.',
      'In Postra, click "Add Channel" and pick Discord.',
      'You are redirected to Discord — choose the server to add the Postra bot to (you must have the "Manage Server" permission), keep the requested permissions ticked, and authorise.',
      'Back in Postra the server appears in your channel list. Open the post composer, and in the Discord settings tab pick which channel of that server the post should go to.',
      'From now on Discord is just another channel: tick it when creating a post and the bot publishes to the channel you selected. Nothing is posted unless you select it.',
    ],
    gotchas: [
      'You must be an admin of the Discord server (Manage Server permission) to add the bot during authorisation.',
      'The bot needs permission to post in the target channel — if a post fails, check the bot\'s role can View Channel and Send Messages there.',
      'Always pick a channel in the Discord settings tab before publishing — without one there is nowhere to post.',
      'Keep the bot on the server — removing it stops publishing.',
      'Media size limit is set by Discord and depends on the server\'s Boost level: 10 MB with no Boost, 50 MB at Boost Level 2, 100 MB at Level 3. A larger file (typically a video) fails with a size error — use a smaller file or boost the server.',
    ],
    composer: [
      'Settings tab: choose which channel of the connected server to publish to (required).',
      'Character limit: 1,980.',
      'Media size limit: 10 MB per file on a server with no Boost (higher with server Boosts). Large videos may not fit.',
      'First comments: click "Add comment" to post follow-up messages in the same channel right after the post; each can have its own Delay (1 min – 2 h or a custom gap).',
    ],
  },
  {
    identifier: 'facebook',
    name: 'Facebook',
    connectType: 'oauth',
    steps: [
      'Postra publishes to a Facebook Page, not to a personal profile — Meta removed API publishing to personal timelines in 2018, so no tool can do it. If you don\'t have a Page yet, create one first (free, about two minutes); Facebook can also convert an existing profile into a Page and bring your followers across.',
      'Click "Add Channel" and pick Facebook.',
      'Log in with the Facebook account that manages your Page and approve all requested permissions. When Facebook asks which Pages to use, tick every Page you may want to publish to.',
      'Choose the Page you want to publish to.',
    ],
    gotchas: [
      'The list shows Pages only — your personal profile is never there, and a single entry means everything worked. Facebook shows the profile and the Page side by side in its own account switcher, which is why people expect two.',
      'You need Facebook access with full control of the Page. With partial access the channel still connects, but publishing fails later.',
      'A Page you skipped in the Facebook permission dialog usually will not appear. Reconnect and tick all of them.',
      "Don't untick any permissions during login — missing permissions break publishing later.",
    ],
    composer: [
      'Post Type: Post or Story (a Story needs at least one image or video).',
      'Embedded URL: attach a link preview to a text-only post.',
      'First comments: supported. Meta approved the permission in September 2026, so any Page you connect from now on gets the "Add comment" button. A Page connected before that keeps the permissions it was granted at the time — reconnect it once and the button appears.',
      "Character limit: 63,206 — effectively you won't hit it.",
    ],
  },
  {
    identifier: 'instagram',
    name: 'Instagram',
    connectType: 'oauth',
    steps: [
      'Set Instagram up on Meta\'s side FIRST — before you touch Postra. Skip this and the account list in the last step comes up empty, because Meta simply does not show us the account.',
      'Make it professional: in the Instagram app open Settings → Account type and tools → Switch to professional account, and pick Business (Creator works too). (Wording shifts slightly between app versions.)',
      'Link it to your Facebook Page: still in Instagram, Edit profile → Page → choose the Page you publish as. You can do the same from the other side: Facebook → your Page → Settings → Linked accounts → Instagram → Connect account. This link is what makes the account visible to Postra — or to any other scheduling tool.',
      'Only now, in Postra: click "Add Channel", pick Instagram and log in with the Facebook account that manages that Page. Tick every Page in the Facebook dialog — a Page you skip there stays invisible to us.',
      'Choose the Instagram account.',
    ],
    gotchas: [
      'Personal Instagram accounts won\'t appear — switch to Business/Creator in the Instagram app (Settings → Account type) and link a Facebook Page first.',
      'No Facebook Page at all? Create one before you start — Instagram publishing always runs through a Page, there is no route around it.',
      'Linking your Page to Instagram (what publishing needs) is not the same thing as joining your personal Facebook profile and Instagram in Accounts Center (shared login, cross-posting — a convenience Meta offers you). If Meta prompted you into the second one during connect and you would rather keep them apart, undo it in Instagram → Settings → Accounts Center → Accounts → Remove. Publishing keeps working as long as the Page link from step 2 stays.',
      'An empty account list almost always means step 1 or step 2 above is missing, not that the connect failed. Finish them in the Instagram app, then connect again.',
      'Linking is done inside Instagram and Facebook, never by Postra: no app can connect your accounts, move them between logins or remove them. If something changed there, it was a dialog Meta showed you — Instagram → Settings → Accounts Center shows what is linked and lets you undo it.',
      'If the account list comes up empty, the connect attempt leaves an unfinished channel marked with a red badge. Remove it from the dialog (or from the channel menu) and connect again once the account is Business/Creator and linked to the Page.',
      "Feed images are automatically cropped to Instagram's allowed aspect ratios.",
    ],
    composer: [
      'Post Type: Post, Reel or Story.',
      "Collaborators: invite up to 3 public accounts to co-author (not available for Stories).",
      'Trial Reel: show a Reel to non-followers first, with manual or performance-based graduation to everyone.',
      'First comments: click "Add comment" to publish a comment under the post right after it goes live, each with its own Delay. It is decided per channel from what Meta granted when you connected — if the button is missing, reconnect the channel.',
      'Media is required; carousels take up to 10 items. Caption limit: 2,200 characters.',
    ],
  },
  {
    identifier: 'threads',
    name: 'Threads',
    connectType: 'oauth',
    steps: [
      'Click "Add Channel", pick Threads and sign in with your Instagram credentials.',
      'Approve the requested permissions.',
    ],
    gotchas: [
      'Threads connects separately from Instagram — connect both if you post to both.',
    ],
    composer: [
      'Character limit: 500. Click "Add post" to build a thread — each follow-up post can have its own Delay (1 min – 2 h or a custom gap).',
      'Settings tab: optional "thread finisher" — a closing post appended at the end of a thread.',
    ],
  },
  {
    identifier: 'x',
    name: 'X (Twitter)',
    connectType: 'oauth',
    steps: [
      'Click "Add Channel", pick X and authorize Postra.',
    ],
    gotchas: [
      'X rejects two identical posts in a row — vary the text when reposting.',
    ],
    composer: [
      'Who can reply: Everyone, accounts you follow, mentioned accounts, subscribers or verified accounts.',
      'Post to a community: paste the community URL.',
      '"Made with AI" and "Paid partnership" flags.',
      'Click "Add post" to build a thread; each follow-up post can have its own Delay (1 min – 2 h or a custom gap). Optional thread finisher.',
      'Character limit: 280 (4,000 if your X account has Premium).',
    ],
  },
  {
    identifier: 'linkedin',
    name: 'LinkedIn',
    connectType: 'oauth',
    steps: [
      'This channel is your personal profile — posts are published under your own name. To post as a company, use "LinkedIn Page" instead.',
      'Click "Add Channel", pick LinkedIn and sign in.',
      'Approve the requested permissions.',
    ],
    gotchas: [
      'Personal profile and company page are two separate channels in Postra — you can connect both and pick either (or both) in the composer.',
    ],
    composer: [
      '"Post as images carousel": turns 2+ attached images into a carousel document (you name the slide deck).',
      'First comments: click "Add comment" — text only on LinkedIn. You can add several, each with its own Delay (1 min – 2 h or a custom gap).',
      'Character limit: 3,000.',
    ],
  },
  {
    identifier: 'linkedin-page',
    name: 'LinkedIn Page',
    connectType: 'oauth',
    steps: [
      'This channel is a company (business) page — posts are published as the company, not under your name.',
      'Click "Add Channel", pick LinkedIn Page and sign in with the personal account that administers the page.',
      'After approving, choose the company page you want to publish to from the list.',
    ],
    gotchas: [
      "You need to be an administrator of the company page — if the list is empty, ask the page owner to make you an admin on LinkedIn.",
    ],
    composer: [
      'Same options as LinkedIn: images carousel, first comments (text only, several allowed, each with its own Delay), 3,000-character limit.',
    ],
  },
  {
    identifier: 'youtube',
    name: 'YouTube',
    connectType: 'oauth',
    steps: [
      'Click "Add Channel", pick YouTube, choose your Google account and approve access.',
      'If your Google account has more than one YouTube channel, pick the one to connect from the list.',
    ],
    gotchas: [
      'The Google account needs an existing YouTube channel.',
      'YouTube accepts video posts only.',
    ],
    composer: [
      'Title (required), visibility (Public / Private / Unlisted), "Made for kids" flag and tags.',
      'Exactly one video per post; the post text becomes the video description (limit 5,000 characters).',
      'First comments and threads are not available on YouTube.',
    ],
  },
  {
    identifier: 'tiktok',
    name: 'TikTok',
    connectType: 'oauth',
    steps: [
      'Click "Add Channel", pick TikTok, log in and approve access.',
    ],
    gotchas: [
      "TikTok is video-first — publishing can take a moment to process on TikTok's side.",
    ],
    composer: [
      'Privacy level: who can see the video (the options come from your TikTok account).',
      'Content posting method: publish directly, or upload to your TikTok drafts ("Upload without posting").',
      'Allow comments / Duet / Stitch toggles (greyed out if your TikTok settings disallow them).',
      '"Video made with AI" flag and branded-content disclosure (your brand / paid partnership).',
      'Photo posts additionally get a title and optional auto-added music.',
      'Caption limit: 2,000 characters.',
      'First comments and threads are not available on TikTok.',
    ],
  },
];

export const APP_TABS: AppTabGuide[] = [
  {
    id: 'calendar',
    name: 'Calendar',
    description:
      'Your posting hub: every scheduled, draft and published post in calendar or list view. This is also where you add channels and create posts.',
  },
  {
    id: 'agent',
    name: 'Agent',
    description:
      'An AI assistant that knows your channels — chat with it to brainstorm, draft and schedule posts.',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Follower growth and post performance per channel.',
  },
  {
    id: 'studio',
    name: 'Studio',
    description:
      'Design graphics and short videos for your posts — templates, free stock photos, your Brand Kit, AI image generation, and video tools including automatic captions. Desktop only.',
  },
  {
    id: 'autopost',
    name: 'Auto Post',
    description:
      'Connect an RSS feed (e.g. your blog) and new articles are turned into social posts automatically.',
  },
  {
    id: 'media',
    name: 'Media',
    description:
      "Every image and video you've uploaded, ready to reuse in any post.",
  },
  {
    id: 'plugs',
    name: 'Plugs',
    description:
      'Small per-channel automations that run in the background to boost reach — available for selected channels such as X, LinkedIn and Threads.',
  },
  {
    id: 'billing',
    name: 'Billing',
    description: 'Your subscription: plan, payment method and invoices.',
  },
  {
    id: 'settings',
    name: 'Settings',
    description:
      'Workspace configuration — see "Settings explained" below for each section.',
  },
];

export interface StudioToolGuide {
  name: string;
  description: string;
}

// Studio → Graphics, tool by tool (left-toolbar order, then saving/export).
// Facts come from the design-editor code — keep in sync when tools change.
export const STUDIO_GRAPHICS_TOOLS: StudioToolGuide[] = [
  {
    name: 'AI Generate',
    description:
      'Describe your idea — or click an upcoming occasion chip (✎ copies it into the prompt for editing) — and AI builds the whole design in one step: a background image plus an editable headline, subtext and call-to-action in your Brand Kit colours. Takes about 5–10 seconds and uses one AI credit. Set SLIDES to 2–5 to get a multi-slide carousel instead of a single graphic. Needs the Starter plan or above — on the free plan the upcoming-occasion list is still there, and the chips open matching templates instead.',
  },
  {
    name: 'AI Refine',
    description:
      'Chat about the design already on the canvas: "shorter headline", "warmer colours", "move the logo to the corner". It edits the relevant elements instead of starting over, and every step lands in history (undo with Ctrl+Z). It restyles the design — it cannot retouch the photo itself; for that, add a stock image or regenerate with a changed prompt.',
  },
  {
    name: 'Templates',
    description:
      'Ready-made layouts in eight categories (promo, quote, announcement, stats, tip, event, community, reel covers), previewed in your Brand Kit colours and current format. Applying one replaces the canvas — Ctrl+Z brings the previous design back. Your own designs saved with "Save as template" appear at the top under "Your templates".',
  },
  {
    name: 'Brand Kit',
    description:
      'Your colours (primary, background, text), font, tone of voice and logo. It drives the whole Studio: AI Generate designs, template previews and video text styling all follow it — set it once and everything comes out in your brand.',
  },
  {
    name: 'Select',
    description:
      'Click any element to open the "Selected object" panel: font size, bold/italic, alignment, outline colour and width, opacity and precise rotation. The colour swatches restyle whatever is selected.',
  },
  {
    name: 'Text',
    description:
      'Add headlines and body copy, then change the font and colour with one click — or fine-tune in the "Selected object" panel.',
  },
  {
    name: 'Shapes',
    description:
      'Fifteen ready-made shapes for badges, dividers and accents. Swatches colour the selected shape; with nothing selected they change the canvas background instead.',
  },
  {
    name: 'Icons',
    description:
      'A built-in icon library with categories and search — click an icon to drop it onto the design.',
  },
  {
    name: 'Stock photos',
    description:
      'Free Pixabay photos, on its own tool on the toolbar — it opens with results already showing, so a photo is two clicks from opening Studio. Click one and it lands on the canvas and in your media library at the same time. Pixabay License: commercial use is fine and no credit is required. Costs nothing and uses no AI credit, on every plan.',
  },
  {
    name: 'Images',
    description:
      'Upload your own photos, and work on whatever photo is on the canvas: filters (brightness, contrast, saturation, blur and black-and-white presets), background removal and a smart crop to the current format. Free stock photos have their own tool next to Templates.',
  },
  {
    name: 'Saving & export',
    description:
      '"Save to library" stores the finished graphic in Media, ready for any post; "Save as template" adds it to your templates; "Download PNG" saves a lossless file; "All formats" renders a variant for every platform size at once; "Use in Post" attaches the design to a post. The format bar at the bottom switches between platform sizes and repositions your layout, and Carousel mode edits multi-slide posts. Studio also keeps a draft automatically — leave and come back, and your design is restored. You can get back into an image later from Media: hover a file and pick "Edit in Studio". Studio needs a desktop or laptop — the canvas and its panels do not fit a phone screen.',
  },
];

// Studio → Video, in goal-screen / tab order. Facts come from the
// video-studio code — keep in sync when tools change.
export const STUDIO_VIDEO_TOOLS: StudioToolGuide[] = [
  {
    name: 'Start screen & loading a clip',
    description:
      'Pick what you came to do — six cards, one per editor tab, and Studio remembers your last choice. Load footage from disk or from your media library; editing happens in your browser, so clips are capped at 200 MB (use a shorter cut for anything bigger). Every video tool is included on all plans. When something finishes rendering it is saved to your media library and you choose whether to use it in a post or carry on editing — nothing navigates away on its own.',
  },
  {
    name: 'Trim',
    description:
      'Drag the start and end handles, preview, and export just the part you want. The waveform helps you cut on the beat — a silent clip simply shows a flat line.',
  },
  {
    name: 'Formats',
    description:
      'One clip, re-framed for every placement: 9:16 (Reels / TikTok / Stories), 1:1 (feed) and 16:9 (YouTube / X) with an automatic centre crop. Each variant can go to your library or straight into a post.',
  },
  {
    name: 'AI Captions',
    description:
      'AI transcribes the clip (the language defaults to your app language), you edit the lines, then burn them in — styled to your Brand Kit, with the original audio untouched.',
  },
  {
    name: 'Text on video',
    description:
      'Overlay a headline on the clip — position, size and colour (Brand Kit swatches included) — then render. Audio is preserved.',
  },
  {
    name: 'Photos → video',
    description:
      'Turn up to 10 photos into a vertical slideshow: set the order and seconds per photo, add a headline, and a gentle Ken Burns motion makes it feel like video.',
  },
  {
    name: 'Stock B-roll',
    description:
      'Search free Pixabay stock videos, preview them and import into your media library to cut into your edits.',
  },
  {
    name: 'Exporting & requirements',
    description:
      'Every tool can send its result to a post ("Use in post"), keep it in your library ("Save to library") or download it. Rendering runs entirely in your browser — Chrome, Edge or Safari 16.4+ is required (WebCodecs); on an unsupported browser Studio tells you instead of failing silently.',
  },
];

export const SETTINGS_SECTIONS: SettingsSectionGuide[] = [
  {
    name: 'Global Settings',
    availability: 'All plans',
    description:
      'Interface language, email notifications, link shortening and account deletion.',
  },
  {
    name: 'Teams',
    availability: 'Plans with team seats',
    description:
      'Invite teammates to your workspace so you can manage channels and posts together.',
  },
  {
    name: 'Webhooks',
    availability: 'Plans with webhooks',
    description:
      'Get an HTTP call to your own endpoint whenever posts publish — for connecting Postra to your own tools.',
  },
  {
    name: 'Auto Post',
    availability: 'Plans with Auto Post',
    description: 'Manage the RSS feeds used by the Auto Post tab.',
  },
  {
    name: 'Sets',
    availability: 'Paid plans',
    description:
      'Save a group of channels as a set and select all of them with one click when composing.',
  },
  {
    name: 'Signatures',
    availability: 'Paid plans',
    description:
      'Reusable text snippets (e.g. hashtags or a call to action) you can append to posts.',
  },
  {
    name: 'Approved Apps',
    availability: 'All plans',
    description:
      "Third-party apps you've granted access to your account — review and revoke them here.",
  },
];

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Why can't I add more channels?",
    answer:
      'Each plan includes a fixed number of channels (3, 6 or 12, depending on the plan; trials are capped at 3). Upgrade in Billing to unlock more. Disconnected channels still occupy a slot until you delete them.',
  },
  {
    question: 'A post failed to publish — what should I do?',
    answer:
      "Open the post from the Calendar to see the error returned by the platform. The usual causes: the channel needs reconnecting (red badge on its avatar), the media doesn't meet the platform's requirements, or the platform flagged a duplicate. Fix the cause and reschedule — still stuck? Email us.",
  },
  {
    question: 'How does the trial work?',
    answer:
      "Paid plans start with a 7-day free trial, capped at 3 channels. Cancel any time in Billing before the trial ends and you won't be charged.",
  },
  {
    question: 'Can I post to multiple channels at once?',
    answer:
      'Yes — pick several channels when composing. Use the per-channel tabs in the editor to tweak the content for each platform before scheduling.',
  },
  {
    question: 'Can I change the colours of Studio templates?',
    answer:
      'Yes — nothing is fixed. Templates (and their previews) render in your Brand Kit colours: set them in Studio → Brand Kit (Primary drives accents like buttons and badges, Background the canvas, Text the copy) and every template redraws in your palette. After applying a template each element is still a normal layer — select a text or shape and the colour swatches restyle it, and the "Selected object" panel adjusts size, outline, opacity and rotation. With nothing selected the swatches change the canvas background instead. AI Generate uses the same Brand Kit, so generated designs come out in your colours too.',
  },
  {
    question: 'How do first comments and threads work?',
    answer:
      'Depending on the channel, the composer shows an extra button below your post. "Add comment" publishes a first comment right under the post on the platform — supported on LinkedIn and LinkedIn Page (text only), Telegram, Discord, Instagram and Facebook Pages. "Add post" chains additional posts into a thread — that\'s how X, Threads, Bluesky and Mastodon work. In both cases you can add several entries, reorder them, and give each one a Delay (1 min – 2 h presets or a custom number of minutes) so it publishes that long after the previous one. TikTok and YouTube don\'t support first comments. Where a channel supports them but the button is missing, reconnect that channel — the feature follows the permissions the platform granted at connect time. Separately, the comments you see when opening a post on the Calendar are internal team notes — they are never published anywhere.',
  },
];
