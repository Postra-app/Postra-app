# Security Policy

Postra takes the security of its users' data seriously. This page says what is in scope, how to report a vulnerability and what to expect from us.

## Scope

- This repository (`github.com/Postra-app/Postra-app`): the Postra web app, API and scheduler.
- The hosted service at `app.postra.co.uk` and the sites `postra.co.uk` and `postra.pl`.
- The `@postra/node` SDK published from this repository.
- The other public repositories of the `Postra-app` organisation.

Vulnerabilities in third-party dependencies with no impact on Postra, and in infrastructure that someone else hosts, are out of scope. Please do not test against other customers' accounts or data; use an account of your own.

## Supported versions

Only the latest version on `main` is supported. It is the version that runs at `app.postra.co.uk`.

## Reporting a vulnerability

Report it privately, either way:

- through GitHub: [Report a vulnerability](https://github.com/Postra-app/Postra-app/security/advisories/new), or
- by email to **[hello@postra.co.uk](mailto:hello@postra.co.uk)** with "Security" in the subject. The same contact is published at <https://postra.co.uk/.well-known/security.txt>.

Please do not open a public issue for a vulnerability.

Include as much as you can:

- a clear description of the problem and its impact,
- steps to reproduce it, with a proof of concept where possible,
- any relevant requests, code or configuration.

### AI-assisted reports

Reports that include AI-assisted analysis are welcome when the reporter has validated them and they come with reproduction steps, a proof of concept and an impact assessment. Reports that appear to be generated without meaningful human analysis will be closed without a detailed response.

## Disclosure

We ask for private disclosure. We will not publish details of a vulnerability until a fix is available, and we ask reporters to do the same. We are glad to credit you once it is fixed, if you want that.

## What to expect

- **Acknowledgement:** within 72 hours of your report.
- **Triage and verification:** within 7 days of the acknowledgement.
- **Fix for a critical issue:** as fast as we can, and within 90 days of triage at the latest.
- **Fix for a non-critical issue:** within 180 days of triage.

We will tell you when the fix is live.
