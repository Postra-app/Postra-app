import { NotEnoughScopesFilter } from '@gitroom/nestjs-libraries/integrations/integration.missing.scopes';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// A box unticked on the platform's consent screen read "Not enough scopes,
// when choosing a provider, please add all the scopes": jargon that did not
// say what to do. The answer says it, and carries a code the web app
// turns into a sentence naming the platform.
describe('NotEnoughScopesFilter', () => {
  it('answers 409 with what to do and a code', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host: any = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new NotEnoughScopesFilter().catch(new NotEnoughScopes(), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      msg: 'The platform did not grant every permission Postra needs. Connect again and leave all the boxes ticked.',
      code: 'not_enough_scopes',
    });
  });
});
