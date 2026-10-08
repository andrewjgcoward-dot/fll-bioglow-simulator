# Shared program library (staged; live setup not yet performed)

The same static frontend works on the laptop and GitHub Pages. It calls Firebase
Realtime Database over HTTPS; it does not require the Mac to stay on. Use the
HTTPS Pages site for normal access. HTTP LAN pages can make outbound HTTPS
requests, but their own application code is not protected from network tampering.
Use localhost for development. No LAN binding, TLS, tunnel, or server change is
included in this feature.

## What users get

- Shared programs: a flat list, 20 metadata entries at a time, with More.
- Save: explicitly confirms adding a version to the currently loaded program.
- Save a copy: creates a distinct program ID, including when names match.
- History: 20 revision summaries at a time. Restore adds a new revision and
  restores its workspace and configured initial x/y/heading. It does not delete
  or modify the earlier revision.
- Full raw Blockly workspace is retained, including layout, IDs, variables,
  comments and unfinished/disconnected blocks. Robot configuration is unchanged.
- A stale save is rejected without replacing local work. The user can load the
  latest shared version or Save a copy. There is no automatic overwrite/rebase.
- Invalid/canceled loads preserve the visible workspace and pose. Loading uses a
  disposable Blockly workspace, checks exact serialization, and rolls back a
  partial visible-editor failure.
- SPIKE import/export and existing browser autosave remain available. Opening an
  imported/demo/shared-link program clears the selected cloud program to avoid
  inadvertently overwriting a different program.

Internet is required for shared operations. There is no offline write queue or
continuous autosave to Firebase. Auth is lazy: the first library operation starts
anonymous sign-in, with Firebase's normal local browser persistence. Reloads
reuse that identity; different browsers/origins can have different identities.
There is no student account form or password. Optional nicknames are unverified
labels; use project names/nicknames, not real names or personal information.

## Deliberately open access and limits

Anyone who opens the public simulator can obtain an anonymous identity and read,
create and edit any program. UID is attribution, not ownership or classroom
membership. There is no owner-only lockout and no secret class access code.
Anonymous Auth and immutable history do NOT prevent spam, repeated edits,
abusive content or quota exhaustion. No App Check is configured. Admins with
Firebase console/Admin access can bypass rules; immutable means client-immutable.
A dedicated new Firebase project should contain only this new program library.

The checked-in rules deny unauthenticated access and unrelated paths. A save is
one atomic multi-location update of catalog metadata, a new immutable history
header and its payload. The next sequence, previous revision and matching
metadata/payload must all agree. Old revisions cannot be overwritten/deleted;
parent deletion is denied. Rules do not rely on the frontend's overwrite dialog.

The app caps each encoded save at 128 KiB, 2,000 blocks and bounded depth/fields.
Database rules validate exact metadata and pose fields, numeric ranges, names,
author UID, server timestamp and a 131,072-character workspace-string limit.
RTDB rules cannot parse embedded JSON or enforce an exact UTF-8 byte length.
A modified client can therefore write malformed workspace text within that
character limit. The app structurally validates it, then stages the Blockly load,
and refuses invalid or lossy data without changing current work. Tests explicitly
verify this limitation. String limits can permit more UTF-8 bytes than characters.

Gallery and history queries return bounded metadata only; individual payloads are
fetched only on load/restore. Root reads and unbounded collection reads are denied.
No whole-gallery payload subscriptions are used. Limits bound individual requests,
not total usage. History grows and is not automatically pruned.

As checked 2026-10-08, Spark Realtime Database includes 1 GB stored, 10 GB/month
downloads and 100 simultaneous connections, with no payment method required.
Firebase documents 100 new Auth accounts/hour/IP; shared school networks can hit
this, especially after clearing browser data or using many new browsers. Quotas
can change. Monitor usage; hitting limits can interrupt the shared library.
Do not enable Blaze/billing or upgrade Auth to Identity Platform for this feature.

Sources:
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/database/usage/limits
- https://firebase.google.com/docs/auth/limits
- https://firebase.google.com/docs/auth/web/anonymous-auth
- https://firebase.google.com/docs/reference/security/database

## Live project and repeatable setup

The approved dedicated project is `fll-bioglow-simulator`, on the free Spark
plan, with Analytics off and no billing account linked. Anonymous Auth and the
reviewed database rules are enabled. `src/firebase-config.js` contains only its
public web configuration. No admin credentials are shipped or needed. The
database is in `us-central1`. For a separate installation, create a dedicated
project with the owner's approval and follow these steps.

1. Create a dedicated Firebase project in the intended Google account on Spark.
   Keep billing unlinked and Analytics off; no existing data/project is needed.
2. Add a Web app. Firebase Hosting is not needed; retain GitHub Pages.
3. Enable Authentication > Sign-in method > Anonymous only. Do not enable other
   providers, automatic cleanup/Identity Platform upgrades or App Check here.
4. Create Realtime Database (NOT Firestore) in the chosen region, initially locked.
5. Review and publish exactly `firebase/database.rules.json` to this new database.
   This is the consequential access change: every anonymously signed-in visitor
   can read and edit the new library. No general `auth != null` root-write rule.
6. Copy the public Web app configuration into `src/firebase-config.js`:

   ```js
   export const firebaseConfig = {
     apiKey: 'PUBLIC_WEB_API_KEY',
     authDomain: 'PROJECT_ID.firebaseapp.com',
     projectId: 'PROJECT_ID',
     databaseURL: 'https://EXACT_DATABASE_URL_FROM_CONSOLE/',
     appId: 'PUBLIC_WEB_APP_ID'
   };
   ```

   `databaseURL` must be the exact RTDB URL, including its region if present.
   No service account JSON, admin private key, database secret or user password
   belongs in this file. The public API key is not an access-control mechanism;
   the database Security Rules are. Do not paste access tokens into URLs manually.
7. Review Auth authorized domains/API-key restrictions for the approved Pages
   hostname and localhost development; do not wildcard unrelated domains or
   configure a LAN tunnel. Anonymous sign-in has no OAuth redirect flow.
8. Smoke-test a first synthetic program from two independent browser origins:
   create, shared edit, stale-save rejection, history restore, malformed load,
   refresh, and blocked unauthenticated write. Then review before publishing code.

## Local testing and reproducible build

Node 22 and Java 17 were used with pinned firebase-tools 14.22.0, Firebase SDK
12.5.0 and esbuild 0.28.2. Java 21 is recommended for newer future CLI releases.
No global installations are needed. The browser ships only the bundled Auth SDK;
the RTDB adapter uses bounded REST requests, not a long-lived subscription.

```sh
npm ci
npm run build:firebase
npm test
npm run test:firebase
```

`test:firebase` launches Auth and RTDB emulators only, project `demo-bioglow`, on
127.0.0.1 ports 9098 and 9008. The first run downloads the official RTDB emulator.
It uses synthetic users/data and never a production Firebase project. The normal
unit suite intentionally skips emulator tests unless BIOGLOW_EMULATOR_TEST=1;
SPIKE fixture testing also skips unless optional local fixtures are supplied.

The emulator tests prove cross-user editing, immutable revisions, restore,
concurrency, unauthenticated rejection, bounded query rules, field/name/pose/size
validation, spoofed-author rejection and atomic completeness. Unit tests cover
network failure recovery without duplicate writes, conflict behavior, unsafe
endpoints/paths, portable serialization and editor rollback.

## Unfinished editor workspaces

Shared saves, history restores and local autosaves preserve the raw Blockly
workspace, including disconnected value blocks and disabled start blocks.
`workspace-session.js` is the app's common capture/restore/autosave boundary;
it does not convert editor contents into an executable program. Raw autosaves
carry `workspaceFormat: 1` so refresh also restores them without executable
validation. Run, SPIKE export and share-link export still convert and validate
strictly, and cannot reuse a previous workspace's cached executable program.

History restore stages and validates the raw candidate before publishing its
new revision. Invalid storage shape, pose or a lossy Blockly round trip fails
before the write. The UI callback regression tests cover both unfinished cases
and verify that a malformed candidate makes zero publication calls.
