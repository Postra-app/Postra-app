'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

// No "Add a thread finisher" here: the Bluesky provider never reads the
// setting, so the switch did nothing, and its default text spoke of
// retweets. A control we offer has to work.

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: undefined,
  CustomPreviewComponent: undefined,
  dto: undefined,
  maximumCharacters: 300,
});
