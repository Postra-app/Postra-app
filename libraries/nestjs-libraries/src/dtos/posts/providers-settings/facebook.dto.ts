import { IsIn, IsOptional, ValidateIf, IsUrl } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class FacebookDto {
  // Without a description the MCP's AI never fills it, so a link in the text
  // got no preview card (upstream 10bb71da6).
  @JSONSchema({
    description:
      'Link to attach as a preview card (image, title, domain), used only for text posts without media. A URL inside the content alone shows as plain text with no card',
  })
  @IsOptional()
  @ValidateIf(p => p.url)
  @IsUrl()
  url?: string;

  @IsIn(['post', 'story'])
  @IsOptional()
  post_type?: 'post' | 'story';
}
