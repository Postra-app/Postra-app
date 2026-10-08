/**
 * When the assistant may schedule. In the app chat a person reads the details
 * and replies. Through MCP (`ask_postra`) the call comes from the customer's
 * own AI assistant, which has already confirmed the tool call with them, and
 * there is no second turn to confirm in (E2E-08-53) — so a complete request
 * is scheduled, and an incomplete one is answered with what is missing.
 * Moving and deleting keep their Approve card in the app either way.
 */
export const schedulingRule = (ui: boolean): string =>
  ui
    ? '- Before scheduling a post, always make sure you ask the user confirmation by providing all the details of the post (text, images, videos, date, time, social media platform, account). There is no card for a new post: ask them to reply to confirm.'
    : [
        "- This request comes through MCP from the customer's own AI assistant, which has already confirmed it with them; there is no way to ask them a follow-up question.",
        '- When the request names the channel, the date and time, and the text, schedule it without asking for confirmation, then report exactly what was scheduled (channel, date and time with time zone, text, attachments).',
        '- When any of those is missing or ambiguous, do not schedule: say exactly what is missing so it can be sent again in one message.',
        '- reschedulePost and deletePost still only ask: say that the person has to approve it in Postra.',
      ].join('\n      ');
