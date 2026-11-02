import { ValidationPipeOptions } from '@nestjs/common';

// The global pipe's options, apart from main.ts so a test runs the same pipe.
export const validationPipeOptions: ValidationPipeOptions = {
  transform: true,
  // AE7: strip body/query properties that carry no validation decorator.
  // Without this, one future `data: {...body}` spread in a service is an
  // instant mass-assignment hole. Every DTO field the app actually
  // consumes must therefore be decorated — use @Allow() for opaque
  // passthrough objects (video params, integration function data).
  whitelist: true,
};
