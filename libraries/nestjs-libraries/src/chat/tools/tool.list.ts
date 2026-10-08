import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { UploadFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool';
import { MediaListTool } from '@gitroom/nestjs-libraries/chat/tools/media.list.tool';
import { ListScheduledPostsTool } from '@gitroom/nestjs-libraries/chat/tools/list.scheduled.posts.tool';
import { ReschedulePostTool } from '@gitroom/nestjs-libraries/chat/tools/reschedule.post.tool';
import { DeletePostTool } from '@gitroom/nestjs-libraries/chat/tools/delete.post.tool';
import { GetAnalyticsTool } from '@gitroom/nestjs-libraries/chat/tools/get.analytics.tool';
import { CreateBrandedDraftTool } from '@gitroom/nestjs-libraries/chat/tools/create.branded.draft.tool';

export const toolList = [
  IntegrationListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  GenerateImageTool,
  CreateBrandedDraftTool,
  UploadFromUrlTool,
  MediaListTool,
  ListScheduledPostsTool,
  ReschedulePostTool,
  DeletePostTool,
  GetAnalyticsTool,
];
