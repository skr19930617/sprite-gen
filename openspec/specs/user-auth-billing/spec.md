# user-auth-billing Specification

## Purpose

TBD - created by archiving change sprite-generator-mvp. Update Purpose after archive.

## Requirements

### Requirement: Authentication required

The system SHALL require users to log in before uploading images, generating animations, or saving projects. Unauthenticated users MUST only see the marketing landing page and login screen.

#### Scenario: Unauthenticated user redirected

- **WHEN** an unauthenticated user navigates to `/upload` or `/projects`
- **THEN** the system redirects them to the login screen

### Requirement: Supabase Auth integration

The system SHALL use Supabase Auth for user authentication. Supported sign-in methods in MVP SHALL include email+password and at least one OAuth provider (Google).

#### Scenario: Email password login

- **WHEN** a user submits valid email and password credentials
- **THEN** Supabase Auth issues a session and the system grants access to authenticated routes

#### Scenario: Google OAuth login

- **WHEN** a user chooses "Googleで続ける" and completes the Google OAuth flow
- **THEN** Supabase Auth links the identity and the system grants access

### Requirement: Free-tier quota enforcement

The system SHALL enforce monthly free-tier limits: **10 successful generations per calendar month** and **5 saved projects total**. Free-tier quotas MUST reset at the start of each UTC month. Failed or timed-out generations MUST NOT count toward the generation quota.

#### Scenario: Successful generation increments counter

- **WHEN** a free-tier user completes a successful generation
- **THEN** the user's monthly generation counter increments by 1

#### Scenario: Failed generation does not count

- **WHEN** a free-tier user's generation times out or errors
- **THEN** the user's monthly generation counter is unchanged

#### Scenario: Generation quota blocks submission

- **WHEN** a free-tier user has already completed 10 generations this month and attempts an 11th
- **THEN** the system blocks the request before calling the renderer and displays an upgrade prompt

#### Scenario: Save quota blocks creation

- **WHEN** a free-tier user has 5 saved projects and attempts to create a 6th
- **THEN** the system blocks the save and displays an upgrade prompt

### Requirement: Paid plan via Stripe

The system SHALL integrate Stripe Checkout for paid plan subscription. On successful subscription, the user's plan status MUST be updated in the database and expanded quotas SHALL apply immediately. Concrete quota numbers for the paid plan SHALL be finalized in the design phase.

#### Scenario: Successful subscription upgrades plan

- **WHEN** a user completes Stripe Checkout for the paid plan
- **THEN** the system receives the Stripe webhook, updates the user's plan to "paid", and grants expanded quotas

#### Scenario: Subscription cancellation downgrades plan

- **WHEN** Stripe reports a subscription cancellation for a user
- **THEN** the system updates the plan back to "free" at the end of the current billing period

### Requirement: Secret isolation for auth and billing

The system SHALL keep the Supabase service-role key and Stripe secret key on the server side only. Client SHALL use only the Supabase anon key and Stripe publishable key.

#### Scenario: Client bundle contains no secrets

- **WHEN** the production client bundle is inspected
- **THEN** it contains no reference to the Supabase service-role key or Stripe secret key

### Requirement: Audit trail for plan changes

The system SHALL record every plan change (free→paid, paid→free) with a timestamp and the Stripe event id in a dedicated database table.

#### Scenario: Plan change recorded

- **WHEN** a user's plan changes due to a Stripe event
- **THEN** a row is inserted into the plan-change audit table with user id, old plan, new plan, timestamp, and Stripe event id
