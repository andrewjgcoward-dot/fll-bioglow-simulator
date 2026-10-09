# Shared library administration

The admin interface is `admin.html`. It offers Rename, Archive and Restore with
confirmation. Archive is a recoverable deletion: it hides the program from the
normal student list, blocks student access to its saved payload/history and
blocks every student edit, including writes from older clients. Restore makes
it available again. Program IDs do not change. Each action adds a revision;
previous names, archived states, raw blocks and starting poses remain immutable.
There is no permanent-delete control.

Only a Firebase ID token issued through Google sign-in, with
`email_verified == true` and exactly `mike.coward@gmail.com`, passes the database
admin rule. The server checks all three conditions for every administrative
write. Anonymous users and other Google accounts cannot rename, archive or
restore through direct API calls. The UI's sign-in state is not authorization.
The owner identity appears in the checked-in rules; it is an identifier, not a
secret. There is no admin key, service account, custom token issuer or backend.

Admin authentication uses a separate named Firebase app and session-scoped
browser persistence. Signing in/out of Admin does not replace the student's
anonymous session. Google authentication requests the standard basic profile
and email identity only. No Drive, Gmail or other Google service permissions
are requested. Firebase Console access is not granted to students or the UI.

## Live configuration

Owner-approved on 2026-10-09 in project `fll-bioglow-simulator` on Spark.
Google and Anonymous providers are enabled. The authorized app origins are
`andrewjgcoward-dot.github.io` and `localhost`, alongside Firebase's default
project domains. `src/admin-config.js` enables the interface. The reviewed
`firebase/database.rules.json` is published to the production database.

Google popup sign-in was verified in Mac Chrome using the approved owner.
Only standard name/profile and email identity consent appeared. No billing,
new legal terms, additional service permissions, admin credentials or CLI
access were added.

Live QA used a newly created synthetic program only. Cancel retained version 1;
rename, archive and restore produced versions 2–4 with identical raw workspace
and starting pose. Anonymous direct rename and admin-access requests were
denied. Archived payload reads were denied and the student list hid the row.
After restore, ordinary student editing and Save a copy succeeded; a stale
save was rejected. Existing student programs were not modified.

Existing data needs no migration. Missing `archived` means active. Older
student tabs can still submit ordinary edits with the existing name; a stale
name or archived program is rejected at the server. Reloading loads the new
list filter. Archived titles remain readable in bounded catalog metadata;
archive is not a confidentiality mechanism or a storage-quota cleanup tool.
Immutable copies still use database space. No existing program is renamed or
archived merely by installing this interface.

## Conflict and integrity behavior

The selected revision remains the base throughout the operation. A newer
student/admin revision causes a conflict; the admin must cancel, refresh and
explicitly try again. No automatic rebasing or overwrite occurs. Repeated
submit clicks are ignored while saving. Cancel before submission writes
nothing. Unknown successful responses recover by comparing the new revision
ID, avoiding duplicate writes.

Admin changes copy the stored payload exactly, including malformed raw JSON,
so an administrator can archive a bad student save without losing evidence.
Rules reject any metadata-changing revision that also alters the blocks or
pose. Old payload/history mutations and hard deletion are denied to admin
clients as well as students. Console project administrators remain privileged
outside these client rules.

## Local verification

`npm test` covers the normal simulator plus admin dialog/controller and paging
regressions. `npm run test:admin` runs isolated Auth/RTDB emulators on
127.0.0.1:9108 and 127.0.0.1:9018, project `demo-bioglow-admin`. It uses synthetic
accounts and unsigned emulator test claims only; none are real Google sessions.
The admin security suite checks verified identity, wrong/unverified/provider
identity denial, direct anonymous API attacks, legacy rows, exact payload
preservation, immutable history, archive filtering, stale/concurrent writes,
restoration, malformed-save archiving and independent student copies.

The original shared-library suite also passes against the staged rules on
these isolated ports, using BIOGLOW_DATABASE_ORIGIN, BIOGLOW_AUTH_ORIGIN and
BIOGLOW_DEMO_PROJECT. Mac Chrome popup and live synthetic QA passed on 2026-10-09.
