# In-game feedback

Electrify stores each accepted report in the private **Electrify Feedback** spreadsheet.
The **Feedback** tab has a **Weekly review** filter view that shows newest reports first.
Use **Review status** to mark reports you have handled. The first eight columns are written
by the callable. Keep their order and include the hidden **Submission ID** column when
moving or sorting feedback rows.

Reports include the time received (UTC), message, optional reply email, menu or
milestone source, scenario ID and outcome when available, and game version.
Firestore stores the shared rate-limit counter and delivery receipts containing only
the submission hash, timing, and delivery status or write lease.

## Production setup

1. Enable the Google Sheets API and IAM Service Account Credentials API in the Firebase
   project `electrify-game`. Create a service account dedicated to writing the sheet,
   without project roles or a downloaded key.
2. On the writer service account, grant **Service Account Token Creator** to the callable's
   runtime service account. For an unmodified second-generation Firebase function, this is
   the project's Compute Engine default service account. The callable exchanges its runtime
   credentials for a short-lived token scoped to Google Sheets.
3. Keep the spreadsheet restricted and share it with the writer service account as an editor.
   In the `Feedback` tab, use these headers in row 1, from A through I: Received (UTC), Feedback,
   Reply email, Source, Scenario ID, Outcome, Game version, Submission ID, Review status.
4. In the release checkout, set `GAME_FEEDBACK_SPREADSHEET_ID` to the ID from the sheet URL and
   `GAME_FEEDBACK_SHEETS_WRITER` to the writer service account's email in
   `firebase/functions/.env.electrify-game`. Keep the project-specific file local.
5. Run `npm ci --prefix firebase/functions` and
   `npx firebase-tools@15 deploy --only functions:mailing-list:submitGameFeedback --project electrify-game`.
   The website workflow deploys `subscribeMailingList` separately. Repeat the targeted
   deploy after backend or feedback configuration changes.
6. Submit test feedback from the website and Steam game menu before release. Verify the
   in-game confirmation and a single corresponding row for each report.

The callable accepts anonymous submissions. It allows eight attempts per minute and 80 per
UTC day across all players. It sends values as literal data and confirms success after
Sheets acknowledges the row. Identical retries use the same submission ID. If an append
has an uncertain result, the callable allows a retry after just over three minutes and
checks the sheet for the original row before writing again. If it could not contact Sheets
to start the append, the same report can be retried immediately.
