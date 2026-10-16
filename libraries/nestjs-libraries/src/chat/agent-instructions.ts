/**
 * When the assistant may schedule. In the app chat a person reads the details
 * and replies. Through MCP (`ask_postra`) the call comes from the customer's
 * own AI assistant, which has already confirmed the tool call with them, and
 * there is no second turn to confirm in (E2E-08-53) — so a complete request
 * is scheduled, and an incomplete one is answered with what is missing.
 * Moving and deleting need an Approve card that only the app chat shows, so
 * through MCP they are not offered at all.
 */
export const schedulingRule = (ui: boolean): string =>
  ui
    ? '- Before scheduling a post, always make sure you ask the user confirmation by providing all the details of the post (text, images, videos, date, time, social media platform, account). There is no card for a new post: ask them to reply to confirm.'
    : [
        "- This request comes through MCP from the customer's own AI assistant, which has already confirmed it with them; there is no way to ask them a follow-up question.",
        '- When the request names the channel, the date and time, and the text, schedule it without asking for confirmation, then report exactly what was scheduled (channel, date and time with time zone, text, attachments).',
        '- When any of those is missing or ambiguous, do not schedule: say exactly what is missing so it can be sent again in one message.',
        "- You cannot move or delete a post through MCP: the Approve card for that is only shown in Postra's own chat. Do not call reschedulePost or deletePost here; say it can be done in the Postra calendar, or by asking the assistant inside Postra.",
      ].join('\n      ');

/**
 * Moving and deleting only park the action behind an Approve card. The model
 * never learns what the person clicked, so "do not call the tool again while
 * a card is open" read as "never call it again": after a Decline, asking a
 * second time got "the card is already open" about a card that was gone
 * (nightly canary, 2026-10-15 and 10-16). Asking again is always a new card.
 * Through MCP there is no card at all and schedulingRule says so.
 */
export const confirmationCardRule = (ui: boolean): string =>
  ui
    ? '- To see, reschedule or delete EXISTING posts, first call listScheduledPosts to fetch them (it returns each post\'s "id" and "group"). Reschedule with reschedulePost (pass the "id"); delete with deletePost (pass the "group"). Both tools only ASK: they return "awaiting_confirmation" and the user gets a card with Approve and Decline. Nothing is deleted or moved until they click. So after calling one, say in one sentence what will happen and point at the card - do not ask them to type "yes", and do not claim the post is already deleted or moved. You cannot see whether the user approved or declined an earlier card, and cards expire, so every time the user asks to delete or move a post, call the tool again and show a new card, even for a post you showed a card for before - never answer that a card is already open. Always pass a short "summary" written in the user\'s language, because that sentence is what the card shows.'
    : '';
