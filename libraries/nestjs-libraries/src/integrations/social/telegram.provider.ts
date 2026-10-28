import { Logger } from '@nestjs/common';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
//@ts-ignore
import mime from 'mime';
import { Api, InputFile, TelegramApiError } from 'node-telegram-bot-api';
import { readFile } from 'fs/promises';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { Integration } from '@prisma/client';
import striptags from 'striptags';
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

// node-telegram-bot-api 2: the Bot API one to one, parameters as one object,
// errors as TelegramApiError (2026-10-27; 0.67 pulled in `request`, which has
// no fix, and old tough-cookie, qs and uuid). 2.x refuses an empty token when
// the client is built, so it is built on first use: at import time it took
// the whole backend down wherever TELEGRAM_TOKEN is not set.
let telegramApi: Api | undefined;
const telegram = () => (telegramApi ??= new Api(process.env.TELEGRAM_TOKEN!));

// The 1.x library read a non-URL string as a path on disk; 2.x sends strings
// as a file_id or URL. Local storage keeps its uploads on disk, so those and
// downloaded bytes go up as files.
const telegramFile = async (media: {
  media: string | Buffer;
  fileOptions: { filename?: string; contentType: string };
}) =>
  typeof media.media !== 'string'
    ? new InputFile(new Uint8Array(media.media), media.fileOptions)
    : mediaStorage === 'local' && !media.media.startsWith('http')
    ? new InputFile(
        new Uint8Array(await readFile(media.media)),
        media.fileOptions
      )
    : media.media;

const replyTo = (messageId?: number) =>
  messageId ? { reply_parameters: { message_id: messageId } } : {};
const TELEGRAM_UPDATES_LOCK = 'telegram-updates-lock';
const TELEGRAM_UPDATES_OFFSET = 'telegram-updates-offset';
const TELEGRAM_CONNECT_POSTS = 'telegram-connect-posts';
const TELEGRAM_PROOF_SECONDS = 15 * 60;
// Added to support local storage posting
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';
const mediaStorage = process.env.STORAGE_PROVIDER || 'local';

// Telegram fetches URL-passed media itself, with hard limits of 5 MB for
// photos and 20 MB for videos/documents — above that it fails with the
// misleading "wrong type of the web page content". Uploading the bytes
// ourselves raises the limits to 10 MB (photos) and 50 MB (videos/documents);
// beyond those the Bot API cannot take the file at all.
const URL_FETCH_LIMITS = {
  photo: 5 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  document: 20 * 1024 * 1024,
} as const;
const UPLOAD_LIMITS = {
  photo: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 50 * 1024 * 1024,
} as const;

export class TelegramProvider extends SocialAbstract implements SocialProvider {
  private readonly _logger = new Logger(TelegramProvider.name);
  override maxConcurrentJob = 3; // Telegram has moderate bot API limits
  identifier = 'telegram';
  name = 'Telegram';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  maxLength() {
    return 4096;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(17);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
    organizationId?: string;
  }) {
    const chat = await telegram().getChat({ chat_id: params.code });

    if (!chat?.id) {
      return 'No chat found';
    }

    // The chat id or @username alone connected any chat the shared bot was
    // in. The proof is "/connect <word>" posted in the chat,
    // which getBotId sees; it is good for one connection, briefly.
    // The proof belongs to the organisation whose wizard saw the message:
    // another organisation naming the chat in that window could
    // otherwise take it.
    // Compared before it is spent, so another organisation naming the chat
    // cannot use up the rightful one's proof; GETDEL keeps it
    // good for one connection.
    const proofKey = `telegram-proven:${chat.id}`;
    const proven = await ioRedis.get(proofKey);
    if (
      !proven ||
      (params.organizationId && proven !== params.organizationId) ||
      (await ioRedis.getdel(proofKey)) !== proven
    ) {
      return 'Post the /connect message in the chat first';
    }

    // The file URL carries the bot token; the picture is downloaded and
    // stored by us (createOrUpdateIntegration), the URL is never kept.
    const file = chat?.photo?.big_file_id
      ? await telegram().getFile({ file_id: chat.photo.big_file_id })
      : undefined;
    const photo = file?.file_path
      ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`
      : '';

    // Modified id to work with chat.username (public groups/channels) or chat.id (private groups/channels) when chat.username is not available
    return {
      id: String(chat.username ? chat.username : chat.id),
      name: chat.title!,
      accessToken: String(chat.id),
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: photo || '',
      username: chat.username!,
    };
  }

  // One bot serves every organisation, and getUpdates with an offset
  // confirms every earlier update for all of them. Each wizard sent its own
  // offset, so one organisation polling ate another's "/connect" and that
  // wizard waited for ever. The server now reads the updates once,
  // under a lock, and keeps the recent "/connect" posts for every wizard to
  // look through; nothing else from the chats is kept.
  private async recentConnectPosts(): Promise<
    {
      raw: string;
      chatId: number;
      text: string;
      messageId: number;
      at: number;
    }[]
  > {
    if (
      (await ioRedis.set(TELEGRAM_UPDATES_LOCK, '1', 'EX', 10, 'NX')) === 'OK'
    ) {
      try {
        const offset = Number(await ioRedis.get(TELEGRAM_UPDATES_OFFSET));
        const res = await telegram().getUpdates({
          ...(offset ? { offset } : {}),
          allowed_updates: ['message', 'channel_post'],
        });
        const posts = res
          .map((u) =>
            'message' in u
              ? u.message
              : 'channel_post' in u
              ? u.channel_post
              : undefined
          )
          .filter((m) => m?.chat?.id && m?.text?.startsWith('/connect '))
          .map((m) =>
            JSON.stringify({
              chatId: m!.chat.id,
              text: m!.text,
              messageId: m!.message_id,
              at: Date.now(),
            })
          );
        if (posts.length) {
          await ioRedis.rpush(TELEGRAM_CONNECT_POSTS, ...posts);
          await ioRedis.ltrim(TELEGRAM_CONNECT_POSTS, -200, -1);
          await ioRedis.expire(TELEGRAM_CONNECT_POSTS, TELEGRAM_PROOF_SECONDS);
        }
        if (res.length) {
          await ioRedis.set(
            TELEGRAM_UPDATES_OFFSET,
            String(res[res.length - 1].update_id + 1)
          );
        }
      } finally {
        await ioRedis.del(TELEGRAM_UPDATES_LOCK);
      }
    }
    const since = Date.now() - TELEGRAM_PROOF_SECONDS * 1000;
    return (await ioRedis.lrange(TELEGRAM_CONNECT_POSTS, 0, -1))
      .map((raw) => ({ raw, ...JSON.parse(raw) }))
      .filter((p) => p.at >= since);
  }

  // `query.id` (the offset the wizard used to send) is no longer used: the
  // server keeps the offset.
  async getBotId(
    query: { id?: number; word: string },
    organizationId?: string
  ) {
    const posts = await this.recentConnectPosts();
    const found = posts.find((p) => p.text === `/connect ${query.word}`);
    if (found) {
      await ioRedis.lrem(TELEGRAM_CONNECT_POSTS, 1, found.raw);
    }
    const chatId = found?.chatId;

    // prevents the code from running while chatId is still undefined to avoid the error 'ETELEGRAM: 400 Bad Request: chat_id is empty'. the code would still work eventually but console spam is not pretty
    if (chatId) {
      await ioRedis.set(
        `telegram-proven:${chatId}`,
        organizationId || '1',
        'EX',
        TELEGRAM_PROOF_SECONDS
      );
      //get the numberic ID of the bot
      const botId = (await telegram().getMe()).id;
      // check if the bot is an admin in the chat
      const isAdmin = await this.botIsAdmin(chatId, botId);
      // get the messageId of the message that triggered the connection
      const connectMessageId = found!.messageId;

      if (!isAdmin) {
        // alternatively you can log here instead if you do not want to inform the user of the bot's admin status
        telegram()
          .sendMessage({
            chat_id: chatId,
            text: "Connection Successful. I don't have admin privileges to delete these messages, please go ahead and remove them yourself.",
          })
          .catch(() => undefined);
      } else {
        // Delete the message that triggered the connection
        await telegram().deleteMessage({
          chat_id: chatId,
          message_id: connectMessageId,
        });
        // Send success message to the chat
        const successMessage = await telegram().sendMessage({
          chat_id: chatId,
          text: 'Connection Successful. Message will be deleted in 10 seconds.',
        });
        // Delete the success message after 10 seconds
        setTimeout(() => {
          telegram()
            .deleteMessage({
              chat_id: chatId,
              message_id: successMessage.message_id,
            })
            .catch(() => undefined);
        }, 10000);
      }
    }

    return chatId ? { chatId } : {};
  }

  private processMedia(mediaFiles: PostDetails['media']) {
    return (mediaFiles || []).map((media) => {
      let mediaUrl = media.path;
      if (mediaStorage === 'local' && mediaUrl.startsWith(frontendURL)) {
        mediaUrl = mediaUrl.replace(frontendURL, '');
      }
      //get mime type to pass contentType to telegram api.
      //some photos and videos might not pass telegram api restrictions, so they are sent as documents instead of returning errors
      const mimeType = mime.getType(mediaUrl); // Detect MIME type
      let mediaType: 'photo' | 'video' | 'document';

      if (mimeType?.startsWith('image/')) {
        mediaType = 'photo';
      } else if (mimeType?.startsWith('video/')) {
        mediaType = 'video';
      } else {
        mediaType = 'document';
      }

      return {
        type: mediaType,
        media: mediaUrl as string | Buffer,
        fileOptions: {
          filename: media.path.split('/').pop(),
          contentType: mimeType || 'application/octet-stream',
        },
      };
    });
  }

  // Telegram downloads URL-passed media itself and rejects files above the
  // URL-fetch limits with "wrong type of the web page content". Small files
  // keep going through as URLs; larger ones are downloaded and uploaded as
  // bytes (higher limits); files Telegram cannot take at all fail with a
  // clear error instead.
  private async resolveMedia(media: {
    type: 'photo' | 'video' | 'document';
    media: string | Buffer;
    fileOptions: { filename?: string; contentType: string };
  }) {
    if (
      typeof media.media !== 'string' ||
      !media.media.startsWith('http') ||
      !(await isSafePublicHttpsUrl(media.media))
    ) {
      return media;
    }

    let size = 0;
    try {
      const head = await fetch(media.media, {
        method: 'HEAD',
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      size = Number(head.headers.get('content-length')) || 0;
    } catch {
      // Size unknown — keep the URL and let Telegram try it.
      return media;
    }

    if (size <= URL_FETCH_LIMITS[media.type]) {
      return media;
    }

    const uploadLimit = UPLOAD_LIMITS[media.type];
    if (size > uploadLimit) {
      throw new Error(
        `Telegram accepts ${media.type}s up to ${Math.round(
          uploadLimit / 1024 / 1024
        )} MB - this file is ${Math.ceil(
          size / 1024 / 1024
        )} MB. Please use a smaller file.`
      );
    }

    const res = await fetch(media.media, {
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
    });
    return { ...media, media: Buffer.from(await res.arrayBuffer()) };
  }

  // Telegram's own 4xx (caption too long, chat not found, bot kicked...) will
  // fail the same way on every attempt; as a plain error Temporal retried it
  // for minutes before the post turned red. BadBody is non-retryable and
  // carries Telegram's sentence to the notification.
  private async sendMessage(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    try {
      return await this.sendMessageUnguarded(
        accessToken,
        message,
        replyToMessageId
      );
    } catch (err: any) {
      if (
        err instanceof TelegramApiError &&
        err.errorCode >= 400 &&
        err.errorCode < 500 &&
        err.errorCode !== 429
      ) {
        throw new BadBody(
          'telegram',
          JSON.stringify({
            error_code: err.errorCode,
            description: err.description,
          }),
          '{}',
          err.description || err.message
        );
      }
      throw err;
    }
  }

  private async sendMessageUnguarded(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const text = striptags(message.message || '', ['u', 'strong', 'p'])
      .replace(/<strong>/g, '<b>')
      .replace(/<\/strong>/g, '</b>')
      // With attributes too: dir="auto" from the editor, class from the API.
      .replace(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g, '$1\n');

    // A caption under a photo/video is capped at 1024 characters (a plain
    // message at 4096). A longer text goes out as its own message right after
    // the media instead of failing the whole post.
    const captionFits = striptags(text).length <= 1024;
    const caption = captionFits ? text : undefined;

    const processedMedia = await Promise.all(
      this.processMedia(mediaFiles).map((m) => this.resolveMedia(m))
    );

    // if there's no media, bot sends a text message only
    if (processedMedia.length === 0) {
      const response = await telegram().sendMessage({
        chat_id: accessToken,
        text,
        parse_mode: 'HTML',
        ...replyTo(replyToMessageId),
      });
      messageId = response.message_id;
    }
    // if there's only one media, bot sends the media with the text message as caption
    else if (processedMedia.length === 1) {
      const media = processedMedia[0];
      const options = {
        chat_id: accessToken,
        caption,
        parse_mode: 'HTML' as const,
        ...replyTo(replyToMessageId),
      };
      const file = await telegramFile(media);
      const response =
        media.type === 'video'
          ? await telegram().sendVideo({ ...options, video: file })
          : media.type === 'photo'
          ? await telegram().sendPhoto({ ...options, photo: file })
          : await telegram().sendDocument({ ...options, document: file });
      messageId = response.message_id;
    }
    // if there are multiple media, bot sends them as a media group - max 10 media per group - with the text as a caption (if there are more than 1 group, the caption will only be sent with the first group)
    else {
      const mediaGroups = this.chunkMedia(processedMedia, 10);
      for (let i = 0; i < mediaGroups.length; i++) {
        const mediaGroup = await Promise.all(
          mediaGroups[i].map(async (m, index) => ({
            type: m.type === 'document' ? 'document' : m.type, // Documents are not allowed in media groups
            media: await telegramFile(m as any),
            caption: i === 0 && index === 0 ? caption : undefined,
            parse_mode: 'HTML',
          }))
        );

        const response = await telegram().sendMediaGroup({
          chat_id: accessToken,
          media: mediaGroup as any[],
          ...(i === 0 ? replyTo(replyToMessageId) : {}),
        });
        if (i === 0) {
          messageId = response[0].message_id;
        }
      }
    }

    if (processedMedia.length > 0 && !captionFits && text.trim()) {
      await telegram().sendMessage({
        chat_id: accessToken,
        text,
        parse_mode: 'HTML',
        ...replyTo(messageId ?? undefined),
      });
    }

    return messageId;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.sendMessage(accessToken, firstPost);

    // for private groups/channels message.id is undefined so the link generated by Postra will be unusable "https://t.me/c/undefined/16"
    // to avoid that, we use accessToken instead of message.id and we generate the link manually removing the -100 from the start.
    if (messageId) {
      return [
        {
          id: firstPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = Number(lastCommentId || postId);

    const messageId = await this.sendMessage(
      accessToken,
      commentPost,
      replyToId
    );

    if (messageId) {
      return [
        {
          id: commentPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }
  // chunkMedia is used to split media into groups of "size". 10 is used here because telegram api allows a maximum of 10 media per group
  private chunkMedia(
    media: { type: string; media: string | Buffer }[],
    size: number
  ) {
    const result = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    return result;
  }

  async botIsAdmin(chatId: number, botId: number): Promise<boolean> {
    try {
      const chatMember = await telegram().getChatMember({
        chat_id: chatId,
        user_id: botId,
      });

      // A bot is never the creator; an administrator says what it may do.
      // The generated types keep `status` a plain string, so they cannot
      // narrow the union.
      return (
        chatMember.status === 'administrator' &&
        'can_delete_messages' in chatMember &&
        !!chatMember.can_delete_messages
      );
    } catch (error) {
      this._logger.warn(
        `Error checking bot privileges: ${(error as Error)?.message ?? error}`
      );
      return false;
    }
  }
}
