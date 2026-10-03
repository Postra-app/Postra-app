import { isOwnMediaUrl } from './own.media.url';
import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return (
      !!text?.split?.('?')?.[0].endsWith('.png') ||
      !!text?.split?.('?')?.[0].endsWith('.jpg') ||
      !!text?.split?.('?')?.[0].endsWith('.jpeg') ||
      !!text?.split?.('?')?.[0].endsWith('.gif') ||
      !!text?.split?.('?')?.[0].endsWith('.webp') ||
      !!text?.split?.('?')?.[0].endsWith('.mp4')
    );
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4'
    );
  }
}

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    // Exact host, not a substring: "evil.example/cdn-dev.postra.pl/x.png" used
    // to pass, and with RESTRICT_UPLOAD_DOMAINS unset nothing was checked.
    return isOwnMediaUrl(text || '');
  }

  defaultMessage(args: ValidationArguments) {
    return 'Media must be uploaded to Postra first (upload, media library or stock import).';
  }
}
